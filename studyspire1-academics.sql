-- StudySpire1 classroom workspace. Apply after studyspire1-organizations-schools.sql.
-- School-only, no changes to the personal StudySpire tables or roles.
-- The existing StudySpire1 school model and account sessions are required.
begin;

create table if not exists public.ss_school_class_enrollments (
 class_id uuid not null references public.ss_school_classes(id) on delete cascade,
 profile_id uuid not null references public.ss_profiles(id) on delete cascade,
 role text not null check (role in ('teacher','student')),
 assigned_by uuid not null references public.ss_profiles(id),
 created_at timestamptz not null default now(),
 primary key (class_id,profile_id)
);
create index if not exists ss_class_enrollments_by_profile on public.ss_school_class_enrollments(profile_id,class_id);

create table if not exists public.ss_school_assignments (
 id uuid primary key default gen_random_uuid(),
 class_id uuid not null references public.ss_school_classes(id) on delete cascade,
 title text not null check(char_length(btrim(title)) between 2 and 160),
 description text not null default '' check(char_length(description)<=3000),
 due_at timestamptz,
 max_points numeric(7,2) not null default 100 check(max_points>0 and max_points<=1000),
 created_by uuid not null references public.ss_profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists ss_school_assignments_by_class on public.ss_school_assignments(class_id,due_at);

create table if not exists public.ss_school_submissions (
 assignment_id uuid not null references public.ss_school_assignments(id) on delete cascade,
 student_id uuid not null references public.ss_profiles(id) on delete cascade,
 body text not null check(char_length(body) between 1 and 10000),
 submitted_at timestamptz not null default now(),
 score numeric(7,2),
 feedback text not null default '' check(char_length(feedback)<=3000),
 graded_by uuid references public.ss_profiles(id) on delete set null,
 graded_at timestamptz,
 primary key(assignment_id,student_id)
);
create index if not exists ss_school_submissions_by_student on public.ss_school_submissions(student_id);

create table if not exists public.ss_school_class_announcements (
 id uuid primary key default gen_random_uuid(),
 class_id uuid not null references public.ss_school_classes(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 1 and 1000),
 created_by uuid not null references public.ss_profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists ss_school_announcements_by_class on public.ss_school_class_announcements(class_id,created_at desc);

alter table public.ss_school_class_enrollments enable row level security;
alter table public.ss_school_assignments enable row level security;
alter table public.ss_school_submissions enable row level security;
alter table public.ss_school_class_announcements enable row level security;
-- Block direct PostgREST table access. Narrow RPC functions below are the only gateway.
revoke all on public.ss_school_class_enrollments,public.ss_school_assignments,
 public.ss_school_submissions,public.ss_school_class_announcements from public,anon,authenticated;

create or replace function public.ss_school_class_can_teach(p_class uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.ss_school_classes c
  where c.id=p_class and
    (public.ss_school_platform_owner() or public.ss_school_principal(c.school_id)
     or exists(
      select 1 from public.ss_school_class_enrollments e
      join public.ss_school_memberships m on m.school_id=c.school_id and m.profile_id=e.profile_id
      where e.class_id=c.id and e.profile_id=(select public.ss_school_actor())
        and e.role='teacher' and m.role='teacher'
     ))
 )
$$;

create or replace function public.ss_school_class_can_submit(p_class uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.ss_school_classes c
  join public.ss_school_class_enrollments e on e.class_id=c.id
  join public.ss_school_memberships m on m.school_id=c.school_id and m.profile_id=e.profile_id
  where c.id=p_class and e.profile_id=(select public.ss_school_actor())
    and e.role='student' and m.role='student'
 )
$$;

create or replace function public.ss_school_classroom(p_class uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 actor uuid := public.ss_school_actor(); sid uuid; leader boolean; teacher boolean; student boolean;
begin
 select school_id into sid from public.ss_school_classes where id=p_class;
 if actor is null or sid is null then raise exception 'Sign in and select an available class'; end if;
 leader := public.ss_school_platform_owner() or public.ss_school_principal(sid);
 teacher := public.ss_school_class_can_teach(p_class);
 student := public.ss_school_class_can_submit(p_class);
 if not(leader or teacher or student) then raise exception 'You are not enrolled in this class'; end if;
 return jsonb_build_object(
  'class_id',p_class,'can_manage',leader,'can_teach',teacher,'can_submit',student,
  'members',case when teacher then coalesce((
   select jsonb_agg(jsonb_build_object('profile_id',p.id,'username',p.username,'role',e.role) order by e.role,p.username)
   from public.ss_school_class_enrollments e join public.ss_profiles p on p.id=e.profile_id
   join public.ss_school_memberships m on m.school_id=sid and m.profile_id=e.profile_id and m.role=e.role
   where e.class_id=p_class
  ),'[]'::jsonb) else '[]'::jsonb end,
  'assignments',coalesce((
   select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'description',a.description,
    'due_at',a.due_at,'max_points',a.max_points,'created_at',a.created_at) order by a.due_at nulls last,a.created_at)
   from public.ss_school_assignments a where a.class_id=p_class
  ),'[]'::jsonb),
  'submissions',coalesce((
   select jsonb_agg(jsonb_build_object('assignment_id',s.assignment_id,
    'student_id',s.student_id,'username',p.username,'body',s.body,
    'submitted_at',s.submitted_at,'score',s.score,'feedback',s.feedback,'graded_at',s.graded_at)
    order by s.submitted_at desc)
   from public.ss_school_submissions s
   join public.ss_school_assignments a on a.id=s.assignment_id
   join public.ss_profiles p on p.id=s.student_id
   where a.class_id=p_class and (teacher or s.student_id=actor)
  ),'[]'::jsonb),
  'announcements',coalesce((
   select jsonb_agg(jsonb_build_object('body',n.body,'created_at',n.created_at,'username',p.username) order by n.created_at desc)
   from public.ss_school_class_announcements n join public.ss_profiles p on p.id=n.created_by
   where n.class_id=p_class
  ),'[]'::jsonb)
 );
end $$;

create or replace function public.ss_school_class_enroll(p_class uuid,p_username text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); sid uuid; target uuid; role_at_school text; v_username text := lower(btrim(coalesce(p_username,'')));
begin
 select school_id into sid from public.ss_school_classes where id=p_class;
 if actor is null or sid is null or not(public.ss_school_platform_owner() or public.ss_school_principal(sid)) then
  raise exception 'Only the school principal or platform Owner may assign students and teachers to classes';
 end if;
 if p_role not in ('teacher','student','remove') or p_role is null then raise exception 'Invalid class role'; end if;
 if v_username !~ '^[a-z0-9_-]{3,32}$' then raise exception 'Enter an existing StudySpire username'; end if;
 select p.id,m.role into target,role_at_school
 from public.ss_profiles p join public.ss_school_memberships m on m.profile_id=p.id and m.school_id=sid
 where p.username=v_username and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
 if target is null then raise exception 'User must first belong to this school'; end if;
 if p_role='remove' then
  delete from public.ss_school_class_enrollments where class_id=p_class and profile_id=target;
 else
  if role_at_school<>p_role then raise exception 'Class role must match school role'; end if;
  insert into public.ss_school_class_enrollments(class_id,profile_id,role,assigned_by)
  values(p_class,target,p_role,actor)
  on conflict(class_id,profile_id) do update set role=excluded.role,assigned_by=excluded.assigned_by,created_at=now();
 end if;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,sid,'class_enrollment_changed',v_username||' / '||p_role);
