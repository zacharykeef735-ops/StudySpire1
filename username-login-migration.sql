-- STUDY SUMMIT · USERNAME-ONLY CLOUD LOGIN (add-on migration)
-- For an existing Study Summit v3.75/v3.76 Supabase project.
-- Run the ORIGINAL supabase.sql first. This script keeps existing data and roles.
-- IMPORTANT: This prepares the database ONLY; the website's cloud.js must be updated
-- to call signInAnonymously(), ss_username_register() and ss_username_login().
-- In Supabase > Authentication > Sign In / Providers, enable Anonymous Sign-Ins.
-- Username accounts created with this method do NOT collect email or phone numbers.
-- Passwords are stored as bcrypt hashes; forgotten-password email recovery is unavailable.

begin;
create extension if not exists pgcrypto;
create schema if not exists ss_private;
revoke all on schema ss_private from public, anon, authenticated;

-- During beta, the username 'admin' may be claimed, but never grants any privileges by itself.\n-- All new accounts are students until an Owner explicitly changes their role.\n-- Password hashes and browser-session mappings are NEVER readable by browsers.
create table if not exists ss_private.username_credentials (
  user_id uuid primary key references public.ss_profiles(id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists ss_private.username_sessions (
  session_uid uuid primary key references auth.users(id) on delete cascade,
  user_id uuid not null references public.ss_profiles(id) on delete cascade,
  logged_in_at timestamptz not null default now()
);
create index if not exists ss_username_sessions_user_idx on ss_private.username_sessions(user_id);
create table if not exists ss_private.username_login_limits (
  user_id uuid primary key references ss_private.username_credentials(user_id) on delete cascade,
  failures integer not null default 0,
  locked_until timestamptz
);
revoke all on all tables in schema ss_private from public, anon, authenticated;

-- Supabase anonymous users have no username metadata. They must be able to obtain
-- a temporary Supabase session BEFORE choosing an application username.
create or replace function public.ss_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare chosen text;
begin
  if new.is_anonymous then return new; end if;
  chosen := lower(trim(coalesce(new.raw_user_meta_data->>'username','')));
  if chosen !~ '^[a-z0-9_-]{3,32}$'
    or chosen in ('owner','moderator','staff','support','official') then
    raise exception 'Choose a valid username (3–32 letters, numbers, _ or -).';
  end if;
  insert into public.ss_profiles(id,username,role) values(new.id,chosen,'student');
  return new;
end;
$$;

-- Resolve the real Study Summit account for this Supabase session.
-- Fallback keeps existing email/password cloud accounts working unchanged.
create or replace function public.ss_current_profile_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.user_id from ss_private.username_sessions s where s.session_uid=(select auth.uid())),
    (select p.id from public.ss_profiles p where p.id=(select auth.uid()))
  );
$$;

-- Registration: the client first calls client.auth.signInAnonymously().
-- Then call: client.rpc('ss_username_register', { chosen_username, chosen_password }).
create or replace function public.ss_username_register(chosen_username text, chosen_password text)
returns uuid language plpgsql security definer set search_path = pg_catalog, extensions as $$
declare
  session_id uuid := auth.uid();
  name_clean text := lower(trim(coalesce(chosen_username,'')));
begin
  if session_id is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'true' then
    raise exception 'Start an anonymous Supabase session first';
  end if;
  if (select public.ss_current_profile_id()) is not null then
    raise exception 'Sign out before creating another account';
  end if;
  if name_clean !~ '^[a-z0-9_-]{3,32}$'
    or name_clean in ('owner','moderator','staff','support','official') then
    raise exception 'Username must be 3–32 letters, numbers, _ or -';
  end if;
  if chosen_password is null or char_length(chosen_password)<10
    or octet_length(chosen_password)>72 then
    raise exception 'Use a password of at least 10 characters and at most 72 bytes';
  end if;
  insert into public.ss_profiles(id,username,role) values(session_id,name_clean,'student');
  insert into ss_private.username_credentials(user_id,password_hash)
    values(session_id,crypt(chosen_password,gen_salt('bf',12)));
  insert into ss_private.username_sessions(session_uid,user_id)
    values(session_id,session_id);
  return session_id;
exception when unique_violation then
  raise exception 'This username is already taken or the session has an account';
end;
$$;

-- Login: a new device starts its OWN anonymous session first, then provides
-- the username + password. Failure tracking is shared across devices.
-- A false result means invalid credentials or a temporary lockout.
create or replace function public.ss_username_login(chosen_username text, chosen_password text)
returns boolean language plpgsql security definer set search_path = pg_catalog, extensions as $$
declare
  session_id uuid := auth.uid();
  account_id uuid;
  stored_hash text;
  attempt_count integer;
  lock_expires timestamptz;
