-- Study Summit Cloud schema for Supabase, v3.75
-- Run this in Supabase SQL Editor. Never put a service_role/secret key in the website.
create extension if not exists pgcrypto;

create table if not exists public.ss_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9_-]{3,32}$'),
  role text not null default 'student' check (role in ('student','moderator','admin','owner')),
  banned boolean not null default false,
  banned_until timestamptz,
  ban_reason text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists ss_profiles_username_unique on public.ss_profiles (lower(username));

create table if not exists public.ss_study_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object' and octet_length(data::text)<=1500000),
  updated_at timestamptz not null default now()
);

create table if not exists public.ss_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  target_id uuid references auth.users(id) on delete set null,
  action text not null,
  details text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.ss_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  about_username text not null default '',
  reason text not null,
  status text not null default 'open' check (status in ('open','reviewed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- User metadata isn't authoritative for permissions: the trigger always starts users as students.
create or replace function public.ss_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare chosen text;
begin
  chosen := lower(trim(coalesce(new.raw_user_meta_data->>'username','')));
  if chosen !~ '^[a-z0-9_-]{3,32}$' or chosen in ('admin','owner','moderator','staff','support','official') then
    raise exception 'Choose a valid username (3–32 letters, numbers, underscores or dashes).';
  end if;
  insert into public.ss_profiles (id,username,role) values (new.id,chosen,'student');
  return new;
end;
$$;
drop trigger if exists ss_auth_user_created on auth.users;
create trigger ss_auth_user_created after insert on auth.users for each row execute procedure public.ss_create_profile();

-- Repair hook only for users who already signed up before running the SQL: do NOT elevate roles.
-- Profiles are created automatically on new registration once this schema is installed.

create or replace function public.ss_can_use()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.ss_profiles p where p.id=(select auth.uid())
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now())));
$$;
create or replace function public.ss_has_staff()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.ss_profiles p where p.id=(select auth.uid())
    and p.role in ('owner','admin','moderator')
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now())));
$$;

alter table public.ss_profiles enable row level security;
alter table public.ss_study_data enable row level security;
alter table public.ss_admin_audit enable row level security;
alter table public.ss_reports enable row level security;

-- Users can see their own status but cannot promote themselves or change ban fields.
drop policy if exists ss_profiles_own_read on public.ss_profiles;
create policy ss_profiles_own_read on public.ss_profiles for select to authenticated using (id=(select auth.uid()));

-- Banned people CAN download their own study data, but cannot change it.
drop policy if exists ss_study_self_read on public.ss_study_data;
create policy ss_study_self_read on public.ss_study_data for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists ss_study_self_insert on public.ss_study_data;
create policy ss_study_self_insert on public.ss_study_data for insert to authenticated
  with check (user_id=(select auth.uid()) and (select public.ss_can_use()));
drop policy if exists ss_study_self_update on public.ss_study_data;
create policy ss_study_self_update on public.ss_study_data for update to authenticated
  using (user_id=(select auth.uid()) and (select public.ss_can_use()))
  with check (user_id=(select auth.uid()) and (select public.ss_can_use()));

-- The browser cannot change server audit logs, server reports or other people's profiles directly.
revoke all on public.ss_admin_audit from anon,authenticated;
revoke all on public.ss_reports from anon,authenticated;
grant select on public.ss_profiles to authenticated;
grant select,insert,update on public.ss_study_data to authenticated;

