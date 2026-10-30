-- StudySpire1 school-first extension (no organizations in the interface).
-- Requires existing StudySpire1 organizations-school, school-join, and academics schemas.
-- Existing original StudySpire tables are NOT dropped or altered except the
-- StudySpire1 school membership role constraint. Shared login stays shared.
begin;

-- School admins are independent of platform admins and never gain platform powers.
-- Keep old school links valid, but new schools do not belong to any organization.
alter table public.ss_schools alter column organization_id drop not null;
create unique index if not exists ss1_schools_global_code_unique on public.ss_schools(code);

alter table public.ss_school_memberships drop constraint if exists ss_school_memberships_role_check;
alter table public.ss_school_memberships add constraint ss_school_memberships_role_check
 check (role in ('school_admin','principal','teacher','student'));

create table if not exists public.ss1_school_admin_permissions (
 school_id uuid not null references public.ss_schools(id) on delete cascade,
 profile_id uuid not null references public.ss_profiles(id) on delete cascade,
 permissions jsonb not null default '{"manage_schools":false,"appoint_principals":false,"manage_enrollment":true,"view_analytics":true,"publish_announcements":true,"manage_settings":false}'::jsonb
 check (jsonb_typeof(permissions)='object'),
 changed_by uuid not null references public.ss_profiles(id),
 changed_at timestamptz not null default now(),
 primary key(school_id,profile_id),
 foreign key(school_id,profile_id) references public.ss_school_memberships(school_id,profile_id) on delete cascade
);
create table if not exists public.ss1_school_branding (
 school_id uuid primary key references public.ss_schools(id) on delete cascade,
 description text not null default '' check(length(description)<=400),
 accent_color text not null default '#397ed4' check(accent_color ~ '^#[A-Fa-f0-9]{6}$'),
 symbol text not null default '🏫' check(length(symbol) between 1 and 8),
 updated_at timestamptz not null default now()
);
create table if not exists public.ss1_school_announcements (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.ss_schools(id) on delete cascade,
 body text not null check(length(btrim(body)) between 2 and 1200),
 created_by uuid not null references public.ss_profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists ss1_announcements_school_idx on public.ss1_school_announcements(school_id,created_at desc);
create table if not exists public.ss1_school_events (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.ss_schools(id) on delete cascade,
 title text not null check(length(btrim(title)) between 2 and 100),
 detail text not null default '' check(length(detail)<=700),
 starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at>starts_at),
 category text not null default 'school' check(category in ('school','exam','holiday','meeting','class')),
 created_by uuid not null references public.ss_profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists ss1_events_school_idx on public.ss1_school_events(school_id,starts_at);
create table if not exists public.ss1_school_attendance (
 school_id uuid not null references public.ss_schools(id) on delete cascade,
 student_id uuid not null references public.ss_profiles(id) on delete cascade,
 day date not null,
 status text not null check(status in ('present','absent','tardy','excused')),
 note text not null default '' check(length(note)<=250),
 recorded_by uuid not null references public.ss_profiles(id),
 recorded_at timestamptz not null default now(),
 primary key (school_id,student_id,day),
 foreign key(school_id,student_id) references public.ss_school_memberships(school_id,profile_id) on delete cascade
);
create table if not exists public.ss1_verified_guardians (
 school_id uuid not null references public.ss_schools(id) on delete cascade,
 student_id uuid not null references public.ss_profiles(id) on delete cascade,
 guardian_id uuid not null references public.ss_profiles(id) on delete cascade,
 verified_by uuid not null references public.ss_profiles(id),
 verified_at timestamptz not null default now(),
 primary key(school_id,student_id,guardian_id),
 foreign key(school_id,student_id) references public.ss_school_memberships(school_id,profile_id) on delete cascade
);
create index if not exists ss1_guardians_by_guardian_idx on public.ss1_verified_guardians(guardian_id);
create table if not exists public.ss1_substitute_notes (
 class_id uuid primary key references public.ss_school_classes(id) on delete cascade,
 content text not null check(length(btrim(content)) between 2 and 3000),
 updated_by uuid not null references public.ss_profiles(id),
 updated_at timestamptz not null default now()
);

alter table public.ss1_school_admin_permissions enable row level security;
alter table public.ss1_school_branding enable row level security;
alter table public.ss1_school_announcements enable row level security;
alter table public.ss1_school_events enable row level security;
alter table public.ss1_school_attendance enable row level security;
alter table public.ss1_verified_guardians enable row level security;
alter table public.ss1_substitute_notes enable row level security;
revoke all on public.ss1_school_admin_permissions,public.ss1_school_branding,
 public.ss1_school_announcements,public.ss1_school_events,public.ss1_school_attendance,
 public.ss1_verified_guardians,public.ss1_substitute_notes from public,anon,authenticated;

-- All authorization checks use the server-resolved StudySpire profile,
-- including the anonymous-session username mapping.
create or replace function public.ss1_is_owner()
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.ss_school_platform_owner(),false)
$$;
create or replace function public.ss1_school_role(p_school uuid)
returns text language sql stable security definer set search_path='' as $$
 select m.role from public.ss_school_memberships m
 where m.school_id=p_school and m.profile_id=(select public.ss_school_actor()) limit 1
