-- StudySpire1 school-first integration, no district/organization management UI.
-- Non-destructive: existing ss_organizations rows are kept privately to preserve
-- legacy school/class relationships. Every new school gets its own internal row.
-- Apply after studyspire1-organizations-schools.sql, -academics.sql and -school-join.sql.
begin;

alter table public.ss_schools add column if not exists join_code text;
update public.ss_schools set join_code='sch-'||replace(left(id::text,13),'-','')
where join_code is null;
create unique index if not exists ss1_unique_school_join_code on public.ss_schools(lower(join_code));
alter table public.ss_schools add constraint ss1_join_code_format
check (join_code ~ '^[a-z0-9][a-z0-9-]{2,39}$') not valid;

create table if not exists public.ss1_school_admins(
 school_id uuid not null references public.ss_schools(id) on delete cascade,
 profile_id uuid not null references public.ss_profiles(id) on delete cascade,
 manage_schools boolean not null default true,
 appoint_principals boolean not null default true,
 manage_enrollment boolean not null default true,
 view_analytics boolean not null default true,
 publish_announcements boolean not null default false,
 manage_settings boolean not null default false,
 assigned_by uuid not null references public.ss_profiles(id),
 updated_at timestamptz not null default now(),
 primary key (school_id,profile_id)
);
create index if not exists ss1_school_admin_profile on public.ss1_school_admins(profile_id);
create table if not exists public.ss1_school_branding(
 school_id uuid primary key references public.ss_schools(id) on delete cascade,
 tagline text not null default '' check(length(tagline)<=160),
 accent text not null default '#3478f6' check(accent ~ '^#[0-9a-fA-F]{6}$'),
 logo_url text not null default '' check(length(logo_url)<=600),
 updated_by uuid references public.ss_profiles(id),
 updated_at timestamptz not null default now()
);
create table if not exists public.ss1_school_announcements(
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.ss_schools(id) on delete cascade,
 title text not null check(length(btrim(title)) between 3 and 120),
 body text not null check(length(btrim(body)) between 3 and 2000),
 author uuid not null references public.ss_profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists ss1_school_announcements_by_school on public.ss1_school_announcements(school_id,created_at desc);
alter table public.ss1_school_admins enable row level security;
alter table public.ss1_school_branding enable row level security;
alter table public.ss1_school_announcements enable row level security;
revoke all on public.ss1_school_admins,public.ss1_school_branding,public.ss1_school_announcements
 from public,anon,authenticated;

create or replace function public.ss1_owner()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ss_profiles p
  where p.id=(select public.ss_school_actor()) and p.role='owner')
$$;

create or replace function public.ss1_school_permission(p_school uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); rec record;
begin
 if actor is null or p_school is null or p_permission not in (
  'manage_schools','appoint_principals','manage_enrollment',
  'view_analytics','publish_announcements','manage_settings') then return false;end if;
 if public.ss1_owner() then return true;end if;
 select * into rec from public.ss1_school_admins
  where school_id=p_school and profile_id=actor;
 if not found then return false;end if;
 return case p_permission
  when 'manage_schools' then rec.manage_schools
  when 'appoint_principals' then rec.appoint_principals
  when 'manage_enrollment' then rec.manage_enrollment
  when 'view_analytics' then rec.view_analytics
  when 'publish_announcements' then rec.publish_announcements
  when 'manage_settings' then rec.manage_settings else false end;
end $$;

create or replace function public.ss1_school_create(p_name text,p_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); org uuid; school uuid;
 n text:=btrim(coalesce(p_name,'')); code text:=lower(btrim(coalesce(p_code,'')));
begin
 if actor is null or not public.ss1_owner() then raise exception 'Only the platform Owner can create schools';end if;
 if length(n) not between 2 and 100 or code !~ '^[a-z0-9][a-z0-9-]{2,39}$' then
  raise exception 'School name must be 2-100 characters; code 3-40 lowercase letters, digits or dashes';end if;
 if exists(select 1 from public.ss_schools where lower(join_code)=code)
 then raise exception 'That school join code is already in use';end if;
 org:=gen_random_uuid();
 insert into public.ss_organizations(id,name,code,created_by)
 values(org,n,'school-'||replace(org::text,'-',''),actor);
 insert into public.ss_schools(organization_id,name,code,join_code,created_by)
 values(org,n,code,code,actor) returning id into school;
 insert into public.ss_school_audit(actor_id,organization_id,school_id,action,detail)
 values(actor,org,school,'school_created',n);
 return school;
