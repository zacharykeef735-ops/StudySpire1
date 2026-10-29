-- StudySummit v3.82 · private cross-device friends and messaging.
-- No access to the private social tables from browser / Data API table endpoints.
-- All public RPCs authenticate via the canonical username-or-legacy profile ID.
-- The server authorizes every operation; merely knowing a UUID cannot reveal a chat.
begin;

create table if not exists ss_private.ss_social_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.ss_profiles(id) on delete cascade,
  recipient_id uuid not null references public.ss_profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique(sender_id,recipient_id),
  check(sender_id<>recipient_id)
);
create index if not exists ss_social_requests_inbox_idx on ss_private.ss_social_requests(recipient_id,status,created_at desc);
create index if not exists ss_social_requests_sender_idx on ss_private.ss_social_requests(sender_id,status,created_at desc);

create table if not exists ss_private.ss_social_friends (
  user_a uuid not null references public.ss_profiles(id) on delete cascade,
  user_b uuid not null references public.ss_profiles(id) on delete cascade,
  since timestamptz not null default now(),
  primary key (user_a,user_b),
  check(user_a<user_b)
);
create index if not exists ss_social_friends_second_idx on ss_private.ss_social_friends(user_b);

create table if not exists ss_private.ss_social_blocks (
  blocker_id uuid not null references public.ss_profiles(id) on delete cascade,
  blocked_id uuid not null references public.ss_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id,blocked_id),
  check(blocker_id<>blocked_id)
);

create table if not exists ss_private.ss_social_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.ss_profiles(id) on delete cascade,
  recipient_id uuid not null references public.ss_profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  check(sender_id<>recipient_id)
);
create index if not exists ss_social_msgs_thread_from_idx on ss_private.ss_social_messages(sender_id,recipient_id,created_at desc);
create index if not exists ss_social_msgs_thread_to_idx on ss_private.ss_social_messages(recipient_id,sender_id,created_at desc);
create index if not exists ss_social_msgs_rate_idx on ss_private.ss_social_messages(sender_id,created_at desc);

create table if not exists ss_private.ss_social_decks (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.ss_profiles(id) on delete cascade,
  recipient_id uuid not null references public.ss_profiles(id) on delete cascade,
  cards jsonb not null check(jsonb_typeof(cards)='array' and jsonb_array_length(cards) between 1 and 25),
  created_at timestamptz not null default now(),
  check(sender_id<>recipient_id)
);
create index if not exists ss_social_decks_inbox_idx on ss_private.ss_social_decks(recipient_id,created_at desc);
create index if not exists ss_social_decks_sender_idx on ss_private.ss_social_decks(sender_id,created_at desc);

-- Defense in depth even though direct table grants are revoked.
alter table ss_private.ss_social_requests enable row level security;
alter table ss_private.ss_social_friends enable row level security;
alter table ss_private.ss_social_blocks enable row level security;
alter table ss_private.ss_social_messages enable row level security;
alter table ss_private.ss_social_decks enable row level security;
revoke all on all tables in schema ss_private from public,anon,authenticated;

create or replace function ss_private.ss_social_actor()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare who uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to StudySummit Cloud to use messages';
  end if;
  who:=(select public.ss_current_profile_id());
  if who is null or not (select public.ss_can_use()) then
    raise exception 'Your Cloud account is unavailable for messaging';
  end if;
  return who;
end;
$$;
revoke all on function ss_private.ss_social_actor() from public,anon,authenticated;

