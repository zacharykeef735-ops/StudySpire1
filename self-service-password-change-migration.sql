-- StudySummit performance / account update.
-- Add a self-service password change for an already signed-in username account.
-- Passwords and hashes never leave the private schema; Owner/Admin roles are not changed.
begin;

create or replace function public.ss_username_change_password(current_password text,new_password text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, extensions as $$
declare
  auth_session uuid := auth.uid();
  target uuid;
  old_hash text;
  attempt_count integer;
  lock_expiry timestamptz;
begin
  -- Cloud username accounts are mapped from an *authenticated* anonymous Supabase session.
  -- Do not accept arbitrary profile identifiers, unverified emails or usernames as proof.
  if auth_session is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'true' then
    raise exception 'Sign in to your username account first';
  end if;
  select m.user_id into target from ss_private.username_sessions m
    where m.session_uid=auth_session;
  if target is null then raise exception 'Sign in to your username account first'; end if;
  if not exists(
    select 1 from public.ss_profiles p where p.id=target
      and (not p.banned or (p.banned_until is not null and p.banned_until<=now()))
  ) then raise exception 'Account unavailable'; end if;
  if current_password is null or octet_length(current_password)>72
    or new_password is null or char_length(new_password)<10 or octet_length(new_password)>72 then
    raise exception 'New password must be 10 characters or longer and at most 72 bytes';
  end if;

  insert into ss_private.username_login_limits(user_id) values(target)
    on conflict (user_id) do nothing;
  select l.failures,l.locked_until into attempt_count,lock_expiry
    from ss_private.username_login_limits l where l.user_id=target for update;
  if lock_expiry is not null and lock_expiry>now() then
    raise exception 'Too many attempts; try again later';
  end if;
  select c.password_hash into old_hash
    from ss_private.username_credentials c where c.user_id=target for update;
  if old_hash is null then raise exception 'Username password record missing'; end if;

  if crypt(current_password,old_hash)<>old_hash then
    update ss_private.username_login_limits set
      failures=case when lock_expiry is not null and lock_expiry<=now()
        then 1 else least(coalesce(attempt_count,0)+1,8) end,
      locked_until=case when (case when lock_expiry is not null and lock_expiry<=now()
        then 1 else coalesce(attempt_count,0)+1 end)>=8
        then now()+interval '15 minutes' else null end
    where user_id=target;
    return false;
  end if;

  update ss_private.username_credentials
    set password_hash=crypt(new_password,gen_salt('bf',12)) where user_id=target;
  update ss_private.username_login_limits
    set failures=0,locked_until=null where user_id=target;
  -- Other devices must authenticate again. Keep the current session active.
  delete from ss_private.username_sessions
    where user_id=target and session_uid<>auth_session;
  insert into public.ss_admin_audit(actor_id,target_id,action,details)
    values(target,target,'password_changed','Account holder changed their password');
  return true;
end;
$$;
revoke all on function public.ss_username_change_password(text,text) from public,anon;
grant execute on function public.ss_username_change_password(text,text) to authenticated;
commit;
