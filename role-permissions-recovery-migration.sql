-- StudySummit v3.79: separate staff capabilities and Owner-approved password recovery.
-- Run AFTER supabase.sql and username-login-migration.sql.
-- Existing profiles, role assignments, and credential hashes remain unchanged.
begin;

create table if not exists ss_private.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ss_profiles(id) on delete cascade,
  requester_session uuid,
  status text not null default 'pending'
    check (status in ('pending','issued','completed','denied')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.ss_profiles(id) on delete set null,
  reviewed_at timestamptz
);
create index if not exists ss_reset_requests_user_time_idx
  on ss_private.password_reset_requests(user_id,created_at desc);
create table if not exists ss_private.password_reset_tokens (
  request_id uuid primary key references ss_private.password_reset_requests(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0
);
alter table ss_private.password_reset_requests enable row level security;
alter table ss_private.password_reset_tokens enable row level security;
revoke all on ss_private.password_reset_requests,ss_private.password_reset_tokens from public,anon,authenticated;

-- Only real email/password sessions may use their Supabase UUID as a profile ID.
-- Anonymous username accounts MUST have a server-side authenticated session mapping.
create or replace function public.ss_current_profile_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.user_id from ss_private.username_sessions s where s.session_uid=(select auth.uid())),
    (select p.id from public.ss_profiles p
      where p.id=(select auth.uid())
        and coalesce((select auth.jwt()->>'is_anonymous'),'false') <> 'true')
  );
$$;

-- Owner > Admin > Moderator > Student.
-- Admins only see manageable accounts. Moderators work in the report queue.
create or replace function public.ss_staff_profiles()
returns table(id uuid,username text,role text,banned boolean,banned_until timestamptz,ban_reason text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare actor_role text;
begin
  select p.role into actor_role from public.ss_profiles p
    where p.id=(select public.ss_current_profile_id())
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
  if actor_role not in ('owner','admin') or actor_role is null then
    raise exception 'Only Owners and Admins can view account management';
  end if;
  return query select p.id,p.username,p.role,p.banned,p.banned_until,p.ban_reason,p.created_at
    from public.ss_profiles p
    where actor_role='owner' or p.role in ('student','moderator')
    order by p.created_at desc limit 500;
end;
$$;

create or replace function public.ss_staff_audit()
returns table(actor_name text,target_name text,action text,details text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare actor_role text;
begin
  select p.role into actor_role from public.ss_profiles p
    where p.id=(select public.ss_current_profile_id())
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
  if actor_role not in ('owner','admin') or actor_role is null then
    raise exception 'Only Owners and Admins can view action history';
  end if;
  return query select coalesce(a.username,'Deleted account'),coalesce(t.username,'—'),x.action,x.details,x.created_at
    from public.ss_admin_audit x
    left join public.ss_profiles a on a.id=x.actor_id
    left join public.ss_profiles t on t.id=x.target_id
    where actor_role='owner' or x.action in ('ban','unban','review_report')
    order by x.created_at desc limit 100;
end;
$$;

-- Anyone who has forgotten their password may request recovery without logging in.
-- The response never reveals whether a username exists.
create or replace function public.ss_request_password_reset(chosen_username text)
returns boolean language plpgsql security definer set search_path = pg_catalog, extensions as $$
declare
  account_id uuid;
  session_id uuid := auth.uid();
begin
  if session_id is null
    or coalesce(auth.jwt()->>'is_anonymous','false') <> 'true'
    or (select public.ss_current_profile_id()) is not null then
    raise exception 'Sign out before requesting password recovery';
  end if;
  if chosen_username is null or chosen_username !~* '^[a-z0-9_-]{3,32}$' then return true; end if;
  select p.id into account_id from public.ss_profiles p
    join ss_private.username_credentials c on c.user_id=p.id
    where p.username=lower(trim(chosen_username));
  if account_id is null then return true; end if;
  if (select count(*) from ss_private.password_reset_requests r
      where r.requester_session=session_id and r.created_at>now()-interval '1 day')>=3 then
    return true;
  end if;
  if exists(select 1 from ss_private.password_reset_requests r
      where r.user_id=account_id and r.status in ('pending','issued')
        and r.created_at>now()-interval '15 minutes') then return true; end if;
  insert into ss_private.password_reset_requests(user_id,requester_session)
    values(account_id,session_id);
  return true;
end;
$$;

create or replace function public.ss_owner_reset_requests()
returns table(request_id uuid,username text,status text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.ss_profiles p
       where p.id=(select public.ss_current_profile_id()) and p.role='owner'
       and (not p.banned or (p.banned_until is not null and p.banned_until<=now()))) then
    raise exception 'Owner only';
  end if;
  return query select r.id,p.username,r.status,r.created_at
    from ss_private.password_reset_requests r
    join public.ss_profiles p on p.id=r.user_id
    where r.status in ('pending','issued')
    order by r.created_at desc limit 100;
end;
$$;

-- Owner must independently verify the requester. A recovery code is shown only once
-- and never stored in plaintext, logged, or embedded in URL parameters.
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

create or replace function public.ss_owner_deny_password_reset(reset_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := public.ss_current_profile_id();
  target_id uuid;
begin
  if not exists(select 1 from public.ss_profiles p where p.id=actor_id and p.role='owner'
      and (not p.banned or (p.banned_until is not null and p.banned_until<=now()))) then
    raise exception 'Owner only';
  end if;
  update ss_private.password_reset_requests set status='denied',reviewed_by=actor_id,reviewed_at=now()
    where id=reset_request_id and status in ('pending','issued') returning user_id into target_id;
  if target_id is null then raise exception 'Recovery request not found or already closed'; end if;
  delete from ss_private.password_reset_tokens where request_id=reset_request_id;
  insert into public.ss_admin_audit(actor_id,target_id,action,details)
    values(actor_id,target_id,'recovery_request_denied','Owner denied a recovery request');
end;
$$;

-- User sets their OWN replacement password using the Owner-supplied one-time code.
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

revoke all on function public.ss_request_password_reset(text),
  public.ss_owner_reset_requests(),public.ss_owner_issue_password_reset(uuid),
  public.ss_owner_deny_password_reset(uuid),
  public.ss_complete_password_reset(text,text,text) from public,anon;
grant execute on function public.ss_request_password_reset(text),
  public.ss_owner_reset_requests(),public.ss_owner_issue_password_reset(uuid),
  public.ss_owner_deny_password_reset(uuid),
  public.ss_complete_password_reset(text,text,text) to authenticated;
commit;
 then return false; end if;
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

revoke all on function public.ss_request_password_reset(text),
  public.ss_owner_reset_requests(),public.ss_owner_issue_password_reset(uuid),
  public.ss_owner_deny_password_reset(uuid),
  public.ss_complete_password_reset(text,text,text) from public,anon;
grant execute on function public.ss_request_password_reset(text),
  public.ss_owner_reset_requests(),public.ss_owner_issue_password_reset(uuid),
  public.ss_owner_deny_password_reset(uuid),
  public.ss_complete_password_reset(text,text,text) to authenticated;
commit;
