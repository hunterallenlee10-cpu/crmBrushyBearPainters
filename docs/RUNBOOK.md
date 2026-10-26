# Runbook

Operational procedures. Sections marked _(Phase N)_ are filled in when that feature exists.

## Local development

```bash
pnpm supabase start      # start local stack (Docker)
pnpm supabase db reset   # wipe local DB, re-apply migrations + seed
pnpm supabase stop       # stop (add --no-backup to discard local data)
```

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
