-- StudySpire1: REMOVE organization system completely.
-- Safe for existing school records: drops the organization link, not schools.
-- Apply after studyspire1-school-only.sql and studyspire1-school-first.sql.
-- Platform Owner remains lifecycle-only. School staff own their school data.
begin;

-- Disable and remove old organization APIs before removing tables.
drop function if exists public.ss_school_create_organization(text,text);
drop function if exists public.ss_school_create_school(uuid,text,text);
drop function if exists public.ss_school_set_admin(uuid,text,boolean);
drop function if exists public.ss_school_overview();
drop function if exists public.ss_school_org_admin(uuid);
drop function if exists public.ss_school_request_join(text,text,text,text);
drop function if exists public.ss_school_pending_join_requests(uuid);
drop function if exists public.ss_school_review_join(uuid,boolean);
drop function if exists public.ss_school_set_member(uuid,text,text);
-- Old alternate APIs could still create organization rows or give platform
-- staff school rights; remove these instead of leaving dormant routes.
drop function if exists public.ss1_school_create(text,text);
drop function if exists public.ss1_school_set_admin(uuid,text,boolean);
drop function if exists public.ss1_school_set_permission(uuid,text,text,boolean);
drop function if exists public.ss1_owner();

-- No schools have organization IDs anymore. School history remains intact.
alter table public.ss_schools drop column if exists organization_id;
alter table public.ss_school_audit drop column if exists organization_id;
create unique index if not exists ss1_school_code_global_unique
  on public.ss_schools(lower(code));
drop table if exists public.ss_organization_admins;
drop table if exists public.ss_organizations;
-- Old parallel school admin structure is replaced by school-specific roles
-- plus ss1_school_admin_permissions, with principal-controlled assignments.
drop table if exists public.ss1_school_admins;

-- Never authorize based on a platform role; platform staff cannot access
-- school membership content. Newer active RPCs use ss_school_actor().
create or replace function public.ss1_school_permission(p_school uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.ss1_school_can(p_school,p_permission)
$$;
revoke execute on function public.ss1_school_permission(uuid,text)
 from public,anon,authenticated;

-- Create a school DIRECTLY, no internal organization or district.
-- Do not give the Owner any school membership or school-content access.
create or replace function public.ss1_create_school(p_name text,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss1_platform_owner_id();
 school uuid; code text;
 n text:=btrim(coalesce(p_name,'')); c text:=lower(btrim(coalesce(p_code,'')));
begin
 if actor is null then raise exception 'Only the platform Owner can create schools'; end if;
 if length(n) not between 2 and 100 or c !~ '^[a-z0-9][a-z0-9-]{2,39}$'
 then raise exception 'Enter a valid school name and unique 3–40-character code'; end if;
 insert into public.ss_schools(name,code,join_code,created_by)
 values(n,c,c,actor) returning id into school;
 insert into public.ss1_school_branding(school_id) values(school)
 on conflict(school_id) do nothing;
 -- One-time activation: an eligible NON-platform-staff account can be
 -- first principal without platform Owner reading or managing school data.
 code:=public.ss1_issue_school_claim(school);
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,school,'school_created',n);
 return jsonb_build_object('id',school,'name',n,'code',c,'claim_code',code);
end $$;

-- Existing school classes remain. Only a verified school principal creates new
-- ones. Teacher and platform staff are denied by the database.
create or replace function public.ss_school_create_class(
 p_school uuid,p_title text,p_subject text default ''
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor();
 new_id uuid; v_title text:=btrim(coalesce(p_title,''));v_subject text:=btrim(coalesce(p_subject,''));
begin
 if actor is null or not exists(select 1 from public.ss_schools s where s.id=p_school)
   or not public.ss_school_principal(p_school)
 then raise exception 'Only this school principal can create classes'; end if;
 if length(v_title) not between 2 and 100 or length(v_subject)>80
 then raise exception 'Enter a valid class name and subject'; end if;
 insert into public.ss_school_classes(school_id,title,subject,created_by)
 values(p_school,v_title,v_subject,actor) returning id into new_id;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,p_school,'class_created',v_title);
 return new_id;
end $$;

-- Request history, now keyed to schools only.
create or replace function public.ss_school_my_join_requests()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); result jsonb;
begin
 if actor is null then raise exception 'Sign in to view school applications'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',q.id,'school_name',s.name,'school_code',s.code,
  'requested_role',q.requested_role,'status',q.status,
  'requested_at',q.requested_at,'reviewed_at',q.reviewed_at
 ) order by q.requested_at desc),'[]'::jsonb) into result
 from (select * from public.ss_school_join_requests
   where profile_id=actor order by requested_at desc limit 30) q
 join public.ss_schools s on s.id=q.school_id;
 return result;