end $$;

create or replace function public.ss_school_create_assignment(
 p_class uuid,p_title text,p_description text,p_due_at timestamptz,p_max_points numeric
)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); sid uuid; new_id uuid;
begin
 select school_id into sid from public.ss_school_classes where id=p_class;
 if actor is null or sid is null or not public.ss_school_class_can_teach(p_class) then raise exception 'Only assigned teachers or school leaders can post assignments'; end if;
 if char_length(btrim(coalesce(p_title,''))) not between 2 and 160 or char_length(coalesce(p_description,''))>3000
    or p_max_points is null or p_max_points<=0 or p_max_points>1000 then raise exception 'Check assignment title, description and points'; end if;
 insert into public.ss_school_assignments(class_id,title,description,due_at,max_points,created_by)
 values(p_class,btrim(p_title),coalesce(p_description,''),p_due_at,p_max_points,actor) returning id into new_id;
 insert into public.ss_school_audit(actor_id,school_id,action,detail) values(actor,sid,'assignment_created',new_id::text);
 return new_id;
end $$;

create or replace function public.ss_school_submit_assignment(p_assignment uuid,p_body text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); cid uuid;
begin
 select class_id into cid from public.ss_school_assignments where id=p_assignment;
 if actor is null or cid is null or not public.ss_school_class_can_submit(cid) then raise exception 'Only enrolled students can submit'; end if;
 if char_length(btrim(coalesce(p_body,''))) not between 1 and 10000 then raise exception 'Enter your submission (maximum 10,000 characters)'; end if;
 if exists(select 1 from public.ss_school_submissions where assignment_id=p_assignment and student_id=actor and graded_at is not null)
 then raise exception 'Graded submissions cannot be changed'; end if;
 insert into public.ss_school_submissions(assignment_id,student_id,body)
 values(p_assignment,actor,btrim(p_body))
 on conflict(assignment_id,student_id) do update set body=excluded.body,submitted_at=now()
 where public.ss_school_submissions.graded_at is null;
