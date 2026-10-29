-- StudySpire v3.92: server-controlled avatars and reports.
-- Username Cloud accounts and legacy email accounts both resolve through ss_current_profile_id().
-- Pictures are small verified WebP images stored in a private table; no public Storage bucket.
begin;

alter table public.ss_profiles
  add column if not exists avatar_upload_restricted boolean not null default false,
  add column if not exists avatar_revision bigint not null default 0;

create table if not exists ss_private.ss_profile_avatars (
  user_id uuid primary key references public.ss_profiles(id) on delete cascade,
  image_data text not null check (char_length(image_data) between 24 and 95000),
  avatar_revision bigint not null check (avatar_revision > 0),
  updated_at timestamptz not null default now()
);
create table if not exists ss_private.ss_profile_avatar_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.ss_profiles(id) on delete cascade,
  target_id uuid not null references public.ss_profiles(id) on delete cascade,
  avatar_revision bigint not null,
  reason text not null check (char_length(reason) between 10 and 500),
  image_snapshot text,
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.ss_profiles(id) on delete set null,
  constraint ss_avatar_no_self_report check (reporter_id <> target_id),
  constraint ss_avatar_report_once unique(reporter_id,target_id,avatar_revision)
);
create index if not exists ss_avatar_reports_queue_idx
  on ss_private.ss_profile_avatar_reports(status,created_at desc);
create index if not exists ss_avatar_reports_target_idx
  on ss_private.ss_profile_avatar_reports(target_id,created_at desc);
alter table ss_private.ss_profile_avatars enable row level security;
alter table ss_private.ss_profile_avatar_reports enable row level security;
revoke all on ss_private.ss_profile_avatars,ss_private.ss_profile_avatar_reports
  from public,anon,authenticated;

-- Self-service avatar state. Auth mapping works for anonymous Supabase sessions
-- that have completed the username/password Cloud login.
create or replace function public.ss_avatar_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer uuid := public.ss_current_profile_id();
  result jsonb;
begin
  if viewer is null then raise exception 'Sign in to manage your profile picture'; end if;
  select pg_catalog.jsonb_build_object(
      'username',p.username,
      'restricted',p.avatar_upload_restricted,
      'image_data',a.image_data,
      'revision',p.avatar_revision
    ) into result
  from public.ss_profiles p
  left join ss_private.ss_profile_avatars a on a.user_id=p.id
  where p.id=viewer;
  if result is null then raise exception 'Account not found'; end if;
  return result;
end;
$$;

-- An avatar update is checked in PostgreSQL, not only by the upload form.
-- Removal is permitted even after new uploads are restricted.
create or replace function public.ss_avatar_set(p_image_data text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.ss_current_profile_id();
  blocked boolean;
  account_banned boolean;
  data_bytes bytea;
  next_revision bigint;
begin
  if actor is null then raise exception 'Sign in before changing your profile picture'; end if;
  select p.avatar_upload_restricted,
         (p.banned and (p.banned_until is null or p.banned_until>now()))
    into blocked,account_banned
  from public.ss_profiles p where p.id=actor for update;
  if not found then raise exception 'Account not found'; end if;
  if account_banned then raise exception 'Banned accounts cannot change profile pictures'; end if;
  if p_image_data is null or p_image_data='' then
    delete from ss_private.ss_profile_avatars where user_id=actor;
  else
    if blocked then raise exception 'A staff member has restricted profile picture uploads on this account'; end if;
    if char_length(p_image_data)>95000 or p_image_data !~ '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$' then
      raise exception 'Use a small WebP profile image'; end if;
    begin
      data_bytes := pg_catalog.decode(pg_catalog.substring(p_image_data,24),'base64');
    exception when others then
      raise exception 'Invalid profile image data';
    end;
    if pg_catalog.octet_length(data_bytes)<16 or pg_catalog.octet_length(data_bytes)>65536
      or pg_catalog.substring(data_bytes,1,4)<>pg_catalog.decode('52494646','hex')
      or pg_catalog.substring(data_bytes,9,4)<>pg_catalog.decode('57454250','hex') then
      raise exception 'Only verified WebP files up to 64 KB are supported';
    end if;
  end if;
  update public.ss_profiles p set avatar_revision=p.avatar_revision+1
    where p.id=actor returning p.avatar_revision into next_revision;
  if p_image_data is not null and p_image_data<>'' then
    insert into ss_private.ss_profile_avatars(user_id,image_data,avatar_revision,updated_at)
      values(actor,p_image_data,next_revision,now())
    on conflict(user_id) do update set image_data=excluded.image_data,
      avatar_revision=excluded.avatar_revision,updated_at=now();
  end if;
  return public.ss_avatar_me();
end;
$$;

-- Signed-in users can look up a current picture by its exact account username.
create or replace function public.ss_avatar_public(chosen_username text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer uuid := public.ss_current_profile_id();
  result jsonb;
begin
  if viewer is null then raise exception 'Sign in to view profile pictures'; end if;
  if chosen_username is null or chosen_username !~ '^[a-z0-9_-]{3,32}$' then return null; end if;
  select pg_catalog.jsonb_build_object(
    'username',p.username,
    'image_data',a.image_data,
    'revision',p.avatar_revision
  ) into result
  from public.ss_profiles p
  left join ss_private.ss_profile_avatars a on a.user_id=p.id
  where p.username=chosen_username
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
  return result;
end;
$$;

-- Batch lookup for the current friend list; protects account data and limits response sizes.
create or replace function public.ss_avatar_list(chosen_usernames text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer uuid := public.ss_current_profile_id();
  result jsonb;
begin
  if viewer is null then raise exception 'Sign in to view profile pictures'; end if;
  if chosen_usernames is null or pg_catalog.cardinality(chosen_usernames)>16 then
    raise exception 'Too many profile pictures requested'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'username',p.username,'image_data',a.image_data
  )),'[]'::jsonb) into result
  from public.ss_profiles p
  left join ss_private.ss_profile_avatars a on a.user_id=p.id
  where p.username=any(chosen_usernames)
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
  return result;
