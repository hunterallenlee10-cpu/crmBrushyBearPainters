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

| Secret                      | Where                         | Steps                                                                      |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env                    | Rotate in Supabase (Settings → API) → update Vercel env → redeploy         |
| `CRON_SECRET`               | Vercel env                    | Generate new value (`openssl rand -hex 32`) → update Vercel env → redeploy |
| `LEAD_INTAKE_HMAC_SECRET`   | Vercel env + website repo env | Update both at the same time, then redeploy both                           |
| Provider keys (Phase 1+)    | Vercel env                    | Rotate at provider → update env → redeploy                                 |

## Month close _(Phase 7)_

## Purge demo data _(Phase 10)_

Demo data only exists in dev/preview (`DEMO_DATA=true`) and is tagged `is_demo = true`. An owner-only admin action removes it.

## Incident basics

- Health check: `GET /api/health` → `{ "ok": true }`.
- Application logs never contain phone numbers or emails (masked). Use record IDs to investigate.
