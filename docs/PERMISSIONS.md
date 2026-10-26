# Permissions

> Built in **Phase 1**. Packs, templates and per-user overrides are managed in **Setup → Roles & Permissions** (`/admin/roles`, owners only; needs `roles:manage`). The tables below are the **seeded defaults** from `supabase/migrations/20261026000300_platform_seed.sql`; owners can change templates and add custom packs after that, so the live screen is the source of truth for the current setup.

## Model (SPEC §4.2)

- **Permission packs** = pages + resource actions (`leads:read|create|update|delete|export|assign`, `jobs:advance_stage`, `estimates:approve_discount`, `invoices:edit`, `payments:record`, `reports:build`, `data:export`, `users:manage`, `roles:manage`, `workflows:manage`, `templates:manage`, `job_admin:override`, `records:restore`, `records:merge`, `bulk:update`, …), grouped by category: Core Records, Sales, Production, Finance, Data & Reporting, Operational Control, HR & Sensitive.
- **Role templates** compose packs. Each user gets one template plus optional per-user grants/revokes.
- **Record scope** per resource: `own`, `team`, `all`.
- **Field masking:** contract amounts, margins, costs and payment info are hidden from Crew Lead, Painter and Subcontractor in Postgres (masked views), not just the UI.
- **Enforcement:** Postgres RLS via `app.current_org_id()`, `app.has_perm()`, `app.record_scope()` + server-side checks in every Server Action.
- **View as user** (owners): read-only impersonation, visible banner, audit-logged.

## Role templates (seeded in Phase 1)

| Template                    | Summary                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Owner                       | Everything, incl. financials, margins, settings, permissions, View as user           |
| Office Manager              | All leads/jobs/schedule/invoices/payments; no permission editing; no margin settings |
| Estimator / Sales           | Own + assigned leads/jobs; estimates; discounts up to their limit; own numbers       |
| Project Manager / Crew Lead | Assigned jobs (scheduled → completed); no contract $ or margins                      |
| Painter                     | Today's jobs on mobile; nothing financial                                            |
| Subcontractor               | Like Painter, limited to their company's work orders + compliance docs               |
| Bookkeeper                  | Invoices, payments, AR, job costing, exports; read-only elsewhere                    |
| Read-only                   | Dashboards and records; no PII exports                                               |

## Matrix (seeded defaults)

How a permission resolves (Postgres `app.user_perm_scope()`, mirrored by `resolvePermissions()` in `lib/domain/permissions.ts`):

1. An owner-level template (`grants_all`: only **Owner**) holds every permission at scope _Everyone's_, with no packs.
2. Otherwise the user holds every permission in their template's live (not deleted) packs, at the **widest** scope any of those packs gives.
3. Per-user **grants** add a permission (or widen its scope); per-user **revokes** remove it and always win.

Scope only applies to permissions marked as scoped in the catalog (`lib/permissions/catalog.ts`). It shows as "—" below for the rest, which are stored as `all`.

### Packs

#### Core Records

**Core records — everyone's** (`core_records_all`, 20 permissions). Leads, accounts, contacts, tasks, notes and documents for the whole company.

| Permission                  | Key                | Scope      |
| --------------------------- | ------------------ | ---------- |
| View leads                  | `leads:read`       | Everyone's |
| Create leads                | `leads:create`     | —          |
| Edit leads                  | `leads:update`     | Everyone's |
| Delete leads                | `leads:delete`     | —          |
| Assign leads                | `leads:assign`     | —          |
| View accounts               | `accounts:read`    | Everyone's |
| Create accounts             | `accounts:create`  | —          |
| Edit accounts               | `accounts:update`  | Everyone's |
| Delete accounts             | `accounts:delete`  | —          |
| View contacts               | `contacts:read`    | Everyone's |
| Create contacts             | `contacts:create`  | —          |
| Edit contacts               | `contacts:update`  | Everyone's |
| Delete contacts             | `contacts:delete`  | —          |
| View tasks                  | `tasks:read`       | Everyone's |
| Create and edit tasks       | `tasks:manage`     | —          |
| View notes and comments     | `notes:read`       | —          |
| Write notes and comments    | `notes:write`      | —          |
| View documents              | `documents:read`   | —          |
| Upload and manage documents | `documents:manage` | —          |
| View Attention items        | `attention:read`   | Everyone's |