end;
$$;

-- Users (including Moderators) can report another account's *current* picture.
-- The snapshot is preserved for staff until reviewed, then cleared.
create or replace function public.ss_avatar_report(chosen_username text, complaint text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.ss_current_profile_id();
  target uuid;
  current_revision bigint;
  current_image text;
  account_banned boolean;
  new_id uuid;
begin
  if actor is null then raise exception 'Sign in to report a profile picture'; end if;
  select (p.banned and (p.banned_until is null or p.banned_until>now()))
    into account_banned from public.ss_profiles p where p.id=actor;
  if account_banned then raise exception 'Banned accounts cannot send reports'; end if;
  if complaint is null or char_length(pg_catalog.btrim(complaint)) not between 10 and 500 then
    raise exception 'Report reason must be 10 to 500 characters'; end if;
  if chosen_username is null or chosen_username !~ '^[a-z0-9_-]{3,32}$' then
    raise exception 'Invalid username'; end if;
  select p.id,a.avatar_revision,a.image_data into target,current_revision,current_image
    from public.ss_profiles p
    join ss_private.ss_profile_avatars a on a.user_id=p.id
    where p.username=chosen_username
      and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
  if target is null then raise exception 'No active profile picture is available to report'; end if;
  if target=actor then raise exception 'You cannot report your own profile picture'; end if;
  if (select count(*) from ss_private.ss_profile_avatar_reports r
      where r.reporter_id=actor and r.created_at>now()-interval '24 hours')>=8 then
    raise exception 'Daily picture report limit reached'; end if;
  if exists(select 1 from ss_private.ss_profile_avatar_reports r where
    r.reporter_id=actor and r.target_id=target and r.avatar_revision=current_revision) then
    raise exception 'You have already reported this version of the profile picture'; end if;
  insert into ss_private.ss_profile_avatar_reports
    (reporter_id,target_id,avatar_revision,reason,image_snapshot)
    values(actor,target,current_revision,pg_catalog.btrim(complaint),current_image)
    returning id into new_id;
  return new_id;
end;
$$;

-- All staff see reported picture evidence. Only Admins and Owners get account restriction lists.
create or replace function public.ss_avatar_staff_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := public.ss_current_profile_id();
  actor_role text;
  accounts_result jsonb;
  reports_result jsonb;
begin
  select p.role into actor_role from public.ss_profiles p where p.id=actor
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
  if actor_role is null or actor_role not in ('moderator','admin','owner') then
    raise exception 'Staff role required'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'id',x.id,'username',x.username,'role',x.role,
     'restricted',x.avatar_upload_restricted,
     'has_picture',x.has_picture
  )),'[]'::jsonb) into accounts_result
  from (select p.id,p.username,p.role,p.avatar_upload_restricted,
        (a.user_id is not null) has_picture
        from public.ss_profiles p left join ss_private.ss_profile_avatars a on a.user_id=p.id
        where actor_role='owner' or (actor_role='admin' and p.role in ('student','moderator'))
        order by p.username limit 500) x;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',x.id,'target_id',x.target_id,'target_username',x.target_username,
      'target_role',x.target_role,'reporter',x.reporter,
      'reason',x.reason,'status',x.status,'created_at',x.created_at,
      'image_snapshot',case when x.status='open' then x.image_snapshot else null end,
      'can_moderate',actor_role='owner'
        or (actor_role='admin' and x.target_role in ('student','moderator'))
        or (actor_role='moderator' and x.target_role='student')
  )),'[]'::jsonb) into reports_result
  from (select r.id,r.target_id,t.username target_username,t.role target_role,
      f.username reporter,r.reason,r.status,r.created_at,r.image_snapshot
      from ss_private.ss_profile_avatar_reports r
      join public.ss_profiles t on t.id=r.target_id
      join public.ss_profiles f on f.id=r.reporter_id
      order by case when r.status='open' then 0 else 1 end,r.created_at desc
      limit 100) x;
  return pg_catalog.jsonb_build_object('accounts',accounts_result,'reports',reports_result);
