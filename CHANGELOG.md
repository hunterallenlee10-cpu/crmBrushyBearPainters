# Changelog

All notable changes, by build phase. See `docs/PLAN.md` for what each phase covers.

## Phase 2 — Leads & Customers

### Added

- **Website lead intake** (`POST /api/public/leads` + photo upload URLs): HMAC-signed with a 5-minute window, idempotency keys, rate limits, honeypot, strict validation. Maps services, timeline, home age and page path; scores the lead; repeat submissions within 180 days attach to the existing lead and notify its owner instead of creating a duplicate. Contract and copy-paste examples in `docs/WEBSITE_INTEGRATION.md`. A test submission becomes a lead in about 0.1 s.
- **Lead Dashboard** (`/leads`): Total / New / Contacted / Walkthrough Scheduled, Needs Attention (stale 14+ days, unassigned, hot), status distribution, My Leads, Recent Leads, conversion funnel with rates and speed to lead, top sources, leads by city, lead aging. Every number comes from the server through the metrics registry; every chart has a "View data" table and drills into the Lead List.
- **Lead List** (`/leads/list`) on a new shared list framework: tabs with counts, search (name, email, phone digits, address, source), quick chips, Source/City/Health selects, Advanced filter (match all/any), sortable columns, saved views (personal or shared), column picker, bulk assign and status change, preview drawer, paging. Filters live in the URL, so a filtered list is a shareable link.
- **New Lead wizard** (`/leads/new`): three steps (contact, property, qualify) with per-step validation, a live duplicate check, completion meter, territory from ZIP, lead-safe note for pre-1978 homes, photos, and "Save & book walkthrough".
- **Lead Detail** (`/leads/[id]`): header with grade and score, Call / SMS / Email composer (simulated through the outbox; nothing is sent), log a call, SMS segment counter, Details with score factors, Activity thread, Notes, Comments with @mentions, Tasks, Edit, Change status (lost reason / check-back date), Book walkthrough, Delete with reason.
- **Lead scoring:** rule-based score 0–100 with grade A–F and Hot/Warm/Cold, stored with its reasons. **Admin → Lead Scoring** edits the points with a live example and can recalculate open leads.
- **Accounts and Contacts** (`/accounts`, `/contacts`): lists, detail pages, New account (account + primary contact + first property), consent with time and source, Do Not Contact, properties with lead-safe badge, gate/lockbox codes encrypted in the app and revealed only on request (logged).
- **Universal search** finds leads, accounts and contacts you're allowed to open, and remembers recently opened records in your browser. **Notifications bell** with mentions and repeat website submissions. Leads menu shows the newest leads.
- Speed to lead in business hours (Pacific, from Company Settings), set once by the first call, text or email a person logs.
- New permission `properties:view_access_codes`. "Team" scope means the same territory.
- Deleted leads, accounts, contacts and properties can be restored in Admin → Deleted Records.

### Changed

- Deleting a record now also requires edit rights on that record (before, the delete permission alone was enough).
- Trusted server code may delete messages (never edit them), for test cleanup and the demo-data purge. People still can't change or delete messages.
- Faster lists at scale: page 1 of 50,000 leads in ~4 ms, tab counts 18 ms, dashboard 141 ms (`docs/PERFORMANCE.md`).
- Two-step sign-in and View as no longer get stuck when a page refresh interrupts the redirect.

### Tests

- SQL/RLS: 282 assertions across 9 files (Phase 2 adds leads, accounts, contacts, notes, comments, tasks, messages, notifications, scoring rules, search, scoped delete; every role plus a second company).
- Unit: 584 tests (scoring, normalization, dedupe, intake mapping and signatures, speed to lead, list filters, metrics registry, wizard, messaging, consent).
- E2E + axe (desktop and mobile): intake API, Lead Dashboard, Lead List, New Lead, Lead Detail, Accounts & Contacts, Admin Lead Scoring, shell.
- `pnpm bench:leads`: 50k-lead benchmark (local only).

## Phase 1 — Platform

### Added

- **Sign-in:** email magic links (invite-only), Google sign-in (ready once the owners add Google credentials), two-step sign-in (TOTP) required for Owner and Bookkeeper, No-access page for accounts that aren't set up or are turned off, sign out. Every app page requires sign-in and keeps the page you were going to.
- **Permission engine in Postgres:** 85 permissions, 18 permission packs (with own/team/all scope), 8 role templates (Owner, Office Manager, Estimator, Project Manager / Crew Lead, Painter, Subcontractor, Bookkeeper, Read-only) and per-user grants/revokes with a reason. Row-level security on every table uses the same resolver, so the screens and the database always agree.
- **View as user** (owners): see the app exactly as a teammate does, read-only, with a banner; recorded in the audit log.
- **Audit log** on every change (who, what, before/after, when, IP, device) and a domain event for every change, both written by the database.
- **Soft delete + Deleted Records** with restore.
- **Admin → Setup** hub with quick find; **Company Settings** (contact, licensing, business hours, SLA timers, on-time guarantee, season, deposit, estimate expiry, review link, referral reward) with placeholders flagged.
- **Admin screens:**
  - **Users:** invite (the email is simulated), edit, change role, labor cost, per-user permissions, deactivate and reactivate.
  - **Roles & Permissions:** packs × templates matrix, template editor with a preview of what changes, custom packs.
  - **Field Picklists:** rename, reorder, colors, disposition categories, sub-source parents.
  - **Territories:** ZIP lists with conflict checks and a ZIP lookup.
  - **Integrations:** 11 cards, all "Not connected", with setup steps, simulated test sends and the outbox.
  - **Audit Log:** filters and before/after diffs.
  - **Deleted Records:** restore.
- **Personal Settings:** profile, two-step sign-in, sign out of all devices, preferences.
- **Integration adapters:** one interface per domain with an outbox provider (records "Simulated – not sent") and disabled real-provider stubs behind three locks.
- Shell now shows only what each role can use; crew roles get the mobile tab bar.
- Real brand assets (logo, mascot, icons) from the Brushy Bear website.
- `pnpm seed:owners` creates owner accounts from `SEED_OWNER_EMAILS`.
- Database guards: only owners can assign, demote, deactivate or change the email of an owner; the last active owner can't be turned off; the Owner template and system packs are locked.
- Tests: SQL/RLS tests for every role (193 assertions), unit tests for permissions, territories, settings, adapters and auth helpers, Playwright E2E + axe for sign-in, every role, View as and each admin screen. CI runs E2E against a local Supabase stack.

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
