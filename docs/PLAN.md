# Build Plan — Brushy Bear CRM

Phase-by-phase plan for SPEC §17. Each phase follows the same loop: plan → implement → migrations → seed → tests → Playwright screenshots in `docs/screens/phase-N/` → `CHANGELOG.md` + docs → commit. I stop at the end of each phase with a report (what was built, screenshots, how to try it, gaps, what I need from you) and wait for your OK.

Principle for ordering: build the **pure domain logic first** in each phase (`lib/domain/*`, unit-tested), then the schema + RLS, then the screens on top. The rules that keep the brand promises (stage gates, ledger, SLAs, guarantees) get tested before any UI depends on them.

---

## Phase 0 — Foundation

**Build**
- Next.js 15 + TS strict, pnpm, ESLint (strict, `no-explicit-any` = error), Prettier, Vitest, Playwright.
- Tailwind v4 + shadcn/ui; brand tokens from SPEC §16 (`--bb-forest`, honey, cream…), Manrope + Lilita One, semantic status colors, one color per job stage.
- Supabase local config (`supabase/config.toml`), first migration: `organizations`, base helpers (`updated_at` trigger, soft-delete conventions, per-year number sequences like `BB-2026-0001`).
- Supabase clients (`server`, `browser`, `service` — service client guarded as server-only).
- Env handling: `lib/env.ts` validated with zod; `.env.example` with every key commented out.
- App shell: top nav (Home · Leads ▾ · Jobs ▾ · Schedule ▾ · Attention · More ▾ · Admin ▾) with recent-items slots, universal search modal shell (`Cmd/Ctrl+K`), integrations pill ("0 of 11 connected"), softphone button (disabled), notifications bell shell, user menu, floating Help button, mobile bottom tab bar for crew roles. Placeholder pages for every nav route.
- Login screen in brand style (cream/forest), placeholder logo in `public/brand/`.
- `/dev/ui` design-system page (tokens, buttons, KPI card, stage legend).
- GitHub Actions: install → lint → format check → typecheck → unit tests → build → DB tests (real `supabase start`).
- Docs skeleton: README, ARCHITECTURE, DATA_MODEL, PERMISSIONS, WORKFLOWS, METRICS, INTEGRATIONS, WEBSITE_INTEGRATION, COMPLIANCE, RUNBOOK, OWNER_GUIDE, CHANGELOG.

**Done when:** `pnpm dev` + `pnpm supabase start` work from the README; CI green; shell renders on desktop and mobile (screenshots of both).

---

## Phase 1 — Platform

**Build**
- Schema: `profiles`, `role_templates`, `permission_packs`, `pack_permissions`, `template_packs`, `user_permission_overrides`, `company_settings`, `picklists` + `picklist_values`, `audit_log` (append-only, trigger-driven, records `impersonated_by`), `activity`, `events`, `integration_connections`, `integration_outbox`, `territories`.
- RLS helpers: `app.current_org_id()`, `app.has_perm()`, `app.record_scope()`; deny-by-default policies on every table.
- Seed: org, 8 role templates, permission packs by category, territories + ZIPs, picklists from SPEC §15.1, Company Settings with placeholders (`[PHONE]`, `[EMAIL]`, `[HOURS]`, `[LNI_NUMBER]`, `[UBI_NUMBER]`), owners from `SEED_OWNER_EMAILS`.
- Auth: Google OAuth + magic link, invite-only, TOTP MFA enforced for Owner and Bookkeeper, deactivate-with-reassign flow.
- Server-action wrapper: zod validate → permission check → mutation → audit → domain event (the one pattern every later mutation uses).
- View-as-user: read-only impersonation, visible banner, audit-logged.
- Admin screens: Users, Roles & Permissions (Overview / Templates / Packs / Users), Field Picklists, Company Settings, Audit Log, Deleted Records (restore).
- Integration framework: 11 domain interfaces, outbox providers, disabled real-provider stubs with mocked-HTTP tests, env flags, Admin → Integrations cards.

**Done when:** RLS tests pass for every role; audit rows on every mutation; Integrations page shows all 11 cards "Not connected".

---

## Phase 2 — Leads & Customers