$$;
create or replace function public.ss1_school_can(p_school uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare role_name text; props jsonb;
begin
 if p_school is null or public.ss_school_actor() is null then return false; end if;
 if public.ss1_is_owner() then return true; end if;
 role_name:=public.ss1_school_role(p_school);
 if role_name='principal' then return p_permission<>'appoint_principals'; end if;
 if role_name<>'school_admin' then return false; end if;
 if p_permission not in ('manage_schools','appoint_principals','manage_enrollment',
  'view_analytics','publish_announcements','manage_settings') then return false; end if;
 select a.permissions into props from public.ss1_school_admin_permissions a
 where a.school_id=p_school and a.profile_id=(select public.ss_school_actor());
 return coalesce(props->>p_permission,'false')='true';
end $$;
create or replace function public.ss1_school_member(p_school uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.ss1_is_owner() or exists(
  select 1 from public.ss_school_memberships m
  where m.school_id=p_school and m.profile_id=(select public.ss_school_actor())
 ) or exists (
  select 1 from public.ss1_verified_guardians g
  where g.school_id=p_school and g.guardian_id=(select public.ss_school_actor())
 )
$$;

create or replace function public.ss1_create_school(p_name text,p_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); result uuid;
 n text:=btrim(coalesce(p_name,''));c text:=lower(btrim(coalesce(p_code,'')));
begin
 if actor is null or not public.ss1_is_owner() then raise exception 'Only a platform Owner can create schools';end if;
 if length(n) not between 2 and 100 or c !~ '^[a-z0-9][a-z0-9-]{1,39}$'
 then raise exception 'Enter a valid school name and unique code'; end if;
 if exists(select 1 from public.ss_schools where code=c) then raise exception 'School code already used';end if;
 -- New schools have no organization. Old organization-linked schools are preserved.
 insert into public.ss_schools(name,code,created_by)
 values(n,c,actor) returning id into result;
 insert into public.ss1_school_branding(school_id) values(result);
 insert into public.ss_school_audit(actor_id,school_id,action,detail) values(actor,result,'school_created',n);
 return result;
end $$;

create or replace function public.ss1_set_school_role(p_school uuid,p_username text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); target uuid; prior text;
 uname text:=lower(btrim(coalesce(p_username,'')));
begin
 if actor is null or not exists(select 1 from public.ss_schools where id=p_school) then raise exception 'School unavailable'; end if;
 if p_role not in ('school_admin','principal','teacher','student','remove') or p_role is null then raise exception 'Invalid school role';end if;
 if uname !~ '^[a-z0-9_-]{3,32}$' then raise exception 'Enter a valid username';end if;
 select id into target from public.ss_profiles where username=uname
  and (not banned or (banned_until is not null and banned_until<=now()));
 if target is null then raise exception 'An active username was not found';end if;
 select m.role into prior from public.ss_school_memberships m
  where m.school_id=p_school and m.profile_id=target for update;
 if (p_role='school_admin' or prior='school_admin') and not public.ss1_is_owner()
  then raise exception 'Only the platform Owner can appoint or remove school admins';end if;
 if (p_role='principal' or prior='principal') and not public.ss1_school_can(p_school,'appoint_principals')
  then raise exception 'You lack principal-management permission';end if;
 if p_role in ('teacher','student','remove') and prior is distinct from 'principal' and prior is distinct from 'school_admin'
  and not public.ss1_school_can(p_school,'manage_enrollment')
  then raise exception 'You lack enrollment permission';end if;
 if p_role='school_admin' and target=actor then raise exception 'Do not assign yourself school admin from this tool';end if;
 if p_role='remove' then
   delete from public.ss_school_memberships where school_id=p_school and profile_id=target;
 else
   insert into public.ss_school_memberships(school_id,profile_id,role,assigned_by)
   values(p_school,target,p_role,actor)
   on conflict(school_id,profile_id) do update set role=excluded.role,assigned_by=excluded.assigned_by,assigned_at=now();
   if p_role='school_admin' then
    insert into public.ss1_school_admin_permissions(school_id,profile_id,changed_by)
    values(p_school,target,actor) on conflict(school_id,profile_id) do nothing;
   end if;
 end if;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,p_school,'school_role',uname||': '||coalesce(prior,'none')||' -> '||p_role);
end $$;

create or replace function public.ss1_set_admin_permissions(p_school uuid,p_username text,p_permissions jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); target uuid; key text; value jsonb;
begin
 if actor is null or not public.ss1_is_owner() then raise exception 'Only the platform Owner can edit school admin permissions';end if;
 if jsonb_typeof(p_permissions)<>'object' then raise exception 'Permissions must be an object';end if;
 if (select count(*) from jsonb_object_keys(p_permissions))<>6 then raise exception 'Exactly six permission switches are required';end if;
 for key,value in select * from jsonb_each(p_permissions) loop
  if key not in ('manage_schools','appoint_principals','manage_enrollment','view_analytics',
   'publish_announcements','manage_settings') or jsonb_typeof(value)<>'boolean' then
   raise exception 'Unknown or invalid permission key';end if;
 end loop;
 select p.id into target from public.ss_profiles p where p.username=lower(btrim(p_username));
 if target is null or not exists(select 1 from public.ss_school_memberships m
  where m.school_id=p_school and m.profile_id=target and m.role='school_admin')
  then raise exception 'This account is not a school admin';end if;
 insert into public.ss1_school_admin_permissions(school_id,profile_id,permissions,changed_by)
 values(p_school,target,p_permissions,actor)
 on conflict(school_id,profile_id) do update set permissions=excluded.permissions,changed_by=excluded.changed_by,changed_at=now();
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,p_school,'school_admin_permissions',lower(btrim(p_username))||' permission flags updated');
end $$;

