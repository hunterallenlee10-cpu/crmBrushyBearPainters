# Metrics

> Skeleton. The metrics registry (`lib/metrics/registry.ts`) is built in **Phase 9** (SPEC §12). Every KPI will be listed here with its formula, the date field it filters on, supported filters, owner-only flag, and its fixture test.

## Rules

- Each KPI is defined **once** in the registry. Cards, reports, "Ask Brushy Bear" and the Daily Brief all read from it.
- Aggregation is server-side over all records (SQL views / RPCs), never from a paginated client list.
- Every card shows a **formula caption** (e.g. "38 open estimates × $6.2k avg · rolling 90d").
- Every metric has a unit test against seeded fixtures with a known expected value. This is how impossible values (a 0% close rate while sold jobs exist) are designed out.

## Minimum set (SPEC §12.1)

Leads created · leads by source · speed to lead (median, p90) · contact rate · walkthrough set rate · walkthrough show rate · estimates sent · 24h SLA % · close rate (count and $) · avg job value · sales velocity · pipeline value · backlog crew-days · projected revenue · revenue sold/completed/collected · gross margin % · labor hours estimated vs actual · daily-update compliance % · on-time start % · rain-delay days · punch items per job · days completed → paid · A/R aging · collection % · review rate · referral conversions · revenue by city/source/estimator · cost per lead & CAC.
