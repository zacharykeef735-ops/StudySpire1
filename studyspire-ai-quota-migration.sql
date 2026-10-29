-- StudySpire hosted-tutor fair-share quota migration (already applied to the linked Supabase project).
-- Run only after public.ss_profiles and public.ss_current_profile_id() exist.
begin;
create table if not exists ss_private.ss_ai_student_usage (
 profile_id uuid not null references public.ss_profiles(id) on delete cascade,
 usage_day date not null,
 request_count integer not null default 0 check(request_count>=0),
 primary key(profile_id,usage_day)
);
create table if not exists ss_private.ss_ai_site_usage (
 usage_day date primary key,
 request_count integer not null default 0 check(request_count>=0)
);
alter table ss_private.ss_ai_student_usage enable row level security;
alter table ss_private.ss_ai_site_usage enable row level security;
revoke all on ss_private.ss_ai_student_usage,ss_private.ss_ai_site_usage from public,anon,authenticated;

create or replace function public.ss_ai_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid; today date := (now() at time zone 'UTC')::date; mine int; global_count int;
begin
 me:=public.ss_current_profile_id();
 if (select auth.uid()) is null or me is null or not exists(
  select 1 from public.ss_profiles p where p.id=me and
   (not p.banned or (p.banned_until is not null and p.banned_until<=now()))
 ) then raise exception 'Sign in to your active StudySpire Cloud account'; end if;
 select request_count into mine from ss_private.ss_ai_student_usage
 where profile_id=me and usage_day=today;
 select request_count into global_count from ss_private.ss_ai_site_usage
 where usage_day=today;
 return jsonb_build_object('profile_id',me,'used',coalesce(mine,0),
  'daily_limit',60,'site_used',coalesce(global_count,0),'site_limit',400,
  'reset_utc',((today+1)::text||'T00:00:00Z'));
end;
$$;
revoke all on function public.ss_ai_status() from public,anon,authenticated;
grant execute on function public.ss_ai_status() to authenticated;

create or replace function public.ss_ai_claim_for(for_profile uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare today date :=(now() at time zone 'UTC')::date; mine int; global_count int;
begin
 if (select auth.role()) <> 'service_role' then raise exception 'Server only'; end if;
 if for_profile is null or not exists(
  select 1 from public.ss_profiles p where p.id=for_profile and
   (not p.banned or (p.banned_until is not null and p.banned_until<=now()))
 ) then raise exception 'Student account unavailable'; end if;
 perform pg_catalog.pg_advisory_xact_lock(82619, 4401);
 insert into ss_private.ss_ai_student_usage(profile_id,usage_day)
 values(for_profile,today) on conflict do nothing;
 insert into ss_private.ss_ai_site_usage(usage_day)
 values(today) on conflict do nothing;
 select request_count into mine from ss_private.ss_ai_student_usage
 where profile_id=for_profile and usage_day=today for update;
 select request_count into global_count from ss_private.ss_ai_site_usage
 where usage_day=today for update;
 if mine>=60 then
  return jsonb_build_object('ok',false,'code','STUDENT_LIMIT','remaining',0,'reset_utc',((today+1)::text||'T00:00:00Z'));
 end if;
 if global_count>=400 then
  return jsonb_build_object('ok',false,'code','SITE_LIMIT','remaining',greatest(0,60-mine),'reset_utc',((today+1)::text||'T00:00:00Z'));
 end if;
 update ss_private.ss_ai_student_usage set request_count=request_count+1
 where profile_id=for_profile and usage_day=today;
 update ss_private.ss_ai_site_usage set request_count=request_count+1
 where usage_day=today;
 return jsonb_build_object('ok',true,'code','OK','remaining',59-mine,'site_remaining',399-global_count);
end;
$$;
revoke all on function public.ss_ai_claim_for(uuid) from public,anon,authenticated;
grant execute on function public.ss_ai_claim_for(uuid) to service_role;
commit;
