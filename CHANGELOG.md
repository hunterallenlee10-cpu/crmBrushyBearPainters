# Changelog

All notable changes, by build phase. See `docs/PLAN.md` for what each phase covers.

## Phase 7 — Money

### Added

- **Ledger (derived, never stored):** contract (accepted estimate + signed change orders − approved credits), billed, left to bill, collected, balance, due, unapplied and refunded, computed the same way in `lib/domain/ledger` (pure, property-tested) and in the `invoice_ledger` / `payment_ledger` / `job_ledger` views. Plain-English reconciliation warnings: unapplied payment, overpaid or overbilled invoice, left to bill after the final invoice, credit waiting or pending approval, payment not cleared after 10 days, stale draft, no contract, Paid in Full stage with a balance, overdue.
- **Invoices:** deposit, progress, final and credit memo; create and edit drafts (lines, due date, terms, notes), **Send** (simulated email with the PDF attached and/or text, PDF stored in Documents, timeline entry), void with a reason. Status kept current by the database (draft, sent, viewed, partially paid, paid, overdue, void); overdue recomputed every minute.
- **Payments with forced application:** record check / cash / card / ACH / Zelle / financing / other with reference and date; the amount must be split across open invoices (oldest due first suggested); change the split later. **Reversals:** mark cleared, bounced (reopens the invoices, notifies finance), void (entered by mistake) and partial or full refunds (unapplied money first, then newest invoice first).
- **Credits:** goodwill, discount and referral credits requested on Job → Financial and approved or rejected by an owner; approved On-Time Guarantee credits (Phase 6) join the ledger automatically. Approved credits go onto the draft final invoice, or onto a credit memo once the final invoice is sent; the job's on-time credit shows "Credit applied".
- **Job → Financial** (sub-tabs Worksheet · Invoices · Payments · Job Costing · Accounting): Money Summary (contract, billed, left to bill, collected, balance, due), Needs attention, invoices and payments with their applications, credits on the worksheet, job costing for owners and the bookkeeper (labor from daily-log hours × hourly cost, paint orders, subcontractor hours, expenses with receipt photos or PDFs in a private bucket, gross margin), QuickBooks "would sync" previews.
- **Overview money tiles** use the ledger, with a "Paid in full" state; the customer section shows paid and balance.
- **Invoices** (`/invoices`): list with search, status and type filters, saved views and registry KPIs (A/R outstanding, overdue, collected, collection %, draft invoices, unapplied money). **A/R aging** (`/invoices/aging`): current, 1–30, 31–60, 61–90, 90+ days by customer and invoice. Universal search finds invoices.
- **Admin → Finance:** month list with totals and a close checklist (uncleared payments, unapplied money, drafts), **Close month** with a summary snapshot, **Reopen** (owners, with a reason). Closed months lock payments, refunds, invoices and expenses dated in them; owners can override with a written reason (new permission `finance:override_lock`, in no pack).
- **Stage automation (gates 10–12, TypeScript and SQL):** reaching Completed drafts the final invoice; sending it → Invoiced; the payment that brings the balance to $0 → Paid in Full; Closed Won needs a $0 balance. All through `advanceJobStage()`.
- **Attention and worker:** "Overdue invoice" (Medium at 7 days, High at 30, editable) with one simulated reminder per threshold (`invoice.overdue`); "Sold, no deposit" uses the real deposit invoice. Job health "balance current" is real, with a "Collect payment" next action.
- **Metrics** (registry, one `finance_stats` call): revenue sold, revenue completed, collected, billed, A/R outstanding, overdue, collection %, gross margin % on completed jobs (owners), days completed → paid, unapplied, aging buckets, open / draft invoices, pending credits.
- Accounting: invoice and payment "would sync" previews in `integration_outbox` (status `simulated`); QuickBooks stays disconnected.

### Changed

- Onboarding's deposit check reads the money actually applied to the deposit invoice; recording the deposit clears the item and releases the Deposit Hold.
- Onboarding Board cards show collected money from the ledger, and the "Under 30% collected" filter works.
- The bookkeeper can read hourly costs for job costing (still no HR access).
- Invoice PDFs show Paid and Balance due.
- Simulated emails can list attachments.

### Tests

