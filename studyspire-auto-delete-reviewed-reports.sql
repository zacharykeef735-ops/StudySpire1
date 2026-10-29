-- Applied in linked StudySpire Supabase project on 2026-10-15.
-- A successful staff review or dismissal deletes the report row atomically.
-- Unreviewed reports remain until acted on; moderation audit entries survive.
begin;
create or replace function ss_private.ss_delete_closed_report()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
 if old.status='open' and new.status in ('reviewed','dismissed') then
  if tg_table_schema='public' and tg_table_name='ss_reports' then
   delete from public.ss_reports where id=new.id and status=new.status;
  elsif tg_table_schema='ss_private' and tg_table_name='ss_profile_avatar_reports' then
   delete from ss_private.ss_profile_avatar_reports where id=new.id and status=new.status;
  end if;
 end if;
 return null;
end;
$$;
revoke all on function ss_private.ss_delete_closed_report() from public,anon,authenticated;
drop trigger if exists ss_remove_closed_report on public.ss_reports;
create trigger ss_remove_closed_report
after update of status on public.ss_reports
for each row execute function ss_private.ss_delete_closed_report();
drop trigger if exists ss_remove_closed_avatar_report on ss_private.ss_profile_avatar_reports;
create trigger ss_remove_closed_avatar_report
after update of status on ss_private.ss_profile_avatar_reports
for each row execute function ss_private.ss_delete_closed_report();
delete from public.ss_reports where status in ('reviewed','dismissed');
delete from ss_private.ss_profile_avatar_reports where status in ('reviewed','dismissed');
commit;
