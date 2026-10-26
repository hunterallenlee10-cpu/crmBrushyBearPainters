# Brushy Bear CRM: Build Prompt for Claude Code

> **How to use this:** Create an empty repo (e.g. `brushybear-crm`), open Claude Code at the repo root, switch to plan mode, and paste everything below the line. Claude Code should save this whole prompt to `docs/SPEC.md` first, then work through it one phase at a time.

---

## 0. Your role and the mission

You are the lead engineer building **Brushy Bear CRM**, the internal operating system for **Brushy Bear Painters**, a new residential painting company on the Eastside of Seattle, WA. Owners: **Erik** (field operations and estimates) and **Hunter Lee** (marketing, customer experience, estimate requests, scheduling, daily updates).

The functional reference is a mature roofing/exteriors CRM ("the reference CRM") that has been studied screen by screen. Its structure, depth, and UX patterns are described in this spec. **Do not copy its data, names, branding, or insurance-claim workflows.** Rebuild the same caliber of system, translated for a painting company. Every screen, field, stage, automation, and report has to make sense for interior, exterior, cabinet, and deck/fence painting jobs.

**What "done" means:** a production-quality, multi-role CRM on Next.js + Supabase, deployed on Vercel. It runs the whole lifecycle (web lead → text-back → walkthrough → itemized estimate in 24h → signed → deposit → onboarding → scheduled → daily photo updates → final walkthrough → touch-ups → invoice → paid → review → referral). Every outside integration is built behind an adapter and ships **disconnected**, ready to switch on later.

### Step 0 (do this before writing any code)

1. Save this entire prompt verbatim to `docs/SPEC.md`.
2. Create `CLAUDE.md` with the working rules from Section 18 plus the stack, commands, and folder map.
3. Create `docs/DECISIONS.md`. Log every non-obvious decision with date + reason.
4. Show me your phase-by-phase plan (Section 17) and wait for my OK before Phase 1.

---

## 1. The business you are building for

### 1.1 Company facts (use these exactly; placeholders stay as placeholders)

| Item | Value |
|---|---|
| Company | Brushy Bear Painters |
| Tagline | "Eastside house painting that holds up to the rain." |
| Owners | Erik (field ops & estimates), Hunter Lee (marketing & customer experience) |
| Service area | Bellevue, Kirkland, Redmond, Sammamish, Issaquah (WA). "Near one of these cities but not in it? Ask us." |
| Phone / Email / Hours | `[PHONE]` / `[EMAIL]` / `[HOURS]`. These are placeholders on the website too, so store them in Company Settings and never hard-code. |
| Licensing | WA L&I contractor reg. `[LNI_NUMBER]` · UBI `[UBI_NUMBER]` (Company Settings; printed on proposals, contracts, invoices) |
| Website | brushybear.vercel.app (separate repo; Next.js). Estimate form at `/estimate` |
| Time zone | America/Los_Angeles (store UTC, display Pacific) |

### 1.2 Services (these become Work Types)

1. **Interior Painting**: walls, ceilings, trim, doors; protected floors/furniture; right sheen per room. Booked all year.
2. **Exterior Painting**: siding, trim, fascia, soffits, doors, garage doors. Dry season only, roughly **June–September**. Most of the job is prep: wash, treat moss/mildew, scrape/sand, repair rot, caulk, prime, then finish coats. Siding types: cedar/wood, fiber-cement, vinyl, stucco (each needs different prep and product). Typical duration: 1–2 weeks of working days.
3. **Cabinet Painting**: kitchen/bath/built-ins. Doors and drawer fronts removed, degreased, sanded, bonding primer, sprayed enamel. Priced mainly by door/drawer/panel count.
4. **Deck & Fence Staining**: decks, fences, railings, pergolas. Clean, brighten, stain. Dry season.

**Add-ons (optional line items on any job):** pressure washing, wood rot repair, drywall repair, trim & millwork, color consultation.

### 1.3 Brand promises the CRM must enforce and measure

These promises are on the website. The CRM exists to keep them, so each one becomes a tracked SLA, automation, or guarantee:

| Promise (website wording) | What the CRM must do |
|---|---|
| "We'll text you within a few minutes during business hours." | Instant auto-text on web lead (via SMS adapter/outbox), a speed-to-lead timer, an Attention item if untouched after X minutes (configurable, default 10) during business hours, and a "median minutes to first contact" KPI. |
| "Written estimate in 24 hours" after the walkthrough | When a walkthrough is marked complete, start a 24h SLA clock, create a "Send estimate" task due +24h, escalate in Attention at 20h, and show a KPI for "% of estimates sent within 24h". |
| "Add-ons are listed as options, so you pick the scope." | Proposals support optional line items and multiple options; the customer selects them when accepting. |
| "One point of contact" | Every job has exactly one **Point of Contact** (user), shown on the job header and in every customer message signature. Reassignment is logged. |
| "A photo update every day" | Crew-lead **Daily Log** (photos + finished today + next up) auto-generates the customer update. Attention item if no log by 7:00 pm on a scheduled production day. KPI: daily-update compliance %. |
| "A clean house every evening" | Daily Log has a required "Cleanup done" checkbox plus a cleanup photo. |
| "Rain-day promise: … you're first on the schedule when it clears. The delay never costs you anything." | Weather-hold flow for exterior/deck jobs: mark a day "Rain delay", the job gets a **priority reschedule** flag (sorts to the top of the scheduling tray), and rain delays can never create charges. |
| "We start on the scheduled date or take $250 off. Rain delays don't count." | Track **promised start date** vs **actual start date**. If start slips and the reason isn't weather, auto-draft a **$250 "On-Time Guarantee" credit** on the final invoice, pending owner approval. Amount is configurable in Company Settings. |
| "Final walkthrough … fix touch-ups on the spot" | Final Walkthrough appointment + punch-list module. A job can't move to Completed until punch items are resolved or the customer signs off. |
| Homes built before 1978 get lead-safe prep | `year_built` / `pre_1978` on the property. Lead-safe (RRP) requirements are auto-added to onboarding and the estimate (see 13.3). |
| HOAs often require approval for exterior color changes | HOA fields on the property; an "HOA approval" onboarding requirement and hold for exterior jobs. |

### 1.4 Seasonality (bake this into scheduling, nurture, and forecasting)

- Exterior & deck/fence production window: **June 1 – Sept 30** (configurable). Exterior estimates outside that window get a "target season" field and go into a pre-season nurture.
- Interior & cabinets run year-round. The website currently says "Now booking fall interiors and cabinets."
- The forecast should show booked exterior backlog for the coming season.

---

## 2. Tech stack (decided; don't substitute without logging a decision)

- **Framework:** Next.js 15 (App Router, React Server Components, Server Actions, Route Handlers), TypeScript `strict`.
- **Database/Auth/Storage/Realtime:** Supabase (Postgres 15+, Supabase Auth, Storage, Realtime). Schema is managed with **Supabase CLI SQL migrations** (`supabase/migrations`). Generate types with `supabase gen types`. Use `@supabase/ssr` for server/client auth.
- **UI:** Tailwind CSS + shadcn/ui (Radix), lucide-react icons, Recharts for charts, TanStack Table for data grids, react-hook-form + zod for forms, dnd-kit for kanban & schedule drag-and-drop, date-fns + date-fns-tz.
- **PDF:** `@react-pdf/renderer` for proposals, contracts, invoices, color sheets, and daily reports.
- **Background jobs:** a Postgres `events` table (outbox pattern) plus a worker route invoked by **Vercel Cron** (every minute) and/or `pg_cron`. Every handler must be idempotent.
- **PWA/offline:** installable PWA. IndexedDB queue for photos and daily logs taken offline, with an "Offline ready · Last synced hh:mm" indicator on job pages (same pattern as the reference CRM).
- **Testing:** Vitest (unit), Playwright (E2E + screenshots), pgTAP or SQL tests for RLS policies, axe for accessibility.
- **Quality gates:** ESLint, Prettier, `tsc --noEmit`, and tests run in GitHub Actions on every push.
- **Hosting:** Vercel (preview + production). Local dev uses `supabase start`.

### 2.1 Integrations: build ready, connect NOTHING

Every external service sits behind an interface in `lib/integrations/<domain>/` with:

- a TypeScript interface (e.g. `SmsProvider.send()`, `CalendarProvider.upsertEvent()`),
- a default **`outbox` provider** that writes what *would* have been sent to an `integration_outbox` table (provider, payload, rendered body, recipient, related record, status `simulated`) and shows it in the UI as "Simulated – not sent",
- a stub file for each real provider, implemented to the documented API shape and unit-tested against mocked HTTP, but **disabled**,
- an env flag (`INTEGRATION_SMS_PROVIDER=outbox|twilio`, etc.) plus a row in `integration_connections` that has to be `connected` before a real provider is used,
- an **Admin → Integrations** page with cards (name, purpose, status pill `Not connected`, last sync, frequency, "Configure" opens a setup checklist from `docs/INTEGRATIONS.md`). Same card pattern as the reference CRM.

| Domain | Interface | Real provider stubs to scaffold |
|---|---|---|
| SMS & voice | `SmsProvider`, `VoiceProvider` | Twilio |
| Email | `EmailProvider` | Resend, SendGrid |
| Calendar | `CalendarProvider` | Google Calendar |
| Accounting | `AccountingProvider` | QuickBooks Online |
| Payments | `PaymentsProvider` (payment links, webhooks) | Stripe |
| E-signature | `ESignProvider` | built-in "click to sign" (Phase 4) + DocuSign/Dropbox Sign stubs |
| Address & maps | `GeoProvider` (autocomplete, geocode, distance) | Google Places / Mapbox |
| Weather | `WeatherProvider` (hourly forecast, rain probability, dew point) | NOAA/NWS (api.weather.gov), OpenWeather |
| Photos | `PhotoSyncProvider` | CompanyCam |
| Reviews | `ReviewsProvider` | Google Business Profile |
| AI (optional) | `AiProvider` | Anthropic. Used only for the "Ask" box and summaries, and always grounded in computed metrics. |

**Never call a real external API in this build. Never commit secrets.** Ship `.env.example` with every key commented out.

---

## 3. Map from the reference CRM to Brushy Bear

### 3.1 Modules to rebuild (translated)

The reference CRM's top nav is: **Home · Leads ▾ · Jobs ▾ · Support ▾ · Attention · More ▾ · Admin ▾**, plus universal search, an integrations status pill, a softphone button, "View as user", a notifications bell, and a user menu (Workspace, Settings, Sign out). Rebuild that shell. Brushy Bear's nav:

- **Home** (Executive Overview for owners; Workspace for everyone else)
- **Leads ▾**: Lead Dashboard, Lead List, New Lead, + 8 most recent leads
- **Jobs ▾**: Jobs Dashboard, Job List, Approvals (unapproved discounts/estimates), New Job, + 10 most recent jobs (showing job #, city)
- **Schedule ▾**: Production Center, Master Schedule, My Projects (PM portal), Onboarding Board
- **Attention** (badge count)
- **More ▾**: Accounts, Contacts, Estimates, Invoices, Campaigns, Documents, Price Book, Analytics, My Numbers, Referrals, Reviews, Help
- **Admin ▾** (permission-gated): Setup, Users, Roles & Permissions, Workflows, Templates, Integrations, Audit Log, Deleted Records

### 3.2 Translation table (roofing/insurance → painting)

| Reference CRM concept | Brushy Bear equivalent |
|---|---|
| Inspection appointment | **Walkthrough** (estimate visit: measure, check repairs, talk colors) |
| Prep Specs (scope/spec builder that seeds onboarding, material & labor orders) | **Estimate & Scope Builder** (areas → surfaces → line items; seeds color sheet, paint order, crew work order, onboarding requirements) |
| Claim Filed / Adjuster Meeting / Approved | *(drop)* → replaced by **Estimate Sent → Accepted** |
| Contract Signed (Sold) | **Sold** (proposal accepted + contract signed) |
| Money Hold (deposit gate) | **Deposit Hold** |
| Permit / HOA hold, Solar DNR hold | **HOA Hold**, **Lead-Safe Hold**, **Weather Hold**, **Customer Hold**, **Color Hold**, **Repair Approval Hold** |
| Install Ready | **Ready to Schedule** |
| Materials Delivered (shingles from supplier) | **Paint & Materials Ready** (paint store order picked up/delivered) |
| Job Started / In Production | **In Progress** |
| Additional Trades | **Add-on Work** (rot repair, drywall, pressure washing) |
| Installed → Invoiced → Completed | **Final Walkthrough → Touch-ups → Completed → Invoiced → Paid in Full** |
| Crew / Subcontractor / Contractor queue | **Crews** (employee crews and subcontract crews) |
| Supplier queue / Order Manager (roofing supply houses) | **Paint Orders** (Sherwin-Williams, Benjamin Moore, Miller Paint, etc. as configurable suppliers) |
| Built-in e-sign agreement module | **BearSign** (built-in proposal acceptance + e-sign adapter) |
| Shingle catalog, comp codes | **Paint catalog** (brand, product line, sheen, coverage, cost) and **production rates** |
| Business Development rep / Self-gen | **Lead Source / Sub-source** and **Lead Set By** (marketing vs. owner vs. referral) |
| Call Center call lists | **Follow-up Lists** (dynamic: Hot new leads, Confirm tomorrow's walkthroughs, Estimates awaiting reply, Just-planning nurture, Pre-season exterior, Past customers) |
| Champions referral program | **Bear Champions** referral program (past customers) |

### 3.3 Do NOT build (reference-CRM features that don't apply)

Insurance claims, adjusters, claim numbers, RCV/ACV, deductibles, depreciation, supplements, date of loss, public-adjuster partners, roofing trades (shingles, flat roof, skylights, gutters, solar, line drops), door-knocking app sync, legacy Salesforce migration tooling, internal IT support desk / system status page, developer deployment permissions, "training bot analytics".

### 3.4 Lessons from the reference CRM (avoid these problems)

While reviewing it, these data-quality problems were visible. Design them out from day one:

- **Unnormalized picklists:** territory/state values like "MD", "Maryland", "Md". → Use FK-backed lookup tables and enums; normalize on input; add DB `CHECK` constraints.
- **Duplicate/ambiguous stage names** ("Scheduled" used for both inspection and install). → Every stage name is unique and self-describing.
- **Money that doesn't reconcile** (contract vs billed vs collected vs payments "linked, not applied"). → One ledger (Section 10). Balances are always *derived* from the ledger, never stored as free-typed numbers.
- **KPIs that show impossible values** (e.g. "Closed rate 0.0%" while sold jobs exist, "↑190000% vs yesterday"). → Every KPI is defined once in a metrics registry (Section 12.1) with a unit test, and every card shows its formula caption.
- **Thousands of stale/aging records** with nothing driving action. → The Attention engine (Section 9) and nurture drips own every stale record.

---

## 4. Users, roles, and permissions

### 4.1 Roles (seeded as Role Templates)

| Template | Who | Can see / do |
|---|---|---|
| **Owner** | Erik, Hunter | Everything, including financials, margins, settings, permissions, and "View as user". |
| **Office Manager** | future hire | All leads/jobs/schedule/invoices/payments; no permission editing; no margin settings. |
| **Estimator / Sales** | Erik now, future reps | Own + assigned leads/jobs; build/send estimates; discounts up to their approval limit; their own My Numbers & commissions. |
| **Project Manager / Crew Lead** | field leads | Assigned jobs (scheduled → completed): scope, color sheet, photos, daily logs, punch list, work orders, materials. **No contract $ or margins.** Customer contact info only for their active jobs. |
| **Painter (Crew Member)** | crew | Mobile view of today's jobs: address, access notes, scope, color sheet, photos upload, clock hours. Nothing financial. |
| **Subcontractor** | partner crews | Like Painter, limited to jobs/work orders assigned to their company, plus their compliance docs. |
| **Bookkeeper** | accountant | Invoices, payments, AR, job costing, exports. Read-only on everything else. |
| **Read-only** | advisors | Read dashboards and records; no PII exports. |

### 4.2 Permission engine (mirror the reference CRM's design)

- **Permission packs** are the building blocks. Each pack = a set of *pages* + *resource actions* (`leads:read|create|update|delete|export|assign`, `jobs:advance_stage`, `estimates:approve_discount`, `invoices:edit`, `payments:record`, `reports:build`, `data:export`, `users:manage`, `roles:manage`, `workflows:manage`, `templates:manage`, `job_admin:override`, `records:restore`, `records:merge`, `bulk:update`, …). Group packs by category: Core Records, Sales, Production, Finance, Data & Reporting, Operational Control, HR & Sensitive.
- **Role templates** compose packs. **Users** get one template plus optional per-user grants/revokes ("security profile").
- **Record scope** per resource: `own`, `team`, `all`.
- **Field-level masking:** contract amounts, margins, costs, and payment info are hidden from Crew Lead / Painter / Subcontractor (enforced in RLS views, not just the UI).
- **Enforcement lives in Postgres RLS** plus server-side checks in every Server Action. The UI only hides what the server already denies.
- **"View as user"** (owners only): read-only impersonation that renders the app with that user's permissions, has a visible banner, and is audit-logged.
- Seed packs/templates in a migration. Admin UI tabs: Overview (users per template), Templates, Packs, Users.

### 4.3 Auth

Supabase Auth with Google OAuth + email magic link. TOTP MFA required for Owner and Bookkeeper. Invite-only (no public signup). Deactivating a user is a soft delete: their records stay and get reassigned via a guided "reassign open work" dialog.

---

## 5. Data model

General rules:
- Every table has `id uuid pk default gen_random_uuid()`, `org_id uuid not null` (multi-tenant ready, since Lee Enterprises may reuse this for other contractors), `created_at`, `updated_at`, `created_by`, `updated_by`, and `deleted_at` (soft delete) where the record is user-facing.
- Money is `bigint` **cents**. Quantities use `numeric(12,2)`. Rates use `numeric(12,4)`.
- Enums are Postgres enums or lookup tables (use lookup tables for anything admins can edit via Field Picklists).
- Human-friendly numbers: Job `BB-2026-0001`, Estimate `EST-2026-0001`, Invoice `INV-2026-0001`, Payment `PMT-2026-0001`, Work Order `WO-2026-0001`, Change Order `CO-2026-0001`. Use per-year sequences.
- `audit_log` captures every insert/update/delete on business tables via trigger (table, record_id, actor, action, before jsonb, after jsonb, at, ip, user_agent, impersonated_by).
- `activity` is the human-readable timeline (separate from the audit log).
- Indexes on every FK, status/stage, owner, dates used in filters, plus trigram indexes for search (name, phone, email, address).

### 5.1 Core entities

**organizations, users/profiles** (name, email, phone, title, department, avatar, role_template_id, is_active, signature, default_territory_id, hourly_cost_cents for job costing, color for calendar)

**territories:** Bellevue, Kirkland, Redmond, Sammamish, Issaquah, plus "Outside service area". Each has `zip_codes text[]`, operating-hours calendar, and an `active` flag. Seed ZIPs (verify): Bellevue 98004–98008; Kirkland 98033, 98034; Redmond 98052, 98053; Sammamish 98074, 98075; Issaquah 98027, 98029. A lead whose ZIP isn't in any territory gets flagged **Out of area** (not rejected).

**accounts** (the household/customer): type `residential | property_manager | hoa | commercial`, display name ("Smith Residence"), status `prospect | active_customer | past_customer | inactive`, lifetime value (derived), primary contact, referral champion flag, tags, notes.

**contacts:** first/last, role on account (`primary`, `spouse/partner`, `property_manager`, `tenant`, `billing`, `other`), mobile, phone, email, preferred channel, **consent** (`sms_opt_in`, `sms_opt_in_at`, `sms_opt_in_source`, `email_opt_in`, `opted_out_at`, `do_not_contact`), language, notes.

**properties** (an account can have several): address fields (street, unit, city, state `WA` default, zip), lat/lng, territory_id, **year_built**, **pre_1978** (generated: `year_built < 1978` or "not sure" → treat as needs testing), home type (single-family, townhome, condo, multi-family), stories (1/2/3+), approx sq ft, **siding_type** (cedar/wood, fiber-cement, vinyl, stucco, brick, mixed, other), **HOA** (has_hoa, hoa_name, hoa_contact, color-approval required), access notes, gate/lockbox code (**encrypted**, visible only to assigned users on scheduled days), pets, parking, alarm, occupancy (occupied/vacant/tenant-occupied), water/power access for washing, photos.

### 5.2 Leads

`leads`: first/last, company (optional), phone, mobile, email, property address (or ZIP only), `services[]` (interior, exterior, cabinets, deck_fence, other), `timeline` (asap, 1_3_months, 3_plus_months, just_planning), `home_built` (before_1978, 1978_or_later, not_sure), notes from customer, **status** (`new`, `contacted`, `walkthrough_scheduled`, `nurture`, `unqualified`, `converted`, `lost`), **disposition** (picklist: `walkthrough_scheduled`, `call_back`, `no_answer`, `left_voicemail`, `texted_no_reply`, `not_interested`, `out_of_area`, `just_planning`, `price_shopping`, `diy`, `hired_someone_else`, `wrong_number`, `do_not_contact`), **lead_source** + **sub_source** (picklists, Section 15.1), `lead_set_by` (user), owner_id, point_of_contact_id, score (0–100) + grade (A–F) + temperature (Hot/Warm/Cold) + `score_factors jsonb`, utm_* fields, landing_page, referrer, referral_code, first_contacted_at, **speed_to_lead_seconds**, last_activity_at, tentative walkthrough date/time, converted_job_id, lost_reason.

`lead_attachments` (photos uploaded on the website form).

### 5.3 Jobs (the opportunity; the heart of the system)

`jobs`: job_number, name (default "Lastname – City – Services"), account_id, property_id, primary_contact_id, `work_types[]` (interior, exterior, cabinets, deck_fence, add_on_only), **stage** (Section 6.2), stage_entered_at, **status** (`open`, `on_hold`, `won`, `lost`), lost_reason, priority (`normal`, `high`, `urgent`) + priority_reason, owner_id (estimator/sales), **point_of_contact_id**, project_manager_id (crew lead), crew_id, lead_source/sub_source (copied from lead), territory_id, **target_season** (for exteriors sold off-season), **promised_start_date**, actual_start_date, estimated_duration_days, estimated_completion_date, accepted_estimate_id, contract_amount_cents (derived from accepted estimate + approved change orders), health_score (0–100) + health_factors jsonb, `holds` (child table), tags, internal_team (child table of user+role), **milestone timestamps** (see 6.3), `is_priority_reschedule` (rain-day promise), `on_time_guarantee_status` (`n/a`, `met`, `missed_weather`, `missed_credit_pending`, `credit_applied`, `waived_by_owner`).

`job_holds`: type (`deposit`, `hoa`, `lead_safe`, `weather`, `customer`, `color`, `repair_approval`, `materials`, `other`), reason, placed_by, placed_at, released_by, released_at, blocks_scheduling bool.

`job_team`: user_id, role (`estimator`, `point_of_contact`, `project_manager`, `office`, `painter`), added_at.

### 5.4 Scheduling & field

`appointments`: job_id or lead_id, type (scheduling Work Types, Section 15.1), start/end, all_day, assigned users / crew, status (`tentative`, `scheduled`, `confirmed`, `in_progress`, `completed`, `no_show`, `rescheduled`, `canceled`), result (for walkthroughs: `measured`, `needs_second_visit`, `customer_no_show`, `not_a_fit`), location, notes, external_calendar_event_id, reminder flags.

`crews` (name, type `employee | subcontractor`, lead_user_id, color, home_territory, active), `crew_members`, `subcontractors` (company, contact, **WA L&I registration #**, registration expiry, **COI** insurance expiry, W-9 on file, bond, RRP certification, status `active | expiring | suspended`, documents), `skills` (interior, exterior high-access 2-story+, spray finish/cabinets, lead-safe RRP certified renovator, staining, carpentry/rot repair, drywall, pressure washing), `crew_skills`, `crew_availability` (time off, blackout dates), daily capacity.

`work_orders`: job_id, crew_id, phase (`prep`, `repair`, `paint`, `cabinet_shop`, `stain`, `touch_up`, `warranty`), scope summary (auto-built from estimate line items), status (`new`, `scheduled`, `in_progress`, `pending_approval`, `completed`, `canceled`), scheduled dates, budgeted hours, actual hours, sub PO amount (for subcontractor work orders), checklist_instance_id.

`daily_logs`: job_id, work_order_id, date, author (crew lead), **finished_today** (text), **next_up** (text), issues/blockers, weather observed, hours per crew member (child table → job costing), **cleanup_done** (required bool) + cleanup photo, photos[], customer_update_status (`draft`, `queued`, `sent`, `simulated`), sent_at.

`time_entries`: user_id, job_id, work_order_id, date, start/end or hours, type (`production`, `travel`, `shop`), approved_by.

`punch_items`: job_id, area, description, photo, assigned_to, status (`open`, `fixed`, `customer_waived`), fixed_photo, fixed_at.

### 5.5 Estimating & catalog (detailed in Section 7)

`price_books` (name, active, effective dates, version), `catalog_items` (type `labor | material | add_on | package | fee | discount`, family, code, name, unit `sqft | lf | each | hour | room | door | drawer | gallon | lump`, unit_price_cents, unit_cost_cents, taxable, active), `paint_products` (brand, line, product, interior/exterior/both, base, available sheens, coverage_sqft_per_gal, cost_per_gal_cents, price_per_gal_cents, VOC, dry/recoat times, min application temp °F, notes), `production_rates` (surface, method `brush_roll | spray | mixed`, condition `good | fair | poor`, units_per_labor_hour, prep_hours_per_unit, notes, is_sample), `estimate_settings` (loaded labor rate, sundries %, waste %, default markup/margin target, minimum job charge, height multipliers, deposit %, estimate expiry days, tax config).

`estimates`, `estimate_options`, `estimate_areas`, `estimate_line_items`, `estimate_versions`, `color_selections` (area, surface, brand, color name, color code, sheen, product, finish notes), `change_orders` (number, reason, line items, amount, status `draft | sent | signed | declined`, signed_at).

### 5.6 Money

`invoices` (number, job_id, type `deposit | progress | final | change_order | credit_memo`, status `draft | sent | viewed | partially_paid | paid | void | overdue`, issue/due dates, terms, line items, subtotal, tax, total, accounting_sync_status `not_connected | pending | synced | error`, external ids), `invoice_lines`, `payments` (number, method `check | cash | card | ach | zelle | financing | other`, amount, received_at, reference/check #, status `received | cleared | bounced | refunded`, deposited_at, external ids), `payment_applications` (payment → invoice, amount), `credits` (type `on_time_guarantee | goodwill | discount | referral`, amount, approved_by), `refunds`.

**Ledger rule:** the job's Contract, Billed, Collected, Balance, and Left-to-Bill are views computed from accepted estimate + signed change orders + invoices + applied payments + credits. No editable "amount collected" field exists anywhere.

`job_costs` (view + manual entries): labor (time entries × user hourly cost), materials (paint orders), subcontractor POs, other expenses (receipts with photo) → **gross profit and gross margin %** per job (owners & bookkeeper only).

### 5.7 Communication & collaboration

`messages` (channel `sms | email | call | voicemail | portal`, direction, from/to, body, attachments, thread_id, related lead/job/contact, provider status, `simulated` flag), `message_threads`, `templates` (channel, name, category, subject, body with merge fields like `{{contact.first_name}}`, `{{job.point_of_contact.first_name}}`, `{{company.phone}}`, `{{appointment.start | date}}`, `{{estimate.link}}`, active), `notes` (pinned, priority `normal | high | urgent`), `comments` (internal, category `general | sales | production | office | finance`, @mentions → notifications), `tasks` (title, due, assignee, related record, status, priority, created_by_workflow), `checklist_templates` + `checklist_instances` + `checklist_items`, `notifications` (user, type, title, link, read_at), `attention_items` (Section 9), `cases` (customer issues & **warranty requests**: type, priority, SLA due, status, resolution), `activity` (timeline entries with type, actor, summary, payload, related records).

### 5.8 Marketing & growth

`campaigns` (email/sms, audience query, status `draft | scheduled | sending | paused | sent`, metrics), `drips` (sequence steps with delays and exit conditions), `campaign_recipients`, `referral_champions` (contact, code like `BEAR-XXXX`, status, earnings), `referrals` (champion, referred lead, status, reward amount, paid_at), `review_requests` (job, sent_at, channel, clicked_at, review_left bool, rating if known).

### 5.9 Platform

`picklists` + `picklist_values` (admin-editable, ordered, active flag, color), `custom_field_definitions` (module, label, api_name, type `text | long_text | number | currency | date | datetime | checkbox | picklist | multi_picklist | user | url`, required, help text) + `custom_field_values` jsonb on each module, `saved_views` (user, module, filters, columns, sort, shared), `reports`, `dashboards`, `report_schedules`, `workflows` + `workflow_runs`, `events` (outbox for the workflow engine), `integration_connections`, `integration_outbox`, `company_settings`, `audit_log`, `imports` (CSV import jobs with mapping & review queue), `bulk_updates` (audited, reversible), `merges` (reversible record merges), `kb_articles` (help center).

---

## 6. Pipelines, stages, gates, and health

### 6.1 Lead pipeline

`New → Contacted → Walkthrough Scheduled → Converted` with side exits `Nurture`, `Unqualified`, `Lost`.

- **New:** created by web form, manual entry, import, or referral link. Speed-to-lead clock starts.
- **Contacted:** first outbound call/text/email logged (manual or the auto-text counts as an *acknowledgement*, not a contact; a human touch is required to move to Contacted).
- **Walkthrough Scheduled:** walkthrough appointment exists. **Convert to Job** happens here, either automatically when the walkthrough is booked (setting, default ON) or manually.
- **Nurture:** "just planning" / exterior off-season / not ready → enrolled in a drip with a re-contact date.
- Converting creates or links the Account, Contact, and Property (dedupe first), creates the Job at stage `Walkthrough Scheduled`, moves files and notes over, and keeps a link back to the lead.

### 6.2 Job stages (unique names; ordered)

| # | Stage | Enters when | Exit gate (must be true to advance) |
|---|---|---|---|
| 1 | **Walkthrough Scheduled** | lead converted / job created with appt | walkthrough appointment marked Completed with result `measured` |
| 2 | **Walkthrough Complete** | walkthrough result = measured | estimate sent (24h SLA clock running) |
| 3 | **Estimate Sent** | an estimate version is sent | accepted (→ Sold) or declined/expired (→ Closed Lost or back to Nurture) |
| 4 | **Sold** | estimate accepted + contract signed | deposit invoice created (automatic) |
| 5 | **Onboarding** | Sold + deposit invoice exists | every *required* onboarding item cleared (6.4) and no blocking holds |
| 6 | **Ready to Schedule** | onboarding cleared | production dates published on Master Schedule |
| 7 | **Scheduled** | dates published + customer notified | paint/materials ready **and** start day arrives |
| 8 | **In Progress** | first production day started (crew lead taps "Start job", or first daily log) | all work orders complete |
| 9 | **Final Walkthrough** | work orders complete | punch list empty or customer sign-off |
| 10 | **Completed** | final walkthrough signed off | final invoice sent |
| 11 | **Invoiced** | final invoice sent | balance = 0 |
| 12 | **Paid in Full** | balance = 0 | auto-close after 3 days (review & referral asks fire) |
| — | **Closed Won** / **Closed Lost** | terminal | Closed Lost requires `lost_reason` (picklist: price, timing, chose competitor, DIY, no response, out of area, scope not a fit, other) |

- Stage changes go through one server function `advanceJobStage(jobId, toStage, {override?})`. It checks gates, writes `stage_history`, emits `job.stage_changed`, and is the only code path that changes stage.
- Owners can **override** a gate with a required reason (audit-logged). That mirrors the reference CRM's "Admin: force into onboarding" / "manually set sold".
- **Holds** don't change stage. They overlay it ("Onboarding · HOA Hold") and block "Ready to Schedule" / scheduling if `blocks_scheduling`.

### 6.3 Milestone timestamps (on `jobs`, editable only in the Job Admin tab with audit)

lead_created_at, first_contact_at, walkthrough_scheduled_at, walkthrough_completed_at, estimate_sent_at, estimate_accepted_at, contract_signed_at, deposit_paid_at, onboarding_started_at, onboarding_completed_at, ready_to_schedule_at, scheduled_at, promised_start_date, actual_start_date, work_completed_at, final_walkthrough_at, completed_at, final_invoiced_at, paid_in_full_at, closed_at, lost_at.

The **Milestones stepper** on the job page shows the six big steps from the reference CRM, renamed: **Lead → Estimate → Sold → In Progress → Completed → Closed**. Each step has a date, the current step is highlighted, and a "Next: …" hint plus an "Advance to …" button sit beside it, enabled only when the gate passes.

### 6.4 Onboarding requirements (seeded by the accepted estimate, like the reference CRM's Prep Specs)

Each requirement has: group, label, required?, owner role, status (`verified`, `pending`, `missing`, `needs_review`, `not_required`), **auto-verify rule** (checks the record, its documents, photos, and payments), and actions (Request from customer, Upload, Create task, Mark cleared with note).

| Group | Requirement | Required when | Auto-verify |
|---|---|---|---|
| Contract & Agreement | Signed contract/proposal on file | always | signed doc exists |
| | Change orders resolved | if any CO pending | no CO in `sent` |
| Money | Deposit received | always (deposit % from settings; default 30%, configurable) | deposit invoice paid ≥ required amount |
| Customer & Access | Primary contact reachable (mobile + email) | always | both present & valid |
| | Access, pets, parking, occupancy confirmed | always | property fields filled |
| Colors & Products | Color selected for every area/surface in scope | always | `color_selections` complete for all line items |
| | Color consult done | if add-on purchased | appointment completed |
| Property & Compliance | HOA approval on file | exterior + property.has_hoa | HOA approval doc uploaded |
| | Lead-safe (RRP) plan + "Renovate Right" pamphlet acknowledgment | pre_1978 = true or not sure, and the scope disturbs painted surfaces | acknowledgment doc signed + certified renovator assigned |
| | Wood rot / repair scope approved | if repair allowance on estimate | repair line approved or CO signed |
| Materials | Paint & materials ordered | always | paint order status ≥ `ordered` |
| Crew | Crew assigned with required skills | always | crew skills ⊇ job required skills |
| Customer Prep | Prep instructions sent (move furniture/valuables, clear exterior perimeter, water & power access) | always | template message logged (sent or simulated) |
| Weather (exterior/deck) | Start date inside production season | exterior/deck | promised_start_date in season window |

**Ready to Schedule = all required items cleared + no blocking holds.** Show "10/14 cleared · 3 auto-verified · 2 need attention · Re-verify all", same as the reference CRM.

### 6.5 Job Health score (0–100, shown on Overview with "View recommendations")

Deterministic weighted checks, chosen by stage: contract signed, deposit paid, onboarding % cleared, crew assigned, next appointment exists, daily logs on every production day, photos (before/progress/after) present, no overdue tasks, no stale stage (stage age vs expected), balance current. Each failed check produces a recommendation with a one-click action. Store `health_factors` for transparency.

### 6.6 Lead score (deterministic, explainable; never an LLM)

Start at 50. Example factors (weights editable in Admin → Lead Scoring): in service area +10 / out of area −20; has mobile +5; has email +3; full address +5; timeline ASAP +15, 1–3 months +8, just planning −10; services exterior or multiple +5; cabinets +5; uploaded photos +5; referral/past-customer source +15; responded to text +10; no response after 3 attempts −15. Grade: A ≥85, B 70–84, C 55–69, D 40–54, F <40. Temperature: Hot (A), Warm (B–C), Cold (D–F). Show grade badge + "70/100 · Warm Lead" + the factor list with +/− points and the "Scored on" date.

---

## 7. Estimate & Scope Builder (the painting-specific core)

This replaces the reference CRM's "Prep Specs". Erik should be able to build an itemized, accurate estimate on a tablet during or right after the walkthrough, and send it the same day.

### 7.1 Structure

```
Estimate (EST-2026-0007, version 2)
 ├─ Option A "Walls & ceilings"   ← customer can pick one option (or "Good / Better / Best" paint lines)
 ├─ Option B "Walls, ceilings, trim & doors"  (recommended)
 │    ├─ Area: Living Room
 │    │    ├─ Walls        420 sqft · 2 coats · condition Fair · color change light→light · Product: [line] Eggshell
 │    │    ├─ Ceiling      240 sqft · 1 coat · flat
 │    │    ├─ Baseboard     86 lf
 │    │    └─ Doors          2 each (both sides)
 │    ├─ Area: Exterior – Front elevation
 │    │    ├─ Siding (cedar) 640 sqft · wash + scrape + spot prime + 2 coats · 2-story multiplier
 │    │    ├─ Fascia/Soffit  110 lf
 │    │    └─ Front door      1 each
 │    └─ Area: Kitchen cabinets
 │         ├─ Doors 22 · Drawer fronts 9 · End panels 3 · Islands 1 · spray enamel
 │         └─ Hardware removal/reinstall  lump
 └─ Optional add-ons (customer toggles on acceptance)
      ├─ Pressure wash driveway & walkway
      ├─ Wood rot repair allowance (up to N lf, then T&M at $X/hr + materials)
      ├─ Drywall repair (per patch / per hour)
      ├─ Trim & millwork
      └─ Color consultation (credited if job is booked; configurable)
```

### 7.2 Surfaces & units (seed as catalog + production rates)

Interior: walls (sqft), ceilings (sqft), accent wall (sqft), baseboard/crown/chair rail (lf), door (each, 1 or 2 sides), door frame (each), window trim (each), closet (each, small/walk-in), stair railing/spindles (lf), built-ins (each).
Exterior: body siding (sqft, by siding type), trim (lf), fascia (lf), soffit (sqft or lf), gutters/downspouts (lf, paint only), entry door / garage door (each), shutters (pair), window trim (each), railings (lf), foundation (sqft).
Cabinets: doors, drawer fronts, end panels, island, crown/light rail (lf), interiors of boxes (optional), hardware (each).
Deck & fence: deck boards (sqft), stairs (each step), railings/balusters (lf), fence (lf × height), pergola (lump/sqft), cleaning & brightening (sqft).

### 7.3 Inputs per line item

Quantity (direct entry, or a measurement helper: room L×W×H → wall sqft minus standard deductions for doors/windows; exterior wall width × height × gable factor), **condition** (good/fair/poor), **prep level** (light/standard/heavy), **coats** (1/2/3), **primer** (none/spot/full; stain-blocking for cedar tannin bleed; bonding for cabinets), **color change** (same / light→dark / dark→light → extra coat/primer rule), **sheen**, **product** (from paint catalog), **method** (brush/roll/spray), **access** (ladder / tall ladder / staging / lift), **height** (1-story, 2-story ×1.25, 3+ ×1.5 — editable multipliers), **lead-safe** flag (auto when pre-1978 & disturbing paint → adds containment/cleanup labor and RRP supplies line).

### 7.4 Pricing engine (pure, unit-tested TypeScript module `lib/estimating/engine.ts`)

For each line:
- `labor_hours = (qty / production_rate[surface, method, condition]) × height_mult × access_mult × coats_factor + prep_hours`
- `gallons = ceil_to_container((qty × coats) / coverage_sqft_per_gal × (1 + waste%))` (round to quarts/gallons/5-gal per product)
- `labor_cost = labor_hours × loaded_labor_rate`
- `material_cost = gallons × product.cost_per_gal + sundries% × labor_cost` (tape, plastic, caulk, patch)
- `price = (labor_cost + material_cost) / (1 − target_margin)`, **or** a flat catalog price per unit when the line uses a catalog item. Show both computed and override price; overrides require a reason.
- Estimate-level: minimum job charge, discounts (amount/% with **approval threshold**: anything over the user's limit goes to **Jobs → Approvals** and blocks sending until an owner approves), tax (configurable rate/rules per location; **confirm the WA sales-tax treatment with an accountant** and keep it configurable), deposit % and amount, expiry date (default 30 days).
- Internal-only panel: total labor hours, crew-days estimate (hours ÷ crew size ÷ 8), gallons by product, **gross margin %**, with a color-coded margin floor warning (configurable, e.g. warn below 40%).
- **All seeded production rates, coverages, costs, and prices are SAMPLE data flagged `is_sample = true` with a visible "Sample – Erik to calibrate" badge** until an owner edits them. Never present them as real numbers.

### 7.5 Outputs from an accepted estimate

1. **Customer proposal:** branded web page (`/p/[token]`, no login, expiring token) plus PDF. Shows company header, L&I number, scope by area in plain English, options to choose, optional add-ons with toggles that update the total live, what's included (Section 7.6), guarantees (24h estimate, daily photo updates, clean house nightly, rain-day promise, on-time start or $250 off), terms, warranty, lead-safe disclosure if applicable, and **Accept & Sign** (typed name + drawn signature + timestamp + IP + user-agent, stored as a signed PDF; real e-sign providers stay disconnected adapters). Viewed/opened tracking.
2. **Contract** (agreement template + accepted scope) → signed PDF in Documents.
3. **Deposit invoice** (auto).
4. **Color sheet** per area/surface (PDF for the crew; the customer gets a copy to confirm).
5. **Paint & materials order** (gallons by product/color/sheen, sundries) → Paint Orders queue.
6. **Work orders** by phase with budgeted hours.
7. **Onboarding requirements** (Section 6.4).

### 7.6 Default "What's included" text (from the website, editable per work type in Admin)

Exterior: plants/decks/walkways/windows/fixtures covered or masked before work starts · washing siding and trim to remove dirt, chalky old paint, mildew and moss · scraping and sanding loose or peeling paint back to a sound edge · soft or rotted wood pointed out to you, with any repair quoted before we paint over it · caulking open joints, trim seams and gaps around windows and doors · priming bare wood, repairs and stained areas · finish coats on siding, trim, fascia, soffits and doors · daily cleanup of paint chips, drop cloths and equipment · a crew-lead quality check and a final walkthrough, with touch-ups fixed on the spot.
Write matching defaults for Interior, Cabinets, and Deck & Fence in the same plain, specific voice, and mark them "Draft – owner to approve".

### 7.7 Change orders

Created from the job (add/remove lines, rot found during prep, extra rooms). Same line-item engine; customer signs via the proposal page; signed COs update the contract amount and, if needed, create a CO invoice. Hidden rot is the classic case, so the crew lead can create a **draft** CO from the field with photos; an owner prices and sends it.

---

## 8. Screens (page-by-page spec, modeled on the reference CRM's UX)

Global patterns that apply everywhere:
- **KPI cards:** label, big number, colored icon chip top-right, and a **formula caption** underneath (e.g. "38 open estimates × $6.2k avg · rolling 90d", "$310K MTD · 75% of month pace"). Clicking a card drills into the filtered list.
- **"View data"** link on every chart opens a table of the exact rows/aggregates behind it, with **Download CSV** (permission-gated, logged).
- All metrics are **aggregated server-side** across all records (SQL views / RPCs), never computed from a paginated client list. Put this subtitle on the Executive Overview: "Company-wide performance. Every metric is aggregated server-side across all records."
- Lists: server-side pagination/sort/filter, a search box, **saved Views** (personal + shared), quick filter selects, an **Advanced** rule builder (Match ALL/ANY; field · operator [contains, equals, does not equal, is empty, is not empty, >, <, between, in last N days] · value; add rule), a **Filters** panel, a **Columns** configurator (drag to reorder, show/hide, reset, saved per user), status tabs with live counts, quick-filter chips, bulk **Select** with actions (assign, change status, add tag, export), row **Quick preview** drawer, and a list/card toggle on Jobs.
- Detail pages: sticky header with name, number, stage/status badges, primary actions (Call, Text, Email; these log activity and go through adapters → outbox), and a kebab menu (Duplicate job, Merge, Delete → soft delete, Print). Destructive actions need confirmation + reason.
- Empty states are friendly and give the next action ("No tasks yet. Add a follow-up to stay on top of this lead.").
- Skeleton loaders, optimistic updates with rollback, toasts, `Cmd/Ctrl+K` universal search, keyboard-accessible menus.

### 8.1 Top bar

Universal search (modal: "Search accounts, contacts, leads, jobs, invoices, phone numbers, addresses, emails, and mentions", scope chips All/Accounts/Contacts/Leads/Jobs/Invoices/Mentions, recent records list) · **Integrations pill** ("0 of 11 connected", click → Admin/Integrations) · softphone button (disabled until voice connected) · "View as user" (owners) · notifications bell with unread count · user menu (Workspace, Settings, Sign out) · floating **Help** button (bottom-left) opening a Help/Assistant panel (KB search + suggested questions; AI answers only when the AI adapter is connected; otherwise KB search only).

### 8.2 Home: Executive Overview (Owners)

Filters: Work Type (All, Interior, Exterior, Cabinets, Deck & Fence, Add-on only) · Date range (Today, This Week, This Month, Last Month, QTD, YTD, Rolling 90d, Custom).
Row 1 KPIs: **Open Pipeline Value** (open estimates + sold-not-started) · **Projected Revenue** (MTD sold + run-rate) · **Estimates Sent** · **Close Rate** (accepted ÷ sent, same cohort) · **Avg Job Value** · **Sales Velocity** (avg days lead → sold).
Row 2 KPIs (Brushy Bear promises): **Speed to Lead** (median minutes, business hours) · **24h Estimate SLA %** · **Daily Update Compliance %** · **On-Time Start %** · **Gross Margin % (completed MTD)** · **AR Outstanding**.
Widgets: Pipeline by Stage (bar: count + value) · Revenue Forecast (monthly actual vs run-rate projection vs **goal**; "No revenue goal configured" state with a link to set one) · Lead Funnel (leads → contacted → walkthrough → estimate → sold, with conversion %) · Exterior Season Backlog (booked crew-days vs capacity, June–Sept) · **City Performance** (Bellevue/Kirkland/Redmond/Sammamish/Issaquah/Out of area: jobs, volume, heat ranking) · **Estimator Leaderboard** (sold $, jobs, close rate) · **Lead Source Performance** (leads, converted, conv %, revenue, and cost-per-lead when spend is entered) + Lead Source Mix donut · **Executive Alerts** (untouched leads aging, stalled jobs, approvals needed, overdue invoices, missed daily updates, weather-risk exteriors in next 7 days, expiring estimates, subcontractor docs expiring); each opens the Attention queue pre-filtered.

### 8.3 Workspace ("My Day", default home for non-owners; owners can switch)

Greeting + one-line counts ("2 appts today · 3 jobs · 5 new leads · 1 approval · 2 awaiting reply · 0 at risk"), local time, **Ready Score**. Cards: Tasks (due today, overdue, upcoming, no due date) · Jobs (active, appts today, need action) · Leads (new, awaiting contact, follow-ups today, converted today) · Cases · Communications (unread email, unread SMS, mentions, notifications) · Attention (finance, production, customer, documents, scheduling, QA). Sections: Needs My Attention, My Jobs, Today's Agenda (calendar + work orders), My Leads (name, status, service, city, source), Communications feed, My Tasks, Recent Activity, Team Feed (My Team/My Territory/Company), Saved Views, Shortcuts (New Lead, New Job, Schedule, Daily Log), Sync status ("Online · No pending uploads").

### 8.4 Leads

**Lead Dashboard:** KPIs (Total, New, Contacted, Walkthrough Scheduled; each "View") · Lead Status Distribution bars · My Leads · Recent Leads · Conversion Funnel (Lead→Contact %, Walkthrough rate, Conversion to job %) · Top Lead Sources · Leads by City · **Lead Aging** buckets (0–3, 4–7, 8–14, 15–30, 30+ days) · Needs Attention (Stale 14+ days no activity, Unassigned, Hot leads).

**Lead List:** header "Leads · N active / N total" + New Lead. KPI strip (Total, New, Qualified/Walkthrough, Walkthrough Rate). Search ("name, email, phone, address, source…"), Views, Source select, City select, Health select (Hot/Stale), Advanced, Filters (source, service, created from/to, timeline, pre-1978), Columns. Tabs: Active · New · Contacted · Walkthrough Scheduled · Nurture · My Leads. Chips: 🔥 Hot · Unassigned · Stale · Last 7 Days · Website · Google · Facebook/Instagram · Nextdoor · Referral · Past Customer. Columns: Name (+hot icon, Preview), Score (grade badge), Services, Contact, City, Status, Walkthrough (date), Source/Sub-source, Created, Last Activity, Owner.

**New Lead wizard** (3 steps with a **Completion %** meter): ① Info (first*, last*, company optional, mobile, phone, email; *one contact method required*; live duplicate check by phone/email/address with "Open existing" option) ② Property (address autocomplete via GeoProvider or manual, map preview, year built / before-1978 / not sure, stories, siding type, HOA) ③ Qualify (services, timeline, source + sub-source (required), lead set by, notes, photos) → **Book Walkthrough** modal (date/time, suggested best slots from the estimator's calendar + drive-time clustering by city, assigned owner; changing owner needs Office Manager+) → Save / Save & Convert. Footer actions: Previous · Call · SMS · Email · Cancel · Next.

**Lead Detail:** header (avatar, name, phone, status pill, score badge "B · Warm Lead"), actions **Call · SMS · Convert to Job**, Edit Lead. Tabs: **Details** (collapsible "Lead Score" with factors; Contact Information; Address with "Open in Maps"; Lead Details: status, disposition, source, sub-source, property type, services, timeline, home built, lead set by, owner; Assignment & Scheduling: owner, tentative date/time; created/updated) · **Activity** (unified thread: SMS, email, calls, system events; composer with template picker and 160-char counter for SMS) · **Notes** · **Comments** (internal, category select General/Sales/Production/Office/Finance, @mention) · **Tasks** (follow-ups, show completed toggle, Add Task).

### 8.5 Jobs

**Jobs Dashboard:** KPIs (Total Pipeline Value, Open Jobs, In Progress, Closed Won, each with vs-prior-period delta) · Revenue & Performance (period select; Total Revenue, Avg Job Size, Win Rate, Closing This Month; daily revenue area chart) · Pipeline Snapshot (every stage: jobs, value, progress bar, total) · Recent Jobs · Pipeline Health (Open, Closed Won, Closed Lost, In Progress).

**Job List:** list/card toggle; search; Views; Stage select (all stages); Work Type select; Advanced; Filters; Columns; chips with counts per stage (Active, My Jobs, All, Walkthrough Scheduled, Estimate Sent, Sold, Onboarding, Ready to Schedule, Scheduled, In Progress, Final Walkthrough, Invoiced, Completed, Closed Won, Closed Lost). Columns: Job #, Priority, Name, Account, Amount, Stage, Work Types, Target/Start Date, Point of Contact, Owner.

**Approvals** (reference: "Unapproved Jobs"): estimates/discounts/change orders/overrides waiting for owner approval; KPIs (Total, Pending, Awaiting submission, by type); "My / All"; grouped by requester; Approve / Reject with note.

**Job Detail:** the most important page. Header: back, "Job #BB-2026-0042 · Customer: Smith Residence · 2 jobs", stage pill, hold pills, "Offline ready · Last synced 4:51 PM", Call/Text/Email, kebab. **Left section nav** (collapsible) with counts:

1. **Overview:** customer card (name, address, badges: work types, stage, health warning like "Start date at risk"), quick Call/Text/Email, Lead source, Point of Contact (avatar), Job date, Last updated, money tiles (**Contract · Paid · Balance**, "Paid in full" state); **Milestones** stepper with "Next: …" and **Advance** button; **Job Details** card (work types, account, projected start, priority, disposition, contract, source, estimator, PM/crew lead, crew; Edit); **Property Quick Info** (year built/lead-safe, HOA, siding, stories, access, colors chosen ✓/✗); Today's Schedule; **Action Required** list ("No upcoming appointment", "Production stage with no schedule", "Outstanding: deposit, colors"); Notes preview; Recent Activity; **Job Health** score with checks; Documents preview; Photos preview; Financial Summary.
2. **Onboarding:** stat tiles (Checklist progress %, Auto-verified, Needs attention, Open cases, Tasks due, Active holds), sub-tabs Checklist · Cases · Tasks · Holds; grouped requirement checklist (Section 6.4) with owner, status chip, and actions; Job Summary side card; Active Holds; Recent Activity. Footnote: "Ready to Schedule = every required item cleared and no blocking holds."
3. **Schedule:** sub-tabs Appointments · Tasks · Checklist; Action Queue ("Assign crew – High", "Order paint – High"); **Production Timeline** (Lead created → Walkthrough → Estimate sent → Sold → Deposit → Colors confirmed → Scheduled → Prep → Paint → Final walkthrough → Touch-ups → Complete) with dates and "Next up"; Today's items; Upcoming appointments; **Dispatch Readiness %** (city/territory match, skill match, crew available, materials status, HOA/lead-safe status, **weather window** for exterior); Assigned crew + **Recommended crews** ranked by workload, availability, skills, drive distance; queue overview; schedule summary.
4. **Estimate & Scope:** estimate versions list (status, total, sent/viewed/accepted), open builder (Section 7), color selections, change orders, "Generate proposal", "Send".
5. **Financial:** sub-tabs Worksheet · Invoices · Payments · Job Costing · Accounting. Worksheet: **Money Summary** (Contract, Billed, Left to Bill, Collected, Balance, Due) plus a plain-English **"Needs attention"** box when anything doesn't reconcile (e.g. "A payment was recorded but not applied to an invoice. Apply it to update the balance."); Contract & Changes; Billing (create invoice: deposit/progress/final/CO); Payments (Record payment, apply to invoice, mark cleared); Credits (On-Time Guarantee, goodwill); Job Costing (labor hours × cost, materials, subs, expenses → gross profit & margin; owners/bookkeeper only); Accounting sync status per invoice ("Not connected").
6. **Photos:** Gallery · Checklist (required shots per work type: before each elevation/room, prep, progress, after, cleanup) · Before/After compare slider; Camera (mobile capture), Upload; filter chips (All, Before, Prep, Progress, After, Damage/Rot, Color, Cleanup, Other) with counts; area tags; select all → share to customer / download zip; summary side panel (total, today, this week, offline pending, synced).
7. **Documents:** tabs (All, Proposals/Estimates, Contracts, Change Orders, Invoices & Receipts, Color Sheets, HOA, Lead-Safe, Warranty, Other); KPI tiles (total, awaiting signature, needs action, recently added, storage used); list/grid; upload; preview; actions (download, rename, recategorize, delete→soft).
8. **Work Orders:** tiles (All, New, In Progress, Completed, Pending Approval, Past Due); filters (type, status, priority, assignee); list; **Paint Orders** and **Labor/Sub Orders** sections; summary donut; "Linked to Production" (appointments, production tasks → View in Production Center); quick actions.
9. **Daily Logs:** timeline of logs (date, author, finished today, next up, hours, photos, cleanup ✓, customer update sent/simulated); "New Daily Log" (mobile-first form).
10. **Customer:** account header (type, address, phone; jobs count, lifetime contract value, paid, balance; won/open/lost), Property & Access (occupancy, access, gate code (masked), pets, parking, emergency contact; Edit), **Internal Team** (estimator, point of contact, PM, office; Edit), Signing Order (who signs proposals/contracts), Contacts (primary ★, others; Add Contact; notification preferences), All Jobs for this customer.
11. **Messages:** customer-facing only (SMS, email, calls) with the banner "Customer-facing. Internal notes and comments stay separate." Composer with templates; disabled-state guidance if no mobile on file ("Add a mobile number before sending SMS").
12. **Tasks & Checklists:** tasks list + checklist instances (exterior prep checklist, cabinet process checklist, lead-safe checklist, final walkthrough checklist).
13. **Punch List:** items by area with photos; status; "Customer sign-off" capture.
14. **Notes** and 15. **Activity Log:** unified feed with composer (Note | Comment toggle, "Team discussion – staff only", @mention, Attach, Pin, priority Normal/High/Urgent, create Task/Case from post) and filter chips (All, Comments, Notes, Activity, Documents, Photos, Appointments, Messages) + search.
16. **Admin** (owner-only): Dates & Timestamps (all milestone dates, each saves on change with audit), Status overrides (force Sold/unsold, force into Onboarding, release all holds; each requires a reason), Job Fields (contract baseline, priority, custom fields). Show a warning banner: "Changes here save immediately and are audit-logged."

Job shortcuts (left rail): **Result Walkthrough**, **Build Estimate**, **Send for Signature**, **Order Paint**, **New Daily Log**. Quick actions: Add Note, Upload Photos, Send Message, Upload Document, Add Task, Add Work Order, Create Change Order. Offline block: "Offline ready · All files available · Download job".

### 8.6 Production Center (left sub-nav workspace)

- **Command Center:** KPIs (Ready to Schedule, Scheduled, At Risk, Unscheduled, Jobs Completed this week, Scheduled Revenue next 30 days); What Needs Your Attention (at-risk jobs, unscheduled ready jobs, HOA/lead-safe holds, paint delays, missing crew, **weather risk next 7 days**); Schedule Health (on time, in progress, behind, at risk); Quick Actions (Open Master Schedule, Field Dispatch, Create Work Order, New Paint Order); Upcoming milestones (today/tomorrow/this week/next week starts).
- **Master Schedule:** KPI strip (Ready, Scheduled, At Risk, Unscheduled, Crews, Conflicts); left **To Be Scheduled** tray (search; "At risk only"; "Priority reschedule (rain)" pinned on top) with cards showing job, planned date, window, crew, conflict check, recommended crew + score, materials, HOA, lead-safe, calendar sync, and "Schedule job"; right **crew-row calendar** (Day / Week / Multi-week; date nav; Today), multi-day bars per job; drag from tray to crew/day; resize to change duration; **conflict detection** (double-booking, skill mismatch, crew time off, HOA/deposit hold, exterior outside season, rain forecast); changes are **drafts until "Publish changes"**, which notifies customers and crews (via outbox) and updates promised start dates (with on-time guarantee tracking).
- **Field Dispatch:** map (GeoProvider; until connected, a list grouped by city) + board of today's crews/jobs; filters (crew, skill, PM, city, status, work type); tiles (Blocked, Ready to schedule, At risk, Today's production).
- **Readiness Queue:** jobs with readiness status (Needs review, Complete, Blocked, Scheduled) and the next action.
- **Crew Queue:** jobs needing crew assignment (No crew, Assigned, Scheduled, At risk).
- **Paint Orders** (Order Manager): tabs Waiting to Order · Ordered · Partially Received · Picked Up/Delivered; columns: PM, job, PO, customer, city, age, $, products/colors, status, pickup/delivery date, supplier; "Generate order from estimate".
- **Exceptions:** rule-generated issues with severity (Critical/High/Medium), owner, recommended action, Resolve (e.g. "No crew assigned", "Start date in 3 days, deposit unpaid", "Rain 70%+ forecast on scheduled exterior day", "Sub COI expired").
- **Recommendations:** rule-based suggestions (schedule X with crew Y, swap days for weather) with guardrails: **Auto-execute OFF, Require approval ON, 15-minute undo window**.
- **Resources:** crews, members, subcontractors (compliance status), skills, capacity, time off.
- **Work Orders:** global list.
- **Weather panel** (exterior/deck jobs next 14 days; WeatherProvider; until connected shows "Weather not connected" and lets a PM mark a rain delay manually).

### 8.7 Onboarding Board (kanban, like the reference CRM)

KPI strip: Active jobs ($ pipeline), **Deposit Hold** (count, $ held), Needs Onboarding (avg age), On Hold/Expediting (avg age), Ready to Schedule ($), Scheduled/In Progress, Invoicing/Collections ($ outstanding), Paid in Full (this month), Open Warranty/Service. Tabs: Board · Expedite · Service/Warranty · Call Log · Data Audit (records missing required data) · Reporting. Filters: work type, holds (has hold/none/HOA/lead-safe/weather/deposit), city, sold date range, "Under 30% collected". Lanes: **Deposit Hold → Needs Onboarding → On Hold / Expediting → Ready to Schedule → Scheduled / In Progress → Invoicing / Collections → Paid in Full**, with lane totals ($, avg days, overdue count). Cards: customer, work-type tag, hold tag, days in lane, value, % collected, job #, overdue warning, icon flags (HOA, lead-safe, weather). Drag between lanes only where gates allow (otherwise show why).

### 8.8 My Projects (PM / crew lead portal, mobile-first)

Left: search, status filter, city filter, Day/Week/Month/All, mini-calendar with job counts per day, project list (name, job #, stage, city, date, "3/6 stages complete"). Right: selected project summary with today's work order, scope, color sheet, access notes, photos, daily log button, punch list.

### 8.9 Attention Center (Section 9)

Header "Jobs don't stall past attention." Refresh, "Only mine". KPI cards: Needs Attention Now (critical & high), Overdue / At-Risk, Awaiting Response, In Progress. Filters: status (pending, in progress, snoozed), priority, type, category, search. Item rows: type icon, title, related record link, age, SLA countdown, owner, actions (Open, Assign, Snooze until…, Resolve with note). "All caught up!" empty state. "Prioritize" button re-sorts by a deterministic urgency score (not AI).

### 8.10 Accounts & Contacts

Dashboards (totals, status distribution, my accounts, recent, health/conversion; contacts: email/phone reachability %, past-customer rate, active 30d) and lists/detail pages with related jobs, properties, contacts, messages, invoices, and documents. Merge duplicates (reversible).

### 8.11 Campaigns (email & SMS marketing)

Tabs: Campaigns · Drips · Automations. KPIs: total campaigns, active, sends (90d), delivery rate, replies (90d), unsubscribes, SMS opt-outs, conversions, queue, bounce rate. Campaign builder: channel, audience builder (saved segment or rule builder over contacts/leads/jobs; e.g. "Past exterior customers in Bellevue", "Open estimates > 7 days", "Just planning – exterior"), template, schedule, test send (outbox), compliance checks (excludes opted-out/DNC; footer with unsubscribe; SMS "Reply STOP to opt out"). Everything is simulated while providers are disconnected.

### 8.12 Price Book & Catalog

Price books list (All/Active/Inactive; product counts; one active "Brushy Bear Standard"), detail with families (Interior Labor, Exterior Labor, Cabinets, Deck & Fence, Add-ons, Materials, Fees, Packages), product table (name, code, family, unit, unit price, cost, status, actions). Paint catalog and Production Rates editors with the "Sample" badge logic.

### 8.13 Documents (global repository)

All documents with linked records, category filter, type filter, size, created date, actions; KPIs (total docs, linked to jobs, storage used).

### 8.14 Analytics (left sub-nav workspace)

- **Overview:** **"Ask Brushy Bear"** box (example prompts: "How are sales this month?", "How much did we collect this month?", "Which jobs are ready to schedule?", "What data-quality issues do we have?", "Compare sales vs last month"). Answers come only from the metrics registry (Section 12.1) and show the metrics + filters used: "Figures are computed, not written." Until the AI adapter is connected, the box matches questions to predefined metric queries with keyword rules. **Daily Brief** (Generate → deterministic summary of what changed yesterday and what needs attention). "My Business – This Month" tiles + "On Pace – This Month".
- **Dashboards:** prebuilt (Executive, Sales/Estimator, Production, Marketing & Lead Sources, A/R Aging, Seasonality/Exterior Backlog) + custom; favorites; shared; export.
- **Reports:** list (name, category, last run, frequency, updated by; tabs All/My/Favorites/Templates) + **report builder** (module, columns, filters, grouping, summary, chart type, save, favorite, share, export CSV, schedule email via outbox). Seed templates: Sold by month, Leads by source, Estimates sent vs accepted, A/R aging, Jobs missing daily logs, Sold – no deposit, Gross margin by job, Speed to lead, 24h SLA misses, On-time start misses.
- **Schedules:** scheduled report deliveries.

### 8.15 My Numbers (personal scoreboard) + My Commissions

Period: MTD, Last Month, YTD, All Time, Custom. Cards (each filters on *its own* date field, and the page says so): Leads Issued, Walkthroughs Set, Walkthroughs Ran, Estimates Sent, Sold ($ + count), Completed, Invoiced/Paid. Click a card → records list below. Owners get "View a rep…".

### 8.16 Referrals ("Bear Champions"), Reviews, Warranty

- Referrals: KPIs (champions, referrals, paid out, closed deals); tabs Champions · Referrals · Payouts · Settings (reward amount, when payable e.g. "after referred job paid in full", code format). Website integration: `?ref=CODE` is captured on the estimate form and attributed.
- Reviews: request log, click-through, review-left tracking; settings for delay and template.
- Warranty/Service cases: customer issue intake, SLA, schedule a warranty visit, resolution.

### 8.17 Help Center

Knowledge base (categories, articles, search, popular tags, "Manage articles" for owners) + Release Notes. Seed 10 short how-to articles (create a lead, book a walkthrough, build an estimate, send a proposal, record a deposit, clear onboarding, schedule a crew, submit a daily log, run the final walkthrough, close a job).

### 8.18 Settings (per user)

Profile (photo, name, email, phone, department, job title), Notifications (per event: in-app/email/SMS), Integrations (personal calendar connection, disconnected), Security (MFA, sessions), Preferences (default home, density, time format).

### 8.19 Admin → Setup (left sub-nav with "Quick find")

Audit Log · Messaging (templates, automations, settings) · Follow-up Lists & Dispositions (dynamic lists like the reference CRM's call lists; dispositions grouped Positive / Negative / Callback / No Contact / Won) · Deleted Records (restore) · Job Recovery · Data Import (CSV with field mapping, preview, review queue) · Bulk Update (CSV; **preview first, audited, reversible**) · Field Picklists (edit/reorder options; "Changes apply everywhere the field is used") · Finance (invoices, payments, reconciliation, close month) · Merge Customers (reversible) · Integrations · Notification Settings · Agreement Templates ("BearSign": templates by doc type Proposal/Contract/Change Order/Lead-Safe Acknowledgment/Warranty/Invoice/Receipt; branding; dynamic clauses; signer roles; required fields; publish validation) · Estimate Setup (paint catalog, production rates, surfaces, multipliers, margin targets, deposit %, expiry, minimum job) · Referral Program · Permissions (packs/templates/users) · Schedule Admin (Territories, Operating Hours, **Work Types with default durations**, Crews/Resources, Scheduling Policies, **Work Rules**, Skills) · Subcontractors (roster & compliance) · Templates (email/SMS) · Workflows · Module Manager (custom fields, page layouts, validation rules per module) · Export Controls (who can export, export log) · **Company Settings** (name, logo, colors, phone, email, hours, L&I #, UBI #, business hours for SLAs, text-back SLA minutes, estimate SLA hours, on-time guarantee amount, exterior season dates, deposit %, tax config, review link, referral reward).

---

## 9. Attention engine (nothing stalls silently)

A rules engine (SQL views + a cron worker) upserts `attention_items` (type, category, priority, title, related record, owner, due/SLA, status `pending | in_progress | snoozed | resolved`, resolution note, dedupe key). Items auto-resolve when the condition clears.

| Type | Category | Rule (defaults; make thresholds editable) | Priority |
|---|---|---|---|
| Untouched new lead | Communication | lead `new`, no human touch within 10 business minutes | Critical |
| Aging lead | Tasks | no activity 3/7/14 days by status | Medium→High |
| Walkthrough unconfirmed | Scheduling | walkthrough tomorrow, not confirmed by 5 pm | High |
| Estimate SLA | Tasks | walkthrough complete, no estimate sent at 20h (warn) / 24h (breach) | High/Critical |
| Estimate awaiting reply | Communication | sent > 3 days, not viewed/accepted | Medium |
| Expiring estimate | Sales | expires in ≤ 5 days | Medium |
| Approval needed | Approvals | discount/CO/override pending > 2 h | High |
| Sold, no deposit | Financial | Sold > 3 days, deposit unpaid | High |
| Onboarding stalled | Production | in Onboarding > 7 days | Medium |
| Ready, not scheduled | Scheduling | Ready to Schedule > 5 days (interior) / season-aware (exterior) | Medium |
| Missing crew | Scheduling | starts ≤ 5 days, no crew | High |
| Paint not ordered | Production | starts ≤ 3 days, no paint order | High |
| Weather risk | Scheduling | exterior/deck day with rain ≥ 60% or dew-point risk (when weather connected) | High |
| Missed daily update | QA | scheduled production day, no daily log by 7 pm | High |
| Start date missed | QA | promised start passed, no actual start, not weather | Critical (+ draft $250 credit) |
| Punch list open | QA | Final Walkthrough > 3 days with open items | Medium |
| Overdue invoice | Financial | 7 / 30 days past due | Medium/High |
| Unread customer message | Communication | inbound SMS/email unread > 30 business min | High |
| Warranty request | Customer | new case, SLA 2 business days | High |
| Sub compliance expiring | Documents | COI/L&I registration expires ≤ 30 days | Medium |

---

## 10. Money rules (single source of truth)

- Contract = accepted estimate (selected option + selected add-ons) + signed change orders − approved credits.
- Billed = sum of non-void invoices. Left to Bill = Contract − Billed. Collected = sum of applied, non-bounced payments. Balance = Billed − Collected. Due = overdue portion.
- Deposit invoice created on acceptance (deposit % from settings). Progress invoices optional. Final invoice auto-drafted at Completed (includes On-Time Guarantee credit if approved).
- Payments must be applied to invoices (UI forces it; unapplied cash is shown as a warning, never silently counted).
- Void/refund/bounced flows reverse cleanly with audit.
- A/R aging buckets: Current, 1–30, 31–60, 61–90, 90+.
- **Month close:** Finance can lock a month; after that, edits to locked-period payments/invoices require an owner override with a reason.
- Accounting sync (QuickBooks adapter) is disconnected; each invoice/payment shows `Not connected` and a "would sync" preview in the outbox.
- Commissions (build the engine, **disabled by default**): plans by role with rate by lead source (company-generated vs self-generated), eligibility rules (pay only when **paid in full** and funds **cleared**), optional overhead deduction %, high-dollar manual review threshold, payroll preview, payables by type, exceptions. Config-driven, with a simulator tab.

---

## 11. Workflows, messaging, and automations

### 11.1 Engine

- Domain events are written to `events` (type like `lead.created`, `lead.status_changed`, `appointment.created`, `appointment.completed`, `estimate.sent`, `estimate.viewed`, `estimate.accepted`, `job.stage_changed`, `job.hold_added/released`, `invoice.created/overdue`, `payment.created`, `daily_log.submitted`, `schedule.published`, `weather.risk_detected`).
- `workflows` define trigger (event + conditions) → ordered actions (send template via channel, create task, create attention item, add/release hold, change field, enroll in drip, notify user, wait/delay, webhook (disabled)). They're **system-defined + toggleable** (like the reference CRM's "Live Engine Workflows": name, trigger label e.g. `Estimate.ACCEPTED`, run count, last run, **Test** button that dry-runs against a chosen record and shows what would happen).
- `workflow_runs` log every execution (input, steps, result, error). Idempotency key per (workflow, event).
- Messages respect business hours (queue overnight texts until 8 am unless it's a customer-initiated thread), consent, and DNC.

### 11.2 Seeded workflows (all ON; all sends go to the outbox while disconnected)

1. **New web lead → instant text-back** ("Hi {{first_name}}, this is {{poc.first_name}} with Brushy Bear Painters. Got your request for {{services}}. When's a good time for a quick walkthrough?"), assign owner by round-robin/territory, create "Call within 10 min" task, start the speed-to-lead SLA.
2. **Walkthrough booked →** confirmation SMS + email (date, time, who's coming, what to expect), calendar event (adapter), reminders 24h and 2h before, convert to job (setting).
3. **Walkthrough completed (measured) →** task "Send estimate" due +24h; Attention at 20h.
4. **Estimate sent →** follow-ups day 2 (text), 5 (email), 10 (text from owner); stop on view+reply/accept/decline.
5. **Estimate accepted →** Sold; contract + deposit invoice; onboarding checklist; welcome email ("what happens next", prep instructions, color selection link).
6. **Deposit paid →** release Deposit Hold; notify office.
7. **Onboarding cleared →** Ready to Schedule; notify scheduler.
8. **Schedule published →** customer notice with start date + crew lead + rain-day promise text; crew notice; day-before reminder ("We'll arrive between 8:00–8:30 am…").
9. **Weather risk (exterior)** → Attention + suggested reschedule; if PM marks rain delay → `is_priority_reschedule = true`, customer text ("Rain's coming in Thursday. We'll move your start to the next dry day, and you're first on the list. No cost to you.").
10. **Promised start missed (not weather) →** Attention Critical + draft $250 On-Time Guarantee credit for owner approval.
11. **Daily log submitted →** customer update (photos + "Finished today / Next up"), signed by the point of contact; missed by 7 pm → Attention.
12. **Work orders complete →** Final Walkthrough appointment request.
13. **Final walkthrough signed off →** Completed; final invoice drafted.
14. **Invoice overdue 7/30 days →** reminders.
15. **Paid in full →** thank-you, warranty info, **Google review request** (+2 days), **referral invite** (+14 days), 1-year "how's the paint holding up?" check-in.
16. **Lead stale 14 days / Just planning →** nurture drip; **exterior pre-season drip** (Feb, Mar, Apr: "Exterior dates for this summer are filling up").
17. **Sub compliance expiring →** notify owner + sub.

### 11.3 Templates

Seed SMS + email templates for every workflow above, in Brushy Bear's voice: **plain, friendly, specific, no hype, short sentences**, signed by a real person (the job's point of contact). Merge fields with a preview pane and a live SMS character/segment counter. Categories: Lead, Walkthrough, Estimate, Sold/Onboarding, Schedule, Daily Update, Weather, Completion, Billing, Review/Referral, Warranty, Internal.

### 11.4 Follow-up Lists (reference CRM "Call Center" call lists, re-purposed)

Dynamic lists with counts: Hot New Leads (≤24h), Confirm Tomorrow's Walkthroughs, Estimates Awaiting Reply, Callbacks Scheduled, Just-Planning Nurture, Pre-Season Exterior, Lost – Re-engage (90 days), Past Customers (annual check-in). A "power dialer" style view: next record, script panel, disposition buttons (grouped Positive / Negative / Callback / No Contact), auto-advance. Call/SMS buttons route through adapters.

---

## 12. Analytics definitions

### 12.1 Metrics registry (single source of truth)

`lib/metrics/registry.ts` defines every KPI once: id, label, description, SQL/RPC, date field it filters on, filters supported (work type, city, owner, source, date range), unit, format, **formula caption template**, and owner-only flag. Every card, report, "Ask" answer, and Daily Brief reads from this registry. Each metric has a unit test against seeded fixtures with a known expected value.

Minimum metrics: leads created, leads by source, speed to lead (median, p90), contact rate, walkthrough set rate, walkthrough show rate, estimates sent, 24h SLA %, estimate → sold close rate (count and $), avg job value, sales velocity (days), pipeline value (open estimates; sold-not-started), backlog crew-days (by work type, season), projected revenue (run-rate), revenue sold/completed/collected, gross margin % (completed), labor hours estimated vs actual, daily-update compliance %, on-time start %, rain-delay days, punch items per job, days completed → paid, A/R aging, collection %, review request → review rate, referral conversions, revenue by city/source/estimator, cost per lead & CAC (when spend is entered per source per month in Admin → Marketing Spend).

### 12.2 "Ask" safety

Answers cite metric ids and filters, never invent numbers, and respect the asker's permissions (crew can't ask about revenue). If a question can't be mapped to a metric, it says so and suggests the closest report.

---

## 13. Security, privacy, and compliance

### 13.1 Security

- RLS on every table, keyed on `org_id` + the permission engine; deny by default; policy tests in CI.
- Service-role key only in server code; never in the client bundle (add a test that greps the build output).
- Private Storage buckets; signed URLs with short expiry; image thumbnails generated server-side; EXIF location stripped from customer-facing copies.
- Encrypted columns (pgsodium or app-level) for gate/lockbox codes and any sensitive notes.
- Rate limiting + bot protection on public endpoints (lead intake, proposal pages); honeypot field support.
- CSP headers, secure cookies, CSRF protection on Server Actions, zod validation on every input.
- Audit log is append-only (no update/delete grants).
- PII-free application logs (mask phones/emails).
- Data export gated by permission and logged (who, what, row count).
- Daily backups note in `docs/RUNBOOK.md` (Supabase PITR recommendation).

### 13.2 Messaging compliance

Store consent with source and timestamp; honor STOP/UNSUBSCRIBE (inbound keyword handler stub); quiet hours; DNC flag blocks all outbound marketing; transactional vs marketing message types are tracked separately.

### 13.3 Lead-safe work (pre-1978 homes)

Track the firm's RRP certification and certified renovators (expiry dates) in Company Settings / Subcontractors. For pre-1978 (or "not sure") properties where painted surfaces will be disturbed: auto-add the lead-safe onboarding requirement, the pamphlet acknowledgment document ("Renovate Right"), a lead-safe checklist on the work order (containment, cleanup, cleaning verification), and require a certified renovator on the crew. Washington runs its own RRP program through the Department of Commerce, so **put a note in `docs/COMPLIANCE.md` to verify current requirements with them.** Don't hard-code legal advice.

### 13.4 Contractor paperwork

Proposal/contract templates include the L&I registration # and UBI from Company Settings, plus a slot for any required Washington customer disclosure notice. Add `docs/COMPLIANCE.md` with an owner checklist to confirm the required notices, lien-related disclosures, warranty terms, and sales-tax treatment with L&I, an attorney, and an accountant. Templates ship as **drafts that need owner approval**.

---

## 14. Website → CRM lead intake (brushybear.vercel.app)

The website's `/estimate` form is a 2-step form. Fields observed on the live site:

- Step 1 "How do we reach you?": `name`, `phone` (mobile), `email`, `location` ("Home address or ZIP code"), `services[]` checkboxes: **Interior, Exterior, Cabinets, Deck or fence, Something else**, plus a hidden honeypot input named `company` (reject submissions where it's filled).
- Step 2: "When would you like it done?" (**As soon as possible, In 1–3 months, 3+ months out, Just planning**), "About when was your home built?" (**Before 1978, 1978 or later, Not sure**; the site notes "Homes built before 1978 get lead-safe prep."), "Photos of what you want painted" (uploads), "Anything else we should know?" (notes).
- Every service page and city page ends in the same form, so capture `page_path` (e.g. `/services/exterior-painting`, `/painters/kirkland-wa`) to infer intent and city.

Build:
1. `POST /api/public/leads` (Route Handler): verifies an `X-BB-Signature` HMAC (shared secret env), rate-limits by IP, validates with zod, honors an `Idempotency-Key`, splits name, normalizes phone (E.164) and email, parses address/ZIP → territory (or Out of area), maps services/timeline/home_built to enums, stores UTM/referrer/`ref` code/page_path, saves photos to Storage (presigned upload flow: `POST /api/public/leads/upload-url`), dedupes against existing contacts/leads (same phone or email in 180 days → attach as new activity on the existing lead and notify owner instead of duplicating), scores the lead, emits `lead.created`.
2. Response returns `{ ok: true, leadId }` only (no PII echo).
3. `docs/WEBSITE_INTEGRATION.md`: exact payload contract, a Next.js server-action snippet for the website repo (sign the payload server-side; never expose the secret), and a curl example for testing.
4. Seeded lead sources include `Website` with sub-sources `Organic`, `Google Ads`, `Google Business Profile`, `Local Services Ads`, `Facebook/Instagram`, `Nextdoor`, `Yelp`, `Referral link`, `Direct`, inferred from UTM/referrer.

---

## 15. Seed data (migration + `supabase/seed.sql` + `scripts/seed-demo.ts`)

### 15.1 Real configuration (always seeded)

- Org "Brushy Bear Painters"; Company Settings with the placeholders from 1.1.
- Users: **Hunter Lee** (Owner; department "Marketing & Customer Experience"), **Erik** (Owner; "Field Operations & Estimates"). Emails come from env `SEED_OWNER_EMAILS` (don't hard-code).
- Territories + ZIPs (5.1), business hours (default Mon–Fri 8:00–17:00, Sat by appointment; editable), exterior season Jun 1–Sep 30.
- Role templates + permission packs (Section 4).
- Picklists:
  - **Lead Source:** Website, Google Ads, Google Business Profile, Local Services Ads, Facebook/Instagram, Nextdoor, Yelp, Angi, Thumbtack, Customer Referral, Past Customer (Repeat), Neighbor/Job-site Sign, Yard Sign, Vehicle/Truck, Door Hanger/Flyer, Realtor/Property Manager, Home Show/Event, Partner/Vendor Referral, Other.
  - **Work Type:** Interior, Exterior, Cabinets, Deck & Fence, Add-on Only, Warranty/Touch-up.
  - **Property Type:** Single-family, Townhome, Condo, Multi-family, Commercial.
  - **Siding Type:** Cedar/Wood, Fiber-cement, Vinyl, Stucco, Brick/Masonry, Mixed, Other.
  - **Lead Disposition**, **Lost Reason**, **Hold Type** (sections 5–6).
  - **Paint Brands** (editable): Sherwin-Williams, Benjamin Moore, Miller Paint, PPG, Behr, Other. **Sheens:** Flat, Matte, Eggshell, Satin, Semi-gloss, Gloss.
- **Work Types for scheduling** (default durations, assigned role): Walkthrough/Estimate 60 min (Estimator) · Color Consultation 60 min (Estimator) · Interior Production Day 8 h (Crew) · Exterior Production Day 8 h (Crew) · Cabinet Spray/Shop Day 8 h (Crew – spray skill) · Deck & Fence Day 8 h (Crew) · Pressure Washing 4 h (Crew) · Rot Repair 4 h (Crew – carpentry) · Final Walkthrough 45 min (PM) · Touch-up Visit 2 h (Crew) · Warranty Visit 1 h (PM) · Paint Pickup 1 h (PM).
- **Work Rules** (editable, enforced by the scheduler with clear messages): Walkthrough before production; Deposit before scheduling; HOA approval before exterior color change; Lead-safe certified renovator on pre-1978 jobs; Exterior/deck only in season (owner override); No exterior painting with rain forecast ≥ X% or surface temp below product minimum (weather-connected only); Max 1 active job per crew per day unless split; Spray-finish skill required for cabinets; 2-story exterior requires high-access skill.
- **Checklist templates:** Walkthrough (measure each area, photos of every elevation/room, note rot/repairs, year built, HOA, colors discussed, access/pets/parking); Exterior Prep (wash, moss/mildew treatment, scrape/sand, repairs, caulk, spot-prime/prime, masking/protection); Interior Prep (move/cover furniture, floor protection, patch, sand, caulk, prime); Cabinet Process (label & remove doors/drawers/hardware, degrease, scuff-sand, bonding primer, spray coats, cure, reinstall, adjust); Deck & Fence (clean, brighten, dry time, stain, protect plants); Lead-Safe; Daily Cleanup; Final Walkthrough (customer walk, punch list, touch-ups, before/after photos, sign-off).
- Workflows (11.2), templates (11.3), follow-up lists (11.4), attention rules (9), metric registry (12.1).
- Price book "Brushy Bear Standard" with surfaces (7.2), add-ons (1.2), sample production rates/paint products flagged **Sample**.

### 15.2 Demo data (dev/preview only; `DEMO_DATA=true`)

~300 leads, ~120 jobs across every stage and work type, realistic Eastside addresses in the 5 cities (fake, generated), estimates with options/add-ons, invoices/payments (some overdue), daily logs with placeholder photos, 3 crews (2 employee, 1 sub), holds of every type, weather-delay examples, and attention items. Tag every demo record `is_demo = true` and add an owner-only "Purge demo data" admin action. Never seed demo data in production.

---

## 16. Design system (match the website brand; clean app UX like the reference CRM)

The website uses forest green, honey gold, and warm cream with a playful bear mascot. The CRM should feel like the same company but work as a calm, dense, fast tool.

**Tokens (CSS variables + Tailwind theme):**

| Token | Hex | Use |
|---|---|---|
| `--bb-forest` | `#1F4D3A` | primary (buttons, active nav, links, headings) |
| `--bb-forest-dark` | `#163829` | hover/pressed, footer-style surfaces |
| `--bb-honey` | `#E9A93B` | accent / key CTA ("Send estimate", "Publish changes"), highlights |
| `--bb-cream` | `#F4EDE1` | brand surfaces, login screen, proposal page background |
| `--bb-cream-light` | `#FAF6EF` | subtle panels |
| `--bb-ink` | `#2B2B2B` | primary text |
| `--bb-border` | `#E6DAC6` | warm borders on brand surfaces |

- App background is a neutral light gray (`#F6F7F9`) with white cards, `rounded-2xl`, 1px soft borders, minimal shadows, so dense data stays readable. Use the cream/forest brand look on the **login screen, customer-facing proposal/portal pages, PDFs, and empty states**.
- Status colors are semantic and accessible: info blue, success green, warning amber, danger red, neutral gray, plus one consistent color per stage (legend in Storybook-like `/dev/ui` page).
- Typography: **Manrope** for all UI text; **Lilita One** only for the logo wordmark, page H1s on brand surfaces, and the proposal header (never in tables).
- Icons: lucide. KPI cards use small rounded-square colored icon chips like the reference CRM.
- The bear mascot and logo come from the website repo's public assets / the "Brushy Bear Painters" Drive folder. Put placeholders in `public/brand/` and ask me for the files. Don't generate new mascot art.
- Pill buttons with a dark 1.5px border for brand CTAs on customer-facing pages (website style); standard shadcn buttons inside the app.
- Mobile: bottom tab bar for crew roles (Today, Jobs, Camera, Daily Log, Messages); 44px touch targets; works one-handed on a ladder-side phone.
- Accessibility: WCAG 2.2 AA contrast (check honey on white; use ink text on honey), focus rings, keyboard nav, aria labels, reduced-motion support.
- Light mode first; dark mode tokens defined but optional.

---

## 17. Build plan (phases with definition of done)

Work in this order. For each phase: plan → implement → migrations → seed → tests → Playwright screenshots of new screens saved to `docs/screens/phase-N/` → update `CHANGELOG.md` + docs → commit on a `phase-N-*` branch. **Don't push to `main` or deploy to production without asking me.**

| Phase | Scope | Definition of done |
|---|---|---|
| **0. Foundation** | Repo, Next.js + TS strict, Tailwind/shadcn, Supabase local, CI, env handling, design tokens, app shell (top nav w/ dropdowns + recent items, user menu, notifications shell, universal search shell), `CLAUDE.md`, docs skeleton | `pnpm dev` + `supabase start` work from README; CI green; shell renders on desktop & mobile |
| **1. Platform** | Orgs, auth (Google + magic link, MFA for owners), users admin, permission engine (packs/templates/users, RLS helpers), View-as-user, audit log, soft delete + Deleted Records, picklists admin, Company Settings, integration adapter framework + outbox + Integrations page | RLS tests pass for every role; audit rows on every mutation; Integrations page shows all 11 cards "Not connected" |
| **2. Leads & Customers** | Accounts, contacts, properties, leads (dashboard, list w/ views/advanced/columns/chips/bulk, wizard, detail tabs), dedupe, lead score, public intake API + upload, universal search | Website payload → lead in < 1 s; duplicate test passes; list handles 50k leads with < 300 ms server query |
| **3. Jobs core** | Convert lead → job, job list/dashboard/approvals, job detail shell with all sections, stage engine + gates + overrides, holds, milestones, notes/comments/@mentions/activity, tasks, job health, Attention engine v1 | Cannot skip a gate without owner override + reason; stage history correct; attention items open/auto-resolve |
| **4. Estimating** | Catalog, paint products, production rates (sample-flagged), estimate builder (options/areas/lines/add-ons), pricing engine, approvals, proposal web page + PDF, accept & sign, change orders, color selections, deposit invoice on accept | Pricing engine 100% unit-tested with fixture jobs; proposal renders on mobile; acceptance produces signed PDF + deposit invoice + onboarding items |
| **5. Onboarding, docs & photos** | Onboarding checklist with auto-verify, onboarding board (kanban), documents module, photos (gallery/checklist/compare, offline queue, PWA) | Ready to Schedule only when gates pass; offline photo capture syncs after reconnect (E2E with network toggling) |
| **6. Production** | Crews/subs/skills/availability, Schedule Admin (territories, hours, work types, rules), Master Schedule (drag/drop, conflicts, draft → publish), dispatch, readiness/crew queues, paint orders, work orders, daily logs → customer updates, time entries, punch list, final walkthrough, weather adapter stub + rain-delay flow + on-time guarantee | Scheduling a conflicting job is blocked with a clear reason; publish sends (simulated) notices; missed daily log raises attention at 7 pm |
| **7. Money** | Invoices, payments (apply, clear, bounce, refund), credits, money summary + plain-English reconciliation warnings, A/R aging, job costing & margin, month close, accounting adapter stub | Ledger property-based tests (random sequences of invoices/payments keep invariants); balances never stored as editable fields |
| **8. Communication & growth** | Messaging inbox/threads, templates, workflow engine + 17 seeded workflows with Test/dry-run + run log, follow-up lists, campaigns/drips, referrals, reviews, warranty cases | Every seeded workflow has a passing dry-run test; quiet hours & opt-out enforced |
| **9. Analytics & home** | Metrics registry, Executive Overview, Workspace, Leads/Jobs dashboards, Analytics hub (Ask w/o AI, Daily Brief, dashboards, report builder, schedules), My Numbers, My Projects portal | Every KPI matches its fixture expected value; every chart has View data + CSV |
| **10. Hardening & launch prep** | Module Manager (custom fields, layouts, validation rules), CSV import/bulk update/merge (preview first, reversible), export controls, Help Center + seeded articles, commissions engine (off), accessibility + performance pass, full E2E suite, docs, Vercel preview deploy | Golden-path E2E (Section 19) green; Lighthouse ≥ 90 on key pages; axe has no serious violations; docs complete |

---

## 18. Working rules for you (also put these in `CLAUDE.md`)

1. **Plan before coding** each phase and show me the plan. Ask before anything destructive (dropping tables, rewriting migrations already applied, force pushes).
2. **Don't invent business facts.** Phone, email, hours, license numbers, prices, production rates, tax rules, and legal language are placeholders or "Sample/Draft – owner to approve" until I give real values. Ask me when you need one.
3. **Never connect real integrations or send real messages.** Everything goes through adapters → outbox.
4. **Don't copy anything from the reference CRM**: no names, data, branding, or wording beyond the generic UX patterns described here.
5. Keep a running `docs/DECISIONS.md`; keep `docs/SPEC.md` as the source of truth and note any deviation.
6. Migrations are additive and reversible. Generate DB types after every migration. No `any`.
7. Business logic lives in `lib/domain/*` as pure, tested functions (stage gates, pricing, ledger, scoring, attention rules, scheduling conflicts). Server Actions/Route Handlers are thin.
8. Server-side aggregation for all metrics; paginate everything; index what you filter on.
9. Every mutation: zod-validated, permission-checked, audit-logged, emits a domain event.
10. Mobile-first for crew screens; desktop-dense for office screens.
11. Write tests alongside features; don't mark a phase done with failing tests or type errors.
12. At the end of each phase, give me: what was built, screenshots, how to try it, known gaps, and what you need from me.

---

## 19. Acceptance: golden-path E2E (Playwright) + key unit tests

**Golden path:** website form POST (signed) → lead appears with score & territory → auto-text in outbox within 1 s → speed-to-lead attention item opens, then resolves after a logged call → walkthrough booked (confirmation + reminders simulated) → lead converted to job → walkthrough completed → estimate built with two options + rot-repair add-on → discount over the limit goes to Approvals → owner approves → proposal sent → customer opens the proposal page, picks Option B + pressure washing, signs → job = Sold, signed PDF stored, deposit invoice created, onboarding items seeded → deposit payment recorded & applied → colors selected, HOA doc uploaded, crew assigned, paint ordered → Ready to Schedule → scheduled on Master Schedule (draft) → Publish → customer/crew notices simulated → rain delay marked on day 1 → priority reschedule flag + customer text simulated, no charge → start → daily logs on each day (customer updates simulated) → punch list with 2 items fixed → final walkthrough sign-off → Completed → final invoice → payment → Paid in Full → review request & referral invite simulated → Closed Won. Assert money summary, stage history, attention items, and KPIs at each step.

**Also test:** promised start missed (not weather) → $250 credit drafted → owner approves → appears on final invoice; pre-1978 lead → lead-safe requirement + certified renovator rule enforced; out-of-area ZIP → flagged; duplicate web submission → merged into the existing lead; crew role can't read contract amounts (RLS); View-as-user is read-only and logged; bulk update preview → apply → revert.

---

## 20. Deliverables

- Working app (local + Vercel preview) with seeded config and demo data toggle.
- `README.md` (setup, commands, env), `CLAUDE.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md` (diagram of app/db/worker/adapters), `docs/DATA_MODEL.md` (ERD via Mermaid), `docs/PERMISSIONS.md` (packs × templates matrix), `docs/WORKFLOWS.md` (every workflow: trigger, conditions, actions, templates), `docs/METRICS.md` (every KPI definition), `docs/INTEGRATIONS.md` (step-by-step to connect each provider later: accounts to create, env vars, webhooks, test steps), `docs/WEBSITE_INTEGRATION.md`, `docs/COMPLIANCE.md` (owner checklist), `docs/RUNBOOK.md` (backups, month close, purge demo data, rotating secrets), `CHANGELOG.md`, `.env.example`.
- A short **owner onboarding guide** (`docs/OWNER_GUIDE.md`) for Erik and Hunter: daily routine (Workspace → Attention → follow-up lists), how to build/send an estimate in under 15 minutes, how to run the schedule, how to close out a job.

When you're ready, start with **Step 0**.