create or replace function public.ss1_school_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); result jsonb;
begin
 if actor is null then raise exception 'Sign in to StudySpire Cloud first';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'name',s.name,'code',s.code,
  'symbol',coalesce(b.symbol,'🏫'),'accent_color',coalesce(b.accent_color,'#397ed4'),
  'description',coalesce(b.description,''),
  'role',coalesce(public.ss1_school_role(s.id),'guardian'),
  'is_owner',public.ss1_is_owner(),
  'can_manage_schools',public.ss1_school_can(s.id,'manage_schools'),
  'can_appoint_principals',public.ss1_school_can(s.id,'appoint_principals'),
  'can_manage_enrollment',public.ss1_school_can(s.id,'manage_enrollment'),
  'can_view_analytics',public.ss1_school_can(s.id,'view_analytics'),
  'can_publish_announcements',public.ss1_school_can(s.id,'publish_announcements'),
  'can_manage_settings',public.ss1_school_can(s.id,'manage_settings'),
  'members',case when public.ss1_school_can(s.id,'manage_enrollment') then
    coalesce((select jsonb_agg(jsonb_build_object('username',p.username,'role',m.role,
     'permissions',case when m.role='school_admin' and public.ss1_is_owner()
       then coalesce(ap.permissions,'{}'::jsonb) else '{}'::jsonb end)
       order by p.username)
       from public.ss_school_memberships m join public.ss_profiles p on p.id=m.profile_id
       left join public.ss1_school_admin_permissions ap on ap.school_id=m.school_id and ap.profile_id=m.profile_id
       where m.school_id=s.id),'[]'::jsonb) else '[]'::jsonb end,
  'classes',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'title',c.title,'subject',c.subject) order by c.title)
    from public.ss_school_classes c where c.school_id=s.id),'[]'::jsonb),
  'announcements',coalesce((select jsonb_agg(x.obj order by x.posted desc)
     from (select jsonb_build_object('id',a.id,'body',a.body,'created_at',a.created_at,
       'author',p.username) as obj,a.created_at as posted
       from public.ss1_school_announcements a
       join public.ss_profiles p on p.id=a.created_by
       where a.school_id=s.id order by a.created_at desc limit 25) x),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,
   'starts_at',e.starts_at,'ends_at',e.ends_at,'detail',e.detail,'category',e.category)
    order by e.starts_at) from public.ss1_school_events e where e.school_id=s.id
       and e.ends_at>now()-interval '30 days' and e.starts_at<now()+interval '1 year'),'[]'::jsonb)
 ) order by s.name),'[]'::jsonb) into result
 from public.ss_schools s left join public.ss1_school_branding b on b.school_id=s.id
 where public.ss1_school_member(s.id);
 return jsonb_build_object('is_owner',public.ss1_is_owner(),'schools',result);
