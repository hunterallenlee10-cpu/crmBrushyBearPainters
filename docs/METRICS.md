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

## Minimum set (SPEC §12.1)

Leads created · leads by source · speed to lead (median, p90) · contact rate · walkthrough set rate · walkthrough show rate · estimates sent · 24h SLA % · close rate (count and $) · avg job value · sales velocity · pipeline value · backlog crew-days · projected revenue · revenue sold/completed/collected · gross margin % · labor hours estimated vs actual · daily-update compliance % · on-time start % · rain-delay days · punch items per job · days completed → paid · A/R aging · collection % · review rate · referral conversions · revenue by city/source/estimator · cost per lead & CAC.
