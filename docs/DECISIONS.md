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

### 2026-10-26 · Generated DB types, checked in CI

- **Decision:** `lib/db/types.ts` is the exact `supabase gen types` output (Prettier-formatted). CI regenerates it from the real stack and fails on any difference. After each migration, run `pnpm db:types` (or copy the diff from the failing CI step when working without Docker).
- **Reason:** SPEC §18 rule 6. The first CI run produced the real output; the file now matches it byte for byte.

### 2026-10-26 · CSP deferred to Phase 10

- **Decision:** Phase 0 ships baseline security headers (nosniff, frame deny, referrer policy, HSTS, permissions policy). The strict nonce-based Content-Security-Policy lands in the Phase 10 hardening pass.
- **Reason:** A nonce CSP touches every page and third-party script; adding it once the page set is stable avoids repeated breakage. Tracked as a known gap.

### 2026-10-26 · Postgres version

- **Decision:** `supabase/config.toml` uses Postgres 17 (CLI default); the sandbox test harness uses the installed Postgres 16.
- **Reason:** Both satisfy SPEC §2 (Postgres 15+). Migrations avoid version-specific features; CI on 17 is the authority.

---

## Phase 1 — Platform

### 2026-10-26 · Full local Supabase in the build sandbox

- **Decision:** The build sandbox can run Docker after all, so Phase 1 was developed and tested against the real `supabase start` stack (Auth, PostgREST, Postgres 17). The plain-Postgres fallback in `scripts/test-db.sh` stays, and both paths must pass. This supersedes the reason given in "Local DB tests without Docker".
- **Reason:** The real stack exercises Auth, JWT claims, MFA levels and PostgREST grants, which the shim only approximates.

### 2026-10-26 · Permissions resolved in Postgres

- **Decision:** One function, `app.user_perm_scope(user, permission)`, resolves a user's scope (`own` / `team` / `all`) from template packs, then per-user grants and revokes. RLS policies, RPCs and the server (`my_access()`) all use it, so the UI and the database cannot disagree. Owner templates use `grants_all`. Policies wrap helpers in `(select …)` so Postgres evaluates them once per query.
- **Reason:** SPEC §4.2 requires enforcement in Postgres, not just in the UI. A single resolver keeps one source of truth.

### 2026-10-26 · Pages are gated by permissions, not a separate "pages" list **[Deviation]**

- **Decision:** SPEC §4.2 says packs are "pages + resource actions". Instead of storing page grants, each nav link and admin section lists the permissions that make it useful (`requiresAny`). A page is visible when the user has at least one of them, and the route itself checks again on the server (`requirePermission` → 404).
- **Reason:** Page grants that don't match the underlying permissions create screens a user can open but can't use (or the reverse). Deriving visibility from permissions keeps them consistent.

### 2026-10-26 · Audit and events from database triggers

- **Decision:** A generic `AFTER` trigger (`app.audit_row()`) writes `audit_log` rows for every insert, update and soft delete on audited tables: actor, real user when viewing as someone, before/after, changed fields, IP, user agent and request ID. Our server passes IP, user agent and request ID in `x-bb-*` request headers. The actor header is only trusted from the service role. The audit log is append-only (trigger + revoked grants). A second trigger, `app.emit_change_event()`, writes `<aggregate>.created|updated|deleted` rows to `events`. Clients can't write either table.
- **Reason:** SPEC §18 rule 9 ("every mutation … audit-logged, emits a domain event") can't be forgotten in a Server Action if the database does it. It also covers changes made through any future path (scripts, RPCs).

### 2026-10-26 · View as user = a database session, read-only

- **Decision:** Starting View as stores a row in `app.impersonation_sessions` keyed by the owner's Supabase session ID (from the JWT), for up to one hour. `app.effective_user_id()` then returns the target user, so RLS shows exactly what they would see. `app.can_write()` is false while impersonating, so every write policy refuses, and the server action wrapper refuses before reaching the database. Start and stop are audit-logged.
- **Reason:** SPEC §4.2 asks for read-only impersonation with a banner. Doing it in Postgres means the preview is exact (not a UI approximation) and can't be used to change data.

### 2026-10-26 · Magic links use `token_hash` on our own route

- **Decision:** The magic-link email template links to `/auth/confirm?token_hash=…&type=email`, which calls `verifyOtp` on our server. Google sign-in uses the PKCE callback at `/auth/callback`. Sign-up is disabled, so only invited users can sign in. The login form always gives the same answer, so it can't be used to find out which emails have accounts.
- **Reason:** `token_hash` links work when the link is opened on a different device or browser than the one that requested it (common with phones). It is the flow Supabase recommends for server-side auth.

### 2026-10-26 · Supabase Auth emails are infrastructure, not "messages"

- **Decision:** Sign-in links are sent by Supabase Auth's own mailer (local: Mailpit; production: the SMTP set in the Supabase dashboard). They don't go through the integrations outbox. Customer and staff messages still always do.
- **Reason:** Without sign-in emails nobody can log in. They contain no customer data, and the owners control the sender in Supabase. Invitation emails written by the CRM itself are still simulated through the outbox.

### 2026-10-26 · MFA required for Owner and Bookkeeper

- **Decision:** Role templates have `requires_mfa`. Owner and Bookkeeper ship with it on. `app.session_ok()` refuses data access unless the session is at assurance level 2 (TOTP) for those roles, and the app sends them to `/mfa` to set it up or answer it.
- **Reason:** SPEC §13 calls for MFA for owners. The Bookkeeper sees all financials, so the same protection applies. Owners can switch it per template.

### 2026-10-26 · Owner seed from `SEED_OWNER_EMAILS`

- **Decision:** `pnpm seed:owners` creates or updates owner accounts from the comma-separated `SEED_OWNER_EMAILS` env var. The first email is Hunter Lee (Marketing & Customer Experience), the second Erik (Field Operations & Estimates). No email address is committed to the repo.
- **Reason:** SPEC §16 ("Emails come from env `SEED_OWNER_EMAILS`, don't hard-code"). Erik's email is still needed.

### 2026-10-26 · Real providers are locked three ways

- **Decision:** A real integration only runs when all three hold: its `INTEGRATION_*_PROVIDER` env var names the real provider, its `integration_connections` row is `connected`, and `REAL_PROVIDERS_LOCKED` in `lib/integrations/core.ts` is `false`. In this build the constant is `true` and a database trigger refuses `connected`. Every send goes to `integration_outbox` with status `simulated`.
- **Reason:** SPEC §18 rule 3 ("Never connect real integrations or send real messages"). One flipped env var can't send a real text by accident.

### 2026-10-26 · AI provider uses the official Anthropic SDK

- **Decision:** The disabled AI adapter is written against `@anthropic-ai/sdk` with an injected `fetch`, so tests never touch the network. It defaults to the `claude-opus-5-5` model and asks the API to fall back automatically when a request is refused. It stays behind the same three locks as every other provider.
- **Reason:** Using the official SDK (instead of hand-written HTTP) keeps request shapes current when it's switched on. Nothing calls it in this build.

### 2026-10-26 · Soft delete through one audited RPC

- **Decision:** Records are soft-deleted and restored only through `soft_delete_record(table, id, reason)` and `restore_record(table, id)`. They check permissions, require a reason, and only accept tables on an allowlist (territories, role templates and permission packs in Phase 1; more are added as tables arrive). Admin → Deleted Records lists them via `list_deleted_records()`.
- **Reason:** One path means one set of checks and one audit trail, instead of a `deleted_at` update in every Server Action.

### 2026-10-26 · Placeholders block nothing but are flagged

- **Decision:** Company Settings ship with `[PHONE]`, `[EMAIL]`, `[HOURS]`, `[LNI_NUMBER]` and `[UBI_NUMBER]`. The settings page flags each one as a placeholder. Later phases will refuse to send customer-facing documents while a placeholder is still in use.
- **Reason:** SPEC §18 rule 2 ("Don't invent business facts"). The owners haven't given these values yet.

### 2026-10-26 · Invites, deactivation and sign-out

- **Decision:** Inviting creates the Supabase Auth user and the profile on the server (service role, after the permission check). If the profile can't be created, the Auth user is removed again. The invitation email is written to the outbox as simulated; the person signs in with a magic link from `/login`. Deactivating turns the profile off (through the normal user client, so database guards apply) and then bans the Auth user so existing sessions stop working; reactivating reverses both. Deactivation will be blocked while the person still owns open work, until a reassign step exists (Phase 2+; today `open_work_counts()` is always empty). Sign out ends only the current device. Settings → Security has "Sign out of all devices".
- **Reason:** SPEC §4.1 (invite-only users, deactivate instead of delete) and SPEC §18 rule 3 (no real messages). Banning makes deactivation take effect right away instead of when the session token expires.

### 2026-10-26 · Only owners can change an owner's account

- **Decision:** Migration `20261026000500` adds one rule to the profiles guard: only an owner can change another owner's role, active status or email. Before, someone with `users:manage` could demote or deactivate an owner even though they couldn't make anyone an owner.
- **Reason:** Found in review. Owners hold every permission, so their accounts need the same protection as the Owner template itself.

### 2026-10-26 · Optional two-step sign-in

- **Decision:** Anyone can turn on two-step sign-in from Settings → Security. Once a person has a verified authenticator, the app asks for a code at every sign-in, even if their role doesn't require it. For roles that do require it (Owner, Bookkeeper), Postgres also refuses data access without it.
- **Reason:** Someone who chose to protect their account expects to be asked for the code. The database check stays tied to the role setting so it can't be bypassed for the roles that see money.

### 2026-10-26 · Simulated sends emit events; the outbox isn't audit-logged

- **Decision:** Each outbox row emits `outbox_message.created` with ids only (migration `20261026000400`). Outbox rows don't get `audit_log` rows: the outbox is itself the permanent record of what would have been sent, and copying message text and recipients into the audit log would spread personal data.
- **Reason:** SPEC §18 rule 9 (events for every mutation) and SPEC §13 (keep personal data to a minimum).

### 2026-10-26 · Admin screen details

- **Decision:**
  - **Audit Log:** filters are a plain GET form, so a filtered view is a shareable link and works without JavaScript. The table filter uses a fixed list of audited tables (`AUDIT_TABLES` in `lib/admin/audit-format.ts`), to be extended as later phases add tables. The person filter matches the actor and the owner viewing as them. Paging uses ids, 50 rows per page.
  - **Outbox:** emails and phone numbers are partly hidden in the list and the detail view.
  - **Picklists:** label edits save on Enter or when you leave the field and are not optimistic, so a clash keeps your text next to the message. Switches, selects and colors update at once. Reordering sends the full order and only the last move counts.
  - **Roles:** creating a template or pack takes two writes. If the second fails, the first is soft-deleted. A single database function would make this one step (known gap).
  - **Packs:** a warning appears when a pack grants managing users, editing permissions or View as, because whoever holds it can widen their own access.
- **Reason:** These follow SPEC §8.19 and §14 (plain-language, accessible admin screens) while keeping the logic in tested helpers.

### 2026-10-26 · E2E test isolation

- **Decision:** One shared test user per role, signed in once by `auth.setup.ts`. Specs that change session state sign in fresh with `loginAs`. Only one sign-in per email runs at a time, across all workers, because a new magic link cancels the previous one. Specs that change or deactivate users use throwaway users and delete what they create with the service role.
- **Reason:** Parallel runs were cancelling each other's sign-ins. The shared users must stay in a known state for the other specs.

---

## Phase 2 — Leads & Customers

### 2026-10-26 · "Team" scope means the same territory **[Deviation]**

- **Decision:** For permissions with `team` scope, a record is in scope when the person owns or created it, or when it is in their home territory (`profiles.default_territory_id`). Accounts take their territory from their primary property.
- **Reason:** SPEC §4.2 lists own/team/all scopes but the app has no teams. For a small Eastside company, "my city" is the natural team. It can be redefined later without changing any policy, since every policy goes through `app.scope_match()`.