end $$;

create or replace function public.ss1_join_school(p_code text,p_role text,p_note text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor();sid uuid;matches integer; result uuid;
begin
 if actor is null then raise exception 'Sign in to StudySpire Cloud first';end if;
 if p_role not in ('student','teacher') or p_role is null then raise exception 'Choose student or teacher';end if;
 if length(coalesce(p_note,''))>300 then raise exception 'Keep your application note under 300 characters';end if;
 select min(id),count(*) into sid,matches from public.ss_schools where code=lower(btrim(coalesce(p_code,'')));
 if matches<>1 then raise exception 'School code not found or ambiguous';end if;
 if exists(select 1 from public.ss_school_memberships where school_id=sid and profile_id=actor) then raise exception 'Already a member of this school';end if;
 if exists(select 1 from public.ss_school_join_requests where school_id=sid and profile_id=actor and status='pending') then raise exception 'Already requested this school';end if;
 if (select count(*) from public.ss_school_join_requests where profile_id=actor and status='pending')>=5 then raise exception 'Too many pending applications';end if;
 if (select count(*) from public.ss_school_join_requests where profile_id=actor and requested_at>now()-interval '1 day')>=10 then raise exception 'Daily application limit reached';end if;
 insert into public.ss_school_join_requests(school_id,profile_id,requested_role,note)
 values(sid,actor,p_role,coalesce(p_note,'')) returning id into result;
 return result;
end $$;
create or replace function public.ss1_my_join_requests()
returns jsonb language plpgsql stable security definer set search_path='' as $
declare actor uuid:=public.ss_school_actor(); data jsonb;
begin
 if actor is null then raise exception 'Sign in to StudySpire Cloud first';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'school',s.name,'school_code',s.code,
  'role',q.requested_role,'note',q.note,'status',q.status,'created_at',q.requested_at)
  order by q.requested_at desc),'[]'::jsonb) into data
 from public.ss_school_join_requests q join public.ss_schools s on s.id=q.school_id
 where q.profile_id=actor;
 return data;
end $;
create or replace function public.ss1_pending_join_requests(p_school uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ss1_school_can(p_school,'manage_enrollment') then raise exception 'School enrollment access denied';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'username',p.username,'role',q.requested_role,
 'note',q.note,'requested_at',q.requested_at) order by q.requested_at),'[]'::jsonb)
 into result from public.ss_school_join_requests q
 join public.ss_profiles p on p.id=q.profile_id where q.school_id=p_school and q.status='pending';
 return result;
end $$;
create or replace function public.ss1_review_join(p_request uuid,p_approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;target uuid;requested text;status_name text;actor uuid:=public.ss_school_actor();
begin
 select school_id,profile_id,requested_role,status into sid,target,requested,status_name
 from public.ss_school_join_requests where id=p_request for update;
 if actor is null or sid is null or not public.ss1_school_can(sid,'manage_enrollment') then raise exception 'Enrollment review access denied';end if;
 if status_name<>'pending' or p_approve is null then raise exception 'Application already reviewed or decision invalid';end if;
 if p_approve then
  if not exists(select 1 from public.ss_profiles p where p.id=target
   and (not p.banned or (p.banned_until is not null and p.banned_until<=now()))) then raise exception 'Inactive account';end if;
  if exists(select 1 from public.ss_school_memberships where school_id=sid and profile_id=target) then raise exception 'Already enrolled';end if;
  insert into public.ss_school_memberships(school_id,profile_id,role,assigned_by)
  values(sid,target,requested,actor);
 end if;
 update public.ss_school_join_requests set status=case when p_approve then 'approved' else 'declined' end,
 reviewed_by=actor,reviewed_at=now() where id=p_request;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,sid,case when p_approve then 'school_join_approved' else 'school_join_declined' end,p_request::text);