end;
$$;

-- Only higher-ranking staff may restrict uploads or remove an account's picture.
create or replace function public.ss_avatar_staff_restrict(
 target_user uuid, restrict_uploads boolean, remove_picture boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.ss_current_profile_id();
  actor_role text;
  target_role text;
begin
  select p.role into actor_role from public.ss_profiles p where p.id=actor
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
  select p.role into target_role from public.ss_profiles p where p.id=target_user for update;
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'Admin or Owner required'; end if;
  if target_role is null or target_user=actor then raise exception 'Choose another account'; end if;
  if actor_role='admin' and target_role not in ('student','moderator') then
    raise exception 'Admins cannot manage Admin or Owner pictures'; end if;
  if restrict_uploads is null then raise exception 'Restriction flag required'; end if;
  update public.ss_profiles p set avatar_upload_restricted=restrict_uploads,
    avatar_revision=p.avatar_revision+case when remove_picture then 1 else 0 end
    where p.id=target_user;
  if remove_picture then delete from ss_private.ss_profile_avatars where user_id=target_user; end if;
  insert into public.ss_admin_audit(actor_id,target_id,action,details)
    values(actor,target_user,
      case when restrict_uploads then 'avatar_restrict' else 'avatar_unrestrict' end,
      case when remove_picture then 'Profile picture removed; upload restriction updated'
           else 'Profile picture upload restriction updated' end);
  return true;
end;
$$;

-- Moderators may remove Student pictures, Admins Student/Moderator, Owners all other users.
-- When a newer image replaced the reported revision, staff can dismiss instead of
-- accidentally removing the newer one.
create or replace function public.ss_avatar_staff_review(
 report_id uuid, decision text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.ss_current_profile_id();
  actor_role text;
  target uuid;
  target_role text;
  reported_revision bigint;
  current_revision bigint;
  report_status text;
begin
  select p.role into actor_role from public.ss_profiles p where p.id=actor
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
  if actor_role is null or actor_role not in ('moderator','admin','owner') then
    raise exception 'Moderator role or higher required'; end if;
  if decision not in ('dismiss','remove') then raise exception 'Unsupported moderation action'; end if;
  select r.target_id,r.avatar_revision,r.status into target,reported_revision,report_status
    from ss_private.ss_profile_avatar_reports r where r.id=report_id for update;
  if target is null or report_status<>'open' then raise exception 'Report already closed or missing'; end if;
  select p.role into target_role from public.ss_profiles p where p.id=target for update;
  if target=actor
    or (actor_role='moderator' and target_role<>'student')
    or (actor_role='admin' and target_role not in ('student','moderator')) then
    raise exception 'A higher-ranking staff member must review this picture'; end if;
  if decision='remove' then
    select a.avatar_revision into current_revision from ss_private.ss_profile_avatars a
      where a.user_id=target for update;
    if current_revision is null or current_revision<>reported_revision then
      raise exception 'This picture changed; dismiss the old report rather than removing a newer picture'; end if;
    delete from ss_private.ss_profile_avatars where user_id=target;
    update public.ss_profiles p set avatar_revision=p.avatar_revision+1 where p.id=target;
    update ss_private.ss_profile_avatar_reports r set status='reviewed',
      reviewed_by=actor,reviewed_at=now(),image_snapshot=null
      where r.target_id=target and r.avatar_revision=reported_revision and r.status='open';
  else
    update ss_private.ss_profile_avatar_reports r set status='dismissed',
      reviewed_by=actor,reviewed_at=now(),image_snapshot=null where r.id=report_id;
  end if;
  insert into public.ss_admin_audit(actor_id,target_id,action,details)
    values(actor,target,case when decision='remove' then 'avatar_removed' else 'avatar_report_dismissed' end,
      'Profile picture report reviewed by '+actor_role);
  return true;
end;
$$;

revoke all on function
  public.ss_avatar_me(),
  public.ss_avatar_set(text),
  public.ss_avatar_public(text),
  public.ss_avatar_list(text[]),
  public.ss_avatar_report(text,text),
  public.ss_avatar_staff_overview(),
  public.ss_avatar_staff_restrict(uuid,boolean,boolean),
  public.ss_avatar_staff_review(uuid,text)
from public,anon,authenticated;
grant execute on function
  public.ss_avatar_me(),
  public.ss_avatar_set(text),
  public.ss_avatar_public(text),
  public.ss_avatar_list(text[]),
  public.ss_avatar_report(text,text),
  public.ss_avatar_staff_overview(),
  public.ss_avatar_staff_restrict(uuid,boolean,boolean),
  public.ss_avatar_staff_review(uuid,text)
to authenticated;

commit;