create or replace function public.ss_social_lookup(chosen_username text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid; target uuid; chosen text; rel text;
begin
 me:=ss_private.ss_social_actor();
 chosen:=lower(trim(coalesce(chosen_username,'')));
 if chosen !~ '^[a-z0-9_-]{3,32}$' then return null; end if;
 select p.id into target from public.ss_profiles p where p.username=chosen and p.id<>me
   and (not p.banned or (p.banned_until is not null and p.banned_until<=now()));
 if target is null then return null; end if;
 if exists(select 1 from ss_private.ss_social_blocks b where b.blocker_id=target and b.blocked_id=me) then return null; end if;
 rel:=case
  when exists(select 1 from ss_private.ss_social_blocks b where b.blocker_id=me and b.blocked_id=target) then 'blocked'
  when exists(select 1 from ss_private.ss_social_friends f where f.user_a=least(me,target) and f.user_b=greatest(me,target)) then 'friend'
  when exists(select 1 from ss_private.ss_social_requests r where r.sender_id=me and r.recipient_id=target and r.status='pending') then 'outgoing'
  when exists(select 1 from ss_private.ss_social_requests r where r.sender_id=target and r.recipient_id=me and r.status='pending') then 'incoming'
  else 'none' end;
 return jsonb_build_object('id',target,'username',chosen,'relation',rel);
end;
$$;

create or replace function public.ss_social_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid;
begin
 me:=ss_private.ss_social_actor();
 return jsonb_build_object(
  'friends',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'username',x.username) order by x.username)
    from (select p.id,p.username from ss_private.ss_social_friends f
      join public.ss_profiles p on p.id=(case when f.user_a=me then f.user_b else f.user_a end)
      where f.user_a=me or f.user_b=me order by p.username limit 200) x),'[]'::jsonb),
  'incoming',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'user_id',x.sender_id,'username',x.username,'created_at',x.created_at) order by x.created_at desc)
    from (select r.id,r.sender_id,p.username,r.created_at from ss_private.ss_social_requests r
      join public.ss_profiles p on p.id=r.sender_id where r.recipient_id=me and r.status='pending'
      and not exists(select 1 from ss_private.ss_social_blocks b where b.blocker_id=me and b.blocked_id=r.sender_id)
      order by r.created_at desc limit 50) x),'[]'::jsonb),
  'outgoing',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'user_id',x.recipient_id,'username',x.username,'created_at',x.created_at) order by x.created_at desc)
    from (select r.id,r.recipient_id,p.username,r.created_at from ss_private.ss_social_requests r
      join public.ss_profiles p on p.id=r.recipient_id where r.sender_id=me and r.status='pending'
      order by r.created_at desc limit 50) x),'[]'::jsonb),
  'blocked',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'username',x.username) order by x.username)
    from (select p.id,p.username from ss_private.ss_social_blocks b
      join public.ss_profiles p on p.id=b.blocked_id where b.blocker_id=me order by p.username limit 200) x),'[]'::jsonb),
  'decks',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'from_id',x.sender_id,'username',x.username,'cards',x.cards,'created_at',x.created_at) order by x.created_at desc)
    from (select d.id,d.sender_id,p.username,d.cards,d.created_at from ss_private.ss_social_decks d
      join public.ss_profiles p on p.id=d.sender_id where d.recipient_id=me order by d.created_at desc limit 20) x),'[]'::jsonb)
 );
end;
$$;

create or replace function public.ss_social_request(chosen_username text)
returns text language plpgsql security definer set search_path='' as $$
declare me uuid; target uuid; chosen text; old ss_private.ss_social_requests%rowtype;
begin
 me:=ss_private.ss_social_actor();
 chosen:=lower(trim(coalesce(chosen_username,'')));
 if chosen !~ '^[a-z0-9_-]{3,32}$' then raise exception 'Enter an exact StudySummit username'; end if;
 select id into target from public.ss_profiles where username=chosen and id<>me
  and (not banned or (banned_until is not null and banned_until<=now()));
 if target is null then raise exception 'Account not found'; end if;
 if exists(select 1 from ss_private.ss_social_blocks b where
   (b.blocker_id=me and b.blocked_id=target) or (b.blocker_id=target and b.blocked_id=me)) then
   raise exception 'Friend requests are unavailable for this account';
 end if;
 if exists(select 1 from ss_private.ss_social_friends f where f.user_a=least(me,target) and f.user_b=greatest(me,target)) then
   return 'already_friends';
 end if;
 if exists(select 1 from ss_private.ss_social_requests r where r.sender_id=target and r.recipient_id=me and r.status='pending') then
   return 'incoming_pending';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text,8));
 select * into old from ss_private.ss_social_requests where sender_id=me and recipient_id=target for update;
 if old.status='pending' then return 'already_pending'; end if;
 if old.status='declined' and coalesce(old.responded_at,old.created_at)>now()-interval '7 days' then
   raise exception 'Please wait before sending another invitation to this person';
 end if;
 if old.status='cancelled' and coalesce(old.responded_at,old.created_at)>now()-interval '1 day' then
   raise exception 'Wait a day before inviting this person again';
 end if;
 if (select count(*) from ss_private.ss_social_requests where sender_id=me and created_at>now()-interval '1 day')>=10 then
   raise exception 'Daily request limit reached';
 end if;
 if (select count(*) from ss_private.ss_social_requests where sender_id=me and status='pending')>=25 then
   raise exception 'Too many unanswered requests; cancel some first';
 end if;
 if old.id is not null then
  update ss_private.ss_social_requests set status='pending',created_at=now(),responded_at=null where id=old.id;
 else
  insert into ss_private.ss_social_requests(sender_id,recipient_id) values(me,target);
 end if;
 return 'sent';
end;
$$;