**Core records — own** (`core_records_own`, 15 permissions). Leads, accounts and contacts the user owns or is assigned to.

| Permission               | Key               | Scope       |
| ------------------------ | ----------------- | ----------- |
| View leads               | `leads:read`      | Own records |
| Create leads             | `leads:create`    | —           |
| Edit leads               | `leads:update`    | Own records |
| View accounts            | `accounts:read`   | Own records |
| Create accounts          | `accounts:create` | —           |
| Edit accounts            | `accounts:update` | Own records |
| View contacts            | `contacts:read`   | Own records |
| Create contacts          | `contacts:create` | —           |
| Edit contacts            | `contacts:update` | Own records |
| View tasks               | `tasks:read`      | Own records |
| Create and edit tasks    | `tasks:manage`    | —           |
| View notes and comments  | `notes:read`      | —           |
| Write notes and comments | `notes:write`     | —           |
| View documents           | `documents:read`  | —           |
| View Attention items     | `attention:read`  | Own records |

**Read all records** (`read_everything`, 17 permissions). View access across modules. No edits, no exports.

| Permission              | Key                 | Scope      |
| ----------------------- | ------------------- | ---------- |
| View leads              | `leads:read`        | Everyone's |
| View accounts           | `accounts:read`     | Everyone's |
| View contacts           | `contacts:read`     | Everyone's |
| View tasks              | `tasks:read`        | Everyone's |
| View notes and comments | `notes:read`        | —          |
| View documents          | `documents:read`    | —          |
| View Attention items    | `attention:read`    | Everyone's |
| View jobs               | `jobs:read`         | Everyone's |
| View appointments       | `appointments:read` | Everyone's |
| View estimates          | `estimates:read`    | Everyone's |
| View customer messages  | `messages:read`     | Everyone's |
| View the schedule       | `schedule:read`     | —          |
| View crews              | `crews:read`        | —          |
| View work orders        | `work_orders:read`  | Everyone's |
| View daily logs         | `daily_logs:read`   | Everyone's |
| View job photos         | `photos:read`       | Everyone's |
| View users              | `users:read`        | —          |

#### Sales

**Sales — everyone's** (`sales_all`, 16 permissions). Jobs, appointments, estimates and messages for the whole company, plus campaigns, referrals and reviews.

| Permission                 | Key                   | Scope      |
| -------------------------- | --------------------- | ---------- |
| View jobs                  | `jobs:read`           | Everyone's |
| Create jobs                | `jobs:create`         | —          |
| Edit jobs                  | `jobs:update`         | Everyone's |
| Delete jobs                | `jobs:delete`         | —          |
| Assign jobs                | `jobs:assign`         | —          |
| Advance job stages         | `jobs:advance_stage`  | —          |
| View appointments          | `appointments:read`   | Everyone's |
| Book and edit appointments | `appointments:manage` | —          |
| View estimates             | `estimates:read`      | Everyone's |
| Build estimates            | `estimates:create`    | —          |
| Send estimates             | `estimates:send`      | —          |
| View customer messages     | `messages:read`       | Everyone's |
| Send customer messages     | `messages:send`       | —          |
| Manage campaigns and drips | `campaigns:manage`    | —          |
| Manage referrals           | `referrals:manage`    | —          |
| Manage review requests     | `reviews:manage`      | —          |

**Sales — own** (`sales_own`, 12 permissions). Own jobs, appointments, estimates and messages; own commissions.

| Permission                 | Key                   | Scope       |
| -------------------------- | --------------------- | ----------- |
| View jobs                  | `jobs:read`           | Own records |
| Create jobs                | `jobs:create`         | —           |
| Edit jobs                  | `jobs:update`         | Own records |
| Advance job stages         | `jobs:advance_stage`  | —           |
| View appointments          | `appointments:read`   | Own records |
| Book and edit appointments | `appointments:manage` | —           |
| View estimates             | `estimates:read`      | Own records |
| Build estimates            | `estimates:create`    | —           |
| Send estimates             | `estimates:send`      | —           |
| View customer messages     | `messages:read`       | Own records |
| Send customer messages     | `messages:send`       | —           |
| View commissions           | `commissions:read`    | Own records |

