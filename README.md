# Brushy Bear CRM

Internal operating system for **Brushy Bear Painters**, a residential painting company on the Eastside of Seattle. It runs the whole job lifecycle: web lead → text-back → walkthrough → estimate in 24h → signed → deposit → onboarding → scheduled → daily photo updates → final walkthrough → invoice → paid → review → referral.

- **Spec (source of truth):** [`docs/SPEC.md`](docs/SPEC.md)
- **Build plan:** [`docs/PLAN.md`](docs/PLAN.md) · **Decisions:** [`docs/DECISIONS.md`](docs/DECISIONS.md) · **Changes:** [`CHANGELOG.md`](CHANGELOG.md)
- **Working rules for contributors and AI agents:** [`CLAUDE.md`](CLAUDE.md)

> Every outside integration (SMS, email, payments, calendar, …) ships **disconnected**. Anything that would be sent is written to an outbox and shown as "Simulated – not sent".

## Stack

Next.js 15 (App Router) · TypeScript strict · Supabase (Postgres, Auth, Storage) · Tailwind CSS v4 + shadcn/ui · Vitest · Playwright · GitHub Actions · Vercel.

## Prerequisites

- **Node.js 22+** and **pnpm 10** (`corepack enable` picks up the pinned version)
- **Docker** (for the local Supabase stack)
- Optional: `psql` (Postgres client) to run DB tests against a running database

## Setup

```bash
pnpm install
cp .env.example .env.local

# Start local Supabase (Postgres, Auth, Storage, Studio). Applies migrations + seed.
pnpm supabase start
# Copy the printed values into .env.local:
#   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321      ("Project URL")
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...      ("Publishable" key)
#   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...               ("Secret" key — server-only)

pnpm dev            # http://localhost:3000
```

Useful pages while developing:

- `/` — the app shell
- `/login` — brand sign-in screen (sign-in is wired up in Phase 1)
- `/dev/ui` — design system: tokens, contrast ratios, stage colors, components (hidden in production)
- Supabase Studio: http://127.0.0.1:54323

## Commands

| Command                             | What it does                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`                          | Dev server                                                                       |
| `pnpm build` / `pnpm start`         | Production build / serve it                                                      |
| `pnpm lint`                         | ESLint                                                                           |
| `pnpm format` / `pnpm format:check` | Prettier                                                                         |
| `pnpm typecheck`                    | `tsc --noEmit`                                                                   |
| `pnpm test`                         | Unit tests (Vitest)                                                              |
| `pnpm test:e2e`                     | E2E + accessibility tests (Playwright, desktop + mobile)                         |
| `pnpm screens`                      | Screenshots → `docs/screens/phase-N/` (`PHASE=N pnpm screens`)                   |
| `pnpm db:test`                      | SQL / RLS tests (see below)                                                      |
| `pnpm db:types`                     | Regenerate `lib/db/types.ts` from the local database                             |
| `pnpm supabase <cmd>`               | Supabase CLI (pinned version), e.g. `start`, `stop`, `db reset`, `migration new` |

### Database tests

`pnpm db:test` runs every `supabase/tests/*.test.sql` file.

- With `DATABASE_URL` set (e.g. `postgresql://postgres:postgres@127.0.0.1:54322/postgres` for local Supabase), it runs against that database.
- Without it, it boots a throwaway Postgres 15+ from your local install, applies a small Supabase stand-in, all migrations and the seed, runs the tests and cleans up. Handy on machines without Docker.

CI always runs them against the real Supabase stack.

### Migrations

```bash
pnpm supabase migration new <name>   # creates supabase/migrations/<timestamp>_<name>.sql
pnpm supabase db reset               # re-applies all migrations + seed locally
pnpm db:types                        # regenerate types after every migration
```

Migrations are additive. Each one has a matching rollback in `supabase/rollbacks/`.

## Project layout

See the folder map in [`CLAUDE.md`](CLAUDE.md#folder-map).

## CI

`.github/workflows/ci.yml` runs on every push: lint → format check → typecheck → unit tests → build → client-bundle secret check; migrations + RLS tests on a real Supabase stack; Playwright E2E + axe on the production build.

## Deployment

Vercel (preview + production). Nothing is deployed to production without the owners' OK. See [`docs/RUNBOOK.md`](docs/RUNBOOK.md).