create or replace function public.ss_social_respond(request_id uuid,accept_request boolean)
returns text language plpgsql security definer set search_path='' as $$
declare me uuid; r ss_private.ss_social_requests%rowtype;
begin
 me:=ss_private.ss_social_actor();
 select * into r from ss_private.ss_social_requests
   where id=request_id and recipient_id=me and status='pending' for update;
 if r.id is null then raise exception 'Friend request is no longer pending'; end if;
 if exists(select 1 from ss_private.ss_social_blocks b where
    (b.blocker_id=me and b.blocked_id=r.sender_id) or (b.blocker_id=r.sender_id and b.blocked_id=me)) then
    raise exception 'You cannot accept a blocked request';
 end if;
 update ss_private.ss_social_requests set status=case when accept_request then 'accepted' else 'declined' end,
   responded_at=now() where id=r.id;
 if accept_request then
  insert into ss_private.ss_social_friends(user_a,user_b) values(least(me,r.sender_id),greatest(me,r.sender_id))
   on conflict do nothing;
 end if;
 return case when accept_request then 'accepted' else 'declined' end;
end;
$$;

create or replace function public.ss_social_cancel(request_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare me uuid;
begin
 me:=ss_private.ss_social_actor();
 update ss_private.ss_social_requests set status='cancelled',responded_at=now()
  where id=request_id and sender_id=me and status='pending';
 return found;
end;
$$;

create or replace function public.ss_social_unfriend(friend_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare me uuid;
begin
 me:=ss_private.ss_social_actor();
 if friend_id is null or friend_id=me then return false; end if;
 delete from ss_private.ss_social_friends where user_a=least(me,friend_id) and user_b=greatest(me,friend_id);
 return found;
end;
$$;

create or replace function public.ss_social_block(blocked_user uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare me uuid;
begin
 me:=ss_private.ss_social_actor();
 if blocked_user is null or blocked_user=me then raise exception 'Choose another user'; end if;
 if not exists(select 1 from public.ss_profiles where id=blocked_user) then return false; end if;
 insert into ss_private.ss_social_blocks(blocker_id,blocked_id) values(me,blocked_user) on conflict do nothing;
 delete from ss_private.ss_social_friends where user_a=least(me,blocked_user) and user_b=greatest(me,blocked_user);
 update ss_private.ss_social_requests set status='cancelled',responded_at=now()
 where status='pending' and ((sender_id=me and recipient_id=blocked_user) or (sender_id=blocked_user and recipient_id=me));
 return true;
end;
$$;

create or replace function public.ss_social_unblock(blocked_user uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare me uuid;
begin
 me:=ss_private.ss_social_actor();
 delete from ss_private.ss_social_blocks where blocker_id=me and blocked_id=blocked_user;
 return found;
end;
$$;

create or replace function public.ss_social_messages(with_user uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid;
begin
 me:=ss_private.ss_social_actor();
 if with_user is null or with_user=me then return '[]'::jsonb; end if;
 if not exists(select 1 from ss_private.ss_social_friends
  where user_a=least(me,with_user) and user_b=greatest(me,with_user)) then
  raise exception 'Only friends can view this conversation';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'from',x.sender_id,'to',x.recipient_id,
   'text',x.body,'at',x.created_at) order by x.created_at,x.id)
  from (select id,sender_id,recipient_id,body,created_at from ss_private.ss_social_messages
    where (sender_id=me and recipient_id=with_user) or (sender_id=with_user and recipient_id=me)
    order by created_at desc,id desc limit 100) x),'[]'::jsonb);
end;
$$;

create or replace function public.ss_social_send(to_user uuid,message text)
returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid; new_id uuid; clean text;
begin
 me:=ss_private.ss_social_actor();
 clean:=trim(coalesce(message,''));
 if char_length(clean)<1 or char_length(clean)>2000 then
   raise exception 'Write a message between 1 and 2000 characters';
 end if;
 if to_user is null or to_user=me then raise exception 'Choose a friend'; end if;
 if not exists(select 1 from ss_private.ss_social_friends where user_a=least(me,to_user) and user_b=greatest(me,to_user)) then
   raise exception 'You must be friends before messaging';
 end if;
 if exists(select 1 from ss_private.ss_social_blocks b where
   (b.blocker_id=me and b.blocked_id=to_user) or (b.blocker_id=to_user and b.blocked_id=me)) then
   raise exception 'Messages are blocked for this connection';
 end if;
 if not exists(select 1 from public.ss_profiles p where p.id=to_user
    and (not p.banned or (p.banned_until is not null and p.banned_until<=now()))) then
   raise exception 'This user is unavailable';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text,9));
 if (select count(*) from ss_private.ss_social_messages m where m.sender_id=me and m.created_at>now()-interval '1 minute')>=15 then
   raise exception 'Sending too fast; please wait a minute';
 end if;
 if (select count(*) from ss_private.ss_social_messages m where m.sender_id=me and m.created_at>now()-interval '1 day')>=500 then
   raise exception 'Daily message limit reached';
 end if;
 insert into ss_private.ss_social_messages(sender_id,recipient_id,body) values(me,to_user,clean) returning id into new_id;
 return new_id;