#### Production

**Production — manage** (`production_manage`, 16 permissions). Schedule, crews, work orders, paint orders, daily logs, photos, punch lists and hours.

| Permission                      | Key                    | Scope      |
| ------------------------------- | ---------------------- | ---------- |
| View the schedule               | `schedule:read`        | —          |
| Edit the schedule               | `schedule:manage`      | —          |
| Publish schedule changes        | `schedule:publish`     | —          |
| View crews                      | `crews:read`           | —          |
| Manage crews and subcontractors | `crews:manage`         | —          |
| View work orders                | `work_orders:read`     | Everyone's |
| Manage work orders              | `work_orders:manage`   | —          |
| View daily logs                 | `daily_logs:read`      | Everyone's |
| Submit daily logs               | `daily_logs:create`    | —          |
| View job photos                 | `photos:read`          | Everyone's |
| Upload job photos               | `photos:upload`        | —          |
| Delete job photos               | `photos:delete`        | —          |
| Manage paint orders             | `paint_orders:manage`  | —          |
| Manage punch lists              | `punch_list:manage`    | —          |
| Clock hours                     | `time_entries:create`  | —          |
| Approve hours                   | `time_entries:approve` | —          |

**Crew lead** (`crew_lead`, 17 permissions). Assigned jobs: scope, colors, photos, daily logs, punch list, hours. No contract amounts.

| Permission               | Key                   | Scope       |
| ------------------------ | --------------------- | ----------- |
| View contacts            | `contacts:read`       | Own records |
| View tasks               | `tasks:read`          | Own records |
| Create and edit tasks    | `tasks:manage`        | —           |
| View notes and comments  | `notes:read`          | —           |
| Write notes and comments | `notes:write`         | —           |
| View documents           | `documents:read`      | —           |
| View jobs                | `jobs:read`           | Own records |
| View appointments        | `appointments:read`   | Own records |
| View the schedule        | `schedule:read`       | —           |
| View crews               | `crews:read`          | —           |
| View work orders         | `work_orders:read`    | Own records |
| View daily logs          | `daily_logs:read`     | Own records |
| Submit daily logs        | `daily_logs:create`   | —           |
| View job photos          | `photos:read`         | Own records |
| Upload job photos        | `photos:upload`       | —           |
| Manage punch lists       | `punch_list:manage`   | —           |
| Clock hours              | `time_entries:create` | —           |

**Field crew** (`field_crew`, 8 permissions). Today's jobs on mobile: scope, colors, photo upload, hours. Nothing financial.

| Permission        | Key                   | Scope       |
| ----------------- | --------------------- | ----------- |
| View documents    | `documents:read`      | —           |
| View jobs         | `jobs:read`           | Own records |
| View the schedule | `schedule:read`       | —           |
| View work orders  | `work_orders:read`    | Own records |
| View daily logs   | `daily_logs:read`     | Own records |
| View job photos   | `photos:read`         | Own records |
| Upload job photos | `photos:upload`       | —           |
| Clock hours       | `time_entries:create` | —           |

#### Finance

**Finance — billing** (`finance_billing`, 5 permissions). Contract amounts, invoices and payments.

| Permission                                 | Key               | Scope      |
| ------------------------------------------ | ----------------- | ---------- |
| See contract amounts, billing and payments | `financials:read` | Everyone's |
| View invoices                              | `invoices:read`   | Everyone's |
| Create and edit invoices                   | `invoices:edit`   | —          |
| View payments                              | `payments:read`   | —          |
| Record payments                            | `payments:record` | —          |

**Finance — view** (`finance_view`, 3 permissions). See contract amounts, invoices and payments.

| Permission                                 | Key               | Scope      |
| ------------------------------------------ | ----------------- | ---------- |
| See contract amounts, billing and payments | `financials:read` | Everyone's |
| View invoices                              | `invoices:read`   | Everyone's |
| View payments                              | `payments:read`   | —          |

**Finance — controls** (`finance_controls`, 2 permissions). Job costing, margins and month close.