### 2026-10-26 · Picklist values are stored as keys, checked by a trigger

- **Decision:** Lead source, sub-source, disposition, property type, siding type and lost reason are stored as picklist value **keys** (e.g. `google_ads`), and a database trigger refuses keys that aren't in the org's picklist. They aren't foreign keys to `picklist_values.id`.
- **Reason:** Keys are immutable and readable in filters, URLs, imports and the website intake. The trigger still gives the data quality SPEC §3.4 asks for: no "MD/Maryland/Md" drift. Turning a value off hides it from new choices without breaking old rows.

### 2026-10-26 · Gate and lockbox codes: app-level encryption, separate table

- **Decision:** Codes live in `property_secrets` as AES-256-GCM ciphertext (`v1:iv:tag:data`), encrypted by the app with `FIELD_ENCRYPTION_KEY`. A new permission, `properties:view_access_codes`, controls reading them (Owner and Office Manager for now). The ciphertext never enters the audit log. Phase 6 narrows reading to the assigned crew on scheduled days.
- **Reason:** SPEC §5.1/§13.1 asks for encrypted codes visible only to the right people. pgsodium is being phased out on Supabase; app-level encryption keeps the key out of the database entirely.

### 2026-10-26 · Convert to Job and real appointments wait for their phases

- **Decision:** Book Walkthrough stores the tentative date/time and owner on the lead and moves it to Walkthrough Scheduled. Convert to Job (and auto-convert on booking) arrives with jobs in Phase 3; calendar appointments and suggested time slots arrive with scheduling in Phase 6. The buttons show which phase brings them.
- **Reason:** Jobs and calendars don't exist yet. The lead fields are what the Phase 3 conversion will read.

### 2026-10-26 · Address lookup waits for the maps integration

- **Decision:** The New Lead wizard takes a typed address. Address autocomplete and the map preview turn on when the Address & Maps integration is connected. "Open in Maps" is a plain link to Google Maps search, not an API call.
- **Reason:** SPEC §18 rule 3: nothing connects to a real service in this build.

### 2026-10-26 · Website intake details

- **Decision:**
  - **Signature:** `X-BB-Signature: t=<unix>,v1=<HMAC-SHA256("<t>.<raw body>")>`. Signatures older than 5 minutes are refused.
  - **Rate limits:** the website passes the visitor's IP as `client_ip` _inside the signed body_ (5 submissions per visitor per 10 minutes). A looser limit applies per sending server (120 per minute). Limits use a small Postgres fixed-window table, so no extra service is needed.
  - **Safe resubmits:** `Idempotency-Key` is claimed before the lead is created, so a retried request never creates two leads.
  - **Honeypot:** a filled `company` field returns `200 { ok: true }` and stores nothing, so bots learn nothing.
  - **Duplicates:** the same phone or email within 180 days adds the new submission to the existing lead as an inbound "portal" message, fills in contact details that lead was missing (never overwrites) and notifies its owner.
  - **Photos:** uploaded first to a private bucket with a signed upload URL. Only files that really exist under the company's folder are attached.
- **Reason:** SPEC §14. Because the website signs requests on its own server, every request comes from that server's address. Rate limiting by connection address alone would throttle all leads together.

### 2026-10-26 · The "we got your request" text waits for workflows

- **Decision:** No automatic acknowledgement text is sent on new website leads in Phase 2. It arrives with the Phase 8 workflow engine, through the outbox, with wording marked "Draft – owner to approve".
- **Reason:** It's an automation with customer-facing wording the owners must approve. The speed-to-lead clock already starts, and only a human touch counts as first contact (SPEC §6.1).

### 2026-10-26 · Lead score computed in TypeScript, stored with its reasons

- **Decision:** `lib/domain/leads/scoring.ts` computes the score from the lead and the editable `lead_scoring_rules`. The result is stored on the lead with the list of factors and the time it was scored. Scores are recomputed when a lead is created or edited, a photo is added, or a message is logged; Admin → Lead Scoring can recalculate open leads after the weights change.
- **Reason:** CLAUDE.md: business logic lives in pure, tested functions. Storing the result keeps list sorting and filtering by score fast and explainable ("why this score").

### 2026-10-26 · Speed to lead: business hours, first human contact, write-once

- **Decision:** The first call, text or email a _person_ logs sets `first_contacted_at` and `speed_to_lead_seconds` (business hours only, Pacific, from Company Settings; DST-safe). The database refuses to change either afterwards.
- **Reason:** SPEC §1.3 promises a text "within a few minutes during business hours". A lead that arrives at 9 pm and gets a call at 8:05 am scores 5 minutes. Write-once keeps the KPI honest.

### 2026-10-26 · Shared list framework

- **Decision:**
  - **URL state:** everything (tab, chips, search, Advanced rules, sort, page, saved view) lives in the URL, so a filtered list is a shareable link and Back works.
  - **Advanced filter:** rules are validated against each module's field whitelist and turned into quoted PostgREST filters. Unknown fields, operators or columns never reach the database. Date rules use Pacific calendar days.
  - **Quick selects** (Source, City) edit an "equals" rule in the Advanced filter. Lead-source chips are either/or.
  - **Columns:** per-user choices are saved in the profile's preferences. Saved views store their own columns.
  - **Table:** a plain semantic table rendered on the server. TanStack Table isn't needed because sorting, paging and filtering all happen in the database.
- **Reason:** SPEC §8 "Lists". One framework for Leads, Accounts and Contacts now, and Jobs next.

### 2026-10-26 · Universal search and recent records

- **Decision:** `search_records()` runs with the user's own permissions, so results include only records they may open. It matches name, email, address, and phone digits (4+ digits). "Recent records" in the search box are remembered in the browser (localStorage, last 8) and never sent anywhere.
- **Reason:** SPEC §8.1. Server-side recent-record history would need another table for little gain at this size.

### 2026-10-26 · Notifications and messages are append-only for people

- **Decision:** Notifications are written by database triggers and trusted server code (mentions, repeat website submissions). People can only mark their own as read (a column-level grant). Messages are append-only; texts and emails must reference their outbox row. Message text stays out of the audit log.
- **Reason:** SPEC §5.7, §13.1 and §18 rule 3. A message log that can be edited isn't a record.

### 2026-10-26 · Metrics registry shape and lead rates

- **Decision:**
  - Each metric in `lib/metrics/registry.ts` names the server-side RPC it reads (`lead_stats`), its unit and a plain-words formula, and has a pure `compute`. The payload is parsed with zod; a missing or malformed field reads as 0. Chart data (status, funnel, sources, cities, aging) is built in the registry too, so components do no math.
  - Rates are clamped to 0–100%. When there's nothing to divide by, the card shows "—" instead of 0%.
  - Lead → Contact, Walkthrough Rate and Conversion to Job are each divided by **all leads** in the period. The funnel also shows each step as a % of the step before it. _Owners to confirm_ whether Walkthrough Rate should be ÷ contacted leads instead.
- **Reason:** CLAUDE.md: every KPI comes from the registry, aggregated on the server.

### 2026-10-26 · Dashboard charts and accessibility

- **Decision:** Charts are hidden from screen readers and described by one spoken summary; every chart has a "View data" table, which is the accessible version. Bars use the brand green (a light tint of it for "not converted yet"). "Download CSV" is disabled until Export Controls (Phase 10). Lead Aging links open the list filtered by Pacific calendar day, so a bucket's link can differ from its count by part of a day at the edges (the View data dialog says so).
- **Reason:** SPEC §8.3 and WCAG 2.2 AA. Exact aging links would need extra list chips; not worth it yet.

### 2026-10-26 · Recalculating lead scores needs two permissions

- **Decision:** Admin → Lead Scoring saves only the rules that changed. "Recalculate open leads" needs `settings:manage` **and** `leads:update`, uses the person's own session, and rescores up to 2,000 of the newest open leads. Otherwise a score updates the next time its lead changes.
- **Reason:** Recalculating edits leads. Without `leads:update`, row security would silently skip leads and the result would look complete when it isn't.

### 2026-10-26 · New Lead wizard details

- **Decision:**
  - **Completion %** counts 17 useful fields. Company, unit and sub-source are left out, so an ordinary residential lead can reach 100%. _Owners to confirm the list._
  - **Home built:** typing a year built fills in the "home built" choice (in the browser and again on the server). A choice the person picks wins over the year.
  - **Duplicates** are a notice, not a block. The notice never includes the id of a lead the viewer can't open; it shows name, status and owner and says who to ask.
  - **Photos** upload after the lead is saved, through one-time signed URLs into the private bucket. A failed upload never undoes the lead. Each file is confirmed in storage before it's attached, and the attachment is inserted with the person's own session, so row security checks they may edit the lead.
  - A scoring failure after saving is logged, not shown as a save error (otherwise people save twice).
  - Unavailable footer buttons (Call / SMS / Email before saving, Save & Convert until Phase 3) use `aria-disabled` so their explanation tooltips stay reachable by keyboard.
  - The lead-safe note for homes built before 1978 is **Draft – owner to approve**.
- **Reason:** SPEC §8.4 "New Lead"; CLAUDE.md rules on permissions and placeholders.

### 2026-10-26 · Deleting a record also needs edit rights on it

- **Decision:** New migration `20261026000800_scoped_soft_delete`. `soft_delete_record()` runs with elevated rights, so row security doesn't apply inside it, and it only checked the delete permission. It now also requires that the record is within the person's **edit** scope (leads and accounts by owner/creator/territory; contacts and properties through their account). Records outside scope answer "Record not found." so the function doesn't reveal they exist. Deleted leads, accounts, contacts and properties now show in Admin → Deleted Records for owners to restore.
- **Reason:** Delete permissions aren't scoped. A custom grant of `leads:delete` to an estimator would otherwise have let them delete other estimators' leads. Covered by `supabase/tests/008_scoped_soft_delete.test.sql`.

### 2026-10-26 · Accounts, contacts and gate codes

- **Decision:**
  - **Gate codes** are only revealed by a server action that reads the row as the person (row security) and decrypts on the server. The encrypted value never reaches the browser. Viewing, setting, replacing and removing a code each go on the account timeline.
  - **Consent:** opting in needs a source; texts need a mobile and email needs an address. A new opt-in is time-stamped; turning it off, or Do Not Contact, clears the time and source. A contact who replied STOP can't be opted back in from the screen. _Owners to decide who may re-opt someone in, and with what proof._
  - **New account** saves the account, primary contact and first property as separate steps. If a later step fails, the ones already saved are removed and the message says nothing was saved. A single database transaction (an RPC) is a later hardening item.
  - **Account search** also matches property addresses (a second query, capped at 200 matching accounts).
  - **Contacts → Mine** means "the account's owner is me".
  - The first property on an account is primary; marking another one primary unsets the old one.
  - The account timeline shows entries the app writes (account created, gate-code events). Database activity triggers for accounts and contacts come later, so a contact's timeline is empty for now.
  - Account and contact KPI strips count on the server but aren't in the metrics registry yet; they move there with account/contact stats RPCs. **[Deviation from "every KPI from the registry", temporary]**
- **Reason:** SPEC §8.5, §8.6, §13.1; gate codes per the 2026-10-26 entry above.

### 2026-10-26 · Lead Detail details

