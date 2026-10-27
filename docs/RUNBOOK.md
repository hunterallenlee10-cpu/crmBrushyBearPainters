# Runbook

Operational procedures. Sections marked _(Phase N)_ are filled in when that feature exists.

## Local development

```bash
pnpm supabase start      # start local stack (Docker)
pnpm supabase db reset   # wipe local DB, re-apply migrations + seed
pnpm supabase stop       # stop (add --no-backup to discard local data)
```

## Sign-in setup (hosted Supabase) _(Phase 1)_

Do this once per Supabase project (preview and production). Local dev reads all of it from `supabase/config.toml`.

1. **Auth → URL Configuration:** set Site URL to the app URL. Add redirect URLs `https://<app>/auth/callback**` and `https://<app>/auth/confirm**`.
2. **Auth → Providers → Email:** keep it on. Turn **off** "Allow new users to sign up" (invite-only).
3. **Auth → Email Templates → Magic Link:** paste `supabase/templates/magic_link.html`. Its link must stay `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`.
4. **Auth → SMTP:** set a real sender so sign-in emails don't hit Supabase's low default limit. This only sends sign-in links.
5. **Auth → Multi-Factor:** enable TOTP.
6. **Google sign-in (optional):** create an OAuth client in Google Cloud (Web application, redirect URI `https://<project>.supabase.co/auth/v1/callback`), then paste its client ID and secret in **Auth → Providers → Google**. Until then, the Google button says Google sign-in isn't set up.
7. **First owners:** set `SEED_OWNER_EMAILS` (comma-separated: Hunter first, then Erik) and run `pnpm seed:owners` with that project's URL and secret key. Each owner then signs in with a magic link and sets up two-step sign-in.

## Locked out

- **Lost authenticator (owner):** another owner can't reset it from the app. In Supabase → Authentication → Users, open the user and delete their MFA factor. They set it up again at next sign-in.
- **Only owner turned off:** the database refuses to deactivate the last active owner, so this can't happen from the app.

## Backups

- Use a Supabase plan with **Point-in-Time Recovery (PITR)** for production, plus the daily backups Supabase takes automatically.
- Before any risky migration in production: confirm the latest backup time in the Supabase dashboard.
- Restores are done from the Supabase dashboard (Database → Backups). Test a restore into a separate project at least once before launch.

## Migrations in production

1. Migrations are additive. Never edit a migration that has already been applied anywhere shared.
2. Every migration has a rollback in `supabase/rollbacks/`. Rollbacks can destroy data; owner approval required.
3. Apply with `pnpm supabase db push` against the linked project after CI is green.

## Rotating secrets

| Secret                      | Where                         | Steps                                                                                                              |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env                    | Rotate in Supabase (Settings → API) → update Vercel env → redeploy                                                 |
| `CRON_SECRET`               | Vercel env                    | Generate new value (`openssl rand -hex 32`) → update Vercel env → redeploy (Vercel Cron picks it up automatically) |
| `LEAD_INTAKE_HMAC_SECRET`   | Vercel env + website repo env | Update both at the same time, then redeploy both                                                                   |
| `FIELD_ENCRYPTION_KEY`      | Vercel env                    | **Don't rotate casually** — see below                                                                              |
| Provider keys (Phase 1+)    | Vercel env                    | Rotate at provider → update env → redeploy                                                                         |

## Website lead intake _(Phase 2)_

The website posts quote requests to `POST /api/public/leads` (contract in `docs/WEBSITE_INTEGRATION.md`).