begin
  if session_id is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'true' then
    raise exception 'Start an anonymous Supabase session first';
  end if;
  if chosen_username is null or chosen_password is null
     or octet_length(chosen_password)>72 then return false; end if;
  select p.id, c.password_hash into account_id, stored_hash
    from public.ss_profiles p
    join ss_private.username_credentials c on c.user_id=p.id
    where p.username=lower(trim(chosen_username));
  if account_id is null then return false; end if;
  insert into ss_private.username_login_limits(user_id)
    values(account_id) on conflict (user_id) do nothing;
  select l.failures,l.locked_until into attempt_count,lock_expires
    from ss_private.username_login_limits l
    where l.user_id=account_id for update;
  if lock_expires is not null and lock_expires>now() then return false; end if;
  if crypt(chosen_password,stored_hash)=stored_hash then
    update ss_private.username_login_limits
       set failures=0,locked_until=null where user_id=account_id;
    insert into ss_private.username_sessions(session_uid,user_id)
      values(session_id,account_id)
      on conflict (session_uid) do update
         set user_id=excluded.user_id,logged_in_at=now();
    return true;
  end if;
  update ss_private.username_login_limits
    set failures=case when lock_expires is not null and lock_expires<=now()
                      then 1 else failures+1 end,
        locked_until=case when (case when lock_expires is not null and lock_expires<=now()
                                then 1 else failures+1 end)>=8
                          then now()+interval '15 minutes' else null end
    where user_id=account_id;
  return false;
end;
$$;

-- Used by the website after a successful registration or login.
create or replace function public.ss_username_me()
returns table(id uuid,username text,role text,banned boolean,
              banned_until timestamptz,ban_reason text)
language sql stable security definer set search_path = '' as $$
  select p.id,p.username,p.role,p.banned,p.banned_until,p.ban_reason
  from public.ss_profiles p where p.id=(select public.ss_current_profile_id());
$$;

-- A sign-out removes the application's mapping before the client also calls
-- client.auth.signOut(). A banned user may still authenticate to export own data.
create or replace function public.ss_username_logout()
returns void language sql security definer set search_path = '' as $$
  delete from ss_private.username_sessions where session_uid=(select auth.uid());
$$;

-- Existing app RLS must follow the CANONICAL profile ID, not the temporary
-- Supabase anonymous-user UUID. Banned accounts retain READ access to exports.
create or replace function public.ss_can_use()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.ss_profiles p
    where p.id=(select public.ss_current_profile_id())
      and (not p.banned or (p.banned_until is not null and p.banned_until<=now())));
$$;
create or replace function public.ss_has_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.ss_profiles p
    where p.id=(select public.ss_current_profile_id())
      and p.role in ('owner','admin','moderator')
      and (not p.banned or (p.banned_until is not null and p.banned_until<=now())));
$$;

drop policy if exists ss_profiles_own_read on public.ss_profiles;
create policy ss_profiles_own_read on public.ss_profiles for select to authenticated
  using (id=(select public.ss_current_profile_id()));
drop policy if exists ss_study_self_read on public.ss_study_data;
create policy ss_study_self_read on public.ss_study_data for select to authenticated
  using (user_id=(select public.ss_current_profile_id()));
drop policy if exists ss_study_self_insert on public.ss_study_data;
create policy ss_study_self_insert on public.ss_study_data for insert to authenticated
  with check (user_id=(select public.ss_current_profile_id()) and (select public.ss_can_use()));
drop policy if exists ss_study_self_update on public.ss_study_data;
create policy ss_study_self_update on public.ss_study_data for update to authenticated
  using (user_id=(select public.ss_current_profile_id()) and (select public.ss_can_use()))
  with check (user_id=(select public.ss_current_profile_id()) and (select public.ss_can_use()));