- **Decision:**
  - **Contact bookkeeping** after a text, email or logged call runs on the server with elevated rights, once the message itself was allowed: recording first contact (speed to lead), moving New → Contacted, rescoring, and turning a call outcome into the disposition. The person is recorded as the actor. Someone who may message a lead but not edit it still stops the speed-to-lead clock.
  - **Do Not Contact** blocks texts and emails; logging a call that already happened is still allowed. _Owners to confirm._
  - Sends go through the SMS/email adapters into the outbox only ("Simulated – not sent"); the action refuses any other provider.
  - A task due date without a time is due at 5:00 PM Pacific. A walkthrough can't be booked in the past.
  - Each tab shows the latest 200 items with a notice; paging comes later. The activity thread is newest first.
  - Manually changing the status to Contacted doesn't count as first contact. _Owners to decide._ Quiet hours aren't applied to one-to-one texts yet (SPEC §13.2 is about marketing). _Owners to decide._
- **Reason:** SPEC §8.4 "Lead Detail", §13.

### 2026-10-26 · Trusted server code may delete messages

- **Decision:** Migration `20261026000900_messages_trusted_delete`. Messages stay append-only for people: no one signed in can edit or delete one. The service role may delete (never edit), so test cleanup and the Phase 10 demo-data purge can remove messages and the outbox rows they reference. Deletes are audit-logged.
- **Reason:** Before this even the service role was refused, so test runs left orphan messages and outbox rows behind, and the demo purge would have hit the same wall.

### 2026-10-26 · Lead List performance at 50k leads

- **Decision:** Migration `20261026001000_lead_list_performance`:
  - Indexes on leads that match the list's default sort (`created_at desc nulls last, id`), plus one led by status for the tabs that includes the columns row security reads (two older indexes that didn't match were replaced).
  - Row-security policies for leads, accounts, contacts, properties and tasks spell out the scope rule (all / own / team) instead of calling `app.scope_match()`. Same rule; covered by the existing per-role SQL tests.
  - `lead_status_counts()` reads the current user once; `lead_stats()` aggregates in a few passes. Results checked identical to the old functions on 50k leads (ties in the source and city top lists are now ordered by name).
- **Reason:** SPEC Phase 2 "done when": < 300 ms at 50k leads. Before: tab counts 759 ms, dashboard 466 ms, page 1 147 ms. After: 18 ms, 141 ms, 4 ms. Full table in `docs/PERFORMANCE.md`. Postgres can't inline a SQL function whose arguments are sub-selects used more than once, so `scope_match()` ran as a real call on every row.

### 2026-10-26 · Sub-source rule on edits

- **Decision:** The sub-source rule (required when the source has sub-sources; must belong to the source) lives in `lib/domain/leads/sub-source.ts`. New leads always follow it. Edit lead checks it only when the source or sub-source changes, so a lead saved before the rule, or a website lead without one, can still have its email or address fixed.
- **Reason:** Blocking an unrelated edit over a field the person didn't touch would be confusing.

## Phase 3 — Jobs core

### 2026-10-26 · advanceJobStage() is enforced by the database

- **Decision:** The `stage` column changes only inside `public.apply_job_stage_change()`, which sets a transaction-local flag the jobs guard checks; even the service role can't update the stage directly. Only the service role may call the function, and only from `lib/jobs/stage.ts` `advanceJobStage()` after its permission and visibility checks. The function re-checks the rules itself: one stage forward when the gate passes, Closed Lost with a lost reason, anything else (skip, back, reopen, a closed gate) needs an owner override with a reason of at least 10 characters by someone holding `job_admin:override`. Every change writes `stage_history` (with a sequence number for exact order), an activity entry and a `job.stage_changed` event, and stamps that stage's milestone the first time.
- **Reason:** SPEC §6.2 "the only code path that changes stage" and Phase 3 "done when: a gate can't be skipped without owner override + reason". Enforcing it in the database means no future screen or script can bypass it. The gate list in `app.job_gate_passes()` and `lib/domain/jobs/gates.ts` must agree; both are tested.

### 2026-10-26 · Gates for later modules stay closed until those modules exist

- **Decision:** Only the walkthrough gate ("completed with result Measured") and Paid in Full → Closed Won can pass on their own in Phase 3. Every other gate (estimate sent, accepted, deposit invoice, onboarding cleared, schedule published, work orders, punch list, final invoice, balance) says which phase brings its check, and only an owner override moves a job past it. Non-owners can request the override; it goes to Approvals.
- **Reason:** Faking those checks with milestone dates would let jobs slip past gates silently. Overrides are explicit, reasoned and audit-logged, and each later phase replaces one closed gate with a real check.

### 2026-10-26 · Blocking holds stop scheduling even with an override

- **Decision:** A hold with "blocks scheduling" (default on) stops a job from entering Ready to Schedule or any later stage, override or not, until it's released. Holds never change the stage; they overlay it and set the job's status to On hold.
- **Reason:** SPEC §6.2 "Holds … block Ready to Schedule / scheduling". An override is for a missing check, not for skipping a known blocker such as an unpaid deposit or a missing HOA approval.

### 2026-10-26 · Contract money is a separate table; baseline until estimates

- **Decision:** Contract amounts live in `job_financials`, readable only with `financials:read` and writable only with `job_admin:override`. Until estimates exist (Phase 4) an owner sets a **contract baseline** in the job's Admin section; dashboards use it. Phase 4 derives the contract from the accepted estimate plus change orders.
- **Reason:** SPEC §4.2 field masking: crew roles must not read contract amounts even through the database. A separate table is simpler and safer than column-level grants, which break `select *`.

### 2026-10-26 · "Own" jobs include the job team

- **Decision:** A job counts as yours (own scope) if you own or created it, or you're its point of contact, project manager or on its internal team. The list is kept in `jobs.team_user_ids` by triggers so row security stays a fast array check.
- **Reason:** Crew leads and painters see their assigned jobs (SPEC §4.1) without a join in every policy.

### 2026-10-26 · Lead conversion is one database transaction