end $$;

create or replace function public.ss1_school_set_admin(p_school uuid,p_username text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); target uuid; v_username text:=lower(btrim(coalesce(p_username,'')));
begin
 if not public.ss1_owner() then raise exception 'Only Owner can manage school admins';end if;
 if not exists(select 1 from public.ss_schools where id=p_school) then raise exception 'School unavailable';end if;
 if v_username !~ '^[a-z0-9_-]{3,32}$' then raise exception 'Invalid username';end if;
 select id into target from public.ss_profiles where username=v_username
  and (not banned or banned_until<=now());
 if target is null then raise exception 'Active account not found';end if;
 if coalesce(p_enabled,false) then
  insert into public.ss1_school_admins(school_id,profile_id,assigned_by)
   values(p_school,target,actor)
   on conflict (school_id,profile_id) do nothing;
 else
  delete from public.ss1_school_admins where school_id=p_school and profile_id=target;
 end if;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,p_school,case when p_enabled then 'school_admin_granted' else 'school_admin_revoked' end,v_username);
end $$;

create or replace function public.ss1_school_set_permission(
 p_school uuid,p_username text,p_permission text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); target uuid; v_username text:=lower(btrim(coalesce(p_username,'')));
begin
 if not public.ss1_owner() then raise exception 'Only the platform Owner can edit admin permissions';end if;
 if p_permission not in ('manage_schools','appoint_principals','manage_enrollment',
 'view_analytics','publish_announcements','manage_settings') or p_enabled is null
 then raise exception 'Invalid permission selection';end if;
 select a.profile_id into target from public.ss1_school_admins a
 join public.ss_profiles p on p.id=a.profile_id
 where a.school_id=p_school and p.username=v_username for update of a;
 if target is null then raise exception 'User is not an admin of this school';end if;
 update public.ss1_school_admins set
  manage_schools=case when p_permission='manage_schools' then p_enabled else manage_schools end,
  appoint_principals=case when p_permission='appoint_principals' then p_enabled else appoint_principals end,
  manage_enrollment=case when p_permission='manage_enrollment' then p_enabled else manage_enrollment end,
  view_analytics=case when p_permission='view_analytics' then p_enabled else view_analytics end,
  publish_announcements=case when p_permission='publish_announcements' then p_enabled else publish_announcements end,
  manage_settings=case when p_permission='manage_settings' then p_enabled else manage_settings end,
  assigned_by=actor,updated_at=now()
 where school_id=p_school and profile_id=target;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,p_school,'school_admin_permission',v_username||' '||p_permission||'='||p_enabled::text);
end $$;

create or replace function public.ss1_school_set_member(p_school uuid,p_username text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); target uuid; old_role text;
 v_username text:=lower(btrim(coalesce(p_username,'')));
 can_enroll boolean:=public.ss1_school_permission(p_school,'manage_enrollment');
 can_principal boolean:=public.ss1_school_permission(p_school,'appoint_principals');
 principal boolean:=public.ss_school_principal(p_school);
begin
 if actor is null or not exists(select 1 from public.ss_schools where id=p_school) then raise exception 'School unavailable';end if;
 if p_role not in ('principal','teacher','student','remove') or p_role is null then raise exception 'Invalid role';end if;
 if p_role='principal' then
  if not can_principal then raise exception 'Permission denied: appoint_principals';end if;
 else
  if not (can_enroll or principal) then raise exception 'Permission denied: manage_enrollment';end if;
 end if;
 if v_username !~ '^[a-z0-9_-]{3,32}$' then raise exception 'Invalid username';end if;
 select id into target from public.ss_profiles where username=v_username and (not banned or banned_until<=now());
 if target is null then raise exception 'Active account not found';end if;
 select role into old_role from public.ss_school_memberships where school_id=p_school and profile_id=target for update;
 if old_role='principal' and not can_principal then raise exception 'Only Owner or authorized school admins can change a principal';end if;
 if p_role='remove' then
  delete from public.ss_school_memberships where school_id=p_school and profile_id=target;
 else
  insert into public.ss_school_memberships(school_id,profile_id,role,assigned_by)
  values(p_school,target,p_role,actor)
  on conflict (school_id,profile_id) do update set role=excluded.role,assigned_by=excluded.assigned_by,assigned_at=now();
 end if;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,p_school,'school_member_changed',v_username||' '||coalesce(old_role,'none')||' -> '||p_role);
