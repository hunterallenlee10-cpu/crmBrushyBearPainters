# Permissions

> Skeleton. The permission engine is built in **Phase 1**; this page becomes the packs × templates matrix then.

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

## Matrix

_Filled in during Phase 1._