end $$;

create or replace function public.ss1_update_school(p_school uuid,p_name text,p_description text,p_accent text,p_symbol text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor();n text:=btrim(coalesce(p_name,''));d text:=btrim(coalesce(p_description,''));
begin
 if not public.ss1_school_can(p_school,'manage_settings') and not public.ss1_school_can(p_school,'manage_schools')
 then raise exception 'School settings permission required';end if;
 if length(n) not between 2 and 100 or length(d)>400 or p_accent !~ '^#[a-fA-F0-9]{6}$' or length(p_symbol) not between 1 and 8
 then raise exception 'Invalid name or branding';end if;
 update public.ss_schools set name=n where id=p_school;
 insert into public.ss1_school_branding(school_id,description,accent_color,symbol)
 values(p_school,d,p_accent,p_symbol)
 on conflict(school_id) do update set description=excluded.description,
 accent_color=excluded.accent_color,symbol=excluded.symbol,updated_at=now();
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,p_school,'school_settings','School profile changed');
end $$;

create or replace function public.ss1_announce(p_school uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor();result uuid;
begin
 if not public.ss1_school_can(p_school,'publish_announcements') then raise exception 'Announcement permission required';end if;
 if length(btrim(coalesce(p_body,''))) not between 2 and 1200 then raise exception 'Enter an announcement up to 1200 characters';end if;
 insert into public.ss1_school_announcements(school_id,body,created_by)
 values(p_school,btrim(p_body),actor) returning id into result;
 insert into public.ss_school_audit(actor_id,school_id,action,detail) values(actor,p_school,'announcement_created',result::text);
 return result;
end $$;
create or replace function public.ss1_schedule_event(p_school uuid,p_title text,p_details text,p_start timestamptz,p_end timestamptz,p_category text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor();result uuid;
begin
 if not public.ss1_school_can(p_school,'manage_settings') then raise exception 'School calendar permission required';end if;
 if length(btrim(coalesce(p_title,''))) not between 2 and 100 or length(coalesce(p_details,''))>700
  or p_start is null or p_end is null or p_end<=p_start or p_end>p_start+interval '30 days'
  or p_category not in ('school','exam','holiday','meeting','class')
 then raise exception 'Invalid school event';end if;
 insert into public.ss1_school_events(school_id,title,detail,starts_at,ends_at,category,created_by)
 values(p_school,btrim(p_title),coalesce(p_details,''),p_start,p_end,p_category,actor) returning id into result;
 insert into public.ss_school_audit(actor_id,school_id,action,detail) values(actor,p_school,'event_created',result::text);
 return result;
end $$;
create or replace function public.ss1_record_attendance(p_school uuid,p_username text,p_day date,p_status text,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); student uuid;
begin
 if not public.ss1_school_can(p_school,'manage_enrollment') then raise exception 'Attendance permission required';end if;
 if p_day is null or p_day<current_date-interval '365 days' or p_day>current_date+interval '2 days'
  or p_status not in ('present','absent','tardy','excused') or length(coalesce(p_note,''))>250 then raise exception 'Invalid attendance entry';end if;
 select p.id into student from public.ss_profiles p
 join public.ss_school_memberships m on m.profile_id=p.id and m.school_id=p_school and m.role='student'
 where p.username=lower(btrim(coalesce(p_username,'')));
 if student is null then raise exception 'Student is not enrolled at this school';end if;
 insert into public.ss1_school_attendance(school_id,student_id,day,status,note,recorded_by)
 values(p_school,student,p_day,p_status,coalesce(p_note,''),actor)
 on conflict(school_id,student_id,day) do update set status=excluded.status,note=excluded.note,
 recorded_by=excluded.recorded_by,recorded_at=now();
 insert into public.ss_school_audit(actor_id,school_id,action,detail) values(actor,p_school,'attendance_recorded',p_day::text);
end $$;
create or replace function public.ss1_verify_guardian(p_school uuid,p_student text,p_guardian text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor();student uuid;guardian uuid;
begin
 if not public.ss1_school_can(p_school,'manage_enrollment') then raise exception 'Guardian verification requires school leadership';end if;
 select m.profile_id into student from public.ss_school_memberships m join public.ss_profiles p on p.id=m.profile_id
 where m.school_id=p_school and m.role='student' and p.username=lower(btrim(coalesce(p_student,'')));
 select id into guardian from public.ss_profiles where username=lower(btrim(coalesce(p_guardian,'')));
 if student is null or guardian is null or student=guardian then raise exception 'Verify the student and guardian accounts first';end if;
 if p_enabled is null then raise exception 'Explicit guardian verification decision required';end if;
 if p_enabled then
  insert into public.ss1_verified_guardians(school_id,student_id,guardian_id,verified_by)
  values(p_school,student,guardian,actor) on conflict do nothing;
 else
  delete from public.ss1_verified_guardians where school_id=p_school and student_id=student and guardian_id=guardian;
 end if;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,p_school,case when p_enabled then 'guardian_verified' else 'guardian_revoked' end,
 'Guardian link reviewed');
end $$;
create or replace function public.ss1_parent_portal()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); data jsonb;
begin
 if actor is null then raise exception 'Sign in first';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'school',s.name,'school_id',s.id,'student',p.username,
  'attendance',coalesce((select jsonb_agg(jsonb_build_object('day',a.day,'status',a.status,'note',a.note)
      order by a.day desc) from
      (select day,status,note from public.ss1_school_attendance
       where school_id=g.school_id and student_id=g.student_id order by day desc limit 50) a),'[]'::jsonb),
  'grades',coalesce((select jsonb_agg(jsonb_build_object('class',c.title,'assignment',asgn.title,
    'score',sub.score,'max_points',asgn.max_points,'feedback',sub.feedback,'submitted_at',sub.submitted_at)
    order by sub.submitted_at desc)
   from public.ss_school_submissions sub
   join public.ss_school_assignments asgn on asgn.id=sub.assignment_id
   join public.ss_school_classes c on c.id=asgn.class_id
   where sub.student_id=g.student_id and c.school_id=g.school_id),'[]'::jsonb)
 ) order by s.name,p.username),'[]'::jsonb) into data
 from public.ss1_verified_guardians g
 join public.ss_schools s on s.id=g.school_id
 join public.ss_profiles p on p.id=g.student_id
 where g.guardian_id=actor;
 return data;
