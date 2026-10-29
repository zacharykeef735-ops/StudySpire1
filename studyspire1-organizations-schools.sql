-- StudySpire1 organization and school management.
-- Run AFTER the existing StudySpire schema and username-login / role migrations.
-- This migration ONLY adds new objects; it does not modify legacy staff privileges.
-- IMPORTANT: Apply to a dedicated StudySpire1 Supabase project for full data isolation.
begin;

create table if not exists public.ss_organizations (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 2 and 100),
 code text not null unique check(code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
 created_by uuid not null references public.ss_profiles(id),
 created_at timestamptz not null default now()
);
create table if not exists public.ss_schools (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.ss_organizations(id) on delete cascade,
 name text not null check(length(btrim(name)) between 2 and 100),
 code text not null check(code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
 created_by uuid not null references public.ss_profiles(id),
 created_at timestamptz not null default now(),
 unique(organization_id, code)
);
create index if not exists ss_schools_org_idx on public.ss_schools(organization_id);
create table if not exists public.ss_organization_admins (
 organization_id uuid not null references public.ss_organizations(id) on delete cascade,
 profile_id uuid not null references public.ss_profiles(id) on delete cascade,
 assigned_by uuid not null references public.ss_profiles(id),
 assigned_at timestamptz not null default now(),
 primary key (organization_id, profile_id)
);
create index if not exists ss_org_admin_by_user_idx on public.ss_organization_admins(profile_id);
create table if not exists public.ss_school_memberships (
 school_id uuid not null references public.ss_schools(id) on delete cascade,
 profile_id uuid not null references public.ss_profiles(id) on delete cascade,
 role text not null check(role in ('principal', 'teacher', 'student')),
 assigned_by uuid not null references public.ss_profiles(id),
 assigned_at timestamptz not null default now(),
 primary key (school_id, profile_id)
);
create index if not exists ss_school_membership_by_user_idx on public.ss_school_memberships(profile_id,school_id);
create table if not exists public.ss_school_classes (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.ss_schools(id) on delete cascade,
 title text not null check(length(btrim(title)) between 2 and 100),
 subject text not null default '' check(length(subject)<=80),
 created_by uuid not null references public.ss_profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists ss_school_classes_school_idx on public.ss_school_classes(school_id);
create table if not exists public.ss_school_audit (
 id bigint generated always as identity primary key,
 actor_id uuid references public.ss_profiles(id) on delete set null,
 organization_id uuid references public.ss_organizations(id) on delete set null,
 school_id uuid references public.ss_schools(id) on delete set null,
 action text not null,
 detail text not null default '',
 created_at timestamptz not null default now()
);
alter table public.ss_organizations enable row level security;
alter table public.ss_schools enable row level security;
alter table public.ss_organization_admins enable row level security;
alter table public.ss_school_memberships enable row level security;
alter table public.ss_school_classes enable row level security;
alter table public.ss_school_audit enable row level security;
-- All client access goes through narrow RPCs. No table-level grants or open policies.
revoke all on public.ss_organizations,public.ss_schools,public.ss_organization_admins,
 public.ss_school_memberships,public.ss_school_classes,public.ss_school_audit
 from public,anon,authenticated;
revoke all on sequence public.ss_school_audit_id_seq from public,anon,authenticated;

-- Resolve username-only accounts through the existing secure session mapping.
-- Never trust a username, role, profile ID or organization supplied by the browser.
create or replace function public.ss_school_actor()
returns uuid language sql stable security definer set search_path='' as $$
 select p.id from public.ss_profiles p
 where p.id=(select public.ss_current_profile_id())
   and (not p.banned or (p.banned_until is not null and p.banned_until<=now()))
 limit 1
$$;
create or replace function public.ss_school_platform_owner()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ss_profiles p
   where p.id=(select public.ss_school_actor()) and p.role in ('owner','co_owner'))
$$;
create or replace function public.ss_school_org_admin(p_organization uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ss_organization_admins a
   where a.organization_id=p_organization and a.profile_id=(select public.ss_school_actor()))
$$;
create or replace function public.ss_school_principal(p_school uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ss_school_memberships m
   where m.school_id=p_school and m.profile_id=(select public.ss_school_actor())
     and m.role='principal')
$$;

create or replace function public.ss_school_create_organization(p_name text,p_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); new_id uuid; v_name text := btrim(coalesce(p_name,'')); v_code text := lower(btrim(coalesce(p_code,'')));
begin
 if actor is null or not public.ss_school_platform_owner() then raise exception 'Only a platform Owner or Co-Owner can create organizations'; end if;
 if length(v_name) not between 2 and 100 or v_code !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'Enter a valid organization name and short code'; end if;
 insert into public.ss_organizations(name,code,created_by) values(v_name,v_code,actor) returning id into new_id;
 insert into public.ss_school_audit(actor_id,organization_id,action,detail) values(actor,new_id,'organization_created',v_name);
 return new_id;
end $$;

create or replace function public.ss_school_create_school(p_organization uuid,p_name text,p_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); new_id uuid; v_name text := btrim(coalesce(p_name,'')); v_code text := lower(btrim(coalesce(p_code,'')));
begin
 if actor is null or not (public.ss_school_platform_owner() or public.ss_school_org_admin(p_organization)) then
   raise exception 'Only the Owner or an organization admin can create schools';
 end if;
 if not exists(select 1 from public.ss_organizations where id=p_organization) then raise exception 'Organization not found'; end if;
 if length(v_name) not between 2 and 100 or v_code !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'Enter a valid school name and code'; end if;
 insert into public.ss_schools(organization_id,name,code,created_by) values(p_organization,v_name,v_code,actor) returning id into new_id;
 insert into public.ss_school_audit(actor_id,organization_id,school_id,action,detail) values(actor,p_organization,new_id,'school_created',v_name);
 return new_id;
end $$;

create or replace function public.ss_school_set_admin(p_organization uuid,p_username text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); target_id uuid; v_name text := lower(btrim(coalesce(p_username,'')));
begin
 if actor is null or not public.ss_school_platform_owner() then raise exception 'Only a platform Owner or Co-Owner can appoint organization admins'; end if;
 if not exists(select 1 from public.ss_organizations where id=p_organization) then raise exception 'Organization not found'; end if;
 if v_name !~ '^[a-z0-9_-]{3,32}$' then raise exception 'Enter an existing StudySpire username'; end if;
 select id into target_id from public.ss_profiles
 where username=v_name and (not banned or (banned_until is not null and banned_until<=now()));
 if target_id is null then raise exception 'Active account not found'; end if;
 if coalesce(p_enabled,false) then
  insert into public.ss_organization_admins(organization_id,profile_id,assigned_by)
    values(p_organization,target_id,actor)
    on conflict (organization_id,profile_id) do update set assigned_by=excluded.assigned_by,assigned_at=now();
 else
  delete from public.ss_organization_admins where organization_id=p_organization and profile_id=target_id;
 end if;
 insert into public.ss_school_audit(actor_id,organization_id,action,detail)
 values(actor,p_organization,case when p_enabled then 'org_admin_granted' else 'org_admin_revoked' end,v_name);
end $$;

create or replace function public.ss_school_set_member(p_school uuid,p_username text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor uuid := public.ss_school_actor(); target_id uuid; org_id uuid;
 v_name text := lower(btrim(coalesce(p_username,''))); old_role text;
 platform boolean := public.ss_school_platform_owner(); orgadmin boolean; principal boolean;
begin
 select organization_id into org_id from public.ss_schools where id=p_school;
 if actor is null or org_id is null then raise exception 'School or account not available'; end if;
 orgadmin:=public.ss_school_org_admin(org_id);
 principal:=public.ss_school_principal(p_school);
 if not(platform or orgadmin or principal) then raise exception 'You cannot manage this school'; end if;
 if p_role not in ('principal','teacher','student','remove') or p_role is null then raise exception 'Invalid school role'; end if;
 if p_role='principal' and not (platform or orgadmin) then raise exception 'Only Owner or organization admin can appoint principals'; end if;
 if v_name !~ '^[a-z0-9_-]{3,32}$' then raise exception 'Enter an existing StudySpire username'; end if;
 select id into target_id from public.ss_profiles
 where username=v_name and (not banned or (banned_until is not null and banned_until<=now()));
 if target_id is null then raise exception 'Active account not found'; end if;
 select role into old_role from public.ss_school_memberships
  where school_id=p_school and profile_id=target_id for update;
 if old_role='principal' and not (platform or orgadmin) then raise exception 'Only Owner or organization admin can change a principal'; end if;
 if p_role='remove' then
  delete from public.ss_school_memberships where school_id=p_school and profile_id=target_id;
 else
  insert into public.ss_school_memberships(school_id,profile_id,role,assigned_by)
   values(p_school,target_id,p_role,actor)
   on conflict (school_id,profile_id) do update set role=excluded.role,assigned_by=excluded.assigned_by,assigned_at=now();
 end if;
 insert into public.ss_school_audit(actor_id,organization_id,school_id,action,detail)
 values(actor,org_id,p_school,'school_member_changed',v_name||': '||coalesce(old_role,'none')||' -> '||p_role);
end $$;

create or replace function public.ss_school_create_class(p_school uuid,p_title text,p_subject text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor();org_id uuid;new_id uuid;v_title text := btrim(coalesce(p_title,''));v_subject text := btrim(coalesce(p_subject,''));
begin
 select organization_id into org_id from public.ss_schools where id=p_school;
 if actor is null or org_id is null or not(public.ss_school_platform_owner() or public.ss_school_principal(p_school)) then
  raise exception 'Only a platform Owner or that school principal can create classes';
 end if;
 if length(v_title) not between 2 and 100 or length(v_subject)>80 then raise exception 'Enter a valid class title and subject'; end if;
 insert into public.ss_school_classes(school_id,title,subject,created_by)
 values(p_school,v_title,v_subject,actor) returning id into new_id;
 insert into public.ss_school_audit(actor_id,organization_id,school_id,action,detail)
 values(actor,org_id,p_school,'class_created',v_title);
 return new_id;
end $$;

create or replace function public.ss_school_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); platform boolean := public.ss_school_platform_owner(); data jsonb;
begin
 if actor is null then raise exception 'Sign in to an active StudySpire Cloud account'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',o.id,'name',o.name,'code',o.code,
  'can_manage_org',platform or public.ss_school_org_admin(o.id),
  'can_assign_admin',platform,
  'admins',case when platform or public.ss_school_org_admin(o.id) then
    coalesce((select jsonb_agg(jsonb_build_object('username',p.username,'profile_id',p.id) order by p.username)
      from public.ss_organization_admins a join public.ss_profiles p on p.id=a.profile_id
      where a.organization_id=o.id),'[]'::jsonb)
   else '[]'::jsonb end,
  'schools',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',s.id,'name',s.name,'code',s.code,
      'can_assign_principal',platform or public.ss_school_org_admin(o.id),
      'can_manage_members',platform or public.ss_school_org_admin(o.id) or public.ss_school_principal(s.id),
      'can_create_class',platform or public.ss_school_principal(s.id),
      'my_role',coalesce((select m.role from public.ss_school_memberships m
                         where m.school_id=s.id and m.profile_id=actor),''),
      'members',case when platform or public.ss_school_org_admin(o.id) or public.ss_school_principal(s.id)
        then coalesce((select jsonb_agg(jsonb_build_object('username',p.username,'role',m.role) order by p.username)
            from public.ss_school_memberships m join public.ss_profiles p on p.id=m.profile_id
            where m.school_id=s.id),'[]'::jsonb)
        else '[]'::jsonb end,
      'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'subject',c.subject) order by c.created_at)
                        from public.ss_school_classes c where c.school_id=s.id),'[]'::jsonb)
    ) order by s.name) from public.ss_schools s
    where s.organization_id=o.id
      and (platform or public.ss_school_org_admin(o.id)
         or exists(select 1 from public.ss_school_memberships m where m.school_id=s.id and m.profile_id=actor))
  ),'[]'::jsonb)
 ) order by o.name),'[]'::jsonb) into data
 from public.ss_organizations o
 where platform or public.ss_school_org_admin(o.id)
   or exists(select 1 from public.ss_schools s join public.ss_school_memberships m on m.school_id=s.id
             where s.organization_id=o.id and m.profile_id=actor);
 return jsonb_build_object('is_owner',platform,'organizations',data);
