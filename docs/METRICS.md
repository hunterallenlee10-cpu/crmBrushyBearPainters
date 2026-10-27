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

## Money (Phase 7)

Source: `public.finance_stats(from, to)` (one server query, security invoker so row security applies; everything hidden without `financials:read`, costs only with `job_costing:read`), defined in `FINANCE_METRICS`. Shown on `/invoices`, A/R aging, Admin → Finance; the Onboarding Board's collected / outstanding use `job_ledger`. "Sent" means issued: not void and `sent_at` set.

| Metric                                  | Formula                                                                                                                                                                              | Date field                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| A/R Outstanding                         | Σ balance of sent invoices (credit memos net against it)                                                                                                                             | — (right now)               |
| Overdue / Overdue invoices              | Σ balance (and count) of sent invoices past their due date                                                                                                                           | `invoices.due_date`         |
| Collected                               | Σ applications of live payments (received or cleared) received in the period; unapplied money excluded                                                                               | `payments.received_on`      |
| Billed                                  | Σ totals of invoices sent in the period                                                                                                                                              | `invoices.issue_date`       |
| Collection %                            | collected ÷ billed on invoices issued in the period × 100                                                                                                                            | `invoices.issue_date`       |
| Revenue sold                            | Σ contract (net of credits) of jobs whose estimate was accepted in the period                                                                                                        | `jobs.estimate_accepted_at` |
| Revenue completed                       | Σ contract (net of credits) of jobs completed in the period                                                                                                                          | `jobs.completed_at`         |
| Gross Margin % (completed)              | (revenue − cost) ÷ revenue × 100 on jobs completed in the period; cost = labor hours × hourly cost + paint orders + subcontractor POs + expenses (owners only; negative shows as 0%) | `jobs.completed_at`         |
| Days completed → paid                   | average days from Completed to Paid in Full, jobs paid in full in the period                                                                                                         | `jobs.paid_in_full_at`      |
| Unapplied cash                          | Σ live payment money not applied to any invoice                                                                                                                                      | — (right now)               |
| Aging: Current, 1–30, 31–60, 61–90, 90+ | Σ balance of sent invoices by days past due (0, 1–30, 31–60, 61–90, > 90), with counts                                                                                               | `invoices.due_date`         |
| Open / Draft invoices                   | sent invoices with money owed; drafts                                                                                                                                                | — (right now)               |
| Pending credits                         | Σ credits waiting for owner approval                                                                                                                                                 | — (right now)               |

Job-level figures (contract, billed, left to bill, collected, balance, due) come from `job_ledger` and `computeJobLedger()`; see DATA_MODEL "No stored balances". Fixture tests: `lib/metrics/finance.test.ts`; SQL: `supabase/tests/013_money.test.sql` checks `finance_stats()`.

## Communication & growth (Phase 8)

Source: `public.communication_stats(from, to)` (one server query, security invoker so row security applies), defined in `COMMUNICATION_METRICS` and parsed by `parseCommunicationStats()`. Shown on Admin → Workflows, Warranty & Service, Campaigns, Bear Champions, Reviews and the Onboarding Board's "Open Warranty/Service" tile. Counts "right now" ignore the period; the rest count rows whose date falls in it (90 days on most screens, 365 on Bear Champions and Reviews). `workflow_stats()` gives the per-workflow run counts on Admin → Workflows.