end $$;

create or replace function public.ss1_school_request_join(p_code text,p_role text,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); school uuid; n text; request_id uuid; code text:=lower(btrim(coalesce(p_code,'')));
begin
 if actor is null then raise exception 'Sign in first';end if;
 if p_role not in ('student','teacher') then raise exception 'Choose Student or Teacher';end if;
 if code !~ '^[a-z0-9][a-z0-9-]{2,39}$' then raise exception 'Enter a valid school code';end if;
 if length(btrim(coalesce(p_note,'')))>300 then raise exception 'Message too long';end if;
 select id,name into school,n from public.ss_schools where join_code=code;
 if school is null then raise exception 'School code not found';end if;
 if exists(select 1 from public.ss_school_memberships where school_id=school and profile_id=actor)
 then raise exception 'You already belong to that school';end if;
 if exists(select 1 from public.ss_school_join_requests where school_id=school and profile_id=actor and status='pending')
 then raise exception 'Your request is already pending';end if;
 if (select count(*) from public.ss_school_join_requests where profile_id=actor and status='pending')>=5
 or (select count(*) from public.ss_school_join_requests where profile_id=actor and requested_at>now()-interval '1 day')>=10
 then raise exception 'School join request limit reached';end if;
 insert into public.ss_school_join_requests(school_id,profile_id,requested_role,note)
 values(school,actor,p_role,btrim(coalesce(p_note,''))) returning id into request_id;
 return jsonb_build_object('id',request_id,'school_name',n,'status','pending');
end $$;

create or replace function public.ss1_school_pending(p_school uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor();result jsonb;
begin
 if actor is null or not (public.ss1_school_permission(p_school,'manage_enrollment') or public.ss_school_principal(p_school))
 then raise exception 'Permission denied: manage_enrollment';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',q.id,'username',p.username,'role',q.requested_role,'note',q.note,'requested_at',q.requested_at)
 order by q.requested_at),'[]'::jsonb) into result
 from public.ss_school_join_requests q join public.ss_profiles p on p.id=q.profile_id
 where q.school_id=p_school and q.status='pending';
 return result;
end $$;

create or replace function public.ss1_school_review_join(p_request uuid,p_approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); school uuid; target uuid;requested text;status text;
begin
 select school_id,profile_id,requested_role,q.status
 into school,target,requested,status from public.ss_school_join_requests q where q.id=p_request for update;
 if school is null or actor is null or not
 (public.ss1_school_permission(school,'manage_enrollment') or public.ss_school_principal(school))
 then raise exception 'Permission denied: manage_enrollment';end if;
 if status<>'pending' then raise exception 'Already reviewed';end if;
 if p_approve is null then raise exception 'Approval decision missing';end if;
 if p_approve then
  if not exists(select 1 from public.ss_profiles p where p.id=target and (not p.banned or p.banned_until<=now()))
  then raise exception 'Inactive account';end if;
  if exists(select 1 from public.ss_school_memberships where school_id=school and profile_id=target)
  then raise exception 'Already enrolled in school';end if;
  insert into public.ss_school_memberships(school_id,profile_id,role,assigned_by)
  values(school,target,requested,actor);
 end if;
 update public.ss_school_join_requests set status=case when p_approve then 'approved' else 'denied' end,
 reviewed_by=actor,reviewed_at=now() where id=p_request;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,school,'school_join_reviewed',p_request::text||' approved='||p_approve::text);
end $$;

create or replace function public.ss1_school_settings(
 p_school uuid,p_name text,p_tagline text,p_accent text,p_logo_url text default '')
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor();v_name text:=btrim(coalesce(p_name,''));
 tagline text:=btrim(coalesce(p_tagline,'')); accent text:=btrim(coalesce(p_accent,''));
 logo text:=btrim(coalesce(p_logo_url,''));