end $$;

-- Remove default public function privileges and expose only guarded RPCs.
revoke execute on function public.ss_school_actor() from public,anon,authenticated;
revoke execute on function public.ss_school_platform_owner() from public,anon,authenticated;
revoke execute on function public.ss_school_org_admin(uuid) from public,anon,authenticated;
revoke execute on function public.ss_school_principal(uuid) from public,anon,authenticated;
revoke execute on function public.ss_school_create_organization(text,text) from public,anon;
revoke execute on function public.ss_school_create_school(uuid,text,text) from public,anon;
revoke execute on function public.ss_school_set_admin(uuid,text,boolean) from public,anon;
revoke execute on function public.ss_school_set_member(uuid,text,text) from public,anon;
revoke execute on function public.ss_school_create_class(uuid,text,text) from public,anon;
revoke execute on function public.ss_school_overview() from public,anon;
grant execute on function public.ss_school_create_organization(text,text) to authenticated;
grant execute on function public.ss_school_create_school(uuid,text,text) to authenticated;
grant execute on function public.ss_school_set_admin(uuid,text,boolean) to authenticated;
grant execute on function public.ss_school_set_member(uuid,text,text) to authenticated;
grant execute on function public.ss_school_create_class(uuid,text,text) to authenticated;
grant execute on function public.ss_school_overview() to authenticated;
commit;
