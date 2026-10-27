# Changelog

All notable changes, by build phase. See `docs/PLAN.md` for what each phase covers.

## Phase 10 — Hardening & launch prep

### Added

- **Module Manager** (Admin): custom fields for leads, jobs, accounts and contacts (all SPEC §5.9 types) shown on the record's "More fields" card and as list columns and filters; page layouts (section order and visibility); validation rules (required, pattern, min/max, length) enforced by the database on save.
- **Data Import**: CSV → column mapping → review queue (errors, possible duplicates with skip / update / create) → apply (rows with errors stay listed with the reason); consent is never imported.
- **Bulk Update**: from a list selection ("Bulk update…") or a CSV; preview with before/after per record → apply → revert (records changed since are reported as conflicts).
- **Merge Customers**: compare two accounts or contacts, pick values per field, merge (every jobs/messages/documents reference moves), **Undo**.
- **Export Controls**: list exports on/off per role (Data export pack), Export CSV on the Lead and Job lists (current filter and columns) and the Audit Log, all logged in the export log.
- **Job Recovery** (owners): jobs whose stage and records disagree, missing milestones, unusually long stays, each with a reasoned owner fix.
- **Help Center**: categories, 10 starter articles, full-text search, article pages, Help → Manage (`help:manage`), Release Notes from this changelog; the floating Help panel searches it. The Help button no longer covers content on phones or the last item of the job rail.
- **Commissions** (off by default): settings, plans per role or person, the engine (company vs self-generated leads, overhead, eligibility at paid in full, review threshold, frozen once approved), a simulator, and **My commissions** on My Numbers.
- **Demo data**: `DEMO_DATA=true pnpm seed:demo` — ~300 leads and 120 jobs over every stage and work type in the five cities, estimates with two options and add-ons, invoices and payments (some overdue), daily logs, three crews (two employee, one subcontractor), every hold type, rain delays and the attention items they cause; all tagged `is_demo`; guarded to local Supabase; Admin → Demo Data purge (also removes demo photo files).
- **Settings**: density preference (comfortable / compact) and an Integrations tab.
- **Security**: nonce-based Content-Security-Policy on every page; Secure + SameSite session cookies; rate limits on the unsubscribe page and review links (intake, proposal and inbound already had them); gate/lockbox codes revealable by the crew scheduled at the property today (logged); tighter PII masking in logs.

### Changed