**Build**
- Domain: lead scoring (§6.6), phone/email normalization, ZIP → territory, dedupe matching.
- Schema: `accounts`, `contacts` (consent fields), `properties` (pre-1978, HOA, siding, encrypted gate code), `leads`, `lead_attachments`, `saved_views`; trigram search indexes.
- Public intake: `POST /api/public/leads` (HMAC, rate limit, idempotency, honeypot, dedupe within 180 days) + `upload-url` presigned flow; `docs/WEBSITE_INTEGRATION.md` with payload contract, server-action snippet, curl example.
- Shared list framework (built once, reused for Jobs, Accounts, etc.): server pagination/sort/filter, saved views, Advanced rule builder, Columns configurator, tabs with counts, chips, bulk select, quick-preview drawer.
- Screens: Lead Dashboard, Lead List, New Lead wizard (3 steps, completion %, live duplicate check, Book Walkthrough modal), Lead Detail (Details / Activity / Notes / Comments / Tasks), Accounts & Contacts lists/detail, universal search.

**Done when:** website payload → lead in < 1 s; duplicate test passes; lead list query < 300 ms at 50k leads (benchmarked with generated data).

---

## Phase 3 — Jobs core

**Build**
- Domain: stage machine + gates (§6.2), override rules, job health score (§6.5), attention rules v1 (§9, the rules whose data exists by now).
- Schema: `jobs`, `stage_history`, `job_holds`, `job_team`, `appointments` (walkthroughs first), `notes`, `comments` + mentions, `tasks`, `notifications`, `attention_items`.
- `advanceJobStage()` as the only path that changes stage; owner override with required reason.
- Convert lead → job (dedupe account/contact/property, move files/notes, link back).
- Screens: Jobs Dashboard, Job List (list/card), Approvals, Job Detail shell with all 16 sections (Overview, Admin, Notes, Activity fully working; later sections show real empty states), Milestones stepper, holds UI, Attention Center.
- Worker route + Vercel Cron config; attention items open and auto-resolve.

**Done when:** a gate can't be skipped without owner override + reason; stage history is correct; attention items open and auto-resolve (tests for each).

---

## Phase 4 — Estimating

**Build**
- Domain: pricing engine (§7.4) — labor hours, gallons with container rounding, sundries, margin pricing, catalog flat pricing, overrides with reason, minimum charge, discounts + approval thresholds, tax (configurable), deposit, margin floor warning. 100% unit-test coverage with fixture jobs.
- Schema: price books, catalog items, paint products, production rates (`is_sample`), estimate settings, estimates / versions / options / areas / line items, color selections, change orders.
- Seed: "Brushy Bear Standard" price book, surfaces (§7.2), add-ons, sample rates/products with "Sample – Erik to calibrate" badges; "What's included" text (exterior from website, others as "Draft – owner to approve").
- Screens: Price Book, Paint Catalog & Production Rates editors, tablet-first Estimate Builder (measurement helpers, options, add-ons, internal margin panel).
- Proposal page `/p/[token]` (mobile, live add-on toggles, guarantees, Accept & Sign with drawn signature) + PDFs (proposal, contract, color sheet) via react-pdf.
- On accept: Sold, signed PDF stored, deposit invoice, onboarding items seeded, paint order draft, work orders.

**Done when:** pricing engine fully tested; proposal works on mobile; acceptance produces signed PDF + deposit invoice + onboarding items.

---

## Phase 5 — Onboarding, documents & photos

**Build**
- Domain: onboarding requirement rules + auto-verify (§6.4), "Ready to Schedule" gate.
- Schema: onboarding requirements, documents, photos (categories, area tags), Storage buckets (private, signed URLs, EXIF stripped on customer copies).
- Screens: Job → Onboarding, Onboarding Board (kanban with gate-aware drag), Documents (job + global), Photos (gallery, required-shot checklist, before/after slider, camera capture).
- PWA: manifest, service worker, IndexedDB offline queue for photos, "Offline ready · Last synced" indicator.

**Done when:** Ready to Schedule only when gates pass; offline photo capture syncs after reconnect (E2E with network toggled off/on).

---

## Phase 6 — Production