end $$;

-- Role elevation clears school access, but does not reference removed tables.
create or replace function public.ss1_remove_promoted_staff_school_access()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role in ('owner','co_owner','admin','moderator') and old.role is distinct from new.role then
   delete from public.ss_school_class_enrollments where profile_id=new.id;
   delete from public.ss_school_memberships where profile_id=new.id;
   delete from public.ss1_verified_guardians where guardian_id=new.id;
 end if;
 return new;
end $$;

-- Retire legacy membership changer; use the principal-administered school role
-- RPC that checks platform exclusion and prevents removing the final principal.
create or replace function public.ss1_school_set_member(p_school uuid,p_username text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.ss1_set_school_role(p_school,p_username,p_role);
end $$;

-- School-only overview for enrolled students, teachers, school admins,
-- principals and verified guardians. The platform Owner has NO access here.
create or replace function public.ss1_school_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=public.ss_school_actor(); result jsonb;
begin
 if actor is null then raise exception 'School accounts only; platform staff cannot view school contents';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'name',s.name,'code',s.code,'join_code',s.join_code,
  'my_role',coalesce(public.ss1_school_role(s.id),'guardian'),
  'is_owner',false,
  'permissions',jsonb_build_object(
   'manage_schools',public.ss1_school_can(s.id,'manage_schools'),
   'appoint_principals',public.ss1_school_can(s.id,'appoint_principals'),
   'manage_enrollment',public.ss1_school_can(s.id,'manage_enrollment'),
   'view_analytics',public.ss1_school_can(s.id,'view_analytics'),
   'publish_announcements',public.ss1_school_can(s.id,'publish_announcements'),
   'manage_settings',public.ss1_school_can(s.id,'manage_settings')),
  'branding',jsonb_build_object('tagline',coalesce(b.tagline,''),
    'accent',coalesce(b.accent,'#3478f6'),'logo_url',coalesce(b.logo_url,'')),
  'admins',case when public.ss_school_principal(s.id)
    then coalesce((select jsonb_agg(jsonb_build_object('username',p.username,
      'permissions',coalesce(ap.permissions,'{}'::jsonb)) order by p.username)
      from public.ss_school_memberships m join public.ss_profiles p on p.id=m.profile_id
      left join public.ss1_school_admin_permissions ap on ap.school_id=m.school_id and ap.profile_id=m.profile_id
      where m.school_id=s.id and m.role='school_admin'),'[]'::jsonb)
    else '[]'::jsonb end,
  'members',case when public.ss1_school_can(s.id,'manage_enrollment')
    or public.ss_school_principal(s.id)
    then coalesce((select jsonb_agg(jsonb_build_object('username',p.username,'role',m.role)
    order by p.username)
    from public.ss_school_memberships m join public.ss_profiles p on p.id=m.profile_id
    where m.school_id=s.id),'[]'::jsonb)
    else '[]'::jsonb end,
  'classes',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'title',c.title,'subject',c.subject) order by c.title)
    from public.ss_school_classes c where c.school_id=s.id),'[]'::jsonb),
  'announcements',coalesce((select jsonb_agg(jsonb_build_object(
    'id',a.id,'title',a.title,'body',a.body,'created_at',a.created_at)
     order by a.created_at desc) from
     (select id,title,body,created_at from public.ss1_school_announcements
      where school_id=s.id order by created_at desc limit 25) a),'[]'::jsonb)
 ) order by s.name),'[]'::jsonb) into result
 from public.ss_schools s
 left join public.ss1_school_branding b on b.school_id=s.id
 where public.ss1_school_member(s.id);
 return jsonb_build_object('is_owner',false,'schools',result);
end $$;

-- Only school principals may configure school administrator permissions.
-- Backend verifies each permission flag; no platform owner override.
revoke execute on function public.ss1_school_overview() from public,anon;
grant execute on function public.ss1_school_overview() to authenticated;

-- No anonymous or general-public direct access to these functions.
revoke execute on function public.ss1_create_school(text,text) from public,anon;
revoke execute on function public.ss_school_create_class(uuid,text,text) from public,anon;
revoke execute on function public.ss_school_my_join_requests() from public,anon;
revoke execute on function public.ss1_school_set_member(uuid,text,text) from public,anon;
grant execute on function public.ss1_create_school(text,text),
  public.ss_school_create_class(uuid,text,text),
  public.ss_school_my_join_requests(),
  public.ss1_school_set_member(uuid,text,text) to authenticated;

commit;