-- Existing staff moderation RPCs now identify the signed-in USERNAME account.
create or replace function public.ss_change_role(target_user uuid, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := public.ss_current_profile_id();
  previous_role text;
begin
  -- Serialize role changes so two Owners cannot remove one another concurrently
  -- and accidentally leave the project without an Owner.
  perform pg_catalog.pg_advisory_xact_lock(82619, 3782);
  if actor_id is null or not exists (
    select 1 from public.ss_profiles p
    where p.id=actor_id and p.role='owner'
      and (not p.banned or (p.banned_until is not null and p.banned_until<=now()))
  ) then
    raise exception 'Only an active Owner can assign roles';
  end if;
  if target_user is null or target_user=actor_id
    or new_role is null or new_role not in ('student','moderator','admin','owner') then
    raise exception 'Invalid role change: choose a different account and valid role';
  end if;
  select p.role into previous_role
    from public.ss_profiles p where p.id=target_user for update;
  if previous_role is null then
    raise exception 'Account not found';
  end if;
  if previous_role='owner' and new_role<>'owner'
    and (select count(*) from public.ss_profiles where role='owner')<=1 then
    raise exception 'Cannot remove the final Owner';
  end if;
  if previous_role=new_role then return; end if;
  update public.ss_profiles set role=new_role where id=target_user;
  insert into public.ss_admin_audit(actor_id,target_id,action,details)
    values(actor_id,target_user,'role',previous_role||' -> '||new_role);
end;
$$;
create or replace function public.ss_change_ban(target_user uuid,ban_hours integer,reason text,lift boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := public.ss_current_profile_id(); actor_role text;
begin
  select p.role into actor_role from public.ss_profiles p where p.id=actor_id
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
  if actor_role not in ('owner','admin') or actor_role is null then raise exception 'Admin only'; end if;
  if target_user=actor_id then raise exception 'Cannot ban yourself'; end if;
  if not exists(select 1 from public.ss_profiles p where p.id=target_user and p.role<>'owner'
    and (actor_role='owner' or p.role<>'admin')) then raise exception 'Protected account'; end if;
  if not lift and (coalesce(trim(reason),'')='' or length(reason)>500
    or ban_hours is null or ban_hours not in (0,24,168,720)) then
    raise exception 'Enter a reason and valid duration';
  end if;
  if lift then
    update public.ss_profiles set banned=false,banned_until=null,ban_reason='' where id=target_user;
  else
    update public.ss_profiles set banned=true,
      banned_until=case when ban_hours=0 then null else now()+make_interval(hours=>ban_hours) end,
      ban_reason=left(trim(reason),500) where id=target_user;
  end if;
  insert into public.ss_admin_audit(actor_id,target_id,action,details)
    values(actor_id,target_user,case when lift then 'unban' else 'ban' end,
      case when lift then left(coalesce(reason,''),500)
        else left(reason,500)||' ('||ban_hours||' hours; 0=permanent)' end);
end;
$$;
create or replace function public.ss_report_issue(about_name text,complaint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select public.ss_current_profile_id()) is null or not (select public.ss_can_use()) then
    raise exception 'Sign in to report an issue';
  end if;
  if length(trim(coalesce(complaint,'')))<10 or length(complaint)>1000
    or length(coalesce(about_name,''))>40 then
    raise exception 'Please explain the issue in 10–1000 characters';
  end if;
  insert into public.ss_reports(reporter_id,about_username,reason)
    values((select public.ss_current_profile_id()),left(trim(coalesce(about_name,'')),40),trim(complaint));
end;
$$;
create or replace function public.ss_review_report(report_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.ss_has_staff()) then raise exception 'Staff only'; end if;
  update public.ss_reports set status='reviewed',
    reviewed_by=(select public.ss_current_profile_id()),reviewed_at=now()
    where id=report_id and status='open';
  if not found then raise exception 'Open report not found'; end if;
  insert into public.ss_admin_audit(actor_id,action,details)
    values ((select public.ss_current_profile_id()),'review_report',report_id::text);
end;
$$;

-- Never expose the private tables or password hashes through the REST API.
revoke all on function public.ss_create_profile() from public,anon,authenticated;
revoke all on function public.ss_current_profile_id() from public,anon;
revoke all on function public.ss_username_register(text,text) from public,anon;
revoke all on function public.ss_username_login(text,text) from public,anon;
revoke all on function public.ss_username_me() from public,anon;
revoke all on function public.ss_username_logout() from public,anon;
grant execute on function public.ss_current_profile_id(),public.ss_username_register(text,text),
  public.ss_username_login(text,text),public.ss_username_me(),public.ss_username_logout()
  to authenticated;
commit;

-- AFTER THE UPDATED WEBSITE CREATES YOUR NEW USERNAME ACCOUNT:
-- Run the following command SEPARATELY in Supabase SQL Editor, replacing the name:
-- update public.ss_profiles set role='owner' where username='your_username' and role='student';
-- Don't paste passwords into the SQL editor. Never share secret/service_role keys.
