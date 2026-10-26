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
