# StudySpire content moderation rollout

The website now checks DMs, study-room posts, account bios and WebP profile photos before attempting to save them. The authenticated Supabase Edge Function `studyspire-moderate` calls the Cloudflare Worker route `/v1/moderate`.

## Content policy
- Block explicit profanity, hateful slurs, threats, promotion of weapons, violent-extremist recruitment and praise, sexual profile imagery, and graphic violence.
- Allow neutral schoolwork, historical discussion, news, political opinions, peaceful advocacy, and critique of controversial topics.
- Avoid automatic punishments based only on an AI classification; incorrect decisions should be reviewable.
- The system transmits submitted text/picture to Cloudflare Workers AI for moderation. Successful moderation stores a temporary SHA-256 hash approval in private Supabase data, not a copy of the submission.

## Deploy the Worker (required)
From the StudySpire GitHub repository on a computer with Node.js installed:

```powershell
git pull origin main
npx wrangler login
npx wrangler deploy
```

This publishes the existing `studyspire` Worker configured in `wrangler.toml`. Do not create a new Worker. The URL remains `https://studyspire.zacharykeef735.workers.dev`.

The image moderation model `@cf/meta/llama-3.2-11b-vision-instruct` may require accepting Meta's license within Cloudflare before first use. See the official Cloudflare model documentation.

## Verify before enabling strict enforcement
1. Confirm `https://studyspire.zacharykeef735.workers.dev/health` returns `aiBound: true`.
2. Sign in to StudySpire and test a harmless DM, a harmless bio edit, and a benign profile picture; all should save.
3. Verify intentionally disallowed *non-graphic* language is rejected, without posting it to another person. Never test with a real threat.
4. Confirm Cloudflare Pages has deployed the latest JavaScript (`cloud.js?v=4.11`, `avatars.js?v=3.94`, `messaging.js?v=3.93`).
5. Check Supabase Edge Function `studyspire-moderate` logs for errors, and monitor Cloudflare Workers AI usage.

After verification, enable the database requirement for approved scans:

```sql
update ss_private.ss_moderation_settings
set enabled=true
where key='enabled';
```

This change is intentionally **not active at initial deployment**. Before enabling, clients that don't use the updated scan gateway can still invoke old content RPCs, and the database's existing deterministic text checks remain in effect. Once enabled, direct RPC calls without an approved, unexpired, matching content hash will be rejected.

To turn the strict gate off during a scanner outage:

```sql
update ss_private.ss_moderation_settings
set enabled=false
where key='enabled';
```

Only trusted database administrators should change this setting. Cloudflare model decisions can be imperfect, and this setup does not independently confirm a live model response until it has been deployed and tested.