end;
$$;

create or replace function public.ss_social_share_deck(to_user uuid,shared_cards jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid; c jsonb; new_id uuid;
begin
 me:=ss_private.ss_social_actor();
 if to_user is null or to_user=me then raise exception 'Choose a friend'; end if;
 if jsonb_typeof(shared_cards) is distinct from 'array' or jsonb_array_length(shared_cards) not between 1 and 25
   or octet_length(shared_cards::text)>30000 then
   raise exception 'Share 1–25 flashcards (maximum 30 KB)';
 end if;
 for c in select value from jsonb_array_elements(shared_cards) loop
   if jsonb_typeof(c) is distinct from 'object' or
     jsonb_typeof(c->'front') is distinct from 'string' or
     jsonb_typeof(c->'back') is distinct from 'string' or
     char_length(c->>'front') not between 1 and 1800 or
     char_length(c->>'back') not between 1 and 5000 then
       raise exception 'Cards must contain a valid question and answer';
   end if;
 end loop;
 if not exists(select 1 from ss_private.ss_social_friends f where f.user_a=least(me,to_user) and f.user_b=greatest(me,to_user))
   or exists(select 1 from ss_private.ss_social_blocks b where (b.blocker_id=me and b.blocked_id=to_user)
       or (b.blocker_id=to_user and b.blocked_id=me)) then
   raise exception 'Flashcards can only be shared with friends';
 end if;
 if (select count(*) from ss_private.ss_social_decks where sender_id=me and created_at>now()-interval '1 day')>=20 then
   raise exception 'Daily deck-sharing limit reached';
 end if;
 insert into ss_private.ss_social_decks(sender_id,recipient_id,cards) values(me,to_user,shared_cards) returning id into new_id;
 return new_id;
end;
$$;

create or replace function public.ss_social_report_message(message_id uuid,why text)
returns boolean language plpgsql security definer set search_path='' as $$
declare me uuid; m ss_private.ss_social_messages%rowtype; author_name text; reason text;
begin
 me:=ss_private.ss_social_actor();
 reason:=trim(coalesce(why,''));
 if char_length(reason) not between 10 and 280 then
   raise exception 'Explain your report in 10–280 characters';
 end if;
 select * into m from ss_private.ss_social_messages where id=message_id and recipient_id=me;
 if m.id is null then raise exception 'Only recipients may report their messages'; end if;
 if (select count(*) from public.ss_reports where reporter_id=me and created_at>now()-interval '1 day')>=20 then
   raise exception 'Daily report limit reached';
 end if;
 select username into author_name from public.ss_profiles where id=m.sender_id;
 insert into public.ss_reports(reporter_id,about_username,reason)
 values(me,left(coalesce(author_name,''),40),left('Message report ['||m.id::text||']: '||reason||' | Quoted message: '||m.body,1000));
 return true;
end;
$$;

-- Explicitly restrict the RPC entry points; private tables remain inaccessible
-- and only the two participants can access data through checked functions.
revoke all on function public.ss_social_lookup(text) from public,anon;
revoke all on function public.ss_social_overview() from public,anon;
revoke all on function public.ss_social_request(text) from public,anon;
revoke all on function public.ss_social_respond(uuid,boolean) from public,anon;
revoke all on function public.ss_social_cancel(uuid) from public,anon;
revoke all on function public.ss_social_unfriend(uuid) from public,anon;
revoke all on function public.ss_social_block(uuid) from public,anon;
revoke all on function public.ss_social_unblock(uuid) from public,anon;
revoke all on function public.ss_social_messages(uuid) from public,anon;
revoke all on function public.ss_social_send(uuid,text) from public,anon;
revoke all on function public.ss_social_share_deck(uuid,jsonb) from public,anon;
revoke all on function public.ss_social_report_message(uuid,text) from public,anon;

grant execute on function public.ss_social_lookup(text) to authenticated;
grant execute on function public.ss_social_overview() to authenticated;
grant execute on function public.ss_social_request(text) to authenticated;
grant execute on function public.ss_social_respond(uuid,boolean) to authenticated;
grant execute on function public.ss_social_cancel(uuid) to authenticated;
grant execute on function public.ss_social_unfriend(uuid) to authenticated;
grant execute on function public.ss_social_block(uuid) to authenticated;
grant execute on function public.ss_social_unblock(uuid) to authenticated;
grant execute on function public.ss_social_messages(uuid) to authenticated;
grant execute on function public.ss_social_send(uuid,text) to authenticated;
grant execute on function public.ss_social_share_deck(uuid,jsonb) to authenticated;
grant execute on function public.ss_social_report_message(uuid,text) to authenticated;
commit;