**Build**
- Domain: scheduling conflict detection + work rules (§15.1), crew recommendation ranking, dispatch readiness %, on-time guarantee logic, rain-delay flow.
- Schema: crews, members, subcontractors (L&I #, COI, RRP), skills, availability, work types, work rules, schedule drafts, work orders, paint orders, daily logs (+ hours), time entries, punch items.
- Screens: Schedule Admin, Production Center (Command Center, Master Schedule with drag/resize + draft → Publish, Field Dispatch, Readiness & Crew queues, Paint Orders, Exceptions, Recommendations with approval + 15-min undo, Resources, Weather panel), My Projects portal (mobile), Daily Log form (mobile, required cleanup check + photo), Punch List + customer sign-off, Final Walkthrough.
- Weather adapter stub (NWS/OpenWeather shapes, disconnected) + manual rain-delay marking.

**Done when:** a conflicting schedule is blocked with a clear reason; Publish sends simulated notices; a missed daily log raises attention at 7 pm Pacific.

---

## Phase 7 — Money

**Build**
- Domain: ledger (§10) — contract, billed, left to bill, collected, balance, due; payment application; void/refund/bounce reversals; A/R aging; job costing & margin; month-close locks. Property-based tests (fast-check) over random invoice/payment sequences.
- Schema: invoices, invoice lines, payments, payment applications, credits, refunds, month closes; ledger views (no editable balance columns anywhere).
- Screens: Job → Financial (Worksheet with plain-English "Needs attention", Invoices, Payments, Job Costing, Accounting), global Invoices list, A/R aging, Admin → Finance (close month).
- On-Time Guarantee credit approval → final invoice. QuickBooks adapter stub with "would sync" previews.

**Done when:** ledger invariants hold under property-based tests; no stored balance fields.

---

## Phase 8 — Communication & growth

**Build**
- Workflow engine: triggers + conditions → actions, idempotency per (workflow, event), quiet hours (queue until 8 am), consent/DNC checks, dry-run "Test" against a chosen record, run log.
- 17 seeded workflows (§11.2) and SMS + email templates in Brushy Bear's voice with merge-field preview and SMS segment counter.
- Messaging inbox/threads, STOP/UNSUBSCRIBE handler stub, Follow-up Lists with power-dialer view, Campaigns & Drips (audience builder, compliance checks), Referrals (Bear Champions, `?ref=` attribution), Reviews, Warranty cases.

**Done when:** every seeded workflow has a passing dry-run test; quiet hours and opt-out are enforced (tests).

---

## Phase 9 — Analytics & home

**Build**
- `lib/metrics/registry.ts`: every KPI in §12.1 with SQL/RPC, date field, filters, formula caption, owner-only flag, and a fixture test with a known expected value.
- Executive Overview, Workspace ("My Day"), Leads/Jobs dashboards wired to the registry; "View data" + CSV on every chart (permission-gated, logged).
- Analytics hub: "Ask Brushy Bear" (keyword → metric matching, no AI), Daily Brief, prebuilt dashboards, report builder, scheduled deliveries (outbox), seeded report templates.
- My Numbers (+ commissions view when enabled), My Projects polish.

**Done when:** every KPI matches its fixture value; every chart has View data + CSV.

---

## Phase 10 — Hardening & launch prep

**Build**
- Module Manager (custom fields, layouts, validation rules), CSV import with mapping/review queue, bulk update (preview → apply → revert), reversible merges, export controls + export log.
- Help Center + 10 seeded articles + release notes.
- Commissions engine (off by default) with simulator.
- Demo data script (`DEMO_DATA=true`, `is_demo` tagging, owner-only purge).
- Security pass (CSP, service-key bundle grep test, PII-free logs), accessibility (axe), performance (Lighthouse ≥ 90).
- Full E2E: golden path (§19) + the extra scenarios. Final docs + `OWNER_GUIDE.md`. Vercel **preview** deploy (asks you first).

**Done when:** golden-path E2E green; Lighthouse ≥ 90 on key pages; no serious axe violations; docs complete.

---

## Risks I'm watching

- **Scope:** this is a large system. I'll keep each phase shippable and resist polishing early screens before the domain rules exist.
- **RLS + field masking for crew roles:** contract amounts must be hidden in Postgres, not just the UI. Plan: base tables are not directly selectable by field roles; they read through masked views. Tested per role in Phase 1 and re-tested as each table lands.
- **Offline PWA (Phase 5):** service-worker + IndexedDB sync is the most fragile piece; it gets its own network-toggle E2E test.
- **Sandbox has no Docker:** I test migrations and RLS against plain Postgres 16 with an auth shim here; CI runs the real Supabase stack (see DECISIONS).

## What I need from you (not blocking Phase 0)

1. Logo + bear mascot files (from the website repo or the Drive folder) for `public/brand/`.
2. Real phone, email, hours, L&I #, UBI # when ready (placeholders until then).
3. A Supabase project + Vercel project when you want a preview deploy (Phase 10, or earlier if you'd like to click around).
4. Owner emails for `SEED_OWNER_EMAILS` (kept in env, not in code).
5. Later: Erik's real production rates, paint costs, and pricing; accountant's answer on WA sales tax; attorney review of contract templates.