begin
 if not public.ss1_school_permission(p_school,'manage_settings') then
   raise exception 'Permission denied: manage_settings';end if;
 if length(v_name) not between 2 and 100 or length(tagline)>160 or accent !~ '^#[a-fA-F0-9]{6}$'
 then raise exception 'Invalid school name, tagline or color';end if;
 if logo<>'' and (length(logo)>600 or logo !~ '^https://[A-Za-z0-9_.:/%-]+$')
 then raise exception 'Logo must use a valid HTTPS image URL';end if;
 -- School name is changed only by the separate manage_schools permission.
 insert into public.ss1_school_branding(school_id,tagline,accent,logo_url,updated_by)
 values(p_school,tagline,accent,logo,actor)
 on conflict (school_id) do update set tagline=excluded.tagline,accent=excluded.accent,
 logo_url=excluded.logo_url,updated_by=excluded.updated_by,updated_at=now();
 insert into public.ss_school_audit(actor_id,school_id,action,detail) values(actor,p_school,'school_settings_updated',v_name);
end $$;

create or replace function public.ss1_school_announce(p_school uuid,p_title text,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor();result uuid;
begin
 if not (public.ss1_school_permission(p_school,'publish_announcements')
    or public.ss_school_principal(p_school))
 then raise exception 'Permission denied: publish_announcements';end if;
 if length(btrim(coalesce(p_title,''))) not between 3 and 120
 or length(btrim(coalesce(p_body,''))) not between 3 and 2000
 then raise exception 'Invalid announcement';end if;
 insert into public.ss1_school_announcements(school_id,title,body,author)
 values(p_school,btrim(p_title),btrim(p_body),actor) returning id into result;
 return result;
end $$;

create or replace function public.ss1_school_analytics(p_school uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not (public.ss1_school_permission(p_school,'view_analytics')
   or public.ss_school_principal(p_school))
 then raise exception 'Permission denied: view_analytics';end if;
 select jsonb_build_object(
  'students',(select count(*) from public.ss_school_memberships where school_id=p_school and role='student'),
  'teachers',(select count(*) from public.ss_school_memberships where school_id=p_school and role='teacher'),
  'principals',(select count(*) from public.ss_school_memberships where school_id=p_school and role='principal'),
  'classes',(select count(*) from public.ss_school_classes where school_id=p_school),
  'assignments',(select count(*) from public.ss_school_assignments a join public.ss_school_classes c on c.id=a.class_id where c.school_id=p_school),
  'submissions',(select count(*) from public.ss_school_submissions s join public.ss_school_assignments a on a.id=s.assignment_id
    join public.ss_school_classes c on c.id=a.class_id where c.school_id=p_school)
 ) into result;
 return result;
end $$;

create or replace function public.ss1_school_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); owner boolean:=public.ss1_owner(); data jsonb;
begin
 if actor is null then raise exception 'Sign in to StudySpire Cloud';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'name',s.name,'code',s.join_code,
  'my_role',coalesce((select m.role from public.ss_school_memberships m where m.school_id=s.id and m.profile_id=actor),''),
  'is_admin',exists(select 1 from public.ss1_school_admins a where a.school_id=s.id and a.profile_id=actor),
  'permissions',jsonb_build_object(
    'manage_schools',public.ss1_school_permission(s.id,'manage_schools'),
    'appoint_principals',public.ss1_school_permission(s.id,'appoint_principals'),
    'manage_enrollment',public.ss1_school_permission(s.id,'manage_enrollment'),
    'view_analytics',public.ss1_school_permission(s.id,'view_analytics'),
    'publish_announcements',public.ss1_school_permission(s.id,'publish_announcements'),
    'manage_settings',public.ss1_school_permission(s.id,'manage_settings')),
  'branding',coalesce((select jsonb_build_object('tagline',b.tagline,'accent',b.accent,'logo_url',b.logo_url)
    from public.ss1_school_branding b where b.school_id=s.id),
    '{"tagline":"","accent":"#3478f6","logo_url":""}'::jsonb),
  'admins',case when owner then coalesce((select jsonb_agg(jsonb_build_object(
    'username',p.username,'permissions',jsonb_build_object(
      'manage_schools',a.manage_schools,'appoint_principals',a.appoint_principals,
      'manage_enrollment',a.manage_enrollment,'view_analytics',a.view_analytics,
      'publish_announcements',a.publish_announcements,'manage_settings',a.manage_settings)
  ) order by p.username) from public.ss1_school_admins a join public.ss_profiles p on p.id=a.profile_id
     where a.school_id=s.id),'[]'::jsonb) else '[]'::jsonb end,
  'members',case when owner or public.ss1_school_permission(s.id,'manage_enrollment')
    or public.ss_school_principal(s.id) then coalesce((
      select jsonb_agg(jsonb_build_object('username',p.username,'role',m.role) order by p.username)
      from public.ss_school_memberships m join public.ss_profiles p on p.id=m.profile_id
      where m.school_id=s.id),'[]'::jsonb) else '[]'::jsonb end,
  'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'subject',c.subject)
   order by c.created_at) from public.ss_school_classes c where c.school_id=s.id),'[]'::jsonb),
  'announcements',coalesce((select jsonb_agg(jsonb_build_object('title',a.title,'body',a.body,'created_at',a.created_at)
     order by a.created_at desc) from (select * from public.ss1_school_announcements where school_id=s.id
     order by created_at desc limit 15) a),'[]'::jsonb)
 ) order by s.name),'[]'::jsonb) into data from public.ss_schools s
 where owner or exists(select 1 from public.ss1_school_admins a where a.school_id=s.id and a.profile_id=actor)
 or exists(select 1 from public.ss_school_memberships m where m.school_id=s.id and m.profile_id=actor);
 return jsonb_build_object('is_owner',owner,'schools',data);
