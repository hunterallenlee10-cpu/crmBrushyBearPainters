# Metrics

> Skeleton. The metrics registry (`lib/metrics/registry.ts`) is built in **Phase 9** (SPEC §12). Every KPI will be listed here with its formula, the date field it filters on, supported filters, owner-only flag, and its fixture test.

## Rules

- Each KPI is defined **once** in the registry. Cards, reports, "Ask Brushy Bear" and the Daily Brief all read from it.
- Aggregation is server-side over all records (SQL views / RPCs), never from a paginated client list.
- Every card shows a **formula caption** (e.g. "38 open estimates × $6.2k avg · rolling 90d").
- Every metric has a unit test against seeded fixtures with a known expected value. This is how impossible values (a 0% close rate while sold jobs exist) are designed out.

## Estimates (Phase 4)

From `estimate_stats(p_from, p_to)` (one server query, row-security scoped), defined in `ESTIMATE_METRICS`. Shown on `/estimates`.

| Metric                        | Formula                                                                                                 | Date field                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Estimates Sent                | estimates first sent in the period                                                                      | `estimates.sent_at`                          |
| 24h Estimate SLA              | sent within the SLA hours (Company Settings) after the walkthrough ÷ those with a completed walkthrough | `sent_at` vs `jobs.walkthrough_completed_at` |
| Close Rate                    | accepted ÷ sent, same cohort (first sent in the period)                                                 | `sent_at`                                    |
| Close Rate ($)                | accepted value ÷ sent value, same cohort                                                                | `sent_at`                                    |
| Avg Job Value                 | accepted value ÷ estimates accepted in the period                                                       | `accepted_at`                                |
| Open Estimates                | value of estimates sent or viewed and not yet answered, right now                                       | —                                            |
| Discounts waiting (Approvals) | pending `estimate_discount` approval requests                                                           | —                                            |

Fixture tests: `lib/metrics/registry.test.ts`. The Jobs Dashboard money now reads the contract amount (accepted estimate + signed change orders, else the baseline).

## Documents (Phase 5)

Source: `public.document_stats(p_job)` (row security applies; `p_job` limits it to one job).

| Metric             | Formula                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Total documents    | live documents you can see                                                                         |
| Awaiting signature | documents marked "awaiting signature"                                                              |
| Needs action       | required onboarding items still open that need paperwork: signed contract, HOA approval, lead-safe |
| Linked to jobs     | documents on a job (the rest are on a customer only)                                               |
| Recently added     | documents added in the last 7 days                                                                 |
| Storage used       | sum of file sizes                                                                                  |

## Onboarding Board (Phase 5)

Source: the board summary built on the server from every job on the board (Sold → Paid in Full, plus jobs paid in full this month; up to 2,000), lanes from `lib/domain/onboarding/board.ts`. Filters on the page apply.

| Metric                  | Formula                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| Active jobs / pipeline  | jobs not in Paid in Full; their contract value                        |
| Deposit Hold / held     | jobs on Deposit Hold; total of their deposit invoices                 |
| Needs Onboarding / age  | jobs working the checklist; average days in the lane                  |
| On Hold / Expediting    | jobs with a blocking hold (not deposit); average days since the hold  |
| Ready to Schedule ($)   | cleared jobs waiting for dates; their contract value                  |
| Scheduled / In Progress | scheduled, in progress or at the final walkthrough                    |
| Invoicing / Outstanding | completed or invoiced; billed − collected (— until payments, Phase 7) |
| Paid in Full            | paid in full this month (Pacific)                                     |

Lane "overdue" uses the attention thresholds: sold with no deposit (3 days), onboarding stalled (7), ready not scheduled (5). Fixture tests: `lib/metrics/registry.test.ts`, `lib/domain/onboarding/board.test.ts`.

## Production (Phase 6)

Source: `public.production_stats()` (one server query, row-security scoped; money only with `financials:read`), defined in `PRODUCTION_METRICS`. Shown on the Command Center and Master Schedule. Board counts (`SCHEDULE_BOARD_METRICS`) come from the board the server builds for the visible window.

| Metric                                      | Formula                                                                                                                   | Date field                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Ready to Schedule                           | jobs in Ready to Schedule, right now                                                                                      | —                            |
| Unscheduled                                 | Ready to Schedule with no live schedule entry (draft or published)                                                        | —                            |
| Scheduled                                   | jobs in Scheduled (dates published, not started)                                                                          | —                            |
| In Progress                                 | jobs in In Progress                                                                                                       | —                            |
| At Risk                                     | Scheduled jobs starting within 7 days (or already past their start) with no crew, materials not ready, or a blocking hold | `schedule_entries.starts_on` |
| Rain reschedules                            | jobs flagged priority reschedule                                                                                          | —                            |
| Completed this week                         | jobs that reached Completed since Monday (Pacific)                                                                        | `jobs.completed_at`          |
| Starts next 7 days                          | jobs whose first published day is within 7 days                                                                           | `starts_on`                  |
| Scheduled revenue (30 days)                 | contract value of jobs whose first published day is in the next 30 days (owner/finance only)                              | `starts_on`                  |
| Daily update compliance                     | daily logs posted ÷ production days due, last 30 days (a day counts once the cutoff passed; rain days don't count)        | `daily_logs.log_date`        |
| On-time start                               | started on or before the guarantee date ÷ jobs started, last 90 days; weather slips excluded                              | `jobs.actual_start_date`     |
| Rain-delay days                             | rain days marked, last 90 days                                                                                            | `rain_delays.delay_date`     |
| Punch items per job                         | punch items ÷ jobs completed in the last 90 days                                                                          | `jobs.completed_at`          |
| Labor hours estimated / actual / variance   | budgeted work-order hours vs. hours logged (time entries) on jobs completed in 90 days; actual ÷ estimated × 100          | `jobs.completed_at`          |
| Backlog                                     | budgeted hours of open work orders on Ready to Schedule, Scheduled and In Progress jobs ÷ crew-day hours (Schedule Admin) | —                            |
| Crews                                       | active crews                                                                                                              | —                            |
| Conflicts / Draft changes / To be scheduled | bars with conflicts in the window; entries with a pending draft; cards in the tray                                        | board window                 |

Fixture tests: `lib/metrics/registry.test.ts` (parsing, units, money hidden without financials). SQL: `supabase/tests/012_production.test.sql` checks `production_stats()` counts.

## Minimum set (SPEC §12.1)

Leads created · leads by source · speed to lead (median, p90) · contact rate · walkthrough set rate · walkthrough show rate · estimates sent · 24h SLA % · close rate (count and $) · avg job value · sales velocity · pipeline value · backlog crew-days · projected revenue · revenue sold/completed/collected · gross margin % · labor hours estimated vs actual · daily-update compliance % · on-time start % · rain-delay days · punch items per job · days completed → paid · A/R aging · collection % · review rate · referral conversions · revenue by city/source/estimator · cost per lead & CAC.
