-- StudySpire account bios, verified role titles, self-service deletion and permanent-ban expiry.
begin;
alter table public.ss_profiles
  add column if not exists bio text not null default '' check (char_length(bio)<=180),
  add column if not exists perma_banned_at timestamptz;
-- Old permanent bans have no reliable start timestamp. Their 30-day period
-- begins at migration, so no existing account is deleted unexpectedly.
update public.ss_profiles
set perma_banned_at=now()
where banned=true and banned_until is null and perma_banned_at is null;

create or replace function ss_private.ss_track_permanent_ban()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.banned=true and new.banned_until is null then
   if tg_op='INSERT' or old.banned is distinct from true
     or old.banned_until is not null or new.perma_banned_at is null then
     new.perma_banned_at:=now();
   end if;
 else
   new.perma_banned_at:=null;
 end if;
 return new;
end;
$$;
drop trigger if exists ss_track_permanent_ban on public.ss_profiles;
create trigger ss_track_permanent_ban before insert or update
  of banned,banned_until,perma_banned_at on public.ss_profiles
  for each row execute function ss_private.ss_track_permanent_ban();
revoke all on function ss_private.ss_track_permanent_ban() from public,anon,authenticated;

-- Public, exact-username role titles cannot be forged using client UI.
create or replace function public.ss_public_profile(chosen_username text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare response jsonb; name_clean text;
begin
 name_clean:=lower(btrim(coalesce(chosen_username,'')));
 if name_clean !~ '^[a-z0-9_-]{3,32}$' then return null; end if;
 select pg_catalog.jsonb_build_object('username',p.username,'role',p.role,'bio',p.bio)
 into response
 from public.ss_profiles p
 where p.username=name_clean
 and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
 return response;
end;
$$;
create or replace function public.ss_public_titles(chosen_usernames text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare response jsonb;
begin
 if chosen_usernames is null or cardinality(chosen_usernames)>16 then
   raise exception 'Too many profile titles requested'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'username',p.username,'role',p.role,'bio',p.bio
 )),'[]'::jsonb) into response
 from public.ss_profiles p
 where p.username=any(chosen_usernames)
   and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
 return response;
end;
$$;

create or replace function public.ss_profile_set_bio(new_bio text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare who uuid := public.ss_current_profile_id(); cleaned text;
begin
 if who is null or not (select public.ss_can_use()) then
   raise exception 'Sign in to edit your bio'; end if;
 cleaned:=btrim(coalesce(new_bio,''));
 if char_length(cleaned)>180 then raise exception 'Bio must be 180 characters or fewer'; end if;
 if ss_private.ss_chat_language_violation(cleaned) is not null then
   raise exception 'Please remove inappropriate language from your bio'; end if;
 update public.ss_profiles p set bio=cleaned where p.id=who;
 if not found then raise exception 'Account unavailable'; end if;
 return (select pg_catalog.jsonb_build_object('username',p.username,'role',p.role,'bio',p.bio)
   from public.ss_profiles p where p.id=who);
end;
$$;

-- Protect the last Owner; re-check credentials before permanently erasing an account.
-- Profile deletion cascades private messages, reports, friendships, study data, etc.
create or replace function public.ss_delete_my_account(confirmed_username text, confirmed_password text)
returns boolean language plpgsql security definer set search_path='' as $$
declare
 actor uuid := public.ss_current_profile_id();
 active_auth uuid := (select auth.uid());
 real_name text; own_role text; pw_hash text; auth_ids uuid[];
begin
 if actor is null or active_auth is null then raise exception 'Sign in first'; end if;
 if confirmed_password is null or octet_length(confirmed_password) not between 1 and 72 then
   raise exception 'Enter your current password'; end if;
 select p.username,p.role into real_name,own_role
   from public.ss_profiles p where p.id=actor for update;
 if real_name is null or lower(btrim(coalesce(confirmed_username,'')))<>real_name then
   raise exception 'Username does not match the signed-in account'; end if;
 select c.password_hash into pw_hash from ss_private.username_credentials c
   where c.user_id=actor;
 if pw_hash is null then
   select u.encrypted_password into pw_hash from auth.users u where u.id=actor;
 end if;
 if pw_hash is null or pw_hash<>extensions.crypt(confirmed_password,pw_hash) then
   raise exception 'Incorrect current password'; end if;
 if own_role='owner' then
   perform pg_catalog.pg_advisory_xact_lock(82619,3782);
   if (select count(*) from public.ss_profiles where role='owner')<=1 then
     raise exception 'The final Owner cannot delete their account; appoint another Owner first';
   end if;
 end if;
 select array_agg(s.session_uid) into auth_ids
 from ss_private.username_sessions s where s.user_id=actor;
 insert into public.ss_admin_audit(actor_id,target_id,action,details)
   values(actor,actor,'account_self_delete','Account holder confirmed permanent removal');
 delete from public.ss_profiles where id=actor;
 delete from auth.users where id=actor;
 delete from auth.users u where u.id=any(coalesce(auth_ids,array[]::uuid[])) and u.is_anonymous;
 return true;
end;
$$;

-- Private cron entrypoint. No direct browser execution or ad-hoc deletes.
create or replace function ss_private.ss_expire_permanent_bans()
returns integer language plpgsql security definer set search_path='' as $$
declare
  doomed record;
  linked_sessions uuid[];
  cleaned integer := 0;
begin
  for doomed in
    select p.id,p.username from public.ss_profiles p
    where p.banned=true and p.banned_until is null
      and p.perma_banned_at<=now()-interval '30 days'
      and p.role<>'owner'
    for update skip locked
  loop
    select array_agg(s.session_uid) into linked_sessions
      from ss_private.username_sessions s where s.user_id=doomed.id;
    insert into public.ss_admin_audit(actor_id,target_id,action,details)
      values(null,doomed.id,'permanent_ban_expired','Deleted after 30-day permanent-ban waiting period');
    delete from public.ss_profiles where id=doomed.id;
    delete from auth.users where id=doomed.id;
    delete from auth.users u where u.id=any(coalesce(linked_sessions,array[]::uuid[]))
      and u.is_anonymous;
    cleaned:=cleaned+1;
  end loop;
  return cleaned;
end;
$$;
revoke all on function ss_private.ss_expire_permanent_bans() from public,anon,authenticated;
revoke all on function public.ss_public_profile(text),public.ss_public_titles(text[]),
 public.ss_profile_set_bio(text),public.ss_delete_my_account(text,text)
 from public,anon,authenticated;
grant execute on function public.ss_public_profile(text),public.ss_public_titles(text[])
 to anon,authenticated;
grant execute on function public.ss_profile_set_bio(text),public.ss_delete_my_account(text,text)
 to authenticated;
commit;