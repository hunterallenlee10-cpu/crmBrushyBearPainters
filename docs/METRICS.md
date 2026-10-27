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

## Analytics & home (Phase 9)

Sources, all security invoker (row security and money permissions apply) and aggregated in Postgres:

- `public.analytics_stats(from, to, filters)` → `kpi.*` and the breakdowns (`parseAnalyticsStats()`). Filters: `work_type`, `territory_id` (city), `owner_id`, `source`. Money is `null` without `financials:read`; gross margin needs `job_costing:read`.
- `public.analytics_monthly(from_month, months, filters)` → Revenue Forecast (sold per month, goal); `public.season_backlog(year)` → Exterior Season Backlog.
- `public.my_numbers(user, from, to)` → `mine.*`; `public.workspace_summary()` → `myday.*`; `public.daily_brief(day)` → `brief.*`.

Each entry has its id, label, description, source, date field, filters, unit, caption template (`{period}` filled from the date range) and owner-only flag; `metricSpec(id)` returns the whole sheet and the "View data" tables show the date field and filters. A ratio with nothing to divide by is "—"; an empty company shows 0 and "—", never NaN. Cost per lead and CAC need marketing spend (Admin → Marketing Spend) and show "—" with a work-type, city or owner filter (spend isn't split that way). Projected revenue = this month's sold value ÷ day of month × days in month. Gross margin = (revenue − direct cost) ÷ revenue for jobs completed in the period.

Shown on: Home (Executive Overview, My Day), `/analytics` (Ask Brushy Bear, Daily Brief, My Business – This Month, On Pace), the six prebuilt dashboards, custom dashboards and My Numbers. Fixture tests: `lib/metrics/analytics.test.ts` with `lib/metrics/fixtures/analytics.ts`; SQL: `supabase/tests/015_analytics.test.sql` loads the same company and checks every `analytics_stats` value against the `@fixture:analytics_stats` block (the unit test reads that block so the two can't drift).

#### KPI

| Id                              | Metric                                  | What it counts                                                                                                                                        | Unit     | Date field                                               | Caption                                                                            |
| ------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `kpi.leads_created`             | Leads created                           | Leads that came in during the period, from any source.                                                                                                | count    | `leads.created_at`                                       | Leads created {period}                                                             |
| `kpi.speed_to_lead_median`      | Speed to Lead                           | Median time from a lead arriving to a person first reaching them, counted in business hours.                                                          | duration | `leads.created_at`                                       | Median, business hours · leads created {period}                                    |
| `kpi.speed_to_lead_p90`         | Speed to Lead (p90)                     | 9 in 10 leads were reached within this time (business hours).                                                                                         | duration | `leads.created_at`                                       | 90th percentile, business hours · leads created {period}                           |
| `kpi.contact_rate`              | Contact rate                            | Share of the period's leads a person has reached at least once.                                                                                       | percent  | `leads.created_at`                                       | Leads contacted ÷ leads created {period}                                           |
| `kpi.walkthrough_set_rate`      | Walkthrough set rate                    | Share of the period's leads that got a walkthrough booked.                                                                                            | percent  | `leads.created_at`                                       | Leads with a walkthrough booked ÷ leads created {period}                           |
| `kpi.walkthrough_show_rate`     | Walkthrough show rate                   | Of walkthroughs whose time came in the period, the share completed (no-shows are the rest).                                                           | percent  | `appointments.starts_at`                                 | Completed ÷ (completed + no-shows) · walkthroughs {period}                         |
| `kpi.estimates_sent`            | Estimates Sent                          | Estimates sent to the customer for the first time in the period.                                                                                      | count    | `estimate_versions.sent_at (first send)`                 | First sent {period}                                                                |
| `kpi.sla_24h`                   | 24h Estimate SLA                        | Share of estimates sent within the estimate SLA (Company Settings, 24 hours by default) after the walkthrough was completed.                          | percent  | `estimate_versions.sent_at (first send)`                 | Sent within the SLA ÷ estimates with a completed walkthrough · first sent {period} |
| `kpi.close_rate`                | Close Rate                              | Accepted ÷ sent, same cohort: estimates first sent in the period.                                                                                     | percent  | `estimate_versions.sent_at (first send)`                 | Accepted ÷ sent · estimates first sent {period}                                    |
| `kpi.close_rate_value`          | Close Rate ($)                          | Accepted value ÷ sent value, same cohort.                                                                                                             | percent  | `estimate_versions.sent_at (first send)`                 | Accepted $ ÷ sent $ · estimates first sent {period}                                |
| `kpi.avg_job_value`             | Avg Job Value                           | Accepted estimate value ÷ estimates accepted in the period.                                                                                           | money    | `estimates.accepted_at`                                  | Accepted $ ÷ estimates accepted {period}                                           |
| `kpi.sales_velocity`            | Sales Velocity                          | Average days from the lead arriving to the estimate being accepted.                                                                                   | days     | `jobs.estimate_accepted_at`                              | Average days lead → sold · jobs sold {period}                                      |
| `kpi.sold_jobs`                 | Jobs sold                               | Jobs whose estimate was accepted in the period.                                                                                                       | count    | `jobs.estimate_accepted_at`                              | Estimate accepted {period}                                                         |
| `kpi.pipeline_value`            | Open Pipeline Value                     | Open estimates (sent or viewed, not answered) plus the contract value of jobs sold but not started.                                                   | money    | `—`                                                      | Open estimates + sold, not started · right now                                     |
| `kpi.pipeline_open_estimates`   | Open estimates                          | Value of estimates sent and waiting on the customer.                                                                                                  | money    | `—`                                                      | Sent or viewed, not answered · right now                                           |
| `kpi.pipeline_sold_not_started` | Sold, not started                       | Contract value of jobs sold and not yet in production.                                                                                                | money    | `—`                                                      | Sold → Scheduled · right now                                                       |
| `kpi.projected_revenue`         | Projected Revenue                       | Sold so far in the period plus the same daily pace for the days left (run-rate). Once the period is over it is what sold.                             | money    | `jobs.estimate_accepted_at`                              | Sold {period} + run-rate for the days left                                         |
| `kpi.revenue_sold`              | Revenue sold                            | Contract value of jobs whose estimate was accepted in the period.                                                                                     | money    | `jobs.estimate_accepted_at`                              | Contracts accepted {period}                                                        |
| `kpi.revenue_completed`         | Revenue completed                       | Contract value of jobs that reached Completed in the period.                                                                                          | money    | `jobs.completed_at`                                      | Jobs completed {period}                                                            |
| `kpi.revenue_collected`         | Collected                               | Payments received in the period and applied to invoices (bounced, void, refunded and unapplied money never counts).                                   | money    | `payments.received_on`                                   | Applied payments received {period}                                                 |
| `kpi.completed_jobs`            | Jobs completed                          | Jobs that reached Completed in the period.                                                                                                            | count    | `jobs.completed_at`                                      | Reached Completed {period}                                                         |
| `kpi.gross_margin_completed`    | Gross Margin % (completed) (owner-only) | Jobs completed in the period: (contract − labor − materials − subcontractors − expenses) ÷ contract.                                                  | percent  | `jobs.completed_at`                                      | Gross profit ÷ revenue · jobs completed {period}                                   |
| `kpi.labor_hours_estimated`     | Labor hours estimated                   | Budgeted work-order hours on jobs completed in the period.                                                                                            | hours    | `jobs.completed_at`                                      | Budgeted hours · jobs completed {period}                                           |
| `kpi.labor_hours_actual`        | Labor hours actual                      | Hours logged on jobs completed in the period.                                                                                                         | hours    | `jobs.completed_at`                                      | Logged hours · jobs completed {period}                                             |
| `kpi.labor_hours_variance`      | Actual vs estimated hours               | Hours logged ÷ hours budgeted × 100 (over 100 means over budget).                                                                                     | number   | `jobs.completed_at`                                      | Actual ÷ estimated × 100 · jobs completed {period}                                 |
| `kpi.daily_update_compliance`   | Daily Update Compliance                 | Production days with a daily log ÷ production days due in the period (a day is due after the cutoff, 7 pm Pacific by default; rain days don't count). | percent  | `schedule_entries.starts_on – ends_on (production days)` | Days logged ÷ production days due {period}                                         |
| `kpi.on_time_start`             | On-Time Start                           | Jobs that started on or before their guaranteed start date ÷ jobs that started in the period. Rain delays don't count against it.                     | percent  | `jobs.actual_start_date`                                 | Started on time ÷ started {period} · weather excluded                              |
| `kpi.rain_delay_days`           | Rain-delay days                         | Job days marked as rain delays in the period.                                                                                                         | count    | `rain_delays.delay_date`                                 | Marked rain days {period}                                                          |
| `kpi.punch_per_job`             | Punch items per job                     | Punch items ÷ jobs completed in the period.                                                                                                           | number   | `jobs.completed_at`                                      | Average punch items · jobs completed {period}                                      |
| `kpi.backlog_crew_days`         | Backlog                                 | Open work-order hours on Ready, Scheduled and In Progress jobs ÷ the crew-day hours in Schedule Admin.                                                | days     | `—`                                                      | Crew-days of work not yet done · right now                                         |
| `kpi.days_completed_to_paid`    | Days completed → paid                   | Average days from Completed to Paid in Full, for jobs paid in full in the period.                                                                     | days     | `jobs.paid_in_full_at`                                   | Average · jobs paid in full {period}                                               |
| `kpi.ar_outstanding`            | AR Outstanding                          | What customers owe on sent invoices.                                                                                                                  | money    | `—`                                                      | Sent invoices, balance owed · right now                                            |
| `kpi.ar_overdue`                | Overdue                                 | Balance owed on sent invoices past their due date.                                                                                                    | money    | `—`                                                      | Past due · right now                                                               |
| `kpi.collection_rate`           | Collection %                            | Of the invoices issued in the period, the share already paid.                                                                                         | percent  | `invoices.issue_date`                                    | Collected ÷ billed · invoices issued {period}                                      |
| `kpi.reviews_requested`         | Review requests                         | Review requests sent in the period (skipped ones left out).                                                                                           | count    | `review_requests.sent_at`                                | Requests sent {period}                                                             |
| `kpi.review_rate`               | Review rate                             | Review requests that led to a review (marked by the office).                                                                                          | percent  | `review_requests.sent_at`                                | Reviews left ÷ requests sent {period}                                              |
| `kpi.referrals`                 | Referrals                               | Bear Champion referrals that came in during the period.                                                                                               | count    | `referrals.created_at`                                   | New referrals {period}                                                             |
| `kpi.referral_conversions`      | Referral conversions                    | Referrals from the period whose job was sold (eligible referrals only).                                                                               | count    | `referrals.created_at`                                   | Referred jobs sold · referrals from {period}                                       |
| `kpi.marketing_spend`           | Marketing spend                         | Monthly spend per lead source from Admin → Marketing Spend, prorated by day for partial months.                                                       | money    | `marketing_spend.month (prorated by day)`                | Spend entered for {period}                                                         |
| `kpi.cost_per_lead`             | Cost per lead                           | Marketing spend ÷ leads created. Spend isn't split by work type, city or owner, so those filters show “—”.                                            | money    | `leads.created_at`                                       | Spend ÷ leads created {period}                                                     |
| `kpi.cac`                       | Customer acquisition cost               | Marketing spend ÷ jobs sold (from that source when a source is picked).                                                                               | money    | `jobs.estimate_accepted_at`                              | Spend ÷ jobs sold {period}                                                         |
| `kpi.expiring_estimates`        | Expiring estimates                      | Sent estimates that expire within 5 days without an answer.                                                                                           | count    | `—`                                                      | Expire within 5 days · right now                                                   |
| `kpi.dq_leads_unassigned`       | Leads with no owner                     | Open leads nobody owns.                                                                                                                               | count    | `—`                                                      | Open leads, no owner · right now                                                   |
| `kpi.dq_jobs_no_poc`            | Jobs with no point of contact           | Open jobs without the one point of contact every customer is promised.                                                                                | count    | `—`                                                      | Open jobs, no point of contact · right now                                         |
| `kpi.dq_jobs_no_property`       | Jobs with no property                   | Open jobs not linked to a property (no address for the crew).                                                                                         | count    | `—`                                                      | Open jobs, no property · right now                                                 |
| `kpi.dq_contacts_unreachable`   | Contacts we can't reach                 | Contacts with no mobile, phone or email.                                                                                                              | count    | `—`                                                      | No phone or email · right now                                                      |

#### Breakdowns

| Id                            | Chart                   | What it shows                                                                                                                                                                                       |
| ----------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpi.pipeline_by_stage`       | Pipeline by Stage       | Open jobs (not Closed Won or Lost) by current stage: count and contract value.                                                                                                                      |
| `kpi.revenue_forecast`        | Revenue Forecast        | Sold value by month: actual, run-rate projection for this month and the next ones (average of the last 3 full months), and the goal from Admin → Revenue Goals.                                     |
| `kpi.lead_funnel`             | Lead Funnel             | Leads created in the period and how many reached each step: contacted, walkthrough, estimate sent, sold.                                                                                            |
| `kpi.season_backlog`          | Exterior Season Backlog | Exterior and deck crew-days on the published schedule vs crew capacity (active crews × production days) for each month of the exterior season, plus sold exterior work not scheduled yet.           |
| `kpi.city_performance`        | City Performance        | Leads created and jobs sold in the period by service-area city, ranked by sold value (then jobs, then leads).                                                                                       |
| `kpi.estimator_leaderboard`   | Estimator Leaderboard   | Per estimator: value and number of estimates accepted in the period, and close rate (accepted ÷ sent, estimates first sent in the period).                                                          |
| `kpi.lead_source_performance` | Lead Source Performance | Per lead source: leads created, converted, conversion %, jobs sold and revenue in the period, and cost per lead when spend is entered.                                                              |
| `kpi.lead_source_mix`         | Lead Source Mix         | Share of the period's leads from each source.                                                                                                                                                       |
| `kpi.ar_aging`                | A/R Aging               | Balance owed on sent invoices by how far past due they are.                                                                                                                                         |
| `kpi.backlog_by_work_type`    | Backlog by Work Type    | Open work-order hours on Ready, Scheduled and In Progress jobs, as crew-days, by the job's first work type.                                                                                         |
| `kpi.executive_alerts`        | Executive Alerts        | Open Attention items by rule (untouched and aging leads, stalled jobs, approvals, overdue invoices, missed daily updates, weather risk, expiring estimates, subcontractor paperwork). Not filtered. |

#### My Numbers

| Id                      | Metric           | What it counts                                                  | Unit  | Date field                               | Caption                                    |
| ----------------------- | ---------------- | --------------------------------------------------------------- | ----- | ---------------------------------------- | ------------------------------------------ |
| `mine.leads_issued`     | Leads Issued     | Leads assigned to you that came in during the period.           | count | `leads.created_at`                       | Your leads, by date created                |
| `mine.walkthroughs_set` | Walkthroughs Set | Walkthroughs you booked during the period.                      | count | `appointments.created_at`                | Booked by you, by date booked              |
| `mine.walkthroughs_ran` | Walkthroughs Ran | Walkthroughs you were on that were completed during the period. | count | `appointments.completed_at`              | Completed, by date completed               |
| `mine.estimates_sent`   | Estimates Sent   | Your estimates first sent during the period.                    | count | `estimate_versions.sent_at (first send)` | By date first sent                         |
| `mine.sold_count`       | Sold             | Your estimates accepted during the period.                      | count | `estimates.accepted_at`                  | By date accepted                           |
| `mine.sold_value`       | Sold ($)         | Accepted value of your estimates accepted during the period.    | money | `estimates.accepted_at`                  | Accepted estimate totals, by date accepted |
| `mine.completed`        | Completed        | Your jobs that reached Completed during the period.             | count | `jobs.completed_at`                      | By date completed                          |
| `mine.invoiced`         | Invoiced         | Your jobs whose final invoice was sent during the period.       | count | `jobs.final_invoiced_at`                 | By date the final invoice was sent         |
| `mine.paid`             | Paid in full     | Your jobs paid in full during the period.                       | count | `jobs.paid_in_full_at`                   | By date paid in full                       |

#### My Day

| Id                               | Metric             | What it counts                                                                            | Unit  | Date field                       | Caption                                |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- | ----- | -------------------------------- | -------------------------------------- |
| `myday.tasks_due_today`          | Due today          | Your open tasks due today (Pacific).                                                      | count | `tasks.due_at (today)`           | Open tasks due today                   |
| `myday.tasks_overdue`            | Overdue            | Your open tasks due before today.                                                         | count | `tasks.due_at`                   | Open tasks due before today            |
| `myday.tasks_upcoming`           | Upcoming           | Your open tasks due after today.                                                          | count | `tasks.due_at`                   | Due after today                        |
| `myday.tasks_no_due`             | No due date        | Your open tasks with no due date.                                                         | count | `—`                              | No due date                            |
| `myday.appointments_today`       | Appointments today | Appointments you're on today (canceled and rescheduled ones left out).                    | count | `appointments.starts_at (today)` | On your calendar today                 |
| `myday.jobs_active`              | Active jobs        | Open jobs you're on (owner, point of contact, project manager, team or crew).             | count | `—`                              | Open jobs you're on                    |
| `myday.jobs_need_action`         | Need action        | Your jobs with an open Attention item you own.                                            | count | `—`                              | Jobs with your open Attention items    |
| `myday.jobs_at_risk`             | At risk            | Your open jobs with a health score under 60.                                              | count | `—`                              | Health under 60                        |
| `myday.leads_new`                | New today          | Leads assigned to you that came in today.                                                 | count | `leads.created_at (today)`       | Your leads created today               |
| `myday.leads_awaiting_contact`   | Awaiting contact   | Your new leads nobody has called, texted or emailed yet.                                  | count | `—`                              | Not reached yet                        |
| `myday.leads_follow_ups_today`   | Follow-ups today   | Your lead tasks due today.                                                                | count | `tasks.due_at (today)`           | Lead tasks due today                   |
| `myday.leads_converted_today`    | Converted today    | Your leads converted to a job today.                                                      | count | `leads.converted_at (today)`     | Became a job today                     |
| `myday.cases_open`               | Open cases         | Warranty and service cases you own that aren't resolved.                                  | count | `—`                              | Yours, not resolved                    |
| `myday.cases_overdue`            | Past SLA           | Your open cases past their SLA.                                                           | count | `—`                              | Yours, past SLA                        |
| `myday.unread_email`             | Unread email       | Customer conversations you can see whose last message is an unread email.                 | count | `—`                              | Conversations, email                   |
| `myday.unread_sms`               | Unread texts       | Customer conversations you can see whose last message is an unread text.                  | count | `—`                              | Conversations, text                    |
| `myday.mentions_unread`          | Mentions           | Unread @mentions of you.                                                                  | count | `—`                              | Unread @mentions                       |
| `myday.notifications_unread`     | Notifications      | Your unread notifications.                                                                | count | `—`                              | Unread                                 |
| `myday.attention_open`           | Needs my attention | Open Attention items you own.                                                             | count | `—`                              | Yours, open                            |
| `myday.approvals_pending`        | Approvals          | Requests waiting for a decision: all of them if you approve, otherwise your own requests. | count | `—`                              | Waiting for a decision                 |
| `myday.estimates_awaiting_reply` | Awaiting reply     | Your estimates sent and not answered yet.                                                 | count | `—`                              | Your estimates waiting on the customer |

#### Daily Brief

| Id                             | Metric               | What it counts                                              | Unit  | Date field                       | Caption             |
| ------------------------------ | -------------------- | ----------------------------------------------------------- | ----- | -------------------------------- | ------------------- |
| `brief.leads_created`          | New leads            | Leads that came in that day.                                | count | `leads.created_at`               | Created that day    |
| `brief.walkthroughs_completed` | Walkthroughs done    | Walkthroughs completed that day.                            | count | `appointments.completed_at`      | Completed that day  |
| `brief.estimates_sent`         | Estimates sent       | Estimate versions sent that day.                            | count | `estimate_versions.sent_at`      | Sent that day       |
| `brief.estimates_accepted`     | Estimates accepted   | Estimates accepted that day.                                | count | `estimates.accepted_at`          | Accepted that day   |
| `brief.accepted_value`         | Accepted value       | Total of the estimates accepted that day.                   | money | `estimates.accepted_at`          | Accepted that day   |
| `brief.jobs_started`           | Jobs started         | Jobs whose actual start was that day.                       | count | `jobs.actual_start_date`         | Started that day    |
| `brief.jobs_completed`         | Jobs completed       | Jobs that reached Completed that day.                       | count | `jobs.completed_at`              | Completed that day  |
| `brief.daily_logs`             | Daily logs           | Daily logs for that day.                                    | count | `daily_logs.log_date`            | Logged for that day |
| `brief.invoices_sent`          | Invoices sent        | Invoices sent that day.                                     | count | `invoices.sent_at`               | Sent that day       |
| `brief.collected`              | Collected            | Payments received that day and applied to invoices.         | money | `payments.received_on`           | Received that day   |
| `brief.reviews_left`           | Reviews left         | Reviews customers left that day.                            | count | `review_requests.review_left_at` | Left that day       |
| `brief.attention_now`          | Needs attention now  | Critical and high Attention items still pending, right now. | count | `—`                              | Right now           |
| `brief.overdue_invoices`       | Overdue invoices     | Sent invoices past due with money owed, right now.          | count | `—`                              | Right now           |
| `brief.approvals_pending`      | Approvals waiting    | Requests waiting for an owner, right now.                   | count | `—`                              | Right now           |
| `brief.unread_conversations`   | Unread conversations | Customer conversations with an unread message, right now.   | count | `—`                              | Right now           |
| `brief.ready_to_schedule`      | Ready to schedule    | Jobs waiting for dates, right now.                          | count | `—`                              | Right now           |

## Minimum set (SPEC §12.1)

All of these are `kpi.*` entries since Phase 9 (table above).

Leads created · leads by source · speed to lead (median, p90) · contact rate · walkthrough set rate · walkthrough show rate · estimates sent · 24h SLA % · close rate (count and $) · avg job value · sales velocity · pipeline value · backlog crew-days · projected revenue · revenue sold/completed/collected · gross margin % · labor hours estimated vs actual · daily-update compliance % · on-time start % · rain-delay days · punch items per job · days completed → paid · A/R aging · collection % · review rate · referral conversions · revenue by city/source/estimator · cost per lead & CAC.
