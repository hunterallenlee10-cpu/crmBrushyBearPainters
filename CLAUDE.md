# CLAUDE.md — Brushy Bear CRM

Internal CRM for **Brushy Bear Painters** (residential painting, Eastside Seattle). Owners: Erik (field ops & estimates) and Hunter Lee (marketing & customer experience).

- **Source of truth:** `docs/SPEC.md`. Read the relevant section before building anything. Note any deviation in `docs/DECISIONS.md`.
- **Decision log:** `docs/DECISIONS.md`. Add an entry (date + reason) for every non-obvious choice.

## Working rules (SPEC §18)

1. **Plan before coding** each phase and show the plan. Ask before anything destructive (dropping tables, rewriting migrations already applied, force pushes).
2. **Don't invent business facts.** Phone, email, hours, license numbers, prices, production rates, tax rules, and legal language stay as placeholders or "Sample/Draft – owner to approve" until the owners give real values. Ask when you need one.
3. **Never connect real integrations or send real messages.** Everything goes through adapters → `integration_outbox` (status `simulated`).
4. **Don't copy anything from the reference CRM**: no names, data, branding, or wording beyond the generic UX patterns in the spec.
5. Keep `docs/DECISIONS.md` current; keep `docs/SPEC.md` as the source of truth and note any deviation.
6. Migrations are additive and reversible. Regenerate DB types after every migration. No `any`.
7. Business logic lives in `lib/domain/*` as pure, tested functions (stage gates, pricing, ledger, scoring, attention rules, scheduling conflicts). Server Actions / Route Handlers stay thin.
8. Server-side aggregation for all metrics; paginate everything; index what you filter on.
9. Every mutation: zod-validated, permission-checked, audit-logged, emits a domain event.
10. Mobile-first for crew screens; desktop-dense for office screens.
11. Write tests alongside features; a phase isn't done with failing tests or type errors.
12. End of each phase, report: what was built, screenshots, how to try it, known gaps, what's needed from the owners.

Also:
- **Never commit secrets.** `.env.example` lists every key, commented out.
- **Never call a real external API** in this build (tests mock HTTP).
- Don't push to `main` or deploy to production without asking. Work happens on the session's designated branch (see DECISIONS 2026-10-26 "Branching").
- Money is integer **cents** everywhere (DB `bigint`, TS `number`). Balances are always derived from the ledger, never stored as editable fields.
- Store timestamps in UTC; display in `America/Los_Angeles`.
- Every KPI comes from `lib/metrics/registry.ts`. No ad-hoc metric math in components.
- Stage changes only through `advanceJobStage()`.

## Stack (SPEC §2)

- Next.js 15 (App Router, RSC, Server Actions, Route Handlers), TypeScript `strict`
- Supabase: Postgres 15+, Auth, Storage, Realtime; SQL migrations in `supabase/migrations`; `@supabase/ssr`
- Tailwind CSS + shadcn/ui (Radix), lucide-react, Recharts, TanStack Table, react-hook-form + zod, dnd-kit, date-fns + date-fns-tz
- `@react-pdf/renderer` for PDFs
- Background jobs: Postgres `events` outbox + worker route hit by Vercel Cron (every minute); idempotent handlers
- PWA with IndexedDB offline queue for photos and daily logs
- Tests: Vitest (unit), Playwright (E2E + screenshots), SQL/pgTAP RLS tests, axe
- Quality gates: ESLint, Prettier, `tsc --noEmit`, tests — all in GitHub Actions on every push
- Hosting: Vercel

## Commands

Package manager: **pnpm**.

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm dev` | Next.js dev server on http://localhost:3000 |
| `pnpm supabase start` | Local Supabase stack (needs Docker) |
| `pnpm supabase db reset` | Re-apply all migrations + `supabase/seed.sql` |
| `pnpm db:types` | Regenerate `lib/db/types.ts` from the local DB |
| `pnpm db:test` | Run SQL/RLS policy tests |
| `pnpm seed:demo` | Load demo data (`DEMO_DATA=true`, never in production) |
| `pnpm lint` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright E2E |
| `pnpm screens` | Playwright screenshots → `docs/screens/phase-N/` |

(Commands are added as each phase lands; this table is the target.)

## Folder map

```
app/
  (auth)/                 login, magic link, MFA
  (app)/                  authenticated shell (top nav, search, notifications)
    home/ leads/ jobs/ schedule/ attention/ accounts/ contacts/ estimates/
    invoices/ campaigns/ documents/ price-book/ analytics/ my-numbers/
    referrals/ reviews/ help/ settings/ admin/
  p/[token]/              public proposal / customer pages (no login)
  api/
    public/leads/         website lead intake (HMAC-signed)
    cron/worker/          outbox/event worker (Vercel Cron)
  dev/ui/                 design-system / stage-color legend page
components/
  ui/                     shadcn primitives
  shell/                  top nav, search modal, user menu, help button
  kpi/ tables/ forms/     shared patterns (KPI card, data grid, rule builder…)
lib/
  domain/                 PURE business logic + tests (stages, pricing, ledger,
                          scoring, attention, scheduling, health)
  estimating/engine.ts    pricing engine entry (re-exports lib/domain/estimating)
  metrics/registry.ts     every KPI, defined once
  integrations/<domain>/  interface + outbox provider + disabled real stubs
  permissions/            packs, templates, server-side checks
  db/                     Supabase clients (server/browser/service) + generated types
  validation/             zod schemas shared by actions and route handlers
  pdf/                    react-pdf documents
supabase/
  migrations/             additive SQL migrations
  seed.sql                real configuration seed (no demo data)
  tests/                  RLS / SQL tests
scripts/                  seed-demo.ts, test helpers
tests/
  e2e/                    Playwright specs
public/brand/             logo + mascot placeholders (real files from owners)
docs/                     SPEC, DECISIONS, ARCHITECTURE, DATA_MODEL, PERMISSIONS,
                          WORKFLOWS, METRICS, INTEGRATIONS, WEBSITE_INTEGRATION,
                          COMPLIANCE, RUNBOOK, OWNER_GUIDE, screens/
```
