-- StudySpire: repair the chat language check, after v3.93.
begin;
create or replace function public.ss_chat_language_check(message text)
returns text language plpgsql immutable security invoker set search_path='' as $$
declare normalized text;
begin
 normalized:=pg_catalog.lower(coalesce(message,''));
 normalized:=pg_catalog.translate(normalized,'01345789','oieastbg');
 normalized:=pg_catalog.regexp_replace(normalized,'[._-]','','g');
 if normalized ~ '(^|[^a-z])(nigg[a-z]*|fagg[a-z]*|kike[s]?|spic[s]?|chink[s]?|paki[s]?)([^a-z]|$)' then
   return 'hateful_language';
 end if;
 if normalized ~ '(^|[^a-z])(fuck[a-z]*|motherfuck[a-z]*|shit[a-z]*|bullshit[a-z]*|bitch[a-z]*|cunt[s]?|asshole[s]?|dumbass[a-z]*|jackass[a-z]*|bastard[s]?|dick[s]?|pussy|whore[s]?|slut[s]?|damn[a-z]*|hell|crap[a-z]*|piss[a-z]*|wtf)([^a-z]|$)' then
   return 'profanity';
 end if;
 if normalized ~ '(^|[^a-z])f[[:space:]]+u[[:space:]]+c[[:space:]]+k([^a-z]|$)'
   or normalized ~ '(^|[^a-z])s[[:space:]]+h[[:space:]]+i[[:space:]]+t([^a-z]|$)' then
   return 'profanity';
 end if;
 return null;
end;
$$;
create or replace function ss_private.ss_chat_language_violation(input_text text)
returns text language sql immutable security invoker set search_path='' as $$
 select public.ss_chat_language_check(input_text);
$$;
revoke all on function public.ss_chat_language_check(text),
 ss_private.ss_chat_language_violation(text) from public,anon,authenticated;
grant execute on function public.ss_chat_language_check(text) to authenticated;
commit;