end $$;
create or replace function public.ss1_school_analytics(p_school uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ss1_school_can(p_school,'view_analytics') then raise exception 'Analytics permission required';end if;
 select jsonb_build_object(
  'students',(select count(*) from public.ss_school_memberships m where m.school_id=p_school and m.role='student'),
  'teachers',(select count(*) from public.ss_school_memberships m where m.school_id=p_school and m.role='teacher'),
  'principals',(select count(*) from public.ss_school_memberships m where m.school_id=p_school and m.role='principal'),
  'classes',(select count(*) from public.ss_school_classes c where c.school_id=p_school),
  'assignments',(select count(*) from public.ss_school_assignments a join public.ss_school_classes c on c.id=a.class_id where c.school_id=p_school),
  'graded_count',(select count(*) from public.ss_school_submissions sub join public.ss_school_assignments a on a.id=sub.assignment_id join public.ss_school_classes c on c.id=a.class_id where c.school_id=p_school and sub.score is not null),
  'average_score_percent',(select round(avg(100*sub.score/nullif(a.max_points,0)),1) from public.ss_school_submissions sub join public.ss_school_assignments a on a.id=sub.assignment_id join public.ss_school_classes c on c.id=a.class_id where c.school_id=p_school and sub.score is not null),
  'attendance_last_30_days',coalesce((select jsonb_object_agg(t.status,t.n) from (
    select status,count(*) n from public.ss1_school_attendance where school_id=p_school and day>=current_date-30 group by status
  ) t),'{}'::jsonb),
  'pending_applications',(select count(*) from public.ss_school_join_requests j where j.school_id=p_school and j.status='pending')
 ) into result;
 return result;
end $$;
create or replace function public.ss1_school_audit(p_school uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ss1_school_can(p_school,'view_analytics') then raise exception 'Audit permission required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('actor',p.username,'action',a.action,'detail',a.detail,
  'created_at',a.created_at) order by a.created_at desc),'[]'::jsonb) into result
 from (select * from public.ss_school_audit where school_id=p_school order by created_at desc limit 70) a
 left join public.ss_profiles p on p.id=a.actor_id;
 return result;