end $$;

create or replace function public.ss_school_grade_assignment(
 p_assignment uuid,p_student uuid,p_score numeric,p_feedback text
)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); cid uuid; sid uuid; maximum numeric; affected int;
begin
 select a.class_id,c.school_id,a.max_points into cid,sid,maximum
 from public.ss_school_assignments a join public.ss_school_classes c on c.id=a.class_id where a.id=p_assignment;
 if actor is null or cid is null or not public.ss_school_class_can_teach(cid) then raise exception 'Only assigned teachers or school leaders can grade'; end if;
 if p_score is null or p_score<0 or p_score>maximum or char_length(coalesce(p_feedback,''))>3000
 then raise exception 'Score must be between 0 and assignment maximum; feedback up to 3,000 characters'; end if;
 if not exists(select 1 from public.ss_school_class_enrollments e where e.class_id=cid and e.profile_id=p_student and e.role='student')
 then raise exception 'Student is not enrolled in this class'; end if;
 update public.ss_school_submissions set score=p_score,feedback=coalesce(p_feedback,''),graded_by=actor,graded_at=now()
 where assignment_id=p_assignment and student_id=p_student;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'Student submission not found'; end if;
 insert into public.ss_school_audit(actor_id,school_id,action,detail)
 values(actor,sid,'submission_graded',p_assignment::text);
end $$;

create or replace function public.ss_school_post_announcement(p_class uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := public.ss_school_actor(); sid uuid; new_id uuid;
begin
 select school_id into sid from public.ss_school_classes where id=p_class;
 if actor is null or sid is null or not public.ss_school_class_can_teach(p_class) then raise exception 'Only assigned teachers or school leaders may post updates'; end if;
 if char_length(btrim(coalesce(p_body,''))) not between 1 and 1000 then raise exception 'Enter an announcement up to 1,000 characters'; end if;
 insert into public.ss_school_class_announcements(class_id,body,created_by)
 values(p_class,btrim(p_body),actor) returning id into new_id;
 insert into public.ss_school_audit(actor_id,school_id,action,detail) values(actor,sid,'class_announcement_created',new_id::text);
 return new_id;
end $$;

-- Helpers are internal. Explicit grants keep working after the October 2026 API exposure change.
revoke execute on function public.ss_school_class_can_teach(uuid) from public,anon,authenticated;
revoke execute on function public.ss_school_class_can_submit(uuid) from public,anon,authenticated;
revoke execute on function public.ss_school_classroom(uuid) from public,anon,authenticated;
revoke execute on function public.ss_school_class_enroll(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.ss_school_create_assignment(uuid,text,text,timestamptz,numeric) from public,anon,authenticated;
revoke execute on function public.ss_school_submit_assignment(uuid,text) from public,anon,authenticated;
revoke execute on function public.ss_school_grade_assignment(uuid,uuid,numeric,text) from public,anon,authenticated;
revoke execute on function public.ss_school_post_announcement(uuid,text) from public,anon,authenticated;
grant execute on function public.ss_school_classroom(uuid),
 public.ss_school_class_enroll(uuid,text,text),
 public.ss_school_create_assignment(uuid,text,text,timestamptz,numeric),
 public.ss_school_submit_assignment(uuid,text),
 public.ss_school_grade_assignment(uuid,uuid,numeric,text),
 public.ss_school_post_announcement(uuid,text) to authenticated;

commit;