| Id                        | Metric                | What it counts                                                                        | Caption                                    |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| `messages.unread`         | Unread conversations  | Customer conversations with a text or email nobody has read yet.                      | Inbound after the last read · right now    |
| `messages.threads`        | Conversations         | Lead and job conversations you can see.                                               | All conversations · right now              |
| `cases.open`              | Open cases            | Warranty and service cases not resolved or closed.                                    | Not resolved · right now                   |
| `cases.overdue`           | Past SLA              | Open cases past their SLA due time (2 business days by default).                      | Open and past SLA · right now              |
| `cases.warranty_open`     | Open Warranty/Service | Open warranty cases.                                                                  | Warranty cases not resolved · right now    |
| `cases.on_time_rate`      | Resolved within SLA   | Of the cases resolved in the period, the share resolved by their SLA due time.        | Resolved by SLA ÷ resolved · in the period |
| `campaigns.total`         | Campaigns             | Campaigns that aren't canceled.                                                       | All campaigns · right now                  |
| `campaigns.active`        | Active                | Scheduled, sending or paused campaigns.                                               | Scheduled + sending + paused · right now   |
| `campaigns.sends`         | Sends (90d)           | Campaign messages recorded (simulated) in the period.                                 | Recipients sent · last 90 days             |
| `campaigns.delivery_rate` | Delivery rate         | Sends that didn't fail, of all attempts. Simulated until a provider reports delivery. | Sent ÷ (sent + failed) · last 90 days      |
| `campaigns.bounce_rate`   | Bounce rate           | Failed sends, of all attempts.                                                        | Failed ÷ (sent + failed) · last 90 days    |
| `campaigns.replies`       | Replies (90d)         | Recipients who replied within 14 days of a campaign.                                  | Replied after a send · last 90 days        |
| `campaigns.conversions`   | Conversions           | Recipients who booked or became a job after a campaign.                               | Converted after a send · last 90 days      |
| `campaigns.queue`         | Queue                 | Recipients waiting to be sent (scheduled or held for quiet hours).                    | Pending + held · right now                 |
| `messages.unsubscribes`   | Unsubscribes          | Contacts and leads who unsubscribed from marketing email in the period.               | Email unsubscribes · last 90 days          |
| `messages.sms_opt_outs`   | SMS opt-outs          | Contacts and leads who replied STOP in the period.                                    | STOP replies · last 90 days                |
| `drips.active`            | In a drip             | Active drip enrollments.                                                              | Active enrollments · right now             |
| `reviews.requested`       | Review requests       | Review requests sent in the period.                                                   | Requests sent · in the period              |
| `reviews.click_rate`      | Click-through         | Requests whose review link was opened.                                                | Clicked ÷ requested · in the period        |
| `reviews.review_rate`     | Review rate           | Requests that led to a review (marked by the office).                                 | Reviews left ÷ requested · in the period   |
| `reviews.left`            | Reviews left          | Reviews customers left for requests sent in the period.                               | Marked review left · in the period         |
| `reviews.avg_rating`      | Average rating        | Average star rating where the office recorded one.                                    | Σ stars ÷ rated reviews · in the period    |
| `referrals.champions`     | Champions             | Active Bear Champions.                                                                | Active champions · right now               |
| `referrals.referrals`     | Referrals             | Referrals that came in during the period.                                             | New referrals · in the period              |
| `referrals.closed`        | Closed deals          | Eligible referrals whose job was sold (all time).                                     | Referred jobs sold · all time              |
| `referrals.conversion`    | Referral conversion   | Referred jobs sold, of all referrals (all time).                                      | Sold ÷ referrals · all time                |
| `referrals.paid_out`      | Paid out              | Referral rewards paid to champions (all time).                                        | Σ rewards paid · all time                  |
| `referrals.payable`       | Ready to pay          | Rewards whose referred job met the program rule and aren't paid yet.                  | Σ payable rewards · right now              |
| `workflows.runs`          | Workflow runs         | Workflow runs started in the period (dry runs excluded).                              | Runs · in the period                       |
| `workflows.failed`        | Failed runs           | Runs that stopped on an error in the period.                                          | Failed · in the period                     |
| `workflows.waiting`       | Waiting               | Runs waiting for a delay, a reminder time or the end of quiet hours.                  | Waiting runs · right now                   |

Fixture tests: `lib/metrics/registry.test.ts` (communication metrics); SQL: `supabase/tests/014_communication.test.sql` checks `communication_stats()`.

## Minimum set (SPEC §12.1)

Leads created · leads by source · speed to lead (median, p90) · contact rate · walkthrough set rate · walkthrough show rate · estimates sent · 24h SLA % · close rate (count and $) · avg job value · sales velocity · pipeline value · backlog crew-days · projected revenue · revenue sold/completed/collected · gross margin % · labor hours estimated vs actual · daily-update compliance % · on-time start % · rain-delay days · punch items per job · days completed → paid · A/R aging · collection % · review rate · referral conversions · revenue by city/source/estimator · cost per lead & CAC.