| Permission                | Key                   | Scope |
| ------------------------- | --------------------- | ----- |
| See job costs and margins | `job_costing:read`    | —     |
| Close a month             | `finance:close_month` | —     |

#### Data & Reporting

**Reporting** (`reporting`, 3 permissions). Dashboards, Analytics and the report builder.

| Permission                        | Key              | Scope |
| --------------------------------- | ---------------- | ----- |
| View reports and dashboards       | `reports:read`   | —     |
| Build and schedule reports        | `reports:build`  | —     |
| Use Analytics and Ask Brushy Bear | `analytics:read` | —     |

**Reporting — view** (`reporting_view`, 2 permissions). View dashboards and Analytics.

| Permission                        | Key              | Scope |
| --------------------------------- | ---------------- | ----- |
| View reports and dashboards       | `reports:read`   | —     |
| Use Analytics and Ask Brushy Bear | `analytics:read` | —     |

**Data export** (`data_export`, 2 permissions). CSV exports (every export is logged).

| Permission         | Key            | Scope |
| ------------------ | -------------- | ----- |
| Export data to CSV | `data:export`  | —     |
| Export leads       | `leads:export` | —     |

#### Operational Control

**Approvals & overrides** (`approvals`, 3 permissions). Approve discounts and credits; override stage gates.

| Permission                                | Key                          | Scope |
| ----------------------------------------- | ---------------------------- | ----- |
| Approve discounts over the limit          | `estimates:approve_discount` | —     |
| Approve credits (incl. On-Time Guarantee) | `credits:approve`            | —     |
| Override job stage gates and dates        | `job_admin:override`         | —     |

**Administration** (`administration`, 14 permissions). Users, roles, settings, picklists, workflows, templates, integrations, audit log and data tools.

| Permission                            | Key                   | Scope |
| ------------------------------------- | --------------------- | ----- |
| View users                            | `users:read`          | —     |
| Invite, edit and deactivate users     | `users:manage`        | —     |
| View as another user                  | `users:view_as`       | —     |
| Edit roles and permissions            | `roles:manage`        | —     |
| Edit company settings and territories | `settings:manage`     | —     |
| Edit field picklists                  | `picklists:manage`    | —     |
| Manage workflows                      | `workflows:manage`    | —     |
| Manage message templates              | `templates:manage`    | —     |
| View integrations and the outbox      | `integrations:read`   | —     |
| Configure integrations                | `integrations:manage` | —     |
| View the audit log                    | `audit:read`          | —     |
| Restore deleted records               | `records:restore`     | —     |
| Merge duplicate records               | `records:merge`       | —     |
| Bulk update records                   | `bulk:update`         | —     |

**Office admin** (`office_admin`, 4 permissions). User directory, message templates, integrations view, restore deleted records.

| Permission                       | Key                 | Scope |
| -------------------------------- | ------------------- | ----- |
| View users                       | `users:read`        | —     |
| Manage message templates         | `templates:manage`  | —     |
| View integrations and the outbox | `integrations:read` | —     |
| Restore deleted records          | `records:restore`   | —     |

#### HR & Sensitive

**HR & sensitive** (`hr_sensitive`, 4 permissions). Pay, labor cost and commission plans.

| Permission              | Key                  | Scope      |
| ----------------------- | -------------------- | ---------- |
| See pay and labor cost  | `hr:read`            | —          |
| Edit pay and labor cost | `hr:manage`          | —          |
| View commissions        | `commissions:read`   | Everyone's |
| Manage commission plans | `commissions:manage` | —          |

### Templates × packs