create or replace function public.ss_staff_profiles()
returns table(id uuid,username text,role text,banned boolean,banned_until timestamptz,ban_reason text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if not (select public.ss_has_staff()) then raise exception 'Staff only'; end if;
  return query select p.id,p.username,p.role,p.banned,p.banned_until,p.ban_reason,p.created_at
    from public.ss_profiles p order by p.created_at desc limit 500;
end;
$$;

create or replace function public.ss_change_role(target_user uuid, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
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

create or replace function public.ss_change_ban(target_user uuid, ban_hours integer, reason text, lift boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare actor_role text;
begin
  select p.role into actor_role from public.ss_profiles p where p.id=(select auth.uid())
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
  if actor_role not in ('owner','admin') or actor_role is null then raise exception 'Admin only'; end if;
  if target_user=(select auth.uid()) then raise exception 'Cannot ban yourself'; end if;
  if not exists(select 1 from public.ss_profiles p where p.id=target_user and p.role<>'owner' and
    (actor_role='owner' or p.role<>'admin')) then raise exception 'Target account is protected'; end if;
  if not lift and (coalesce(trim(reason),'')='' or length(reason)>500 or ban_hours is null or ban_hours not in (0,24,168,720)) then
    raise exception 'Enter a reason and choose a valid duration';
  end if;
  if lift then
    update public.ss_profiles set banned=false,banned_until=null,ban_reason='' where id=target_user;
  else
    update public.ss_profiles set banned=true,
      banned_until=case when ban_hours=0 then null else now()+make_interval(hours=>ban_hours) end,
      ban_reason=left(trim(reason),500) where id=target_user;
  end if;
  insert into public.ss_admin_audit(actor_id,target_id,action,details)
    values ((select auth.uid()),target_user,case when lift then 'unban' else 'ban' end,
      case when lift then left(coalesce(reason,''),500) else left(reason,500)||' ('||ban_hours||' hours; 0=permanent)' end);
end;
$$;

create or replace function public.ss_report_issue(about_name text, complaint text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not (select public.ss_can_use()) then raise exception 'Sign in to report an issue'; end if;
  if length(trim(coalesce(complaint,'')))<10 or length(complaint)>1000 or length(coalesce(about_name,''))>40 then
    raise exception 'Please explain the issue in 10–1000 characters';
  end if;
  insert into public.ss_reports(reporter_id,about_username,reason)
    values((select auth.uid()),left(trim(coalesce(about_name,'')),40),trim(complaint));
end;
$$;

create or replace function public.ss_staff_reports()
returns table(id uuid,reporter_name text,about_username text,reason text,status text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if not (select public.ss_has_staff()) then raise exception 'Staff only'; end if;
  return query select r.id,coalesce(p.username,'Deleted account'),r.about_username,r.reason,r.status,r.created_at
    from public.ss_reports r left join public.ss_profiles p on p.id=r.reporter_id
    order by r.created_at desc limit 100;
end;
$$;

create or replace function public.ss_review_report(report_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not (select public.ss_has_staff()) then raise exception 'Staff only'; end if;
  update public.ss_reports set status='reviewed',reviewed_by=(select auth.uid()),reviewed_at=now()
    where id=report_id and status='open';
  if not found then raise exception 'Open report not found'; end if;
  insert into public.ss_admin_audit(actor_id,action,details)
    values ((select auth.uid()),'review_report',report_id::text);
end;
$$;

create or replace function public.ss_staff_audit()
returns table(actor_name text,target_name text,action text,details text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if not (select public.ss_has_staff()) then raise exception 'Staff only'; end if;
  return query select coalesce(a.username,'Deleted account'),coalesce(t.username,'—'),x.action,x.details,x.created_at
  from public.ss_admin_audit x
  left join public.ss_profiles a on a.id=x.actor_id
  left join public.ss_profiles t on t.id=x.target_id
  order by x.created_at desc limit 100;
end;
$$;

revoke all on function public.ss_create_profile() from public,anon,authenticated;
revoke all on function public.ss_can_use() from public,anon;
revoke all on function public.ss_has_staff() from public,anon;
grant execute on function public.ss_can_use(), public.ss_has_staff() to authenticated;
revoke all on function public.ss_staff_profiles() from public,anon;
revoke all on function public.ss_change_role(uuid,text) from public,anon;
revoke all on function public.ss_change_ban(uuid,integer,text,boolean) from public,anon;
revoke all on function public.ss_report_issue(text,text) from public,anon;
revoke all on function public.ss_staff_reports() from public,anon;
revoke all on function public.ss_review_report(uuid) from public,anon;
revoke all on function public.ss_staff_audit() from public,anon;
grant execute on function public.ss_staff_profiles(),public.ss_change_role(uuid,text),
  public.ss_change_ban(uuid,integer,text,boolean),public.ss_report_issue(text,text),
  public.ss_staff_reports(),public.ss_review_report(uuid),public.ss_staff_audit() to authenticated;

-- IMPORTANT: After YOU create your own account and confirm its email, run the
-- exact owner-claim command from README.md once in this SQL editor.
-- NEVER put this command inside index.html or cloud.js.