end $$;
create or replace function public.ss1_substitute_plan(p_class uuid,p_content text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); current_content text; school uuid;
begin
 select school_id into school from public.ss_school_classes where id=p_class;
 if actor is null or school is null or not public.ss_school_class_can_teach(p_class) then raise exception 'Only assigned teachers or school leaders may access substitute plans';end if;
 if p_content is not null then
  if length(btrim(p_content)) not between 2 and 3000 then raise exception 'Enter a plan of 2–3000 characters';end if;
  insert into public.ss1_substitute_notes(class_id,content,updated_by)
  values(p_class,p_content,actor)
  on conflict(class_id) do update set content=excluded.content,updated_by=excluded.updated_by,updated_at=now();
  insert into public.ss_school_audit(actor_id,school_id,action,detail) values(actor,school,'substitute_plan_updated',p_class::text);
 end if;
 select content into current_content from public.ss1_substitute_notes where class_id=p_class;
 return jsonb_build_object('content',coalesce(current_content,''),'class_id',p_class);
end $$;

-- Internal helper functions do not need direct browser EXECUTE rights.
revoke execute on function public.ss1_is_owner() from public,anon,authenticated;
revoke execute on function public.ss1_school_role(uuid) from public,anon,authenticated;
revoke execute on function public.ss1_school_can(uuid,text) from public,anon,authenticated;
revoke execute on function public.ss1_school_member(uuid) from public,anon,authenticated;
-- Whitelist browser-callable functions and enforce verified roles INSIDE each.
revoke execute on function public.ss1_create_school(text,text) from public,anon,authenticated;
revoke execute on function public.ss1_set_school_role(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.ss1_set_admin_permissions(uuid,text,jsonb) from public,anon,authenticated;
revoke execute on function public.ss1_school_overview() from public,anon,authenticated;
revoke execute on function public.ss1_join_school(text,text,text) from public,anon,authenticated;
revoke execute on function public.ss1_my_join_requests() from public,anon,authenticated;
revoke execute on function public.ss1_pending_join_requests(uuid) from public,anon,authenticated;
revoke execute on function public.ss1_review_join(uuid,boolean) from public,anon,authenticated;
revoke execute on function public.ss1_update_school(uuid,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.ss1_announce(uuid,text) from public,anon,authenticated;
revoke execute on function public.ss1_schedule_event(uuid,text,text,timestamptz,timestamptz,text) from public,anon,authenticated;
revoke execute on function public.ss1_record_attendance(uuid,text,date,text,text) from public,anon,authenticated;
revoke execute on function public.ss1_verify_guardian(uuid,text,text,boolean) from public,anon,authenticated;
revoke execute on function public.ss1_parent_portal() from public,anon,authenticated;
revoke execute on function public.ss1_school_analytics(uuid) from public,anon,authenticated;
revoke execute on function public.ss1_school_audit(uuid) from public,anon,authenticated;
revoke execute on function public.ss1_substitute_plan(uuid,text) from public,anon,authenticated;
grant execute on function public.ss1_create_school(text,text),
 public.ss1_set_school_role(uuid,text,text),public.ss1_set_admin_permissions(uuid,text,jsonb),
 public.ss1_school_overview(),public.ss1_join_school(text,text,text),public.ss1_my_join_requests(),
 public.ss1_pending_join_requests(uuid),public.ss1_review_join(uuid,boolean),
 public.ss1_update_school(uuid,text,text,text,text),public.ss1_announce(uuid,text),
 public.ss1_schedule_event(uuid,text,text,timestamptz,timestamptz,text),
 public.ss1_record_attendance(uuid,text,date,text,text),public.ss1_verify_guardian(uuid,text,text,boolean),
 public.ss1_parent_portal(),public.ss1_school_analytics(uuid),public.ss1_school_audit(uuid),
 public.ss1_substitute_plan(uuid,text) to authenticated;
commit;
