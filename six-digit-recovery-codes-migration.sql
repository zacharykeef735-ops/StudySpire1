-- StudySummit v3.80 · Upgrade previously deployed recovery functions to 6-digit codes.
-- Do NOT rerun old base schema over this migration.
-- Any previously issued 32-character codes are revoked and must be reissued by an Owner.
begin;

delete from ss_private.password_reset_tokens AS t
using ss_private.password_reset_requests AS r
where t.request_id=r.id and r.status='issued';

update ss_private.password_reset_requests
  set status='pending', reviewed_by=null, reviewed_at=null
  where status='issued';

create or replace function public.ss_owner_issue_password_reset(reset_request_id uuid)
returns text language plpgsql security definer set search_path = pg_catalog, extensions as $$
declare
  actor_id uuid := public.ss_current_profile_id();
  target_id uuid;
  reset_status text;
  recovery_code text;
  random_bytes bytea;
  random_number bigint;
begin
  if not exists(select 1 from public.ss_profiles p where p.id=actor_id and p.role='owner'
      and (not p.banned or (p.banned_until is not null and p.banned_until<=now()))) then
    raise exception 'Owner only';
  end if;
  select r.user_id,r.status into target_id,reset_status
    from ss_private.password_reset_requests r where r.id=reset_request_id for update;
  if target_id is null or reset_status not in ('pending','issued') then
    raise exception 'Recovery request not found or already closed';
  end if;
  -- Generate six decimal digits from cryptographically secure random bytes.
  -- Preserve leading zeros (such as 004219); do not use random().
  random_bytes := gen_random_bytes(4);
  random_number :=
       get_byte(random_bytes,0)::bigint * 16777216
     + get_byte(random_bytes,1)::bigint * 65536
     + get_byte(random_bytes,2)::bigint * 256
     + get_byte(random_bytes,3)::bigint;
  recovery_code := lpad((random_number % 1000000)::text,6,'0');
  insert into ss_private.password_reset_tokens(request_id,token_hash,expires_at,attempts)
    values(reset_request_id,encode(digest(recovery_code,'sha256'),'hex'),now()+interval '15 minutes',0)
    on conflict (request_id) do update set token_hash=excluded.token_hash,
       expires_at=excluded.expires_at,attempts=0;
  update ss_private.password_reset_requests set status='issued',
    reviewed_by=actor_id,reviewed_at=now() where id=reset_request_id;
  insert into public.ss_admin_audit(actor_id,target_id,action,details)
    values(actor_id,target_id,'recovery_code_issued','Recovery code issued (expires in 15 minutes)');
  return recovery_code;
end;
$$;

create or replace function public.ss_complete_password_reset(chosen_username text,recovery_code text,new_password text)
returns boolean language plpgsql security definer set search_path = pg_catalog, extensions as $$
declare
  session_id uuid := auth.uid();
  target_id uuid;
  reset_id uuid;
  stored_token_hash text;
  expiry timestamptz;
  tries integer;
  approving_owner uuid;
begin
  if session_id is null
    or coalesce(auth.jwt()->>'is_anonymous','false') <> 'true'
    or (select public.ss_current_profile_id()) is not null then
    raise exception 'Sign out before setting a replacement password';
  end if;
  if new_password is null or char_length(new_password)<10 or octet_length(new_password)>72 then
    raise exception 'New password must be 10 characters minimum and 72 bytes maximum';
  end if;
  if chosen_username is null or recovery_code is null
    or chosen_username !~* '^[a-z0-9_-]{3,32}$'
    or recovery_code !~ '^[0-9]{6}$' then return false; end if;
  select r.id,r.user_id,t.token_hash,t.expires_at,t.attempts,r.reviewed_by
    into reset_id,target_id,stored_token_hash,expiry,tries,approving_owner
    from ss_private.password_reset_requests r
    join ss_private.password_reset_tokens t on t.request_id=r.id
    join public.ss_profiles p on p.id=r.user_id
    where p.username=lower(trim(chosen_username)) and r.status='issued'
    order by r.created_at desc limit 1 for update of t;
  if reset_id is null or expiry<=now() or tries>=5 then return false; end if;
  if encode(digest(upper(recovery_code),'sha256'),'hex')<>stored_token_hash then
    update ss_private.password_reset_tokens set attempts=attempts+1 where request_id=reset_id;
    return false;
  end if;
  update ss_private.username_credentials
    set password_hash=crypt(new_password,gen_salt('bf',12)) where user_id=target_id;
  delete from ss_private.username_sessions where user_id=target_id;
  update ss_private.password_reset_requests
    set status=case when id=reset_id then 'completed' else 'denied' end
    where user_id=target_id and status in ('pending','issued');
  delete from ss_private.password_reset_tokens
    where request_id in (select id from ss_private.password_reset_requests where user_id=target_id);
  insert into public.ss_admin_audit(actor_id,target_id,action,details)
    values(approving_owner,target_id,'password_reset_completed','One-time code redeemed; password updated');
  return true;
end;
$$;

commit;
