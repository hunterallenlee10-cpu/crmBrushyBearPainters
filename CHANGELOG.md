# Changelog

All notable changes, by build phase. See `docs/PLAN.md` for what each phase covers.

## Phase 1 — Platform

### Added

- **Sign-in:** email magic links (invite-only), Google sign-in (ready once the owners add Google credentials), two-step sign-in (TOTP) required for Owner and Bookkeeper, No-access page for accounts that aren't set up or are turned off, sign out. Every app page requires sign-in and keeps the page you were going to.
- **Permission engine in Postgres:** 85 permissions, 18 permission packs (with own/team/all scope), 8 role templates (Owner, Office Manager, Estimator, Project Manager / Crew Lead, Painter, Subcontractor, Bookkeeper, Read-only) and per-user grants/revokes with a reason. Row-level security on every table uses the same resolver, so the screens and the database always agree.
- **View as user** (owners): see the app exactly as a teammate does, read-only, with a banner; recorded in the audit log.
- **Audit log** on every change (who, what, before/after, when, IP, device) and a domain event for every change, both written by the database.
- **Soft delete + Deleted Records** with restore.
- **Admin → Setup** hub with quick find; **Company Settings** (contact, licensing, business hours, SLA timers, on-time guarantee, season, deposit, estimate expiry, review link, referral reward) with placeholders flagged.
- **Admin screens:** Users, Roles & Permissions, Field Picklists, Territories, Integrations (11 cards, all "Not connected", plus the simulated outbox), Audit Log, Deleted Records; personal Settings.
- **Integration adapters:** one interface per domain with an outbox provider (records "Simulated – not sent") and disabled real-provider stubs behind three locks.
- Shell now shows only what each role can use; crew roles get the mobile tab bar.
- Real brand assets (logo, mascot, icons) from the Brushy Bear website.
- `pnpm seed:owners` creates owner accounts from `SEED_OWNER_EMAILS`.
- Tests: SQL/RLS tests for every role (187 assertions), unit tests for permissions, territories, settings, adapters and auth helpers, Playwright E2E + axe for sign-in, every role, View as and each admin screen. CI runs E2E against a local Supabase stack.

## Phase 0 — Foundation

### Added

- Next.js 15 (App Router) + TypeScript strict, pnpm, ESLint (no `any`), Prettier, Vitest, Playwright.
- Tailwind CSS v4 + shadcn/ui with Brushy Bear tokens (forest, honey, cream, ink), Manrope + Lilita One (self-hosted), semantic status colors, one color per job stage. Contrast is unit-tested against WCAG AA.
- App shell: top nav (Home · Leads ▾ · Jobs ▾ · Schedule ▾ · Attention · More ▾ · Admin ▾) with recent-item slots, universal search (`Ctrl/Cmd+K`, scope chips), integrations pill ("0 of 11 connected"), softphone and View-as-user buttons (unavailable until their phases), notifications, user menu, floating Help panel, mobile menu, crew bottom tab bar.
- Placeholder page for every route, showing which phase delivers it. 404 page.
- Brand login screen (sign-in wired in Phase 1).
- `/dev/ui` design-system page with live contrast ratios and the stage legend.
- Supabase: local config (invite-only signup, TOTP MFA on), first migration (`organizations`, `updated_at` trigger, per-year numbers like `BB-2026-0001`), seed with the organization, rollback file.
- SQL test harness (`pnpm db:test`) with a guard that every table has RLS enabled.
- Env validation (`lib/env.ts`), Supabase server/browser/service clients, integration registry (11 domains, all disconnected), `.env.example`.
- GitHub Actions CI: lint, format, typecheck, unit tests, build, client-bundle secret check, Supabase migrations + RLS tests, Playwright E2E + axe.
- Docs skeleton: README, ARCHITECTURE, DATA_MODEL, PERMISSIONS, WORKFLOWS, METRICS, INTEGRATIONS, WEBSITE_INTEGRATION, COMPLIANCE, RUNBOOK, OWNER_GUIDE.