| Pack                      | Owner | Office Manager | Estimator / Sales | Project Manager / Crew Lead | Painter (Crew Member) | Subcontractor | Bookkeeper | Read-only |
| ------------------------- | :---: | :------------: | :---------------: | :-------------------------: | :-------------------: | :-----------: | :--------: | :-------: |
| Core records — everyone's |  All  |       ✓        |         —         |              —              |           —           |       —       |     —      |     —     |
| Core records — own        |  All  |       —        |         ✓         |              —              |           —           |       —       |     —      |     —     |
| Read all records          |  All  |       —        |         —         |              —              |           —           |       —       |     ✓      |     ✓     |
| Sales — everyone's        |  All  |       ✓        |         —         |              —              |           —           |       —       |     —      |     —     |
| Sales — own               |  All  |       —        |         ✓         |              —              |           —           |       —       |     —      |     —     |
| Production — manage       |  All  |       ✓        |         —         |              —              |           —           |       —       |     —      |     —     |
| Crew lead                 |  All  |       —        |         —         |              ✓              |           —           |       —       |     —      |     —     |
| Field crew                |  All  |       —        |         —         |              —              |           ✓           |       ✓       |     —      |     —     |
| Finance — billing         |  All  |       ✓        |         —         |              —              |           —           |       —       |     ✓      |     —     |
| Finance — view            |  All  |       —        |         —         |              —              |           —           |       —       |     —      |     ✓     |
| Finance — controls        |  All  |       —        |         —         |              —              |           —           |       —       |     ✓      |     —     |
| Reporting                 |  All  |       ✓        |         —         |              —              |           —           |       —       |     ✓      |     —     |
| Reporting — view          |  All  |       —        |         —         |              —              |           —           |       —       |     —      |     ✓     |
| Data export               |  All  |       —        |         —         |              —              |           —           |       —       |     ✓      |     —     |
| Approvals & overrides     |  All  |       —        |         —         |              —              |           —           |       —       |     —      |     —     |
| Administration            |  All  |       —        |         —         |              —              |           —           |       —       |     —      |     —     |
| Office admin              |  All  |       ✓        |         —         |              —              |           —           |       —       |     —      |     —     |
| HR & sensitive            |  All  |       —        |         —         |              —              |           —           |       —       |     —      |     —     |

| Template                    | Key               | MFA required | Crew (mobile) |
| --------------------------- | ----------------- | :----------: | :-----------: |
| Owner                       | `owner`           |     Yes      |       —       |
| Office Manager              | `office_manager`  |      —       |       —       |
| Estimator / Sales           | `estimator`       |      —       |       —       |
| Project Manager / Crew Lead | `project_manager` |      —       |      Yes      |
| Painter (Crew Member)       | `painter`         |      —       |      Yes      |
| Subcontractor               | `subcontractor`   |      —       |      Yes      |
| Bookkeeper                  | `bookkeeper`      |     Yes      |       —       |
| Read-only                   | `read_only`       |      —       |       —       |

**Approvals & overrides**, **Administration** and **HR & sensitive** aren't in any seeded template. Only Owner holds them, through `grants_all`. To give one to someone else, add the pack to a custom template, or grant the single permission on that person's user page.

## How to change permissions safely

- **Preview first.** On a template's page, ticking or unticking packs shows **What changes** (permissions added, removed, or re-scoped) before you save. The effective-permission grid underneath highlights the same changes. Saving applies at once to everyone on the template.
- **Built-in packs are read-only.** The database refuses edits to system packs, so the starting templates stay predictable. To change one, open it and choose **Duplicate as custom pack**, edit the copy, then swap the copy in for the original on the templates that need it.
- **Custom packs** (Packs tab → **New pack**): pick a category and tick permissions. For scoped permissions, choose _Own records_, _Team_ or _Everyone's_. The key is generated from the name and never changes.
- **Copy a template rather than editing a built-in one** (Templates tab → **New template**). The copy starts with the source template's packs and its crew / MFA flags; then adjust its packs. Built-in templates (other than Owner) _can_ have their packs changed, but that affects every user on them.
- **One-off exceptions go on the user, not the template.** Use per-user grants and revokes on `/admin/users/<id>`, with a required reason. A revoke always beats what the template gives.
- **What's locked, and why:**
  - The **Owner** template can't be renamed, re-packed, deleted or copied. It always has every permission, so the business can't lock itself out. At least one active owner is always required.
  - Custom templates can't be made owner-level or "system" (database guard).
  - Built-in templates and packs can't be deleted.
  - A template can't be deleted while anyone is on it, including deactivated users. Move them to another template first.
- **Deleting is a soft delete with a reason.** Deleted templates and packs stop applying right away and can be restored from **Setup → Deleted Records**. A deleted pack grants nothing, even if a template still links to it.
- **Enforcement is in Postgres** (RLS + guard triggers). Every change is audit-logged and emits a domain event through database triggers. The screens only hide what the database already denies.