1. **Secret:** generate one value with `openssl rand -hex 32`. Set it as `LEAD_INTAKE_HMAC_SECRET` in the CRM's Vercel env **and** the website's env. Without it the endpoint answers `503`.
2. **Organization:** `LEAD_INTAKE_ORG_SLUG` picks which organization receives website leads (default `brushy-bear`).
3. **Check it works:** run the curl example in `docs/WEBSITE_INTEGRATION.md` against the preview URL. Expect `201` and a new lead under Leads → New.
4. **Something wrong?** Every request is recorded in `intake_requests` (outcome, reason, time). `401` = bad or old signature (check both secrets match and the website's clock), `429` = rate limit, `409` = same idempotency key with a different body.

## Gate and lockbox codes _(Phase 2)_

- Codes are encrypted in the app (AES-256-GCM) with `FIELD_ENCRYPTION_KEY` (32 random bytes, base64: `openssl rand -base64 32`) before they reach the database.
- **Losing or changing the key makes saved codes unreadable.** Keep a copy in the owners' password manager. To rotate: export the codes while the old key is set, change the key, re-enter them. A re-encryption script is a Phase 10 hardening item.
- Without the key set, the app still works; saving a code shows "Gate codes can't be saved until FIELD_ENCRYPTION_KEY is set."

## Background worker _(Phase 3)_

`/api/cron/worker` processes queued events, refreshes job health, auto-closes jobs 3 days after Paid in Full, and runs the attention rules.

1. **Secret:** set `CRON_SECRET` (`openssl rand -hex 32`) in the Vercel env. Vercel Cron sends it as `Authorization: Bearer …` automatically; the database job below sends the same value. Without it the route answers `503`.
2. **Schedule (every minute, from Supabase):** Vercel Hobby only runs cron jobs once a day, so `vercel.json` keeps a daily run as a backup and the database calls the worker every minute with `pg_cron` + `pg_net` (both free on every Supabase plan). Set it up once per hosted project in the SQL editor, replacing the URL and secret:

   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select vault.create_secret('<CRON_SECRET>', 'worker_cron_secret');
   select cron.schedule('crm-worker', '* * * * *', $$
     select net.http_get(
       url := 'https://<app>/api/cron/worker',
       headers := jsonb_build_object('Authorization', 'Bearer ' ||
         (select decrypted_secret from vault.decrypted_secrets where name = 'worker_cron_secret'))
     );
   $$);
   ```

   Check it with `select * from cron.job_run_details order by start_time desc limit 5;`. To stop it: `select cron.unschedule('crm-worker');`. On a Vercel Pro plan you can instead set the `vercel.json` schedule to `* * * * *` and unschedule the database job.

3. **Run it by hand:** `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/worker` returns a JSON summary (events claimed/processed/failed, jobs auto-closed, health updates, attention items opened/updated/resolved).
4. **Stuck or failing events:** check `events` where `status = 'failed'` (`last_error` says why). Failed events retry up to 5 times with back-off; events stuck in `processing` for 5 minutes are picked up again.
5. **Attention noise:** turn a rule off or change its thresholds in Admin → Attention Rules; changes apply on the next run.

## Estimates, proposal links and documents _(Phase 4)_

- **Links** are `APP_URL/p/<token>`. Only the token's SHA-256 is stored, so a lost link can't be recovered: send a new version (the old link then says "There's a newer version"). Links expire after the Company Settings expiry days; the worker marks them Expired.
- **Rate limits** on the public page: 120 views, 10 accept/decline tries and 30 PDF downloads per address per 10 minutes, 8 accept tries per link. Buckets live in `rate_limits` (same table as website intake).
- **Documents** live in the private Supabase Storage bucket `documents` (`<org>/jobs/<job>/<uuid>-<file>.pdf`). The app streams them after a permission check; never make the bucket public. Back it up with the database (Storage isn't in the database dump).
- **Acceptance didn't finish** (signed but no PDF, or the job didn't move): the worker retries on the `estimate.accepted` event. Check `events` for a failed `estimate.accepted`; once the cause is fixed, set it back to `queued`.
- **Changing prices:** edit the Price Book or Estimate Setup. Drafts pick up the change the next time they're opened or edited; sent versions never change.

## Onboarding, documents, photos and offline _(Phase 5)_

- **Onboarding checks** run in the worker every minute for jobs in Sold or Onboarding (`summary.onboarding` in the worker's JSON: jobs checked, rows changed, jobs moved to Ready to Schedule). A job that should have moved: open it → Onboarding → **Re-verify all**; the item that's still open says why. Manual clears show who cleared them and the note.
- **Storage buckets:** `documents` (25 MB per file: PDF, photos, Word, Excel, text, CSV) and `photos` (display copies and thumbnails, `<org>/jobs/<job>/<uuid>.jpg` and `-thumb.jpg`). Both are private; never make them public. Back them up with the database (Storage isn't in the database dump). Deleting a row soft-deletes it; files stay until a purge job (Phase 10) removes files of rows deleted long ago.
- **Uploads that fail on Vercel:** documents upload straight to Supabase Storage (no Vercel size limit); photos go through `/api/jobs/<id>/photos` after the browser shrinks them (8 MB max per photo).
- **Offline queue:** photos taken without signal live in the browser's IndexedDB on that phone (`brushybear-offline` → `uploads`) until they upload. Clearing site data on the phone deletes photos that haven't uploaded yet. Uploads are idempotent (client id), so retries never duplicate.
- **Service worker** (`public/sw.js`): caches only hashed static files and `/offline`. After changing what it caches, bump `VERSION` in the file so phones drop the old cache. To turn it off in an emergency, deploy a `sw.js` that calls `self.registration.unregister()`.

## Production schedule, daily logs and field screens _(Phase 6)_

- **Worker:** each minute it also runs `sweepProduction` (gates for production jobs, on-time checks), `sweepDailyUpdates` (customer updates still in draft after 2 minutes) and the subcontractor status refresh; every 15 minutes (or `?recommendations=1`) it ranks crews for the tray. The worker JSON has `production`, `dailyUpdates`, `subcontractors` and `recommendations` counts.
- **Publish refused:** the Master Schedule lists the drafts that block it with the reason (double-booking, time off, missing skill, expired sub paperwork, hold). Fix the draft or, for overridable rules, an owner overrides it with a reason. Publish never sends half a schedule.
- **A job didn't move stage:** gates 6–9 are re-checked by the worker. Scheduled → In Progress needs materials picked up/delivered and the first day reached; In Progress → Final Walkthrough needs every work order completed or canceled; Final Walkthrough → Completed needs the customer's sign-off, or the final-walkthrough appointment completed with no open punch items. The job's Schedule section shows the next steps.
- **Daily logs from phones:** logs wait in the phone's offline queue (with their cleanup photo) until there's signal; progress photos upload after their log (the photo route answers 503 until then and the queue retries). A crew lead who cleared site data before syncing loses unsent logs.
- **Missed daily update** Attention items appear after the cutoff (default 7 pm Pacific; Admin → Attention Rules). Rain days don't count.
- **Migrations for production:** `20261027000400_production.sql` and `20261027000500_production_seed.sql` (additive; the seed calls `app.seed_production_defaults` for every organization and is safe to re-run). Rollbacks in `supabase/rollbacks/`.

## Month close _(Phase 7)_

## Purge demo data _(Phase 10)_

Demo data only exists in dev/preview (`DEMO_DATA=true`) and is tagged `is_demo = true`. An owner-only admin action removes it.

## Incident basics

- Health check: `GET /api/health` → `{ "ok": true }`.
- Application logs never contain phone numbers or emails (masked). Use record IDs to investigate.
