-- StudySpire server-enforced chat language policy and flagged-attempt audit.
begin;
create table if not exists ss_private.ss_chat_language_flags(
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references public.ss_profiles(id) on delete cascade,
 recipient_id uuid references public.ss_profiles(id) on delete set null,
 reason text not null check(reason in ('profanity','hateful_language')),
 created_at timestamptz not null default now()
);
create index if not exists ss_chat_flags_latest_idx on ss_private.ss_chat_language_flags(created_at desc);
create index if not exists ss_chat_flags_sender_idx on ss_private.ss_chat_language_flags(sender_id,created_at desc);
alter table ss_private.ss_chat_language_flags enable row level security;
revoke all on ss_private.ss_chat_language_flags from public,anon,authenticated;

create or replace function ss_private.ss_chat_language_violation(input_text text)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare normalized text;
begin
  -- Normalize common numeric substitutions and punctuation between letters.
  normalized:=pg_catalog.translate(pg_catalog.lower(coalesce(input_text,'')),
    '01345789','oieastbg');
  normalized:=pg_catalog.regexp_replace(normalized,'[._-]','','g');
  -- Do not match ordinary substrings: 'hello' or 'class' are not blocked.
  if normalized ~ '(^|[^a-z])(nigg[a-z]*|fagg[a-z]*|kike[s]?|spic[s]?|chink[s]?|paki[s]?)([^a-z]|$)' then
    return 'hateful_language';
  end if;
  if normalized ~ '(^|[^a-z])(fuck[a-z]*|motherfuck[a-z]*|shit[a-z]*|bullshit[a-z]*|bitch[a-z]*|cunt[s]?|asshole[s]?|dumbass[es]*|jackass[es]*|bastard[s]?|dick[s]?|pussy|whore[s]?|slut[s]?|damn[a-z]*|hell|crap[a-z]*|piss[a-z]*|wtf)([^a-z]|$)' then
    return 'profanity';
  end if;
  -- Catch letters separated by spacing or punctuation without blocking normal sentences.
  if normalized ~ '(^|[^a-z])f[[:space:]]+u[[:space:]]+c[[:space:]]+k([^a-z]|$)'
     or normalized ~ '(^|[^a-z])s[[:space:]]+h[[:space:]]+i[[:space:]]+t([^a-z]|$)' then
    return 'profanity';
  end if;
  return null;
end;
$$;
revoke all on function ss_private.ss_chat_language_violation(text) from public,anon,authenticated;

create or replace function public.ss_chat_language_check(message text)
returns text language plpgsql immutable security definer set search_path = '' as $$
begin
  return ss_private.ss_chat_language_violation(message);
end;
$$;
revoke all on function public.ss_chat_language_check(text) from public,anon,authenticated;
grant execute on function public.ss_chat_language_check(text) to authenticated;

create or replace function public.ss_social_send(to_user uuid,message text)
returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid; new_id uuid; clean text; violation text;
begin
 me:=ss_private.ss_social_actor();
 clean:=pg_catalog.btrim(coalesce(message,''));
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
 violation:=ss_private.ss_chat_language_violation(clean);
 if violation is not null then
   -- Reject without inserting a message; store limited staff-only moderation metadata.
   if (select count(*) from ss_private.ss_chat_language_flags f
       where f.sender_id=me and f.created_at>now()-interval '1 hour')<20 then
     insert into ss_private.ss_chat_language_flags(sender_id,recipient_id,reason)
       values(me,to_user,violation);
   end if;
   return null;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(me::text,9));
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

create or replace function public.ss_staff_chat_flags()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if not (select public.ss_has_staff()) then raise exception 'Staff only'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',x.id,'sender',x.sender,'recipient',x.recipient,
   'reason',x.reason,'created_at',x.created_at
 )),'[]'::jsonb) into result
 from (select f.id,s.username sender,r.username recipient,f.reason,f.created_at
   from ss_private.ss_chat_language_flags f
   join public.ss_profiles s on s.id=f.sender_id
   left join public.ss_profiles r on r.id=f.recipient_id
   order by f.created_at desc limit 100) x;
 return result;
end;
$$;
revoke all on function public.ss_social_send(uuid,text), public.ss_staff_chat_flags()
  from public,anon,authenticated;
grant execute on function public.ss_social_send(uuid,text), public.ss_staff_chat_flags()
  to authenticated;
commit;