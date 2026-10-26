# Decisions

Every non-obvious decision, newest at the bottom. Format: date · decision · reason. Deviations from `docs/SPEC.md` are marked **[Deviation]**.

---

### 2026-10-26 · Branching **[Deviation]**

- **Decision:** All work is committed to the session branch `claude/pensive-ride-f31jbx` instead of a new `phase-N-*` branch per phase. Each phase ends with a tagged commit message `phase-N: …` so phases stay easy to find.
- **Reason:** This build runs in a cloud session that is only allowed to push to its designated branch. SPEC §17's intent (no direct pushes to `main`, phases reviewable separately) is preserved. If the owners want true per-phase branches, they can be cut from the phase commits later.

### 2026-10-26 · Next.js 15, not the latest major

- **Decision:** Pin Next.js `15.5.x` (latest 15 line).
- **Reason:** SPEC §2 names Next.js 15. Newer majors exist but switching would be an unlogged substitution.

### 2026-10-26 · Tailwind CSS v4 + shadcn/ui

- **Decision:** Tailwind v4 (CSS-first `@theme` config) with the current shadcn/ui CLI.
- **Reason:** Current shadcn/ui targets Tailwind v4; brand tokens from SPEC §16 map directly to `@theme` CSS variables.

### 2026-10-26 · Single app at repo root (no monorepo)

- **Decision:** One Next.js app at the root; no Turborepo/workspaces.
- **Reason:** One deployable, one team. The website is a separate repo (SPEC §1.1). Revisit only if a second app appears.

### 2026-10-26 · Pricing engine location

- **Decision:** Implementation lives in `lib/domain/estimating/`; `lib/estimating/engine.ts` re-exports it.
- **Reason:** SPEC §7.4 names `lib/estimating/engine.ts`, while SPEC §18 rule 7 puts all business logic in `lib/domain/*`. The re-export satisfies both.

### 2026-10-26 · Money in TypeScript

- **Decision:** Cents are `bigint` in Postgres and plain `number` (integer) in TypeScript, branded as `Cents`. Supabase returns `bigint` as number; values stay far below 2^53.
- **Reason:** JS `BigInt` doesn't serialize through JSON/RSC and would complicate every form and chart. A $90 trillion ceiling is not a risk for a painting company.

### 2026-10-26 · Supabase CLI via npm devDependency

- **Decision:** Add the `supabase` npm package as a devDependency and call it through `pnpm supabase …`.
- **Reason:** Keeps the CLI version pinned per repo, so README instructions work without a global install.

### 2026-10-26 · Local DB tests without Docker

- **Decision:** CI (GitHub Actions) runs the real `supabase start` stack. For environments without Docker (like the build sandbox), `scripts/test-db.sh` boots a throwaway plain Postgres 16, applies a small `auth`-schema shim (`auth.uid()`, `auth.jwt()`, `authenticated`/`anon` roles), then runs the same migrations and RLS tests.
- **Reason:** The build sandbox has Postgres 16 binaries but no Docker daemon. RLS policies must still be tested on every change (SPEC §13.1). CI on the real Supabase stack is the authority.

### 2026-10-26 · Org resolution for RLS

- **Decision:** `org_id` for the current user comes from a `SECURITY DEFINER` helper `app.current_org_id()` that reads the caller's `profiles` row (not a client-editable JWT claim). Permission checks use `app.has_perm('<resource>:<action>')` and `app.record_scope('<resource>')` helpers backed by the permission-pack tables.
- **Reason:** Keeps tenancy and permissions enforced in Postgres (SPEC §4.2) and avoids trusting custom claims until a custom access-token hook is set up.

### 2026-10-26 · Background worker

- **Decision:** `/api/cron/worker` (protected by `CRON_SECRET`) drains `events` and scheduled jobs in batches using `SELECT … FOR UPDATE SKIP LOCKED`. Vercel Cron calls it every minute. `pg_cron` is optional, not required.
- **Reason:** Works the same locally (call the route) and on Vercel; `SKIP LOCKED` makes concurrent runs safe; idempotency keys make retries safe.

### 2026-10-26 · Self-hosted fonts via Fontsource

- **Decision:** Manrope and Lilita One come from `@fontsource-variable/manrope` and `@fontsource/lilita-one` (npm), not `next/font/google`.
- **Reason:** Builds don't depend on reaching Google Fonts (CI, sandboxed builds), and no visitor request goes to a third party. Same typefaces as SPEC §16.

### 2026-10-26 · SQL tests without pgTAP

- **Decision:** RLS/SQL tests are plain `.test.sql` files using small assertion helpers (`tests.assert`, `tests.assert_eq`, `tests.assert_raises`) run with `psql`. Each file wraps itself in `begin … rollback`.
- **Reason:** SPEC §2 allows "pgTAP or SQL tests". pgTAP isn't available on a plain local Postgres; plain SQL runs identically on the real Supabase stack (CI) and the throwaway Postgres (sandbox). Repeatable because nothing is committed.

### 2026-10-26 · Rollback files for migrations

- **Decision:** Every migration in `supabase/migrations/` has a matching `supabase/rollbacks/<same name>.down.sql`.
- **Reason:** SPEC §18 rule 6 requires reversible migrations; the Supabase CLI has no down-migrations. Rollbacks are manual and need owner approval outside local dev.

### 2026-10-26 · Placeholder routes via one catch-all

- **Decision:** `app/(app)/[...slug]/page.tsx` renders a "Coming in Phase N" page for every route in `lib/nav.ts` (statically generated; unknown paths 404). Real pages added at a specific path override it automatically.
- **Reason:** Every nav link works from day one without 40 throwaway files, and the nav config stays the single source of truth.

### 2026-10-26 · Preview viewer until sign-in

- **Decision:** Until Phase 1, `getViewer()` returns a read-only "Owner (preview)" viewer and the shell shows a "Preview build" banner. No route is protected yet.
- **Reason:** Auth is Phase 1 scope. The shell already consumes the final viewer shape, so Phase 1 only swaps the implementation. There is no data to protect yet.

### 2026-10-26 · Stage colors darkened for AA

- **Decision:** Ready to Schedule `#854D0E`, Final Walkthrough `#9A3412`, Completed `#166534`.
- **Reason:** The first picks measured 4.2–4.35:1 as badge text on their own tint, below WCAG AA (4.5:1). A unit test now checks every stage color.

### 2026-10-26 · Hand-written DB types in Phase 0

- **Decision:** `lib/db/types.ts` is hand-written in `supabase gen types` shape for Phase 0. CI regenerates it from the real stack and warns on drift (non-blocking for now).
- **Reason:** `supabase gen types` needs Docker, which this sandbox lacks. Once the first CI run produces the real output, it replaces the file and the check becomes blocking.

### 2026-10-26 · CSP deferred to Phase 10

- **Decision:** Phase 0 ships baseline security headers (nosniff, frame deny, referrer policy, HSTS, permissions policy). The strict nonce-based Content-Security-Policy lands in the Phase 10 hardening pass.
- **Reason:** A nonce CSP touches every page and third-party script; adding it once the page set is stable avoids repeated breakage. Tracked as a known gap.

### 2026-10-26 · Postgres version

- **Decision:** `supabase/config.toml` uses Postgres 17 (CLI default); the sandbox test harness uses the installed Postgres 16.
- **Reason:** Both satisfy SPEC §2 (Postgres 15+). Migrations avoid version-specific features; CI on 17 is the authority.