- **Decision:** `public.convert_lead_to_job()` (service role, after `convertLeadToJob()` checks `jobs:create` and edit rights on the lead) reuses a matching contact (same mobile, phone or email in the company), its account, and a property with the same street and ZIP; otherwise it creates them ("Smith Residence"). It creates the job at Walkthrough Scheduled named "Lastname – City – Work types", moves the lead's notes, comments, tasks and walkthrough appointment to the job, and links both ways. Messages and activity stay on the lead (messages are append-only) and the job's Messages and Activity sections show them. Lead photos stay on the lead until the Photos module (Phase 5).
- **Reason:** SPEC §6.1. A single transaction never leaves half a conversion behind (the account create in Phase 2 wasn't atomic).

### 2026-10-26 · Booking a walkthrough creates an appointment and converts

- **Decision:** Booking a walkthrough now creates an `appointments` row (60 minutes, assigned to the lead owner); a trigger keeps `leads.walkthrough_at` in sync. When Company Settings "Convert to job when a walkthrough is booked" is on (default) and the person can create jobs, the lead converts right away. If converting fails the booking still stands and the screen shows why. Existing booked walkthroughs were copied into appointments by the migration.
- **Reason:** SPEC §6.1 ("automatically when the walkthrough is booked (setting, default ON)") and §5.4.

### 2026-10-26 · Attention engine: pure rules + a sync plan, every minute

- **Decision:** Rules are pure functions (`lib/domain/attention/rules.ts`) over a snapshot of open leads, upcoming walkthroughs, open jobs and pending approvals. A pure planner (`sync.ts`) turns "what should be open" into inserts, escalations (same item, new priority), auto-resolves, snooze wake-ups and "condition cleared" marks. The worker applies it every minute. An item a person resolved stays resolved while the problem persists (no nagging) and can open again after the problem clears. Critical and high items notify their owner. Thresholds are editable in Admin → Attention Rules; SLA numbers come from Company Settings.
- **Rules in Phase 3:** untouched new lead, aging lead, walkthrough not confirmed, estimate SLA, approval waiting, sold with no deposit, onboarding stalled, ready not scheduled (exteriors only count in season), start date missed. Weather, paint, crew, daily log, punch list, invoice, unread message, warranty and subcontractor rules arrive with their modules.
- **Reason:** SPEC §9 and CLAUDE.md rule 7 (attention rules are pure, tested functions).

### 2026-10-26 · Background worker route

- **Decision:** `/api/cron/worker` runs every minute (Vercel Cron, `vercel.json`) with `Authorization: Bearer $CRON_SECRET`; without the secret it answers 503, with a wrong one 401. It's exempt from the sign-in redirect for that reason. Each run: claims queued events with `claim_events()` (SKIP LOCKED, retries with back-off, stuck events retried after 5 minutes), notifies the job team of stage changes and owners of approval requests, auto-closes jobs 3 days after Paid in Full, refreshes job health (only writing when it changed) and runs the attention sweep. Other events are marked "skipped" until workflows arrive (Phase 8).
- **Reason:** SPEC §2 (events outbox + worker route hit by Vercel Cron). Note: per-minute crons need a Vercel Pro plan; on Hobby the schedule must be daily — owners to confirm the plan before deploy.

### 2026-10-26 · Job health counts only checks whose data exists

- **Decision:** Health is computed in `lib/domain/jobs/health.ts` from weighted checks chosen by stage (point of contact, walkthrough/final walkthrough booked, no overdue tasks, stage not stale, contract signed and deposit paid dates, start date on track). Checks for later modules (onboarding, crew, daily logs, photos, balance) are listed as "arrives in Phase N" and never lower the score. Closed jobs have no score.
- **Reason:** SPEC §6.5. A score that drops for things nobody can fix yet would be noise.

### 2026-10-26 · Admin sections moved

- **Decision:** Notification Settings moves to Phase 8 (with messaging and workflows) and Job Recovery to Phase 10 (hardening); the job's own Admin section covers fixing dates and stages now. Admin → Attention Rules is new in Phase 3.
- **Reason:** Their data and use cases arrive with those phases.

### 2026-10-27 · Attention and Approvals counts are registry metrics

- **Decision:** The Attention Center cards, the Attention nav badge and the Approvals cards read `ATTENTION_METRICS` / `APPROVAL_METRICS` in `lib/metrics/registry.ts`. Attention counts come from `attention_summary()` (one Postgres query, row-security scoped). Approval counts are server-side `count: "exact", head: true` queries; decided counts cover the last 30 days (`APPROVAL_DECIDED_WINDOW_DAYS`).
- **Reason:** CLAUDE.md "Every KPI comes from lib/metrics/registry.ts". The first build of these screens counted inline; this moves them before the phase closes.

### 2026-10-27 · Record-level totals aren't registry KPIs

- **Decision:** The Customer section's "Lifetime contract value" is the sum of contract baselines on that account's jobs, computed by a tested helper (`app/(app)/jobs/[id]/_sections/feed-utils.ts`). It isn't a dashboard KPI, so it doesn't go through the registry. Lost jobs are left out, and people without `financials:read` don't see it.
- **Reason:** The registry holds aggregate KPIs across many records. A total on one record page is a display figure. Owners to confirm whether lost jobs should count.

### 2026-10-27 · Job screens details

- **Jobs Dashboard:** "Closing This Month" = open jobs whose estimated completion date falls in the period. Pipeline value and In Progress are "right now" figures with no prior-period comparison (`job_stats()` keeps no history). Win rate counts every closed job, overrides included.
- **Job List:** stage chips cover all 14 stages; the closed stages' chips appear only on the All tab. On phones the list starts as cards. Filters, view and layout live in the URL like the Lead List.
- **Job Detail:** 16 sections in a left rail (a select on phones). Overview, Admin, Notes, Activity, Customer, Messages, Tasks and Schedule (appointments) work now; Onboarding, Estimate, Financial, Photos, Documents, Work Orders, Daily Logs and Punch List show what arrives in which phase. Calendar dates (promised and actual start) display as plain dates, not converted from UTC, so they don't shift a day. "Release all holds" needs a note; releasing one hold doesn't. Appointments with no assignee go to the job owner, or else the person booking.
- **Job messages:** `lib/jobs/messaging.ts` is separate from lead messaging because the recipient is the job's primary contact. SMS goes to the mobile number only; calls use mobile or phone. Everything goes through the outbox as simulated.
- **Approvals:** requesters see their own requests; owners see everyone's. If the job has already moved since the request, Approve is turned off ("out of date") and the owner rejects or the requester cancels it.
- **Attention Center:** "Prioritize" ranks up to 2,000 matching items by urgency score on the server (scores depend on the current time, so they can't be a stored sort column). Past 2,000 the page says the ranking is partial and suggests a filter; that's far beyond this company's volume. Snooze presets: 1 hour, tomorrow 8 am, next Monday 8 am (Pacific).
- **New Job** starts from an existing customer (account, property, contact). Creating a customer inline waits for owner feedback. Accounts get a "New job" button; the New Lead wizard's "Save & Convert" saves the lead and converts it in one go.
- **Reason:** SPEC §8.5–§8.9. Recorded so the owners can review the choices; open questions are in the Phase 3 report.

## Phase 4 — Estimating

### 2026-10-27 · Pricing engine: per line, margin pricing, fixed quote order

- **Decision:** `lib/domain/estimating/*` (re-exported by `lib/estimating/engine.ts`) prices each line on its own. Production-rate lines: labor hours = quantity ÷ units-per-hour × height × access × coat factor (+ prep hours × prep factor, + lead-safe %), paint gallons from coverage × coats (+ waste), rounded up to containers per line (3+ quarts buy a gallon, 4+ gallons buy a 5-gallon pail, only sizes the product comes in); cost = labor + paint + sundries; price = cost ÷ (1 − target margin). Flat lines are quantity × unit price. The option total runs in one order: lines + chosen add-ons + RRP supplies → job minimum → discount → tax → total → deposit. Change orders use the same line math with no minimum, discount or deposit, and credits make lines (and totals) negative.
- **Reason:** SPEC §7.3–7.4. Rounding per line matches how paint is bought for each surface/color; one fixed order keeps the PDF, the proposal page and the database totals identical. The engine is pure and 100% covered (`pnpm test:coverage` enforces it in CI).

### 2026-10-27 · Discount approvals use the effective discount

- **Decision:** The builder compares what the customer would pay with the computed (pre-override, pre-discount) price, per option and with every add-on. The worst case is the version's effective discount %. Sending is blocked when it's above the sender's limit (per-user limit, else role limit from Estimate Setup, else 0%; people with `estimates:approve_discount` have none) unless an owner approved at least that much. Requests go to Approvals as `estimate_discount`.
- **Reason:** SPEC §7.4 / §8.5. Price overrides and discounts both lower the price, so one number catches both.

### 2026-10-27 · Sent versions are frozen; the proposal is a snapshot

- **Decision:** Sending stores a customer snapshot (`estimate_versions.proposal`) and freezes the version (guards refuse edits to sent content). Changes mean "New version", which copies the version as a draft; sending it replaces the old link (the old token is revoked and shows "There's a newer version"). Drafts are re-priced live with today's catalog; sent versions show their stored numbers.
- **Reason:** What the customer signs must never change underneath them; a price-book edit can't move a sent number.

### 2026-10-27 · Proposal links: hashed tokens, one accept transaction

- **Decision:** Links carry a 256-bit random token; only its SHA-256 is stored. The page is public (`/p/[token]`), rate limited per address (views 120/10 min, accept 10/10 min per address and 8 per link, PDF 30/10 min). If the limiter itself errors it lets the request through (a customer shouldn't be blocked by our outage). Accepting runs `accept_estimate()` in one transaction: signature (typed name, drawn PNG + hash, IP, user agent, consent text, time), version and estimate accepted, job financials, deposit invoice (draft), a Deposit Hold, onboarding requirements, paint-order and work-order drafts and the color schedule. Then `completeAcceptance()` renders the signed proposal + contract PDF into the private `documents` bucket and moves the job Walkthrough Complete → Estimate Sent → Sold → Onboarding through the normal gates. It is idempotent; the worker re-runs it on `estimate.accepted` if the first try failed.
- **Reason:** SPEC §7.5. A partial acceptance (signed but no invoice) would be worse than a retry.

### 2026-10-27 · Deposit invoice is drafted, untaxed, and Phase 7 sends it

- **Decision:** The deposit invoice is `deposit %` of the accepted total (tax included in the total; the deposit line itself isn't taxed again), created as a draft. With a 0% deposit no invoice is made and the Sold gate passes on acceptance. A Deposit Hold blocks scheduling until the deposit is paid (Phase 7).
- **Reason:** Sending invoices and taking payments arrive with Money (Phase 7); the gate only needs the invoice to exist.

### 2026-10-27 · Contract amount = accepted estimate + signed change orders

- **Decision:** `job_financials.contract_cents` is a generated column: accepted estimate total + signed change orders, or the Admin baseline when nothing is accepted. Dashboards, lists and job health read it. Change orders marked "bill separately" (the default) get a draft change-order invoice when signed.
- **Reason:** SPEC §7.7. One stored truth for the contract, derived, never typed in.

### 2026-10-27 · Sample numbers are flagged in the database

- **Decision:** Every seeded price-book item, paint product, production rate and the Estimate Setup row is `is_sample = true` ("Sample – Erik to calibrate"). Saving a row clears the flag (the database never lets anyone set it back); saving the Estimate Setup pricing records who calibrated it and when. Tax starts at 0% and "not confirmed with our accountant". The builder, Price Book and Estimate Setup show Sample badges until then.
- **Reason:** CLAUDE.md "Don't invent business facts". The builder is usable today without anyone mistaking the sample prices for real ones.

### 2026-10-27 · Draft legal and customer wording

- **Decision:** The exterior "What's included" list is the website's text (approved). Interior, cabinets and deck/fence lists, the guarantees and the four agreement templates are drafts with [SLOTS] for L&I/UBI numbers, warranty terms and the lead-safe disclosure. Customers see "Draft – owner to approve" / "Draft – owner/attorney to approve" labels until an owner approves or publishes. Publishing a template needs every slot filled, the required merge fields and an owner's confirmation. The e-sign consent sentence (`ESIGN_CONSENT`) is also draft wording for the owners' attorney.
- **Reason:** CLAUDE.md rule 2. The flow works end to end; the words are theirs to approve.

### 2026-10-27 · PDFs stream through the app

- **Decision:** Office PDFs (`/jobs/[id]/estimate/[versionId]/pdf`, change orders, color sheet, invoices, stored documents) check the person's permission and row security, then the server renders or reads the file and streams it. The customer's signed copy streams from `/p/[token]/pdf`. No storage URLs reach the browser.
- **Reason:** The bucket stays private and every download goes through the same permission check.

### 2026-10-27 · Builder details

- **Decision:** Lines added for a pre-1978 (or unknown-age) home default to lead-safe when they disturb paint. The measurement helper (room walls, ceiling, baseboard, exterior wall with gable factor, fence) fills the quantity and keeps the measurements on the line. Crew leads (`change_orders:draft`) report a scope change from the field without prices; owners are notified and price it. Onboarding requirements show read-only on the job until Phase 5 adds verification.
- **Reason:** SPEC §7.2–7.7, §6.4.

### 2026-10-27 · Embedding hints for estimates ↔ jobs

- **Decision:** `jobs.accepted_estimate_id` adds a second relationship between jobs and estimates, so PostgREST embeds between them name the foreign key (`jobs!estimates_job_id_fkey`, `estimates!estimate_versions_estimate_id_fkey`).
- **Reason:** Without the hint the query fails at run time (PGRST201); the generated types don't catch it.

## Phase 5 — Onboarding, documents & photos

### 2026-10-27 · Onboarding checks run in TypeScript; the gate reads stored results

- **Decision:** Each requirement's auto-verify rule is a pure function in `lib/domain/onboarding/rules.ts` over a job snapshot (signed document, change orders, deposit invoice and applied payments, contact, property access fields, color schedule, color consult, HOA and lead-safe documents, paint orders, prep-instructions message, promised start vs season). `lib/onboarding/checks.ts` loads the snapshot with the service client and writes the results through `apply_onboarding_checks()` (service role only), which touches only rows whose result changed and never overwrites a manual clear (a verified row with `verified_auto = false`). The Onboarding → Ready to Schedule gate (TS `exitGate` and SQL `app.job_gate_passes('onboarding')`) is "the checklist exists, every required row is verified, and no hold blocks scheduling". `advanceJobStage()` re-runs the checks before it reads that gate.
- **When the checks run:** right after acceptance, after a change order is signed, after every onboarding action and document change, on "Re-verify all", and in the worker every minute for jobs in Sold or Onboarding (up to 500 per run; far above this business's volume).
- **Reason:** SPEC §6.4 / CLAUDE.md rule 7 (business logic as pure, tested functions). One SQL function for the gate keeps `advanceJobStage()` and the database in agreement; checks stay cheap because unchanged rows aren't written.

### 2026-10-27 · Jobs move to Ready to Schedule on their own

- **Decision:** When a check run finds the gate passes and the job is in Onboarding, it calls `advanceIfGatePasses(onboarding → ready_to_schedule)` (never an override). So clearing the last item, uploading the HOA approval or the worker's sweep moves the job; stage history records it as a normal, non-override move.
- **Reason:** SPEC §11.2 #7 "Onboarding cleared → Ready to Schedule". The notification to the scheduler waits for workflows (Phase 8); the job team already hears about stage changes.

### 2026-10-27 · People clear items with a note; everything else is the checks' job

- **Decision:** The database guard lets a person (with `jobs:update` on the job) only mark an item cleared with a note of at least 3 characters, reopen an item they (or anyone) cleared by hand, record that it was requested from the customer, or link a task. Statuses missing / needs review / not required, labels, "required" and the check results are written only by trusted code. A manual clear is stamped with who and when, shows on the timeline, and stands until someone reopens it.
- **Reason:** SPEC §6.4 actions (Request from customer, Upload, Create task, Mark cleared with note). Phase 5 has no payments, crews or paint-ordering screens, so those items need an honest, audited manual path that the checks can't silently undo.

### 2026-10-27 · Deposit check is designed against the ledger; pending until Phase 7

- **Decision:** `depositRule()` takes the live deposit invoice and the cents applied to it. Until payments exist (Phase 7) the loader passes `appliedCents: null`, so the item stays Pending with "Recording payments arrives in Phase 7. Until then, mark this cleared with a note." Clearing the deposit item (by hand now, by the check in Phase 7) releases the job's Deposit Hold in the same transaction (`onboarding_requirements_after` trigger). Job health counts the deposit as paid when `deposit_paid_at` is set or the deposit item is cleared.
- **Reason:** SPEC §6.4, §11.2 #6. Phase 7 only has to pass the applied amount; nothing else changes.

### 2026-10-27 · Rules whose data comes later

- **Decision:** Crew assigned (skills) and the certified-renovator part of the lead-safe item report Pending "arrives in Phase 6"; Paint ordered is real (paint order status ≥ ordered) but the paint order queue to change that status arrives in Phase 6. "Repair scope approved" passes when the accepted estimate includes a repair allowance the customer accepted (option line or chosen add-on) or a change order is signed. "Required" is fixed at acceptance except the HOA item (follows exterior work + the property's HOA flag) and change orders (required once one is sent).
- **Reason:** No fake verification; the manual clear covers the gap.

### 2026-10-27 · Prep instructions and requests are template-keyed messages

- **Decision:** `messages.template_key` (new column) tags messages sent from onboarding: `prep_instructions` clears the Prep item when a message with that key was sent or simulated; other requests use `onboarding_contact|access|colors|hoa|lead_safe`, and photo shares use `photo_share`. Message drafts live in `lib/onboarding/messages.ts` (plain, short, signed by the sender) and are marked "Draft wording – owner to approve"; Phase 8 templates replace them. Everything goes through the outbox as simulated.
- **Reason:** SPEC §6.4 "template message logged (sent or simulated)", §2.1.

### 2026-10-27 · Cases wait for Phase 8

- **Decision:** The Onboarding "Cases" tab and "Open cases" tile say Cases arrive in Phase 8 (with warranty cases). The Onboarding Board's Service/Warranty tab and Open Warranty/Service KPI do the same.
- **Reason:** PLAN puts cases (customer issues and warranty requests) in Phase 8; building a throwaway case table now would need a migration rewrite later.

### 2026-10-27 · Onboarding Board lives under Schedule

- **Decision:** `/schedule/onboarding` (Schedule ▾ → Onboarding Board), as the nav already listed. Lanes come from the job's stage and active holds (`lib/domain/onboarding/board.ts`): Sold/Onboarding with a Deposit Hold → Deposit Hold; with another blocking hold → On Hold / Expediting; otherwise Needs Onboarding; Ready to Schedule (any hold → On Hold); Scheduled, In Progress, Final Walkthrough → Scheduled / In Progress; Completed, Invoiced → Invoicing / Collections; Paid in Full plus jobs closed won after being paid this month (Pacific) → Paid in Full. Time in a lane starts when the hold that put the job there was placed. Cards count as overdue past the attention-rule thresholds (sold with no deposit, onboarding stalled, ready not scheduled).
- **Moves:** only Needs Onboarding → Ready to Schedule changes anything, through `advanceJobStage()` (which re-runs the checks). Every other drop says what to do instead (release the hold, Master Schedule in Phase 6, payments in Phase 7, override for moving back). Each ready card also has a button, so the move works without dragging. The whole board set (up to 2,000 jobs) is loaded on the server so lane totals and KPIs count every job; lanes show 60 cards each.
- **Tabs:** Board, Expedite (held or overdue, longest wait first), Data Audit (missing contact info, property, point of contact, sold date, checklist, promised start), Reporting (lane totals), Call Log (calls logged on board jobs); Service/Warranty waits for Phase 8. "% collected" and Outstanding show "—" until Phase 7; the "Under 30% collected" filter is left out until then.
- **Reason:** SPEC §8.7; the nav in Phase 0 already put it under Schedule.

### 2026-10-27 · Photo privacy: re-encoded on upload, originals not kept

- **Decision:** The browser shrinks each photo to 2,560 px and re-encodes it as JPEG (smaller uploads on weak signal; that drops EXIF). The server re-encodes again with sharp (`.rotate()` from EXIF orientation, resize, JPEG without metadata) and writes a 480 px thumbnail; the original file is never stored, so GPS location, camera details and timestamps never reach storage or a customer. `job_photos.exif_stripped` is always true (checked). Server-side thumbnails are done (no gap). `sharp` became a direct dependency (it already shipped with Next).
- **Reason:** SPEC §13.1 "EXIF location stripped from customer-facing copies". Stripping on upload is simpler and safer than keeping two copies and remembering to share the right one. Owners lose the GPS proof-of-location on photos; if they want it later, it can be kept as a separate, staff-only field.

### 2026-10-27 · Files: photos by signed links, documents through the app

- **Decision:** Photos live in a new private `photos` bucket; the gallery gets 10-minute signed links made on the server after the person's row-security read (one batch call per page). Documents stay in the private `documents` bucket and stream through `/api/files/documents/[id]` after the same check (inline for PDFs and photos, download otherwise). That route may be framed by our own pages only (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`) so PDFs preview in a dialog; everything else stays `DENY`. Uploads of documents go straight from the browser to storage through a one-time signed upload URL, then the server checks the stored object (size, type) and inserts the row with the person's own client. Allowed document types: PDF, JPEG/PNG/WebP/HEIC, Word, Excel, text, CSV, up to 25 MB.
- **Reason:** SPEC §13.1 (private buckets, short-lived signed URLs). A gallery of thumbnails through the app server would be slow; documents keep Phase 4's streaming so crew permission checks happen on every download. Vercel's 4.5 MB request limit rules out uploading documents through a route.

### 2026-10-27 · Offline queue: IndexedDB, idempotent uploads, minimal service worker

- **Decision:** `lib/offline/queue-core.ts` (pure, tested) queues uploads with a client id; `idb-store.ts` keeps them in IndexedDB (memory if unavailable); `OfflineSyncProvider` (in the signed-in layout) uploads when the browser goes online, every 30 s while anything waits, and right after each capture, with back-off (5 s doubling to 5 min) for network/5xx/429 and "failed, retry or discard" for refusals. The photo route treats the client id as an idempotency key (`unique (job_id, client_id)`), so a retry after a lost response never duplicates. Phase 6 adds a `daily_log` uploader to the same queue. The service worker (`public/sw.js`, production only) caches hashed static files and an `/offline` page and never caches signed-in pages or API responses. The job header and Camera page show "Offline ready · Last synced 4:51 PM", or what's waiting.
- **Reason:** SPEC §2 PWA, PLAN Phase 5 "offline photo capture syncs after reconnect". Caching job pages offline would put customer data on shared phones; "Download job" for offline reading is left for later (gap).

### 2026-10-27 · Documents can move between a customer's jobs

- **Decision:** Uploaded documents can be renamed, recategorized, marked "awaiting signature", moved to another job of the same customer or kept on the customer only (account documents show on the customer page and in the job's Documents under "On the customer"). Generated documents stay on their job; signed documents can't be deleted. Deletes are soft (`soft_delete_record`, `documents:manage` plus edit rights) and restorable in Deleted Records, which now also lists jobs (they were missing from the screen since Phase 3), documents and photos.
- **Reason:** SPEC §8.5 #7, §8.13 "link to job/account"; signed paperwork is a legal record.

### 2026-10-27 · Required shots come from the accepted scope

- **Decision:** The Photos checklist lists, per work type, Before and After once per area of the accepted option (rooms, elevations, cabinet runs) and Prep / Progress / Cleanup once per job (`lib/domain/photos.ts`). A photo counts for a shot when it was taken from that checklist item or has the same category and area tag. Job health's photo check is real: before (and progress while in progress) photos from In Progress on, after photos from the Final Walkthrough on.
- **Reason:** SPEC §8.5 #6 "required shots per work type: before each elevation/room, prep, progress, after, cleanup".

### 2026-10-27 · Activity for files

- **Decision:** Uploading or deleting a document, adding or deleting photos, and sharing photos write timeline entries (`document_*`, `photo_*`), so the Activity feed's Documents and Photos chips have content. Sharing photos sends one simulated message and marks the photos customer-visible.
- **Reason:** SPEC §8.5 #14–15 feed filters.

## Phase 6 — Production

### 2026-10-27 · Schedule entries are drafts until "Publish changes"

- **Decision:** `schedule_entries` keep the published slot (`crew_id`, `starts_on`, `ends_on`, `published_at/by`) and a pending draft (`draft_action` create/update/cancel, `draft_crew_id`, `draft_starts_on/ends_on`, `draft_reason`, `draft_note`) in one row. People only write the draft fields (row security + guard); only trusted code writes the published fields, inside `publishSchedule()` (`lib/production/publish.ts`, plan in `lib/domain/scheduling/publish.ts`). Publish refuses the whole batch when any draft still has a blocking conflict, so nobody is told half a schedule. On publish: the job's promised start, guarantee date, crew, estimated completion and priority flag are updated, the customer gets one notice per job (text, else email) and the crew lead one notice per crew, all through adapters → `integration_outbox` (status `simulated`), and Ready to Schedule → Scheduled runs through `advanceIfGatePasses()`.
- **Reason:** SPEC §8.6 "drafts until Publish changes". Two columns sets in one row keep "what the customer was told" and "what we're planning" side by side without a second table, and the board can show both.

### 2026-10-27 · Conflicts: block vs. heads-up, owner override with a reason

- **Decision:** `checkPlacement()` (pure) returns every conflict with a code, a plain-language reason that names the other job, dates and the fix, a severity (block / warn) and whether an owner may override it. Blocks: past dates, inactive crew, double-booking past the crew's `max_jobs_per_day` (unless both entries are "split"), crew time off and company blackouts, a blocking hold (Deposit Hold is the locked `deposit_before_scheduling` rule — never overridable), missing required skills, expired/missing subcontractor paperwork, closed jobs. Heads-ups: non-production day, exterior out of season, HOA approval pending, walkthrough not done, weather (only when weather is connected). An owner (`job_admin:override`) can override the overridable ones on a saved entry with a reason of ≥ 10 characters (stored on the entry and audited). The same function runs in the browser for instant feedback, in the save action, and in Publish.
- **Reason:** SPEC §8.6 "conflicts with reasons", §15.1 work rules; PLAN Phase 6 "conflicting schedule is blocked with a clear reason".

### 2026-10-27 · On-time start guarantee and the draft credit

- **Decision:** The first publish sets `jobs.guarantee_start_date`. Later moves for **weather** or **customer** reasons move the guarantee date; **company** moves keep the earlier date (`nextGuaranteeDate`). When the actual start (Start job button, or the first daily log) is later than the guarantee date and no rain delay covers the slip, the system drafts one `on_time_credits` row with the amount from Company Settings → `on_time_guarantee_cents` (status `pending_approval`) and notifies the owners. The database refuses people creating credits and refuses a credit a rain delay covers. Owners (`credits:approve`) approve or waive it on Job → Schedule; approved credits wait for Phase 7 to be applied to the final invoice (`invoice_id`, status `applied`). Waiving sets the job to "Waived by owner".
- **Reason:** SPEC §1.3 "on-time start or $250 off" (amount stays a company setting the owners confirm), "draft pending owner approval".

### 2026-10-27 · Rain-day promise never costs the customer anything

- **Decision:** "Mark rain delay" (scheduler, or a crew lead on their job) records `rain_delays` (no money column at all), sets `is_priority_reschedule`, pins the job to the top of the Master Schedule tray, logs a timeline entry and event `job.rain_delay`, and texts the customer the SPEC wording (draft – owner to approve) through the outbox. Rain slips never draft an on-time credit. Weather forecasts are not connected, so the "weather risk" attention rule and the weather work rule stay dormant and the Weather page says "Weather not connected" with the manual form.
- **Reason:** SPEC §1.3 rain-day promise, §10 weather adapter (no real API calls in this build).

### 2026-10-27 · Gates 6–9

- **Decision:** Ready to Schedule → Scheduled: a published schedule entry exists. Scheduled → In Progress: materials ready (no live paint order that isn't picked up, delivered or canceled) and the first published day is today or earlier (Pacific) — "Start job" records the actual start and then tries the gate. In Progress → Final Walkthrough: at least one live work order and all of them completed or canceled. Final Walkthrough → Completed: the customer's sign-off is captured, **or** the final-walkthrough appointment is completed with no open punch items. Same rules in TypeScript (`lib/domain/jobs/gates.ts`) and SQL (`app.job_gate_passes`), checked by tests on both sides.
- **Reason:** SPEC §6.2 gates 6–9.

### 2026-10-27 · Daily logs: required cleanup photo, offline queue, customer update signed by the point of contact

- **Decision:** A daily log needs "finished today", the "Cleanup done" check (database check `cleanup_done = true`) and a cleanup photo (`cleanup_photo_id not null`). The phone form queues the log with its cleanup photo as one `daily_log` item in the Phase 5 offline queue (client id = log id, idempotent) and progress photos as `photo` items linked by `daily_log_id`; the photo route answers 503 until its log has arrived, so the queue retries in order. The server records hours per person as `time_entries`, then sends the customer update right away (text, else email; draft wording; signed with the point of contact's name) — a worker sweep sends any update still in draft after 2 minutes. "Missed daily update" raises an attention item after the cutoff (default 7 pm Pacific, editable in Admin → Attention Rules, looking back 3 production days), owned by the crew lead.
- **Reason:** SPEC §1.3 daily photo update and clean house every evening, §8.5 #9, §9.

### 2026-10-27 · Crews count as "on the job"

- **Decision:** `jobs.team_user_ids` now also holds the active members and lead of the job's crew and of crews on its live schedule entries (`app.job_crew_user_ids`, refreshed by triggers when crews, members, entries or the job's crew change). Own-scope roles (painters, crew leads) therefore see exactly the jobs their crew works, on Today, My Projects, Daily Log and the job page.
- **Reason:** SPEC §4 own scope, §8.8; no separate assignment step for crews.

### 2026-10-27 · Recommendations need approval; auto-execute stays off

- **Decision:** The worker (every 15 minutes) ranks crews for unscheduled and rain-delayed jobs (skills 35, availability 30, workload 20, territory 15 points; first open start in 60 days) and stores `schedule_recommendations`. Approving one creates a **draft** entry and assigns the crew; it can be undone within the undo window (default 15 minutes). Schedule settings default to "approval required = on, auto-execute = off", and the database refuses both on at once.
- **Reason:** SPEC §8.6 Recommendations "approval ON, auto-execute OFF, 15-min undo".

### 2026-10-27 · Exceptions reuse the Attention Center

- **Decision:** Production → Exceptions lists open attention items from the production rules (missing crew, paint not ordered, missed daily update, punch list open, start date missed, subcontractor paperwork expiring, weather risk) with Resolve; there is no separate exceptions table. Subcontractors are a new attention subject type.
- **Reason:** One place for SLAs, owners and snoozes (SPEC §9).

### 2026-10-27 · Subcontractor status is computed

- **Decision:** `subcontractors.status` is set by the database from the paperwork: suspended (by hand), else **expiring** when insurance, license or W-9 is missing or any expires within 30 days, else active. An expired document blocks scheduling the sub's crews (`sub_compliance` rule). Paperwork files live in the private documents bucket under `<org>/subcontractors/<id>/` and stream through `/api/files/subcontractors/[id]` for `crews:manage` only.
- **Reason:** SPEC §13.4, §8.6 Resources; "missing" is treated like "expiring" so the owners see it before it blocks a job.

### 2026-10-27 · Field Dispatch lists by city; no map

- **Decision:** Field Dispatch groups today's production by city with filters (crew, skill, city, status, work type); the map waits for the maps integration (not connected).
- **Reason:** No real external APIs in this build.

### 2026-10-27 · Seeded production configuration

- **Decision:** `app.seed_production_defaults(org)` (idempotent, `on conflict do nothing`) seeds skills, the SPEC §15.1 work types and durations (keys match appointment types), 11 work rules, the §15.1 checklist templates (walkthrough, exterior prep, interior prep, cabinet process, deck & fence, lead-safe from §13.3, daily cleanup, final walkthrough), schedule settings (Mon–Fri, 8:00 start, 30-minute arrival window, 8-hour crew day) and the production attention rules. Owners can change all of it in Admin → Schedule Admin and Attention Rules.
- **Reason:** SPEC §15.1; production must be usable on the empty production database. Start time, arrival window and crew-day hours are placeholders for the owners to confirm.

### 2026-10-27 · Customer sign-off on the crew's device

- **Decision:** Punch List → "Capture customer sign-off": typed name + drawn signature, the statement shown to the customer (draft wording – owner to approve) with the number of open items accepted, time, IP and device, SHA-256 of the signature image. Sign-offs can't be edited or deleted by anyone but trusted maintenance. Punch items need `punch_list:manage`; fixed and waived items keep their photos and note.
- **Reason:** SPEC §1.3 final walkthrough, §8.5 #13.

### 2026-10-27 · Validation schemas stay out of "use server" files

- **Decision:** Zod schemas with `.refine()` callbacks live in `lib/validation/*` or a `schema.ts` next to the actions, never inline in a `"use server"` module.
- **Reason:** Next.js treats every inline function in a server-action module as a server action and the production build fails ("Server Actions must be async functions"); `tsc` and ESLint don't catch it.

### 2026-10-27 · Deviations and gaps left for later

- **Decision:** Not built in Phase 6: reading gate/lockbox codes is still Owner/Office Manager only (narrowing to the assigned crew on scheduled days, promised in the Phase 2 entry, is left as a gap); suggested walkthrough time slots and calendar sync (calendar integration not connected); map views; real weather forecasts; on-time credit applied to invoices (Phase 7); clock-in/out time entries (hours come from daily logs).
- **Reason:** Scope and "no real integrations" rule; listed in the Phase 6 report.

## Phase 7 — Money

### 2026-10-27 · One ledger, derived every time, in TypeScript and SQL

- **Decision:** Every money figure is computed from the records, never stored: Contract = `job_financials.contract_cents` (accepted estimate + signed change orders) − approved/applied credits; Billed = Σ non-void invoices (drafts included, the SPEC §10 wording); Left to bill = Contract − Billed; Collected = Σ applications of live payments (received or cleared) on non-void invoices; Balance = Billed − Collected; Due = the overdue part of the balance (capped at the balance). Unapplied money is shown separately and never counts as collected. The pure version is `lib/domain/ledger` (property-tested with fast-check, 1,000 random operation sequences per invariant); the database version is the `invoice_ledger`, `payment_ledger` and `job_ledger` views. Both are checked against the same scenario (`lib/domain/ledger/fixtures.ts` and `supabase/tests/013_money.test.sql`). A SQL test fails if any money table grows a column named like a balance, paid, collected, outstanding or due amount.
- **Reason:** SPEC §10 "balances derived, never stored"; CLAUDE.md money rules. Two implementations kept in step by one scenario are cheaper than a round trip for every screen.

### 2026-10-27 · A/R counts sent invoices; a draft is never "issued"

- **Decision:** An invoice is issued when it is not void and `sent_at` is set. A/R outstanding, overdue, aging and reminders only look at issued invoices; Billed still includes drafts (SPEC wording), so "Left to bill" drops the moment the final invoice is drafted. A draft deposit invoice paid at signing reads **Paid**; if that payment later bounces it reads **Draft** again, not Sent.
- **Reason:** Customers don't owe what they haven't been sent; the Overview's "billed" should still show what the office has prepared.

### 2026-10-27 · Payment status `void` (deviation)

- **Decision:** Payments have the SPEC statuses received / cleared / bounced / refunded plus **void** for a payment entered by mistake (reason required). Bounced and void payments keep their history and stop counting; their applications stay on record but are ignored by the ledger. Payments are never deleted.
- **Reason:** "Bounced" and "refunded" mean something happened with the customer's money; a typo needs its own honest status. Noted as a deviation from SPEC §5.6.

### 2026-10-27 · Money is written only through checked database functions

- **Decision:** People can read money tables (with `financials:read`) but never insert, update or delete them directly. Every write goes through a `service_role`-only function (`create_invoice`, `record_payment`, `refund_payment`, `decide_credit`, `close_month`, …) called by a thin Server Action. Each function re-checks the acting person's permission and company (`app.require_actor_perm`, `app.require_actor_org`, actor from the signed request header) and runs the whole change in one transaction, so totals, applications and statuses can't drift. Triggers guard what the functions write (applications never exceed what a payment can cover or what an invoice still owes, no edits to sent invoices except status, locked months).
- **Reason:** CLAUDE.md "every mutation zod-validated, permission-checked, audit-logged"; money rules are easier to prove once, in the database.

### 2026-10-27 · Forced application

- **Decision:** Recording a payment (`payments:record`) requires saying which invoices it pays; the form suggests oldest-due-first and the amounts must add up to the payment (or the payment is larger than everything owed, and the rest is shown as unapplied with a warning). Applications can be changed later (**Apply** on the payment) as long as the new split still adds up. The worksheet lists "Payments applied to invoices" so the office can see exactly what paid what.
- **Reason:** SPEC §10 "forced application"; unapplied money is the most common reconciliation problem.

### 2026-10-27 · Reversals: bounce, void, refund

- **Decision:** A bounce (with reason) stops the payment counting, reopens the invoices it paid, writes a timeline entry, emits `payment.bounced` and notifies finance. A refund (amount ≤ what's left, method, reason) comes out of unapplied money first and then off the payment's applications, newest invoice first; the split is stored on the refund (`detail`). A fully refunded payment becomes `refunded`. Stage automation only moves forward, so a reversal after Paid in Full raises the "Paid stage with a balance" warning instead of moving the job back.
- **Reason:** SPEC §10 reversals; stage changes only through `advanceJobStage()`, which never moves backwards on its own.

### 2026-10-27 · Credits: requested, approved, placed

- **Decision:** Goodwill, discount and referral credits are added on Job → Financial (`invoices:edit` or `credits:approve`) and wait for an owner (`credits:approve`) unless the owner adds them as approved. On-Time Guarantee credits are never typed in: approving the drafted `on_time_credits` row (Phase 6) mirrors it into `credits`. Approved credits lower the contract and are **placed**: onto the draft final invoice as a negative line (only if the new total stays at or above what's already paid on it), otherwise onto a draft **credit memo** once the final invoice has been sent; before there is a final invoice they wait. Placing sets the credit to `applied` with its invoice, and the mirrored `on_time_credits` row too (job credit status "Credit applied"). Migration backfills credits for approved on-time credits already in production.
- **Reason:** SPEC §1.3 (on-time credit "applied to the final invoice"), §5.6, §10; the "stays at or above what's paid" rule came from a property-test counterexample (a credit pushing a part-paid final invoice negative).

### 2026-10-27 · The database keeps invoice status current

- **Decision:** `invoices.status` is refreshed by the database after every payment, application, refund or send (`app.refresh_invoice_status`): paid, partially paid, overdue, viewed, sent, draft or void, the same rules as `invoiceDisplayStatus()`. "Overdue" is also recomputed every minute by `sweep_invoices`, because time passing changes it. The same refresh stamps `jobs.deposit_paid_at` the first time a deposit invoice is fully paid.
- **Reason:** Lists and filters need a status column they can index; the ledger views stay the source of truth for amounts.

### 2026-10-27 · Gates 10–12 are real

- **Decision:** Completed → Invoiced: the final invoice has been sent. Invoiced → Paid in Full: something billed, nothing left to bill and a $0 balance. Paid in Full → Closed Won: still a $0 balance. Reaching Completed drafts the final invoice (contract − everything already billed, approved credits as lines) through `ensureFinalInvoice()`; sending it moves the job to Invoiced, and the payment that clears the balance moves it to Paid in Full, both through `advanceIfGatePasses()`. Same rules in `lib/domain/jobs/gates.ts` and `app.job_gate_passes`. Job health "balance current" is real (overdue invoices), with a "Collect payment" next action.
- **Reason:** SPEC §6.2 gates 10–12; PLAN Phase 7 "paying the balance moves the job to Paid in Full".

### 2026-10-27 · Sending an invoice

- **Decision:** Send (issue date, due date, email and/or text) marks the invoice sent, renders the invoice PDF (now with Paid and Balance due), stores it in Documents (`invoices.pdf_document_id`), records the simulated email (with the PDF listed as an attachment) and text in `integration_outbox`, logs the timeline, and writes a QuickBooks "would sync" preview. The due date defaults to the issue date ("due on receipt") until the owners give real terms. Messages say how to pay with the placeholder `[HOW_TO_PAY — owner to provide]`; wording is "Draft – owner to approve".
- **Reason:** SPEC §10 "send (simulated SMS/email + PDF)"; no real messages or invented payment instructions.

### 2026-10-27 · Accounting stays a disconnected stub

- **Decision:** Invoices and payments carry `accounting_sync_status = not_connected`. Sending an invoice or recording a payment writes an `accounting.*` row to `integration_outbox` with status `simulated` showing exactly what would be sent to QuickBooks; Job → Financial → Accounting lists those previews. No QuickBooks call exists in this build.
- **Reason:** CLAUDE.md "never connect real integrations"; SPEC §14.

### 2026-10-27 · Overdue reminders at 7 and 30 days

- **Decision:** The worker's money sweep emits `invoice.overdue` once per invoice per threshold (7 and 30 days past due, idempotency key per invoice and threshold). The handler sends one simulated reminder to the customer (text, else email; draft wording) and notifies finance. The "Overdue invoice" attention rule raises Medium at 7 days and High at 30 (editable in Admin → Attention Rules, seeded idempotently). "Sold, no deposit" now uses the real deposit invoice and payments.
- **Reason:** SPEC §9 "Overdue invoice 7 / 30 days → Medium/High".

### 2026-10-27 · Month close and the owner-only override

- **Decision:** Admin → Finance shows each month's totals and an un-cleared / unapplied / draft checklist, and closes a month (`finance:close_month`, owners and the bookkeeper), saving a summary snapshot. Payments, refunds, invoices and expenses dated in a closed month can't be added or changed, except by someone with the new permission **`finance:override_lock`**, which isn't in any pack (owners only) and needs a written reason (≥ 10 characters, audit-logged). Reopening a month needs the same permission and a reason. The lock is enforced in the database functions and triggers, not only in the screens.
- **Reason:** SPEC §10 month close / lock; bookkeeper can close, only owners can change the past.

### 2026-10-27 · Job costing for owners and the bookkeeper

- **Decision:** Job → Financial → Job Costing (`job_costing:read`): contract, labor (daily-log hours × each person's hourly cost), materials from paint orders, subcontractor hours, other expenses with receipt photos or PDFs, gross margin and margin %. Expenses are written with the same permission; receipts are re-encoded (photos lose EXIF) and stored in the private `receipts` bucket, streamed through `/api/files/receipts/[id]` after a check. The bookkeeper may read `profile_compensation` for costing only, not edit it, and still has no `hr:read`. Crew roles see no amounts anywhere (no `financials:read`).
- **Reason:** SPEC §4 permissions, §5.6 job_costs, §8.5 #5.

### 2026-10-27 · Finance numbers come from one database function

- **Decision:** `finance_stats(from, to)` (security invoker, so row security applies) returns every money KPI in one round trip: A/R outstanding, overdue, collected, billed, collection %, revenue sold / completed, gross margin % on completed jobs (owner only), days completed → paid, unapplied, aging buckets (current, 1–30, 31–60, 61–90, 90+) and counts. The registry (`lib/metrics/registry.ts`) defines each metric once on top of it; `/invoices`, A/R aging, Admin → Finance and the board read only the registry. Negative margins display as 0% in the registry tiles (gap noted).
- **Reason:** CLAUDE.md "every KPI from the registry", "server-side aggregation".

### 2026-10-27 · Sales tax is an owner question

- **Decision:** Invoice lines are tax-included amounts with no separate sales-tax line; no tax rule is coded. This waits for the owners.
- **Reason:** CLAUDE.md "don't invent tax rules".

### 2026-10-27 · Deviations and gaps left for later

- **Decision:** Not built in Phase 7: commissions (Phase 10); a customer-facing invoice page or online payments (no payment processor connected); real email attachments (recorded in the outbox only); the Analytics money dashboards (Phase 9); workflow templates on money events (Phase 8).
- **Reason:** Scope and "no real integrations" rule; listed in the Phase 7 report.

## Phase 8 — Communication & growth

### 2026-10-29 · Workflows are system-defined; the database holds the switch and the run log

- **Decision:** The 17 workflows of SPEC §11.2 are defined once in TypeScript (`lib/domain/workflows/catalog.ts`: triggers, conditions, ordered actions, exit rules, a "Built in" list). The `workflows` table only holds each one's on/off switch (with a required reason to turn off) and `workflow_runs` logs every run. People can't add or edit workflow logic in this build; they change the wording (templates), delays (Messaging settings) and the switch. A turned-off workflow logs a `skipped` run for each event and sends nothing; turning it back on doesn't replay them.
- **Reason:** SPEC §11.1 "system-defined + toggleable", testable dry runs, and no custom-logic editor before the owners ask for one.

### 2026-10-29 · One run per (workflow, event), inline and from the worker

- **Decision:** A run row is inserted first with the unique key `<workflow>:<event id>`; a second attempt (the inline dispatch right after the action, then the worker picking up the same event) hits the unique index and stops. Waits and quiet-hours deferrals park the run as `waiting` with `resume_at`; the worker resumes due runs every minute (`claim_workflow_runs`, `FOR UPDATE SKIP LOCKED`). A failed step stops the run (status `failed`, visible on Admin → Workflows with Retry). A dry run (Test) uses the same planner with `dryRun: true` and writes nothing.
- **Reason:** Phase 8 "done when": no message sent twice; delayed steps executed by the worker.

### 2026-10-29 · Customer sends moved behind their workflows

- **Decision:** Earlier phases sent some customer messages directly: publish notices (Phase 6), the rain-delay text, daily updates, overdue reminders (Phase 7) and the on-time credit owner notice. Those sends now happen only through workflows 8, 9, 11, 14 and 10 (the built-in code emits the event and dispatches the workflow inline). Stage moves, holds, invoices and attention rules stay built in and are listed on each workflow page under "Built in". `lib/production/notify.ts` and `lib/money/reminders.ts` were removed.
- **Reason:** One source per message, so turning a workflow off really stops it and nothing goes out twice (SPEC §11.1).

### 2026-10-29 · Quiet hours and the customer-initiated window

- **Decision:** Quiet hours are 8:00 pm – 8:00 am Pacific by default (Messaging settings), for automated **texts** only. A text due in quiet hours waits until they end (the run or drip step is deferred, the campaign batch waits). If the customer texted us in the last 24 hours (setting) the conversation counts as customer-initiated and replies go out. Emails aren't held. One-to-one texts a person sends by hand aren't held either (unchanged from Phase 3; a case acknowledgment sent from the case page is one of these). The E2E setup turns quiet hours off for the local test company so the suite can run at night; quiet hours are covered by unit tests and the dry run's "as if it were" time.
- **Reason:** SPEC §11.1, §13.2.

### 2026-10-29 · Consent model for automated and marketing messages

- **Decision:** Do Not Contact blocks every channel. A STOP reply blocks texts (and, as in Phase 2, clears marketing consent). Transactional messages need only an address. Marketing texts need an explicit SMS opt-in; marketing email needs the contact's email opt-in, while leads (no opt-in record) may get marketing email until they unsubscribe. Every marketing text ends with "Reply STOP to opt out." and every marketing email with the company footer and a signed one-click unsubscribe link (`/u/<token>`, HMAC with `MESSAGING_LINK_SECRET`, derived from the service key if unset; the page asks before unsubscribing so link scanners don't). Inbound STOP / UNSUBSCRIBE / START / HELP (stub route, HMAC with `INBOUND_MESSAGES_SECRET`) apply to every contact and lead with that number. Consent is checked again at send time for drips and campaigns.
- **Reason:** SPEC §13.2; TCPA/CAN-SPAM basics without inventing legal language (the footer's mailing address stays `[MAILING_ADDRESS]`).

### 2026-10-29 · Templates are drafts until an owner approves them; drafts are used while simulated

- **Decision:** 88 SMS and email templates are seeded (`is_system`, "Draft – owner to approve"). Editing a template puts it back to draft; only an owner (with `templates:manage`) can approve. Because nothing really sends in this build, drafts are used by workflows and shown with a Draft badge in every preview and outbox row (`template_status`). When a real provider is connected, only approved wording should go out (to switch on with the integration). Texts are normalized to plain punctuation (GSM-7) so a segment holds 160 characters. Placeholders like `[PHONE]`, `[WARRANTY_TERMS]`, `[HOW_TO_PAY — owner to provide]`, `[REFERRAL_REWARD]` pass through and are flagged.
- **Reason:** CLAUDE.md "don't invent business facts"; SPEC §11.3.

### 2026-10-29 · Threads per lead or job; reading a thread is shared

- **Decision:** Every message belongs to one `message_threads` row per subject (lead, job, contact or account), created by a trigger on insert; existing messages were backfilled. The thread keeps the summary (last message, last inbound) and a generated `unread` (inbound after the last read). Opening a conversation marks it read for everyone; a person's outbound reply also marks it read. Marking read/unread needs `messages:send` and `messages:read` (`mark_thread_read`). The "Unread customer message" attention rule fires after 30 business minutes.
- **Reason:** SPEC §5.7, §9.

### 2026-10-29 · Audit-log exemptions for message bodies and logs

- **Decision:** `workflow_runs`, `campaign_recipients` and `message_threads` have no audit trigger (`000_rls_everywhere` exempts them). They are logs or summaries themselves and would copy message text and personal data into the audit log. Their changes still emit events where useful.
- **Reason:** CLAUDE.md "audit every mutation" weighed against data minimization; the mutations that matter (workflow switch, templates, campaigns, cases, referrals) are audited.

### 2026-10-29 · Cases

- **Decision:** Warranty / service cases (`cases`, numbered `CASE-YYYY-NNNN`) belong to a job or a customer. The SLA due time is N business days (Messaging settings, default 2) using Company Settings hours. A warranty visit is a `warranty_visit` appointment on the job, linked by `appointments.case_id`; a customer-only case has to be linked to a job before a visit is booked. Resolving needs a written resolution. The acknowledgment and visit confirmation use the `case_received` / `case_visit_booked` templates. Crew leads can read cases on jobs they're on (`cases:read` own).
- **Reason:** SPEC §5.7, §8.16, §9 "Warranty request, SLA 2 business days".

### 2026-10-29 · Follow-up lists: built-in rules, owner-edited names, scripts and cooldowns

- **Decision:** The 8 lists of SPEC §11.4 are rules in `lib/follow-ups/lists.ts`, read with the person's own client (so row security applies) and capped at 300 rows each. Admin → Follow-up Lists edits names, scripts (drafts), cooldowns and the on/off switch, and the dispositions (grouped Positive / Negative / Callback / No Contact / Won; a disposition can set the lead's disposition, require a callback, or set Do Not Contact). After a disposition the record rests on that list for its cooldown or until its callback time. "Call" records a simulated call through the voice adapter (outbox) and offers a `tel:` link on phones.
- **Reason:** SPEC §8.19, §11.4.

### 2026-10-29 · Campaigns and drips

- **Decision:** A campaign's audience reuses the list rule builder over contacts, leads, or the primary contacts of matching jobs (direct columns only). It's edited while it's a draft; scheduling re-runs the compliance checks on the server (empty message, email subject, unknown fields, job/estimate fields that a campaign can't fill, empty or unreachable audience: errors; placeholders, draft wording, long texts, quiet hours: warnings). When it starts, the worker freezes the audience into `campaign_recipients` with the reason anyone is left out (no consent, opted out, Do Not Contact, no address, duplicate address), then sends 100 per minute through the outbox. A recipient is marked converted if their lead books a walkthrough or converts, or the contact gets a new job, within 90 days. The two seeded drips (exterior pre-season, just-planning nurture) are edited on the Drips tab; turning a drip off ends active enrollments at their next step. Saved segments exist in the schema but the UI keeps the audience on the campaign (gap).
- **Reason:** SPEC §8.11.

### 2026-10-29 · Bear Champions and reviews

- **Decision:** A champion gets a generated code (`BEAR-XXXX`, prefix in Referral Program settings) when workflow 15 sends the invite or when an owner adds them. A website lead with `?ref=CODE` becomes a referral automatically (database trigger); self-referrals are recorded as not eligible. Referral status (Referred, Walkthrough booked, Sold, Reward payable, Paid, Didn't book, Not eligible) is derived from the lead and job, never stored; the reward amount is copied from Company Settings when the referral comes in (`[REFERRAL_REWARD]` until set). An owner records the payout (method + reference); a paid reward can't be changed. Review requests are made by workflow 15 with a tracked link (`/r/<token>`, stored as a hash) that forwards to Company Settings → Review link; someone marks the review left and its stars.
- **Reason:** SPEC §5.8, §8.16, §14.

### 2026-10-29 · Notifications

- **Decision:** 14 notification types. The company sets the default per type (in-app, email, text) and whether the in-app alert is required; each person can change their own (Settings → Notifications), except that a required in-app alert stays on. A trigger on `notifications` applies the choice and puts email and text copies in the outbox (simulated). Texts need a mobile number in +1 format on the profile.
- **Reason:** SPEC §8.18, §8.19.

### 2026-10-29 · Navigation and screen deviations

- **Decision:** Messages (`/messages`) and Warranty & Service (`/cases`) are under More; Follow-up Lists (`/follow-ups`) under Leads. Crews read job messages on `/field/messages` (crew lead `messages:read` own). Mention search in the universal search stays a placeholder. Message bodies aren't searched yet.
- **Reason:** SPEC §8 nav leaves room; kept the top bar short.

## Phase 9 — Analytics & home

### 2026-10-30 · One registry, three new sources, `kpi.*` namespace

- **Decision:** Every Phase 9 number is a registry entry in `lib/metrics/registry.ts`: 46 `kpi.*` metrics (SPEC §12.1) and 11 breakdowns from `analytics_stats(from, to, filters)`, 9 `mine.*` from `my_numbers(user, from, to)`, 21 `myday.*` from `workspace_summary()` and 16 `brief.*` from `daily_brief(day)`, plus `analytics_monthly` and `season_backlog` for the forecast and season charts. Each entry now also carries its date field, the filters it honours and the permission it needs (`requires`); `metricSpec(id)` gives the full sheet (id, label, description, source RPC, date field, filters, unit, caption, owner-only). Values are parsed with zod; a ratio with a zero denominator is `null` and shows "—", never NaN. Older phase metrics keep their ids; overlapping KPIs on the Leads/Jobs dashboards keep using the Phase 2–7 entries.
- **Reason:** CLAUDE.md "every KPI from the registry"; SPEC §12 asks for id, label, description, source, date field, filters, unit and caption per KPI. One call per screen keeps the work in Postgres (CLAUDE.md "server-side aggregation").

### 2026-10-30 · Analytics filters and marketing spend

- **Decision:** `analytics_stats` takes `{work_type, territory_id, owner_id, source}` (all optional) and every count, sum and breakdown honours them. Money is null for roles without `financials:read`; gross margin needs `job_costing:read` (owners and the bookkeeper). Marketing spend is entered per month and lead source (Admin → Marketing Spend) and prorated by day when the period covers part of a month. Cost per lead and CAC only apply with no work-type, city or owner filter (`spend_applies`); spend isn't split that way, so they show "—" with the reason. CAC = spend ÷ jobs sold (estimate accepted) in the period, from that source when one is picked.
- **Reason:** SPEC §8.14 filters, §12.1 "cost per lead & CAC". Splitting spend by city or work type would invent an allocation rule the owners haven't given.

### 2026-10-30 · Revenue goals and the forecast

- **Decision:** Goals are per month (Admin → Revenue Goals, `settings:manage`; read with `financials:read`). With none set, every goal line, On Pace and "My Business – This Month" show "No revenue goal configured" with a link for owners. Revenue Forecast = sold value per month for the last six months, this month's run rate (sold so far ÷ day of month × days in month) and a trailing three-month average for the next five months; On Pace compares the run rate to the goal (within ±5% = on pace).
- **Reason:** SPEC §8.14 "On Pace", §12.1 "projected revenue". No production rates or seasonality factors are assumed (CLAUDE.md "don't invent business facts").

### 2026-10-30 · Exterior season backlog

- **Decision:** The season comes from Company Settings (exterior season start/end; June 1 – September 30 when unset). Capacity per month = production days in the month (Schedule settings, Mon–Fri by default) × active crews; booked = published schedule entries on exterior or deck/fence jobs, in production days; unscheduled = sold, onboarding or ready-to-schedule exterior jobs for that season with nothing scheduled, in crew-days (estimated duration, or open work-order hours ÷ crew-day hours). After September 30 the chart shows next year's season.
- **Reason:** SPEC §8.14 "Seasonality / Exterior Backlog". Weekdays-only capacity is the Phase 6 production calendar; no extra capacity factors are assumed.

### 2026-10-30 · Reports run on the server, capped at 10,000 rows

- **Decision:** Reports read four security-invoker views (`report_leads`, `report_jobs`, `report_estimates`, `report_invoices`) with the viewer's own client, in 1,000-row chunks (PostgREST's max), up to 10,000 rows; grouping, totals and chart series are computed over every matching row on the server (`lib/domain/reports/summarize.ts`), never on one page. Past 10,000 the page says the results were cut. Money and cost columns the viewer can't see are dropped before the query. The 10 seeded templates (`app.seed_analytics_defaults`, idempotent by `template_key`) can't be edited, only copied; "Save as" makes a personal report that can be shared with the team.
- **Reason:** SPEC §8.14 "Reports list + builder"; CLAUDE.md "paginate everything". A report bigger than 10,000 rows belongs in a CSV export from the source list, which the owners haven't asked for yet.

### 2026-10-30 · Every chart and KPI table exports CSV, logged

- **Decision:** Each "View data" table has **Download CSV** when the person has `data:export` and isn't impersonating; otherwise the button is disabled with "Your role can't export data. Ask an owner for export access." The file is built in the browser from the rows already on screen, after the server logs it (`log_export()` → `export_log`, event `export.created`); report CSVs come from `/analytics/reports/<id>/csv`, logged the same way. CSV cells starting with `= + - @` (unless a plain number) get a leading apostrophe; files have a BOM and CRLF for Excel.
- **Reason:** SPEC §8.14 "View data + Download CSV on every chart", §13 data minimization. Building from the on-screen rows guarantees the file matches what the person saw.

### 2026-10-30 · Scheduled report emails go to the outbox, with a link instead of an attachment

- **Decision:** A schedule (daily / weekly on a weekday / monthly on day 1–28, at an hour, Pacific time) emails chosen teammates. The worker claims due schedules with an optimistic update on `next_run_at` (so a run happens once however often the worker fires), runs the report as the service with the company filter, and records one simulated email per recipient through `recordOutbound()` (related to the schedule) with the totals, a 20-row preview and a link. A delivery only runs when the person who scheduled it still has `reports:build` and an **all-records** scope on the report's module; otherwise it's skipped with a note on the Schedules page. The email carries no attachment.
- **Reason:** CLAUDE.md "never send real messages"; the service role bypasses row security, so the all-scope check stops a scoped user from mailing rows they couldn't see. Attachments wait for a real email provider.

### 2026-10-30 · Home by role; Executive Overview and My Day

- **Decision:** `/` opens the Executive Overview for owners and My Day for everyone else; Settings → Preferences changes a person's default home (the Executive Overview needs `analytics:read`, otherwise My Day shows), and `?view=my_day|executive` switches for one visit. My Day's **Ready Score** starts at 100 and loses points, each capped: overdue tasks (10 each, max 30), critical/high Attention items (10, max 30), new leads not reached (5, max 20), cases past SLA (5, max 10), unread conversations (2, max 10); each factor links to the list. Overdue = due before now; due today = due later today (Pacific). Executive alerts link to the Attention Center filtered by rule (`/attention?type=<rule>`).
- **Reason:** SPEC §8.2, §8.3. A fixed, explained score is testable and can't be gamed by hidden weights.

### 2026-10-30 · Ask Brushy Bear and the Daily Brief use no AI

- **Decision:** Ask Brushy Bear maps keywords to registry metrics, a period and filters (`lib/domain/analytics/ask.ts`), runs them with the asker's permissions and answers with the numbers, the metric ids it used and the filters. If a question needs a permission the person lacks it says which; if nothing matches it suggests the closest report. The Daily Brief summarizes `daily_brief(day)` in fixed sentences. The optional AI integration stays disconnected.
- **Reason:** SPEC §8.14 "keyword→metric, no AI"; CLAUDE.md "never call a real external API".

### 2026-10-30 · My Numbers: each card on its own date; no commissions

- **Decision:** My Numbers cards: Leads Issued (leads created with you as owner), Walkthroughs Set (booked in the period), Walkthroughs Ran (held in the period), Estimates Sent (first sent), Sold ($ and count, estimate accepted), Completed (work completed), Invoiced and Paid in full; each card says its date field and opens its records. Owners can pick any rep. Commissions show nothing until the commissions engine exists (Phase 10).
- **Reason:** SPEC §8.15; commission rules are an owner business fact we don't have.

### 2026-10-30 · Audit exemptions and deviations

- **Decision:** `export_log` and `report_run_stats` have no audit trigger (they are logs themselves; `000_rls_everywhere` exempts them). Dashboards are lists of widget ids (`dashboards.widgets text[]`), not a drag-and-drop layout; a custom dashboard picks KPIs and charts from the catalog in order. Favorites are per person. Deviations/gaps: no drag-to-resize dashboard grid; no PDF of reports; scheduled deliveries have no attachment; Ask doesn't understand free-form comparisons beyond "this vs last month/year"; the walkthrough show rate is completed ÷ (completed + no-show) for walkthrough appointments whose time came in the period.
- **Reason:** Keep Phase 9 to SPEC §8.14's must-haves; the rest is listed in the Phase 9 report.

## Hosting

### 2026-10-27 · Separate hosting; worker every minute from the database

- **Decision:** Brushy Bear gets its own Supabase organization and project (separate from the owners' other business), and its own Vercel project in the existing Vercel team. Production deploys from `main`. Vercel Hobby only allows daily cron jobs, so `vercel.json` runs the worker once a day as a backup and Supabase `pg_cron` + `pg_net` call `/api/cron/worker` every minute (RUNBOOK "Background worker"). The production database starts empty: migrations plus the real configuration seed, no demo data.
- **Reason:** Owner request (2026-10-27): "a new project and totally separate", "get this live". Per-minute Vercel cron needs Pro; the database schedule is free and keeps the attention engine current.

### 2026-10-27 · Password sign-in added **[Deviation]**

- **Decision:** The login page offers email + password ("Sign in") above the email-link option; Settings → Security has "Change password" (10+ characters). Sign-ups stay off, so only invited accounts can sign in, and two-step sign-in is still required afterwards for owners and the bookkeeper. Wrong password and unknown email get the same message.
- **Reason:** Owner request (2026-10-27): log in directly with a password instead of waiting for a sign-in email. The free Supabase email sender is limited to a few emails an hour and only reaches organization members. SPEC §4.3 listed Google + magic link only; this adds a third method.

### 2026-10-27 · Owner two-step sign-in turned off in production **[Deviation]**

- **Decision:** In the production database the Owner role template has `requires_mfa = false` (the Bookkeeper still requires two-step sign-in). This is a data setting on the role template, not a code or migration change: the seed, migrations, local stack and CI keep owner two-step sign-in **on**, so the MFA tests still cover the flow. Re-enable it in the Supabase SQL editor with `update role_templates set requires_mfa = true where key = 'owner';` (Admin → Roles shows the "Two-step sign-in" badge but has no switch for it).
- **Reason:** Owner request (2026-10-27): the owners asked to sign in with email + password only. SPEC §4.3/§13.1 call for two-step sign-in on owner accounts; recommended to turn it back on once day-to-day use settles.