- SQL/RLS: 691 assertions across 14 files (Phase 7 adds 104 in `013_money.test.sql`: no stored balance columns, the ledger view against the shared scenario, forced application and over-application refused, bounce / void / refund, credits and credit memo, gates 10–12, month lock and owner override, per-role row security (crew sees no amounts), `finance_stats`, cross-company isolation; migration applied, rolled back and re-applied).
- Unit: 1,036 tests across 81 files (Phase 7 adds the ledger domain with fast-check property tests — balance = billed − collected, every live dollar applied or shown as unapplied, no application exceeds its payment or invoice, refunds never exceed a payment, credits only on live invoices, due within the balance, aging adds up — plus reconciliation, aging, costing, month lock, gates, health, attention and registry metrics).
- E2E + axe on a production build (desktop and phone): recording the deposit clears the onboarding item and releases the Deposit Hold; the final invoice carries the approved $250 On-Time Guarantee credit; paying it moves the job to Paid in Full; Invoices list, A/R aging and Admin → Finance; bookkeeper job costing with a receipt upload; phone layout. Screenshots in `docs/screens/phase-7/`.

## Phase 6 — Production

### Added

- **Resources:** crews (employee or subcontractor, lead, home territory, max jobs per day, day capacity), members (teammates or names; lead / painter / helper), skills with expiry (RRP certificate), time off and company blackout days (Production → Resources). **Admin → Subcontractors** with insurance / license / W-9 uploads and expiry; status Active / Expiring / Suspended is computed and raises Attention before paperwork lapses.
- **Admin → Schedule Admin:** production days, day start, arrival window, crew-day hours, recommendation approval / auto-execute / undo window; SPEC §15.1 work types and durations; 11 work rules (on/off, block or warn, owner override, parameters); skills; checklist templates. All seeded with defaults on every organization (idempotent).
- **Master Schedule:** tray of Ready to Schedule jobs (rain reschedules pinned on top) with the recommended crew, dates and score; crew-row calendar with Day / Week / Multi-week views; drag from the tray, drag bars to move, drag the edge to resize (mouse, touch, keyboard), or use the Schedule dialog. Every placement is checked against the work rules and shows conflicts with plain reasons (double-booking names the other job and dates). Changes stay **drafts** until **Publish changes**, which is refused while any draft is blocked, then sets promised start, on-time guarantee date and crew and records simulated customer and crew notices in the outbox. Owners can override overridable rules with a written reason.
- **Production Center** (left sub-nav): **Command Center** (registry KPIs: ready, unscheduled, scheduled, in progress, at risk, rain reschedules, starts next 7 days, completed this week, scheduled revenue for finance, daily-update compliance, on-time start, rain-delay days, punch items per job, labor hours estimated vs actual, backlog crew-days); **Field Dispatch** (today's production by city, filters; map waits for the maps integration); **Readiness Queue** and **Crew Queue** (dispatch readiness %, blocks, next action, assign crew); **Paint Orders** (status tabs, supplier, expected date, pickup/delivery, generate from the accepted estimate); **Exceptions** (production Attention items with Resolve); **Recommendations** (approve → draft, reject, undo within 15 minutes; approval on, auto-execute off); **Work Orders**; **Weather** ("Weather not connected" + manual rain delay).
- **Field screens (mobile-first):** **Today** (today's jobs: address, access notes, parking, pets, today's work order and scope, colors, open punch items, Start job, Daily log, Photos), **Daily Log** and **My Projects** (search, status and city filters, Day / Week / Month / All, mini calendar with job counts per day, project list with "N/6 stages complete", selected project summary with photos).
- **Daily logs:** finished today, next up, issues, weather, hours per person, required "Cleanup done" + cleanup photo, progress photos. Works offline through the photo queue; on upload the customer update is recorded (simulated) and signed by the point of contact. Job → Daily Logs timeline with thumbnails, cleanup check, hours and update status.
- **Job sections:** **Schedule** (next steps, production timeline, dispatch readiness checks, crew with recommended crews and scores, schedule entries, on-time start guarantee with credit approve/waive, rain delays, Start job, appointments); **Work Orders** (tiles, status and crew controls, labor vs subcontractor hours, paint orders); **Punch List** (items by area with before/fixed photos, fixed / customer waived / reopen / remove, final-walkthrough status, **customer sign-off** with drawn signature). Tasks & Checklists shows real checklists (add from a template, tick items). Order Paint and New Daily Log shortcuts work.
- **Stage automation (gates 6–9, TypeScript and SQL):** published entry → Scheduled; materials ready + first day reached (Start job) → In Progress; all work orders done → Final Walkthrough; customer sign-off (or walkthrough completed with no open items) → Completed. All through `advanceJobStage()`.
- **Promises:** on-time start (missed non-weather start drafts the Company Settings credit for owner approval; stored for Phase 7), rain-day promise (rain delay never charges, priority reschedule, customer text), daily photo update, clean house every evening, final walkthrough sign-off.
- **Attention rules** (editable thresholds): missing crew, paint not ordered, missed daily update (7 pm Pacific, owner = crew lead), punch list open, start date missed (uses the guarantee date, skips rain slips), subcontractor paperwork expiring, weather risk (dormant until weather is connected). Job health checks for crew, schedule and daily logs are real.
- Worker: production sweep, daily-update sweep, subcontractor status, recommendations every 15 minutes.

### Changed

- Crew leads and members of a job's crew count as "on the job" (own-scope visibility).
- Onboarding "Crew assigned" and the lead-safe certified-renovator check are real.
- Book Walkthrough and appointment texts no longer promise Phase 6 features that need the calendar integration.

### Tests

- SQL/RLS: 586 assertions across 13 files (Phase 6 adds 78: guards on published vs draft fields, Publish-only writes, crew visibility, credits refused for people and for rain slips, daily log cleanup checks, punch sign-off immutability, gates 6–9, `production_stats`, cross-company isolation; rollbacks applied and re-applied by hand).
- Unit: 1,000 tests across 75 files (Phase 6 adds scheduling domain: conflicts and work rules, crew ranking, readiness, on-time guarantee, daily-update compliance, publish plan, calendar layout, My Projects windows; gates, health, attention rules with a fixed 7 pm clock, registry metrics).
- E2E + axe on a production build (desktop and phone): conflicting schedule blocked with the reason, Publish records customer and crew outbox rows, job Schedule / Work Orders sections, every Production Center page and Schedule Admin, Today and My Projects (owner and painter), daily log required fields + offline → sync, punch list and customer sign-off → Completed. Screenshots in `docs/screens/phase-6/`.

## Phase 5 — Onboarding, documents & photos

### Added

- **Onboarding checks:** every requirement on the checklist now checks itself against the job: signed contract stored, change orders signed, deposit invoice paid (pending until payments arrive in Phase 7), contact has mobile and email, access/pets/parking/occupancy filled in, colors chosen for every surface, color consult completed, HOA approval uploaded, lead-safe acknowledgment uploaded (certified renovator in Phase 6), repair allowance accepted or change order signed, paint order placed, prep instructions sent, promised start inside the exterior season. Results run after every change, on "Re-verify all" and every minute in the worker.
- **Ready to Schedule is a real gate** (in TypeScript and in the database): every required item cleared and no hold that blocks scheduling. When it passes, the job moves to Ready to Schedule on its own. Clearing the deposit item releases the Deposit Hold.
- **Job → Onboarding:** tiles (progress %, auto-verified, needs attention, open cases, tasks due, active holds), sub-tabs Checklist · Cases · Tasks · Holds, grouped checklist with what each check found, its owner, and Request from customer (simulated text or email with draft wording), Upload (straight into Documents), Create task, Mark cleared with a note, Reopen; job summary card and the "Ready to Schedule = …" footnote.
- **Onboarding Board** (`/schedule/onboarding`): lanes Deposit Hold → Needs Onboarding → On Hold / Expediting → Ready to Schedule → Scheduled / In Progress → Invoicing / Collections → Paid in Full with totals, average days and overdue counts; KPI strip from the metrics registry; filters (work type, holds, city, sold dates); cards with customer, work types, holds, days in lane, value, onboarding progress and HOA/lead-safe/weather icons; drag (mouse, touch, keyboard) or a button moves a cleared job to Ready to Schedule, and every other drop explains why not. Tabs Expedite, Data Audit, Reporting and Call Log.
- **Documents:** Job → Documents with KPI tiles (total, awaiting signature, needs action, recently added, storage used), category tabs, list or grid, upload (PDF, photos, Word, Excel, text, CSV up to 25 MB, straight to private storage), preview (PDF and photos in a dialog), download, rename, recategorize, mark awaiting signature, move to another job of the same customer, delete (soft, restorable). Global **Documents** page (`/documents`) with KPIs, category tabs, type filter, title search, linked job or customer, paging. Documents on the customer page.
- **Photos:** Job → Photos with Camera (phone camera) and Upload, category and area tags, filter chips with counts, area filter, required-shot checklist per work type (areas from the accepted estimate), before/after compare slider, select → share with the customer (simulated) or download a zip, edit and delete, and a summary panel (total, today, this week, waiting to upload, shared). Photos are shrunk in the browser and re-encoded on the server with a thumbnail; GPS and every other EXIF field are removed and originals aren't kept.
- **Works offline:** photos taken without signal wait on the device (IndexedDB) and upload when the connection is back, without duplicates. "Offline ready · Last synced …" on the job header. Installable app (manifest, service worker, offline page). **Camera** page (`/field/camera`) for crews: pick a job, photo type and area, shoot.
- **Attention and health:** "Onboarding stalled" names the open items and holds (and stays quiet once everything is cleared); job health's onboarding and photo checks are real.
- Timeline entries for document uploads/deletes and photos added, deleted or shared. Deleted Records lists jobs, documents and photos.

### Changed

- The onboarding gate no longer needs an owner override when the checklist is cleared.
- Job messages remember the template they came from (`messages.template_key`).
- Document previews may be framed by the app's own pages; everything else still can't be framed.

### Tests

- SQL/RLS: 508 assertions across 12 files (Phase 5 adds 56: manual clears and their guard, check results never overwriting a manual clear, Deposit Hold release, the gate with and without holds, document uploads, links, signed-document protection, soft delete and restore, photo upload/visibility per role, idempotent client ids, file-path checks, cross-company isolation).
- Unit: 932 tests (Phase 5 adds 66: onboarding rules and checklist, board lanes/moves/filters, photos and documents helpers, offline queue, EXIF stripping, zip writer, registry metrics, gates, health, attention).
- E2E + axe on a production build (desktop and mobile): onboarding checks → board refusal → clearing items → Ready to Schedule; documents section and page; photos upload, checklist, compare, share, zip; **offline capture syncs after reconnect** (`context.setOffline`) on desktop and phone; Camera page. Screenshots in `docs/screens/phase-5/`.

## Phase 4 — Estimating

### Added

- **Pricing engine** (`lib/domain/estimating`, 100% covered): production-rate lines (labor from units per hour × height × access × coats, prep, lead-safe time; paint from coverage × coats + waste, rounded to quarts / gallons / 5-gallon pails), flat lines, credits, margin pricing (cost ÷ (1 − margin)), job minimum, discounts, tax, deposit, RRP supplies, options and add-ons, change orders, effective-discount check, proposal snapshot, paint order, work orders, color schedule and onboarding requirements from the accepted scope.
- **Estimate Builder** (Job → Estimate & Scope → builder), tablet-first: versions, Good/Better/Best options (duplicate, recommend), areas (copy to another option), lines from the price book or custom, a line editor with a measurement helper (room walls/ceiling/baseboard, exterior wall with gable factor, fence), optional add-ons, live customer total and deposit, an internal margin panel (cost, gross margin vs floor, labor hours, crew days, gallons by product), discount with approval request, notes, preview PDF, Send for signature (text/email, simulated) and New version.
- **Customer proposal page** `/p/[token]` (no login, mobile-first cream/forest): options, add-on switches that update the total live, scope by area, what's included, guarantees, lead-safe disclosure, terms, Accept & Sign (typed name + drawn signature, consent, time, IP, device), decline, viewed tracking, rate limits, signed-copy download. Same page for change orders.
- **On acceptance:** one database transaction records the signature and drafts the deposit invoice, a Deposit Hold, the onboarding checklist, a paint order, work orders by phase and the color schedule; then the signed proposal + contract PDF is stored privately and the job moves Estimate Sent → Sold → Onboarding through the gates. Retried by the worker if anything fails.
- **Change orders:** priced with the same engine (credits allowed), sent and signed on the proposal page; signing updates the contract amount and drafts a change-order invoice. Crew leads can report a scope change from the field for the office to price.
- **Job → Estimate & Scope:** estimates and versions, color schedule (edit, confirm, color-sheet PDF), change orders, signed documents. **Job → Onboarding** shows the requirement checklist and progress. **Job → Financial** lists invoices with PDFs.
- **PDFs:** proposal / signed contract, change order, color sheet, invoice.
- **Price Book** (`/price-book`): price books, catalog by family with search and an item editor; **Paint catalog**; **Production rates** by surface × method × condition. Sample rows are badged until saved.
- **Admin → Estimate Setup:** labor rate, sundries, waste, margin target and floor, minimum job, multipliers, color-change rule, lead-safe labor and RRP supplies, crew and measuring defaults, discount limits by role, sales tax; "What's included" per work type; guarantees and lead-safe disclosure. **Admin → Agreement Templates:** edit wording and conditional clauses, publish with validation (no unfilled slots, required merge fields, owner confirmation).
- **Estimates** list (`/estimates`) with status tabs and KPIs from the registry: estimates sent, 24h SLA %, close rate (count and $), average job value, open estimates.
- **Attention rules:** estimate SLA now uses the real send time; new "Estimate awaiting reply" (3 days) and "Expiring estimate" (5 days) rules. **Job health:** the contract-signed check is real.
- New permissions `catalog:manage` and `change_orders:draft`; discount approvals in Jobs → Approvals.
- Seed (configuration, all sample-flagged): default price book with 45 items, 10 sample paint products, 360 sample production rates, pricing settings, exterior "What's included" from the website (others draft), guarantees, 4 draft agreement templates, private `documents` bucket.

### Changed

- The contract amount on dashboards, lists and job health is the accepted estimate plus signed change orders (the Admin baseline only when nothing is accepted).
- Build Estimate and Send for Signature shortcuts open the Estimate & Scope section.
- Leaving a field out of an estimate form no longer clears it; a blank deposit % means the company default.

### Tests

- SQL/RLS: 452 assertions across 11 files (Phase 4 adds 95: catalog and estimate access per role, sent versions frozen, send/accept/decline/expire, signatures, deposit invoice, onboarding, change orders).
- Unit: 866 tests; the estimating engine at 100% statements and branches.
- E2E + axe: estimate build → send → sign on a 390px phone → signed PDF, deposit invoice and onboarding; change order signed and contract updated; phone builder; Price Book, paint catalog, production rates, Estimate Setup, Agreement Templates, Estimates list; estimator permissions. Screenshots in `docs/screens/phase-4/`.

## Phase 3 — Jobs core

### Added

- **Convert lead → job:** one database transaction that finds or creates the contact (by mobile, phone or email), account and property (street + ZIP), names the job "Lastname – City – Work types", and moves the lead's notes, comments, tasks and walkthrough to the job. From Lead Detail ("Convert to job"), the New Lead wizard ("Save & Convert"), or automatically when a walkthrough is booked (Company Settings switch).
- **Stage engine:** `advanceJobStage()` is the only way a stage changes, and the database enforces it. One step forward when the gate passes; skipping, going back, reopening or passing a closed gate needs an owner override with a reason (10+ characters). Closed Lost needs a lost reason. Blocking holds (HOA, color, permit…) stop scheduling even with an override. Every change writes stage history, activity, an audit entry and an event, and stamps the milestone date. Non-owners can request an override; it lands in **Approvals**.
- **Jobs Dashboard** (`/jobs`): pipeline value, open, in progress, closed won, revenue and performance (sold value, average job size, win rate, closing this month), daily sold chart, pipeline snapshot by stage, recent jobs, pipeline health. All from the metrics registry with "View data" tables.
- **Job List** (`/jobs/list`): the shared list framework with tabs, stage chips, search, filters, saved views, columns, bulk actions, table or cards (cards by default on phones).
- **Job Detail** (`/jobs/[id]`): header with stage, holds, priority and health; Call / Text / Email (simulated); 16 sections. Overview (customer, money, milestones stepper, stage actions), Admin (milestone dates, contract baseline, on-time status, stage history, delete), Notes with @mentions, Activity, Customer, Messages, Tasks and Schedule (appointments) work now; the rest say which phase brings them.
- **Holds, team and appointments:** place and release holds, job team roles, book appointments (walkthrough, color consultation, final walkthrough, touch-up, warranty visit) in Pacific time and completion results.
- **Job health** score (0–100) with its factors, refreshed by the worker; checks for later modules never lower it.
- **Attention Center** (`/attention`): items open on their own (untouched new lead, aging lead, unconfirmed walkthrough, estimate SLA, approval waiting, sold with no deposit, onboarding stalled, ready not scheduled, start date missed), escalate, and close on their own when fixed. Assign, start, snooze, resolve, filters, Prioritize sort, nav badge. **Admin → Attention Rules** turns rules on or off and sets thresholds.
- **Background worker** (`/api/cron/worker`, every minute via Vercel Cron, needs `CRON_SECRET`): processes events, notifies job teams and owners, auto-closes Paid in Full jobs after 3 days, refreshes health, runs the attention sweep.
- **New Job** (`/jobs/new`) from an existing customer; "New job" button on accounts. Jobs in universal search, recent records and Deleted Records.

### Changed

- Booking a walkthrough on a lead now creates a real appointment.
- Deleting your own note or comment works again (it was blocked by row security).
- Attention, Approvals and Jobs counts are registry metrics.
- Admin: Notification Settings moves to Phase 8, Job Recovery to Phase 10.

### Tests

- SQL/RLS: 357 assertions across 10 files (Phase 3 adds 75: stage rules and overrides, holds, history order, conversion, approvals, attention items, job visibility per role).
- Unit: 764 tests (gates, health, attention rules and sync plan, metrics, list module, section helpers, snooze times).
- E2E + axe on a production build (desktop and mobile): Jobs Dashboard, Job List, Job Detail and sections, New Job, Approvals, lead conversion, Attention Center, Admin Attention Rules, plus every earlier spec.

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