- Website leads get their text-back right after the form is submitted (the intake route runs the lead's own events instead of waiting for the next worker minute).
- Every leftover "arrives in Phase N" placeholder is gone (stage gates, health checks, onboarding, empty sections, nav placeholders, Setup cards, disabled Export buttons).
- The estimate's Discount, deposit & notes form keeps unsaved typing when another change refreshes the page.
- The demo purge takes contacts of demo accounts with it and unlinks (doesn't block on) real leads that point at a demo customer.
- `pnpm build` / `pnpm typecheck` run TypeScript with a larger heap.
- Brand fonts load through `next/font` (no text reflow on phones); fixed sideways scrolling on Messages (phone), Schedule Admin (phone), the Invoices tabs and the Onboarding Board KPIs; the Master Schedule calendar is keyboard-scrollable; the Schedule job dialog keeps its fields after saving.
- Merged from `main`: email + password sign-in and Change password (Settings → Security). Owner two-step sign-in is off in production at the owners' request (data setting; see DECISIONS).

### Tests

- SQL/RLS: 1,027 assertions across 17 files (Phase 10 adds 109 in `016_hardening.test.sql`: custom fields and validation rules, imports, bulk update apply/revert/conflicts, merge and undo, export log kinds, Help Center rows, commissions (off by default, own vs all, frozen entries), demo counts, purge (real records untouched) and stage backdating, gate codes for the crew on site today, Job Recovery facts, row security per role and across companies; migrations applied, rolled back and re-applied).
- Unit: 1,388 tests across 99 files (Phase 10 adds custom fields, bulk planning and CSV, imports, merge, commissions engine and simulator, job recovery, Help markdown and release notes, CSP builder, PII masking, the demo plan and its guard).
- E2E + axe on a production build (desktop and phone, one worker, per spec file): 376 passed, 153 skipped (role- or device-specific), 0 failed. New: `golden-path.spec.ts` (SPEC §19, website form → Closed Won), `edge-cases.spec.ts` (missed-start credit, pre-1978 renovator rule, out-of-area, duplicate submission, crew can't see money, View as logged), `hardening.spec.ts` (Module Manager, Import, Bulk Update, Merge, Export, Help, Commissions, Job Recovery, gate code), `a11y.spec.ts` (every nav page and Admin section: no serious/critical axe violations, no sideways scroll). Screenshots in `docs/screens/phase-10/`.
- Lighthouse (local production build, desktop): 99–100 Performance, 100 Accessibility, 100 Best Practices on login, home, lead list, job detail and the proposal page (`docs/PERFORMANCE.md`, with the phone numbers).

## Phase 9 — Analytics & home

### Added

- **Home by role**: owners land on the **Executive Overview** (two KPI rows — pipeline value, projected revenue, estimates sent, close rate, average job value, sales velocity; speed to lead, 24h SLA, daily-update compliance, on-time start, gross margin (owners and the bookkeeper), A/R outstanding — then Pipeline by Stage, Revenue Forecast, Lead Funnel, Exterior Season Backlog, City Performance, Estimator Leaderboard, Lead Source Performance and Mix, and Executive Alerts; a clean empty state while the company has no data); everyone else lands on **My Day** (`/workspace`): greeting, Ready Score with the reasons, today's appointments and jobs, my tasks (overdue / today / upcoming / no date), follow-ups, my Attention items, my pipeline, Team Feed. Settings → Preferences sets the default home.
- **Analytics hub** (`/analytics`): **Ask Brushy Bear** (keyword → registry metric, period and filters; cites the metric ids, says which permission is missing, suggests the closest report; no AI), **Daily Brief** for any day, **My Business – This Month** and **On Pace** against the revenue goal ("No revenue goal configured" until one is set).
- **Dashboards**: six prebuilt (Executive, Sales / Estimator, Production, Marketing & Lead Sources, A/R Aging, Seasonality / Exterior Backlog) with date range and work type / city / owner / source filters in the URL; **custom dashboards** from the KPI and chart catalog, shared with the team or private; **favorites**.
- **Reports**: list with the 10 seeded templates (Sold by month, Leads by source, Estimates sent vs accepted, A/R aging, Jobs missing daily logs, Sold – no deposit, Gross margin by job, Speed to lead, 24h SLA misses, On-time start misses) and saved reports; **builder** over leads, jobs, estimates and invoices (columns, rule filters, group by, totals, chart), Save / Save as / share; Export CSV.
- **Schedules** (`/analytics/schedules`): email a report daily, weekly or monthly to teammates; the worker records each delivery as a simulated email in the outbox (totals, preview, link), once per run, and notes skips.
- **My Numbers** (`/my-numbers`): Leads Issued, Walkthroughs Set / Ran, Estimates Sent, Sold ($ and count), Completed, Invoiced / Paid in full, each on its own date field and clickable to its records; owners pick any rep. Commissions: nothing shown yet.
- **View data + Download CSV on every chart and KPI table** (needs `data:export`, disabled with a reason otherwise; every export logged in `export_log`).
- **Admin → Marketing Spend** (per month and source; cost per lead and CAC) and **Admin → Revenue Goals** (per month).
- **Registry**: every SPEC §12.1 KPI with id, label, description, source RPC, date field, filters, unit, caption template and owner-only flag (`metricSpec()`); new sources `analytics_stats`, `analytics_monthly`, `season_backlog`, `my_numbers`, `workspace_summary`, `daily_brief`.
- **My Projects** empty state with links to today's jobs and the Master Schedule.

### Changed

- `/` no longer shows the placeholder Home; the worker also sweeps report schedules; Admin lists Marketing Spend and Revenue Goals under Finance.
- Download CSV on the Lead and Jobs dashboards' View data is now on for roles with `data:export` (it was disabled until this phase). List and Audit Log exports still wait for Export Controls (Phase 10).
- My Day's count cards are a list of links (valid markup for screen readers); the donut chart is no longer focusable inside its hidden picture.

### Tests

- SQL/RLS: 918 assertions across 16 files (Phase 9 adds 143 in `015_analytics.test.sql`: a deterministic March 2026 fixture checked against every `analytics_stats` value — the same block the unit fixture test reads — plus breakdowns, filters, role-hidden money, cross-company isolation, monthly, season backlog, My Numbers, Daily Brief, My Day, the report views, row security on the new tables, `log_export` and the schedule guard; migrations applied, rolled back and re-applied).
- Unit: 1,300 tests across 90 files (Phase 9 adds the analytics fixture — value and display of every KPI — and the SQL/TS fixture sync, empty-company zeros and "—" with no NaN, permissions and captions, forecast and season, My Numbers, periods and filters, Ask Brushy Bear, Daily Brief, Ready Score, dashboards, report config, templates, grouping and summaries, CSV, schedules and deliveries).
- E2E + axe on a production build (desktop and phone): full suite 306 passed, 135 skipped (role- or device-specific), 0 failed. New `analytics.spec.ts`: the Executive Overview's KPIs and every widget with View data + CSV (logged), every prebuilt dashboard and the Leads/Jobs dashboards, Ask / Daily Brief / On Pace, a report from a template and from the builder with CSV, a schedule delivered once to the outbox by the worker, a custom dashboard, My Numbers, Marketing Spend and Revenue Goals, the estimator's My Day (no Analytics, CSV disabled), the painter on a phone. Screenshots in `docs/screens/phase-9/`.

## Phase 8 — Communication & growth

### Added

- **Workflow engine** (`lib/domain/workflows`, pure; `lib/workflows/engine.ts`): triggers and conditions → ordered actions (send, notify, task, attention, hold, set field, enroll in drip, assign owner, calendar, wait, webhook stub), exit rules, one run per (workflow, event), waits and quiet-hours deferrals resumed by the worker, consent and Do Not Contact on every send, transactional vs marketing from the template, run log with every step, failed runs with Retry, and a **Test** dry run against a real record ("as if it were" any time) that writes nothing.
- **The 17 seeded workflows, all on** (SPEC §11.2): web-lead text-back, walkthrough confirmation and reminders, send-the-estimate task, estimate follow-ups day 2/5/10, welcome after acceptance, deposit and onboarding notices, schedule published (customer + crew + day-before reminder), rain delay, on-time credit for owner approval, daily customer update, final-walkthrough request, final invoice task, overdue reminders, Paid in Full thank-you → review → Bear Champions invite → 1-year check-in, nurture / exterior pre-season drips, subcontractor paperwork. **Admin → Workflows**: list with runs and last run, switch (reason required), steps, "Built in", Test, run log.
- **Messaging & Templates**: 88 SMS and email templates ("Draft – owner to approve") with merge fields and filters, an editor with live preview (sample or a real job/lead), SMS segment counter, field inserter, owner approval, on/off; **Messaging settings** (quiet hours, customer-initiated window, STOP line, email footer, review and referral delays, case SLA).
- **Conversations**: every message belongs to a lead's or job's thread with read/unread; **Messages** inbox (Unread · All · Mine, leads/jobs), reply from the inbox through the lead's or job's rules; unread banner and Mark read on the lead and job; Workflow tag on automatic messages; template picker in the lead and job composers; crews read job messages on `/field/messages`. **Inbound stub** `/api/public/messages/inbound` (HMAC): routes replies to the right conversation, STOP / UNSUBSCRIBE / START / HELP.
- **Warranty & Service cases** (`/cases`): KPIs, filters, new case from a job or customer, SLA in business days, warranty visits as appointments on the job, "We got your request" and visit confirmations, resolve with what was done; Onboarding → Cases tab and Open cases tile; Onboarding Board → Service/Warranty tab and KPI; cases on the Attention Center.
- **Follow-up Lists** (Leads → Follow-up Lists): 8 live call lists with counts and cooldowns; **power dialer** with the script, Call (voice adapter → outbox), Text from a template, dispositions grouped Positive / Negative / Callback / No Contact / Won, callbacks, auto-advance; **Admin → Follow-up Lists & Dispositions**.
- **Campaigns & Drips** (`/campaigns`): audience builder on the list rules (contacts, leads, or customers on jobs), message from a template or your own, pre-send compliance checks, test send to yourself, schedule / send now / pause / resume / cancel, recipients with the reason anyone was left out, replies and conversions; the campaign worker; the two seeded drips with an editor and enrollments; Automations tab.
- **Bear Champions** (`/referrals`): champions with BEAR-XXXX codes and ?ref= links, referrals from the website (automatic) or by hand, derived status, payouts, settings; **Admin → Referral Program**. **Reviews** (`/reviews`): request log, clicks through the tracked `/r/` link, review left and stars.
- **Notifications**: Settings → Notifications (per event in-app / email / text; required alerts stay on) and Admin → Notification Settings (company defaults); a database trigger applies them to every notification.
- **Unsubscribe** page `/u/<token>` (signed; asks before unsubscribing; ends marketing email and drips).
- **Attention rules**: Unread customer message (30 business minutes) and Warranty request (SLA 2 business days).
- **Metrics** (registry, one `communication_stats` call): unread conversations, open / past-SLA / warranty cases and on-time rate, campaigns, sends, delivery and bounce rate, replies, conversions, queue, unsubscribes and STOPs, active drips, review requests / click rate / review rate / reviews / average rating, champions, referrals, closed, conversion, paid out, payable, workflow runs / failed / waiting.

### Changed

- Customer sends that earlier phases made directly now go through their workflows (one source, can be switched off): publish notices, rain-delay text, daily updates, overdue reminders, the on-time credit notice. Crew notices on publish are still related to the crew.
- The onboarding prep check accepts the welcome email; request drafts on the checklist come from the templates.
- Lead texting respects a STOP reply (`leads.sms_opted_out_at`).
- The E2E setup turns quiet hours off for the local test company (tests run at any hour).

### Tests

- SQL/RLS: 775 assertions across 15 files (Phase 8 adds 84 in `014_communication.test.sql`: the seed (17 workflows on, draft templates, lists, dispositions, drips, quiet hours, attention rules) and its idempotency; who may edit and approve templates and switch workflows; one run per (workflow, event) and claiming waiting runs once; threads, unread and who sees conversations (painters none, crew leads their own jobs); cases (first response, resolution, timeline, scope by role); generated champion codes; `?ref=` referrals, self-referral and unknown codes; payouts; campaigns start as drafts and follow the status rules; people can only stop a drip enrollment; `communication_stats`; cross-company isolation; migrations applied, rolled back and re-applied).
- Unit: 1,141 tests across 87 files (Phase 8 adds a dry run for every seeded workflow, quiet hours and consent, the merge-field renderer and template validation, seed-sync, drips, follow-up cooldowns and callbacks, referrals, case SLA in business days, inbound routing and keywords, campaign checks and recipient planning, attention rules and the communication metrics).
- E2E + axe on a production build (desktop and phone): full suite 292 passed, 131 skipped (role- or device-specific), 0 failed. New `communication.spec.ts`: the 17 workflows, a dry run and the switch; a new template previewed, counted and approved; an inbound text → unread conversation → read, STOP and START; composer template picker; a warranty case acknowledged, visit booked and resolved; the power dialer with a callback; **no double sends** (a booked walkthrough confirms once however often the worker runs; publish sends one customer notice; one daily update per log); a campaign built, checked, tested, sent and unsubscribed from; Bear Champions, Reviews and notification settings. Screenshots in `docs/screens/phase-8/`.

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
