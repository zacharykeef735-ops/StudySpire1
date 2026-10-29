-- StudySpire1: self-service school join requests with mandatory leader approval.
-- Apply AFTER studyspire1-organizations-schools.sql and studyspire1-academics.sql.
-- No direct table access. Never grant org admin, principal or platform roles by request.
begin;

create table if not exists public.ss_school_join_requests (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.ss_schools(id) on delete cascade,
 profile_id uuid not null references public.ss_profiles(id) on delete cascade,
 requested_role text not null check(requested_role in ('student','teacher')),
 note text not null default '' check(char_length(note)<=300),
 status text not null default 'pending' check(status in ('pending','approved','denied','cancelled')),
 requested_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references public.ss_profiles(id) on delete set null
);
create unique index if not exists ss_join_one_pending_per_school
 on public.ss_school_join_requests(school_id,profile_id) where status='pending';
create index if not exists ss_join_by_school on public.ss_school_join_requests(school_id,status,requested_at desc);
create index if not exists ss_join_by_profile on public.ss_school_join_requests(profile_id,requested_at desc);

alter table public.ss_school_join_requests enable row level security;
revoke all on public.ss_school_join_requests from public,anon,authenticated;

create or replace function public.ss_school_request_join(
 p_org_code text,p_school_code text,p_role text,p_note text default ''
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor uuid := public.ss_school_actor();
 school uuid; school_name text; org_name text;
 new_id uuid;
 clean_org text := lower(btrim(coalesce(p_org_code,'')));
 clean_school text := lower(btrim(coalesce(p_school_code,'')));
 clean_note text := btrim(coalesce(p_note,''));
begin
 if actor is null then raise exception 'Sign in with a StudySpire username first'; end if;
 if p_role not in ('student','teacher') or p_role is null then raise exception 'Choose student or teacher'; end if;
 if char_length(clean_note)>300 then raise exception 'Message is too long (300 characters max)'; end if;
 if clean_org !~ '^[a-z0-9][a-z0-9-]{1,39}$' or clean_school !~ '^[a-z0-9][a-z0-9-]{1,39}$'
 then raise exception 'Enter the organization and school codes provided by your school'; end if;
 select s.id,s.name,o.name into school,school_name,org_name
 from public.ss_schools s join public.ss_organizations o on o.id=s.organization_id
 where o.code=clean_org and s.code=clean_school;
 if school is null then raise exception 'School code not found. Double-check both codes.'; end if;
 if exists(select 1 from public.ss_school_memberships where school_id=school and profile_id=actor)
 then raise exception 'You already belong to this school'; end if;
 if exists(select 1 from public.ss_school_join_requests where school_id=school and profile_id=actor and status='pending')
 then raise exception 'Your request is already pending for this school'; end if;
 if (select count(*) from public.ss_school_join_requests where profile_id=actor and status='pending')>=5
 then raise exception 'You have too many open school applications'; end if;
 if (select count(*) from public.ss_school_join_requests where profile_id=actor and requested_at>now()-interval '24 hours')>=10
 then raise exception 'Daily request limit reached. Try again tomorrow.'; end if;
 insert into public.ss_school_join_requests(school_id,profile_id,requested_role,note)
 values(school,actor,p_role,clean_note) returning id into new_id;
 return jsonb_build_object('id',new_id,'school_name',school_name,'organization_name',org_name,'status','pending');
end $$;

create or replace function public.ss_school_my_join_requests()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); result jsonb;
begin
 if actor is null then raise exception 'Sign in to view your school applications'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',q.id,'school_name',s.name,'school_code',s.code,'organization_name',o.name,
  'requested_role',q.requested_role,'status',q.status,
  'requested_at',q.requested_at,'reviewed_at',q.reviewed_at
 ) order by q.requested_at desc),'[]'::jsonb) into result
 from (select * from public.ss_school_join_requests where profile_id=actor order by requested_at desc limit 30) q
 join public.ss_schools s on s.id=q.school_id
 join public.ss_organizations o on o.id=s.organization_id;
 return result;
end $$;

create or replace function public.ss_school_pending_join_requests(p_school uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); org uuid; result jsonb;
begin
 select organization_id into org from public.ss_schools where id=p_school;
 if actor is null or org is null or not(public.ss_school_platform_owner()
    or public.ss_school_org_admin(org) or public.ss_school_principal(p_school))
 then raise exception 'Only a school leader can review applications'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',q.id,'username',p.username,'role',q.requested_role,
  'note',q.note,'requested_at',q.requested_at
 ) order by q.requested_at),'[]'::jsonb) into result
 from public.ss_school_join_requests q
 join public.ss_profiles p on p.id=q.profile_id
 where q.school_id=p_school and q.status='pending';
 return result;
end $$;

create or replace function public.ss_school_review_join(p_request uuid,p_approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor uuid := public.ss_school_actor();
 school uuid; org uuid; target uuid; target_role text; request_status text;
begin
 select q.school_id,q.profile_id,q.requested_role,q.status,s.organization_id
 into school,target,target_role,request_status,org
 from public.ss_school_join_requests q join public.ss_schools s on s.id=q.school_id
 where q.id=p_request for update of q;
 if actor is null or school is null or not(public.ss_school_platform_owner()
    or public.ss_school_org_admin(org) or public.ss_school_principal(school))
 then raise exception 'Only a school leader can decide this application'; end if;
 if request_status<>'pending' then raise exception 'This application was already decided'; end if;
 if p_approve is null then raise exception 'Choose approve or decline'; end if;
 if p_approve then
  if not exists(select 1 from public.ss_profiles p
    where p.id=target and (not p.banned or (p.banned_until is not null and p.banned_until<=now())))
  then raise exception 'This account is not active'; end if;
  if exists(select 1 from public.ss_school_memberships m where m.school_id=school and m.profile_id=target)
  then raise exception 'This person is already a school member. Review their existing role first.'; end if;
  insert into public.ss_school_memberships(school_id,profile_id,role,assigned_by)
   values(school,target,target_role,actor);
 end if;
 update public.ss_school_join_requests
 set status=case when p_approve then 'approved' else 'denied' end,
     reviewed_at=now(),reviewed_by=actor
 where id=p_request;
 insert into public.ss_school_audit(actor_id,organization_id,school_id,action,detail)
 values(actor,org,school,case when p_approve then 'school_join_approved' else 'school_join_denied' end,
        p_request::text);
end $$;

create or replace function public.ss_school_cancel_join(p_request uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); affected integer;
begin
 if actor is null then raise exception 'Sign in first'; end if;
 update public.ss_school_join_requests
 set status='cancelled',reviewed_at=now()
 where id=p_request and profile_id=actor and status='pending';
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'No pending application belongs to your account'; end if;
end $$;

-- PostgreSQL defaults often grant EXECUTE to PUBLIC. Revoke before opt-in.
revoke execute on function public.ss_school_request_join(text,text,text,text) from public,anon,authenticated;
revoke execute on function public.ss_school_my_join_requests() from public,anon,authenticated;
revoke execute on function public.ss_school_pending_join_requests(uuid) from public,anon,authenticated;
revoke execute on function public.ss_school_review_join(uuid,boolean) from public,anon,authenticated;
revoke execute on function public.ss_school_cancel_join(uuid) from public,anon,authenticated;
grant execute on function public.ss_school_request_join(text,text,text,text),
 public.ss_school_my_join_requests(),
 public.ss_school_pending_join_requests(uuid),
 public.ss_school_review_join(uuid,boolean),
 public.ss_school_cancel_join(uuid) to authenticated;
commit;
