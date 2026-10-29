-- StudySpire · remembered account switching (shared by StudySpire and StudySpire1).
-- Passwords are never kept on devices. The browser keeps one random opaque token
-- per remembered username; only its SHA-256 digest exists in ss_private.
-- Changing or resetting a password revokes every remembered device token.
create table if not exists ss_private.remembered_login_tokens (
  token_hash text primary key,
  user_id uuid not null references ss_private.username_credentials(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint ss_remembered_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists ss_remembered_tokens_user_idx
  on ss_private.remembered_login_tokens(user_id);
alter table ss_private.remembered_login_tokens enable row level security;
revoke all on ss_private.remembered_login_tokens from public, anon, authenticated;

create or replace function ss_private.revoke_remembered_on_password_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.password_hash is distinct from old.password_hash then
    delete from ss_private.remembered_login_tokens where user_id = new.user_id;
  end if;
  return new;
end;
$$;
create or replace trigger ss_revoke_remembered_on_password_change
  after update of password_hash on ss_private.username_credentials
  for each row execute function ss_private.revoke_remembered_on_password_change();

-- An anonymous auth identity is not itself proof of an app username session.
-- Only legacy non-anonymous email accounts may use the profile-id fallback.
create or replace function public.ss_current_profile_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.user_id from ss_private.username_sessions s
      where s.session_uid=(select auth.uid())),
    (select p.id from public.ss_profiles p
      where p.id=(select auth.uid())
        and coalesce(auth.jwt()->>'is_anonymous','false') <> 'true')
  );
$$;

-- Only a live, anonymous Supabase session mapped to a username account
-- may issue a fresh saved-login token. Keep at most 24 tokens per account.
create or replace function public.ss_remember_current_username()
returns text language plpgsql security definer set search_path = pg_catalog, extensions as $$
declare
  current_uid uuid := auth.uid();
  account_id uuid;
  new_token text;
begin
  if current_uid is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'true' then
    raise exception 'Sign in to a username account first';
  end if;
  select s.user_id into account_id from ss_private.username_sessions s
    join ss_private.username_credentials c on c.user_id=s.user_id
    where s.session_uid=current_uid;
  if account_id is null then raise exception 'Sign in to a username account first'; end if;
  new_token := encode(gen_random_bytes(32),'hex');
  insert into ss_private.remembered_login_tokens(token_hash,user_id)
    values(encode(digest(new_token,'sha256'),'hex'),account_id);
  delete from ss_private.remembered_login_tokens t
   where t.user_id=account_id and t.token_hash not in (
     select recent.token_hash from ss_private.remembered_login_tokens recent
       where recent.user_id=account_id
       order by recent.last_used_at desc, recent.created_at desc limit 24
   );
  return new_token;
end;
$$;

-- A bearer token is scoped to exactly one username and is usable only through
-- a real authenticated anonymous Supabase session. No direct table access.
create or replace function public.ss_remembered_switch(chosen_username text, device_token text)
returns boolean language plpgsql security definer set search_path = pg_catalog, extensions as $$
declare
  current_uid uuid := auth.uid();
  account_id uuid;
  digest_text text;
begin
  if current_uid is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'true' then
    raise exception 'Start an anonymous Supabase session first';
  end if;
  if chosen_username is null or chosen_username !~* '^[a-z0-9_-]{3,32}$'
     or device_token is null or device_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  digest_text := encode(digest(device_token,'sha256'),'hex');
  select t.user_id into account_id from ss_private.remembered_login_tokens t
    join public.ss_profiles p on p.id=t.user_id
    join ss_private.username_credentials c on c.user_id=t.user_id
    where p.username=lower(chosen_username) and t.token_hash=digest_text;
  if account_id is null then return false; end if;
  insert into ss_private.username_sessions(session_uid,user_id)
    values(current_uid,account_id)
    on conflict(session_uid) do update
      set user_id=excluded.user_id,logged_in_at=now();
  update ss_private.remembered_login_tokens
    set last_used_at=now() where token_hash=digest_text and user_id=account_id;
  return true;
end;
$$;

-- Forgetting a saved account also invalidates that token server-side.
create or replace function public.ss_forget_remembered_username(device_token text)
returns void language plpgsql security definer set search_path = pg_catalog, extensions as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'true' then
    raise exception 'Start an anonymous Supabase session first';
  end if;
  if device_token is null or device_token !~ '^[0-9a-f]{64}$' then return; end if;
  delete from ss_private.remembered_login_tokens
    where token_hash=encode(digest(device_token,'sha256'),'hex');
end;
$$;

revoke all on function ss_private.revoke_remembered_on_password_change() from public,anon,authenticated;
revoke all on function public.ss_remember_current_username() from public,anon,authenticated;
revoke all on function public.ss_remembered_switch(text,text) from public,anon,authenticated;
revoke all on function public.ss_forget_remembered_username(text) from public,anon,authenticated;
grant execute on function public.ss_remember_current_username(),
  public.ss_remembered_switch(text,text),
  public.ss_forget_remembered_username(text) to authenticated;