end $$;


create or replace function public.ss1_school_rename(p_school uuid,p_name text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); clean text:=btrim(coalesce(p_name,''));
begin
 if not public.ss1_school_permission(p_school,'manage_schools') then raise exception 'Permission denied: manage_schools';end if;
 if length(clean) not between 2 and 100 then raise exception 'School name must be 2-100 characters';end if;
 update public.ss_schools set name=clean where id=p_school;
 if not found then raise exception 'School unavailable';end if;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,p_school,'school_renamed',clean);
end $$;

-- Remove all client access to legacy organization-management RPCs in StudySpire1's
-- shared Supabase backend. These school-only RPCs replace them in the new UI.
-- NOTE: these were only used by StudySpire1 school features, not the original StudySpire.
revoke execute on function public.ss_school_create_organization(text,text) from public,anon,authenticated;
revoke execute on function public.ss_school_create_school(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.ss_school_set_admin(uuid,text,boolean) from public,anon,authenticated;
revoke execute on function public.ss_school_set_member(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.ss_school_request_join(text,text,text,text) from public,anon,authenticated;
revoke execute on function public.ss_school_review_join(uuid,boolean) from public,anon,authenticated;
revoke execute on function public.ss_school_pending_join_requests(uuid) from public,anon,authenticated;

revoke execute on function public.ss1_owner() from public,anon,authenticated;
revoke execute on function public.ss1_school_permission(uuid,text) from public,anon,authenticated;
revoke execute on function public.ss1_school_create(text,text) from public,anon;
revoke execute on function public.ss1_school_set_admin(uuid,text,boolean) from public,anon;
revoke execute on function public.ss1_school_set_permission(uuid,text,text,boolean) from public,anon;
revoke execute on function public.ss1_school_set_member(uuid,text,text) from public,anon;
revoke execute on function public.ss1_school_request_join(text,text,text) from public,anon;
revoke execute on function public.ss1_school_pending(uuid) from public,anon;
revoke execute on function public.ss1_school_review_join(uuid,boolean) from public,anon;
revoke execute on function public.ss1_school_rename(uuid,text) from public,anon;
revoke execute on function public.ss1_school_settings(uuid,text,text,text,text) from public,anon;
revoke execute on function public.ss1_school_announce(uuid,text,text) from public,anon;
revoke execute on function public.ss1_school_analytics(uuid) from public,anon;
revoke execute on function public.ss1_school_overview() from public,anon;
grant execute on function public.ss1_school_create(text,text),
 public.ss1_school_set_admin(uuid,text,boolean),
 public.ss1_school_set_permission(uuid,text,text,boolean),
 public.ss1_school_set_member(uuid,text,text),
 public.ss1_school_request_join(text,text,text),
 public.ss1_school_pending(uuid),
 public.ss1_school_review_join(uuid,boolean),
 public.ss1_school_rename(uuid,text),
 public.ss1_school_settings(uuid,text,text,text,text),
 public.ss1_school_announce(uuid,text,text),
 public.ss1_school_analytics(uuid),
 public.ss1_school_overview() to authenticated;
commit;
