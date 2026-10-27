-- Phase 9: Analytics & home — every SPEC §12.1 KPI against a deterministic
-- fixture (March 2026, Pacific) with known expected values, the monthly and
-- season series, My Numbers, My Day, the Daily Brief, the report views and
-- templates, and row security on the new tables (marketing spend, revenue
-- goals, export log, reports, schedules, dashboards, favorites) for every role
-- that matters, plus cross-company isolation.
--
-- The expected analytics_stats() values between the @fixture markers are the
-- same numbers lib/metrics/fixtures/analytics.ts holds; a unit test reads this
-- block and compares, so the SQL aggregate and the registry's compute agree.
begin;

insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));
select app.seed_analytics_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner', null, 'Olive Owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager', null, 'Oscar Office')),
  ('books', tests.make_user('books@test.bb', 'bookkeeper', null, 'Bea Books')),
  ('ro', tests.make_user('ro@test.bb', 'read_only', null, 'Rae Readonly')),
  ('est_a', tests.make_user('esta@test.bb', 'estimator', null, 'Avery Estimator')),
  ('est_b', tests.make_user('estb@test.bb', 'estimator', null, 'Blake Estimator')),
  ('painter', tests.make_user('painter@test.bb', 'painter', null, 'Pat Painter')),
  ('other_owner', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co'), 'Other Owner'));
grant select on u to authenticated, service_role;
create temp table r (k text primary key, id uuid) on commit drop;
grant select, insert on r to authenticated, service_role;
create temp table st (k text primary key, v jsonb) on commit drop;
grant select, insert on st to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Fixture: March 2026 (Pacific). Times are Pacific wall-clock.
-- -----------------------------------------------------------------------------
insert into public.profile_compensation (profile_id, org_id, hourly_cost_cents)
select id, tests.org_id(), 3000 from u where k = 'painter';

with a as (insert into public.accounts (org_id, display_name) values (tests.org_id(), 'Fixture Residence') returning id)
insert into r select 'acct', id from a;
insert into public.contacts (org_id, account_id, first_name) values (tests.org_id(), (select id from r where k = 'acct'), 'Nobody');

-- Leads (ZIPs pick the territory: 98004 Bellevue, 98033 Kirkland, 98052 Redmond).
insert into public.leads (org_id, first_name, last_name, email, zip, services, status, lead_source, owner_id,
                          first_contacted_at, speed_to_lead_seconds, walkthrough_at, created_at)
values
  (tests.org_id(), 'Lena', 'One', 'l1@x.test', '98004', '{exterior}', 'contacted', 'website', (select id from u where k = 'est_a'),
   timestamptz '2026-03-02 10:05 America/Los_Angeles', 300, timestamptz '2026-03-05 10:00 America/Los_Angeles', timestamptz '2026-03-02 10:00 America/Los_Angeles'),
  (tests.org_id(), 'Liam', 'Two', 'l2@x.test', '98033', '{interior}', 'contacted', 'website', (select id from u where k = 'est_a'),
   timestamptz '2026-03-03 10:10 America/Los_Angeles', 600, null, timestamptz '2026-03-03 10:00 America/Los_Angeles'),
  (tests.org_id(), 'Lola', 'Three', 'l3@x.test', '98004', '{interior}', 'walkthrough_scheduled', 'google_ads', (select id from u where k = 'est_b'),
   timestamptz '2026-03-04 10:15 America/Los_Angeles', 900, timestamptz '2026-03-07 09:00 America/Los_Angeles', timestamptz '2026-03-04 10:00 America/Los_Angeles'),
  (tests.org_id(), 'Leo', 'Four', 'l4@x.test', '98052', '{cabinets}', 'new', 'google_ads', (select id from u where k = 'est_b'),
   null, null, null, timestamptz '2026-03-06 10:00 America/Los_Angeles'),
  (tests.org_id(), 'Luz', 'Five', 'l5@x.test', null, '{exterior}', 'new', 'nextdoor', null,
   null, null, null, timestamptz '2026-03-08 10:00 America/Los_Angeles'),
  -- February: outside the period.
  (tests.org_id(), 'Lars', 'Six', 'l6@x.test', '98004', '{interior}', 'new', 'website', (select id from u where k = 'est_a'),
   null, null, null, timestamptz '2026-02-10 10:00 America/Los_Angeles');
insert into r select 'l' || substr(email, 2, 1), id from public.leads where email like 'l_@x.test';

-- Jobs. The stage flag lets the fixture place jobs in any stage directly.
select set_config('app.stage_change', 'on', true);
insert into public.jobs (org_id, name, account_id, work_types, stage, owner_id, point_of_contact_id, lead_source, territory_id,
                         lead_id, lead_created_at, walkthrough_completed_at, estimate_sent_at, estimate_accepted_at,
                         guarantee_start_date, actual_start_date, completed_at, final_invoiced_at, paid_in_full_at,
                         target_season, estimated_duration_days, created_at)
values
  (tests.org_id(), 'J1', (select id from r where k = 'acct'), '{exterior}', 'completed',
   (select id from u where k = 'est_a'), (select id from u where k = 'est_a'), 'website', (select id from public.territories where org_id = tests.org_id() and name = 'Bellevue'),
   (select id from r where k = 'l1'), timestamptz '2026-03-02 10:00 America/Los_Angeles', timestamptz '2026-03-05 12:00 America/Los_Angeles',
   timestamptz '2026-03-06 09:00 America/Los_Angeles', timestamptz '2026-03-12 10:00 America/Los_Angeles',
   date '2026-03-16', date '2026-03-16', timestamptz '2026-03-25 15:00 America/Los_Angeles', timestamptz '2026-03-26 09:00 America/Los_Angeles', null,
   null, null, timestamptz '2026-03-02 11:00 America/Los_Angeles'),
  (tests.org_id(), 'J2', (select id from r where k = 'acct'), '{interior}', 'scheduled',
   (select id from u where k = 'est_b'), (select id from u where k = 'est_b'), 'google_ads', (select id from public.territories where org_id = tests.org_id() and name = 'Kirkland'),
   null, timestamptz '2026-03-01 10:00 America/Los_Angeles', timestamptz '2026-03-08 12:00 America/Los_Angeles',
   timestamptz '2026-03-10 12:00 America/Los_Angeles', timestamptz '2026-03-20 10:00 America/Los_Angeles',
   date '2026-03-16', date '2026-03-18', null, null, null, null, null, timestamptz '2026-03-01 11:00 America/Los_Angeles'),
  (tests.org_id(), 'J3', (select id from r where k = 'acct'), '{cabinets}', 'estimate_sent',
   (select id from u where k = 'est_a'), null, 'website', (select id from public.territories where org_id = tests.org_id() and name = 'Redmond'),
   null, null, null, timestamptz '2026-03-15 10:00 America/Los_Angeles', null, null, null, null, null, null, null, null,
   timestamptz '2026-03-14 10:00 America/Los_Angeles'),
  (tests.org_id(), 'J4', (select id from r where k = 'acct'), '{exterior}', 'estimate_sent',
   (select id from u where k = 'est_b'), null, 'nextdoor', (select id from public.territories where org_id = tests.org_id() and name = 'Bellevue'),
   null, null, null, timestamptz '2026-02-20 10:00 America/Los_Angeles', null, null, null, null, null, null, null, null,
   timestamptz '2026-02-18 10:00 America/Los_Angeles'),
  (tests.org_id(), 'J5', (select id from r where k = 'acct'), '{interior}', 'paid_in_full',
   (select id from u where k = 'est_a'), null, 'website', (select id from public.territories where org_id = tests.org_id() and name = 'Bellevue'),
   null, null, null, null, timestamptz '2026-02-01 10:00 America/Los_Angeles', null, null,
   timestamptz '2026-02-20 10:00 America/Los_Angeles', null, timestamptz '2026-03-03 10:00 America/Los_Angeles', null, null,
   timestamptz '2026-01-20 10:00 America/Los_Angeles'),
  (tests.org_id(), 'J6', (select id from r where k = 'acct'), '{interior}', 'ready_to_schedule',
   (select id from u where k = 'est_a'), null, 'website', (select id from public.territories where org_id = tests.org_id() and name = 'Bellevue'),
   null, null, null, null, timestamptz '2026-02-15 10:00 America/Los_Angeles', null, null, null, null, null, null, null,
   timestamptz '2026-02-01 10:00 America/Los_Angeles'),
  (tests.org_id(), 'J7', (select id from r where k = 'acct'), '{exterior}', 'scheduled',
   null, null, null, (select id from public.territories where org_id = tests.org_id() and name = 'Sammamish'),
   null, null, null, null, null, null, null, null, null, null, 2027, null, timestamptz '2026-01-05 10:00 America/Los_Angeles'),
  (tests.org_id(), 'J8', (select id from r where k = 'acct'), '{deck_fence}', 'sold',
   null, null, null, null, null, null, null, null, null, null, null, null, null, null, 2027, 7,
   timestamptz '2026-01-06 10:00 America/Los_Angeles');
update public.jobs set stage = 'closed_lost', lost_reason = 'price', lost_at = timestamptz '2026-02-25 10:00 America/Los_Angeles'
where org_id = tests.org_id() and name = 'J4';
select set_config('app.stage_change', 'off', true);
insert into r select lower(name), id from public.jobs where org_id = tests.org_id() and name in ('J1','J2','J3','J4','J5','J6','J7','J8');
update public.leads set status = 'converted', converted_job_id = (select id from r where k = 'j1'),
  converted_at = timestamptz '2026-03-05 12:00 America/Los_Angeles' where id = (select id from r where k = 'l1');

insert into public.job_financials (job_id, org_id, contract_baseline_cents) values
  ((select id from r where k = 'j1'), tests.org_id(), 1000000),
  ((select id from r where k = 'j2'), tests.org_id(), 500000),
  ((select id from r where k = 'j5'), tests.org_id(), 300000),
  ((select id from r where k = 'j6'), tests.org_id(), 300000);

-- Estimates: E1 (J1, A, SLA met, accepted), E2 (J2, B, SLA missed, accepted),
-- E3 (J3, A, open, expiring), E4 (J4, B, sent in February, declined).
insert into public.estimates (org_id, job_id, title, status, owner_id, total_cents, sent_at, accepted_at, expires_at, declined_at)
values
  (tests.org_id(), (select id from r where k = 'j1'), 'EST-T-1', 'accepted', (select id from u where k = 'est_a'), 1000000,
   timestamptz '2026-03-06 09:00 America/Los_Angeles', timestamptz '2026-03-12 10:00 America/Los_Angeles', null, null),
  (tests.org_id(), (select id from r where k = 'j2'), 'EST-T-2', 'accepted', (select id from u where k = 'est_b'), 500000,
   timestamptz '2026-03-10 12:00 America/Los_Angeles', timestamptz '2026-03-20 10:00 America/Los_Angeles', null, null),
  (tests.org_id(), (select id from r where k = 'j3'), 'EST-T-3', 'sent', (select id from u where k = 'est_a'), 200000,
   timestamptz '2026-03-15 10:00 America/Los_Angeles', null, now() + interval '2 days', null),
  (tests.org_id(), (select id from r where k = 'j4'), 'EST-T-4', 'declined', (select id from u where k = 'est_b'), 400000,
   timestamptz '2026-02-20 10:00 America/Los_Angeles', null, null, timestamptz '2026-02-25 10:00 America/Los_Angeles');
insert into r select lower(replace(title, 'EST-T-', 'e')), id from public.estimates where title like 'EST-T-%';
insert into public.estimate_versions (org_id, estimate_id, version_no, status, sent_at, proposal)
select tests.org_id(), e.id, 1, 'sent', e.sent_at, '{}'::jsonb from public.estimates e where e.title like 'EST-T-%';

-- Walkthroughs: completed (L1), no-show (L3), still scheduled (L2: not due; booking it stamps the lead's walkthrough).
insert into public.appointments (org_id, lead_id, type, starts_at, ends_at, assigned_user_ids, status, result, completed_at, created_by, created_at)
values
  (tests.org_id(), (select id from r where k = 'l1'), 'walkthrough', timestamptz '2026-03-05 10:00 America/Los_Angeles',
   timestamptz '2026-03-05 11:00 America/Los_Angeles', array[(select id from u where k = 'est_a')], 'completed', 'measured',
   timestamptz '2026-03-05 11:00 America/Los_Angeles', (select id from u where k = 'est_a'), timestamptz '2026-03-02 10:30 America/Los_Angeles'),
  (tests.org_id(), (select id from r where k = 'l3'), 'walkthrough', timestamptz '2026-03-07 09:00 America/Los_Angeles',
   timestamptz '2026-03-07 10:00 America/Los_Angeles', array[(select id from u where k = 'est_b')], 'no_show', null, null,
   (select id from u where k = 'est_b'), timestamptz '2026-03-04 10:30 America/Los_Angeles'),
  (tests.org_id(), (select id from r where k = 'l2'), 'walkthrough', timestamptz '2026-03-09 09:00 America/Los_Angeles',
   timestamptz '2026-03-09 10:00 America/Los_Angeles', array[(select id from u where k = 'est_a')], 'scheduled', null, null,
   (select id from u where k = 'est_a'), timestamptz '2026-03-03 10:30 America/Los_Angeles');

-- Production: J2 published Mon Mar 16 – Fri Mar 20, rain on Wed the 18th, logs on the 16th, 17th and 19th.
insert into public.crews (org_id, name) values (tests.org_id(), 'Crew Fixture');
insert into r select 'crew', id from public.crews where org_id = tests.org_id() and name = 'Crew Fixture';
insert into public.schedule_entries (org_id, job_id, status, crew_id, starts_on, ends_on, published_at) values
  (tests.org_id(), (select id from r where k = 'j2'), 'published', (select id from r where k = 'crew'), date '2026-03-16', date '2026-03-20', now()),
  (tests.org_id(), (select id from r where k = 'j7'), 'published', (select id from r where k = 'crew'), date '2027-07-05', date '2027-07-09', now());
insert into public.rain_delays (org_id, job_id, delay_date) values (tests.org_id(), (select id from r where k = 'j2'), date '2026-03-18');
insert into public.job_photos (org_id, job_id, category, storage_path, thumb_path, mime_type, size_bytes)
values (tests.org_id(), (select id from r where k = 'j2'), 'cleanup',
        tests.org_id() || '/jobs/' || (select id from r where k = 'j2') || '/c.jpg',
        tests.org_id() || '/jobs/' || (select id from r where k = 'j2') || '/c-thumb.jpg', 'image/jpeg', 1000);
insert into public.daily_logs (org_id, job_id, log_date, finished_today, cleanup_done, cleanup_photo_id)
select tests.org_id(), (select id from r where k = 'j2'), d, 'Walls', true,
       (select id from public.job_photos where job_id = (select id from r where k = 'j2'))
from unnest(array[date '2026-03-16', date '2026-03-17', date '2026-03-19']) d;
insert into public.work_orders (org_id, job_id, work_order_number, phase, title, status, budgeted_hours) values
  (tests.org_id(), (select id from r where k = 'j1'), 'WO-T-1', 'paint', 'Paint siding', 'completed', 40),
  (tests.org_id(), (select id from r where k = 'j2'), 'WO-T-2', 'paint', 'Paint walls', 'scheduled', 32),
  (tests.org_id(), (select id from r where k = 'j6'), 'WO-T-3', 'paint', 'Paint trim', 'new', 16);
insert into public.time_entries (org_id, job_id, user_id, entry_date, hours)
select tests.org_id(), (select id from r where k = 'j1'), (select id from u where k = 'painter'), d, 10
from unnest(array[date '2026-03-16', date '2026-03-17', date '2026-03-18']) d;
insert into public.punch_items (org_id, job_id, area, description)
select tests.org_id(), (select id from r where k = 'j1'), 'Front', 'Touch-up ' || g from generate_series(1, 3) g;
insert into public.job_expenses (org_id, job_id, category, description, amount_cents, spent_on)
values (tests.org_id(), (select id from r where k = 'j1'), 'materials', 'Caulk and tape', 10000, date '2026-03-17');

-- Money: J1 deposit $4,000 issued and paid in March; progress $6,000 issued Mar 26, due Apr 10, unpaid.
select tests.login_service((select id from u where k = 'owner'));
insert into r select 'dep', public.create_invoice((select id from r where k = 'j1'), 'deposit',
  '[{"description": "Deposit", "unit_price_cents": 400000}]'::jsonb);
select public.mark_invoice_sent((select id from r where k = 'dep'), date '2026-03-03', date '2026-03-03');
select public.record_payment((select id from r where k = 'j1'), 'check', 400000, date '2026-03-04',
  jsonb_build_array(jsonb_build_object('invoice_id', (select id from r where k = 'dep'), 'amount_cents', 400000)));
insert into r select 'prog', public.create_invoice((select id from r where k = 'j1'), 'progress',
  '[{"description": "Progress", "unit_price_cents": 600000}]'::jsonb);
select public.mark_invoice_sent((select id from r where k = 'prog'), date '2026-03-26', date '2026-04-10');
select tests.logout();

-- Reviews (J1 left, J5 not), referrals (one sold via J2, one not), spend, a goal, alerts.
insert into public.review_requests (org_id, job_id, status, sent_at, review_left, review_left_at) values
  (tests.org_id(), (select id from r where k = 'j1'), 'reviewed', timestamptz '2026-03-27 10:00 America/Los_Angeles', true, timestamptz '2026-03-28 10:00 America/Los_Angeles'),
  (tests.org_id(), (select id from r where k = 'j5'), 'sent', timestamptz '2026-03-05 10:00 America/Los_Angeles', false, null);
insert into public.referral_champions (org_id, contact_id)
select tests.org_id(), id from public.contacts where account_id = (select id from r where k = 'acct') limit 1;
insert into public.referrals (org_id, champion_id, lead_id, job_id, created_at)
select tests.org_id(), c.id, x.lead_id, x.job_id, x.at
from public.referral_champions c,
     (values ((select id from r where k = 'l3'), (select id from r where k = 'j2'), timestamptz '2026-03-04 10:00 America/Los_Angeles'),
             ((select id from r where k = 'l4'), null::uuid, timestamptz '2026-03-06 10:00 America/Los_Angeles')) x(lead_id, job_id, at)
where c.org_id = tests.org_id();
insert into public.marketing_spend (org_id, month, lead_source, amount_cents) values
  (tests.org_id(), date '2026-03-01', 'website', 31000),
  (tests.org_id(), date '2026-03-01', 'google_ads', 62000),
  (tests.org_id(), date '2026-02-01', 'website', 10000);
insert into public.revenue_goals (org_id, month, goal_cents) values (tests.org_id(), date '2026-03-01', 2000000);
insert into public.attention_items (org_id, rule_key, category, priority, title, subject_type, subject_id, status, dedupe_key, resolution, resolved_at) values
  (tests.org_id(), 'untouched_lead', 'communication', 'high', 'Untouched', 'lead', (select id from r where k = 'l4'), 'pending', 'fx:1', null, null),
  (tests.org_id(), 'untouched_lead', 'communication', 'high', 'Untouched', 'lead', (select id from r where k = 'l5'), 'pending', 'fx:2', null, null),
  (tests.org_id(), 'overdue_invoice', 'financial', 'medium', 'Overdue', 'job', (select id from r where k = 'j1'), 'resolved', 'fx:3', 'manual', now());

-- -----------------------------------------------------------------------------
-- 1. analytics_stats() as an owner: every scalar KPI input
-- -----------------------------------------------------------------------------
select tests.login((select id from u where k = 'owner'));
insert into st values ('march', public.analytics_stats(timestamptz '2026-03-01 00:00 America/Los_Angeles',
                                                      timestamptz '2026-04-01 00:00 America/Los_Angeles', '{}'::jsonb));
select tests.logout();

create temp table expected (key text primary key, value text) on commit drop;
-- @fixture:analytics_stats:begin
insert into expected values
  ('accepted', '2'),
  ('accepted_value_cents', '1500000'),
  ('approvals_pending', '0'),
  ('ar_outstanding_cents', '600000'),
  ('backlog_hours', '48'),
  ('billed_cents', '1000000'),
  ('billed_collected_cents', '400000'),
  ('cac_jobs', '2'),
  ('can_see_costs', 'true'),
  ('can_see_money', 'true'),
  ('cohort_accepted', '2'),
  ('cohort_accepted_value_cents', '1500000'),
  ('collected_cents', '400000'),
  ('completed_cents', '1000000'),
  ('completed_jobs', '1'),
  ('crew_day_hours', '8'),
  ('daily_due', '4'),
  ('daily_logged', '3'),
  ('days_completed_to_paid_avg', '11'),
  ('dq_contacts_unreachable', '1'),
  ('dq_jobs_no_poc', '5'),
  ('dq_jobs_no_property', '7'),
  ('dq_leads_unassigned', '1'),
  ('elapsed_days', '31'),
  ('estimates_sent', '3'),
  ('estimates_sent_value_cents', '1700000'),
  ('expiring_estimates', '1'),
  ('filters_applied', 'false'),
  ('labor_actual_hours', '30'),
  ('labor_budgeted_hours', '40'),
  ('leads_contacted', '3'),
  ('leads_converted', '1'),
  ('leads_created', '5'),
  ('leads_walkthrough', '3'),
  ('margin_cost_cents', '100000'),
  ('margin_jobs', '1'),
  ('margin_revenue_cents', '1000000'),
  ('on_time_met', '1'),
  ('on_time_missed', '1'),
  ('open_estimates', '1'),
  ('open_estimates_value_cents', '200000'),
  ('overdue_cents', '600000'),
  ('paid_jobs', '1'),
  ('period_days', '31'),
  ('punch_items', '3'),
  ('rain_delay_days', '1'),
  ('referrals', '2'),
  ('referrals_sold', '1'),
  ('reviews_left', '1'),
  ('reviews_requested', '2'),
  ('sla_hours', '24'),
  ('sla_measured', '2'),
  ('sla_met', '1'),
  ('sold_cents', '1500000'),
  ('sold_jobs', '2'),
  ('sold_not_started_cents', '800000'),
  ('sold_not_started_jobs', '4'),
  ('speed_measured', '3'),
  ('speed_median_seconds', '600'),
  ('speed_p90_seconds', '840'),
  ('spend_applies', 'true'),
  ('spend_cents', '93000'),
  ('velocity_days_avg', '14.5'),
  ('walkthroughs_completed', '1'),
  ('walkthroughs_due', '2');
-- @fixture:analytics_stats:end

-- Numbers compare as numbers (jsonb keeps the column's scale: 48.00), everything else as text.
select tests.assert(
  case when e.value ~ '^-?[0-9]+(\.[0-9]+)?$' then (s.v ->> e.key)::numeric = e.value::numeric
       else (s.v ->> e.key) is not distinct from e.value end,
  'analytics_stats.' || e.key || ' = ' || e.value || ' (got ' || coalesce(s.v ->> e.key, 'null') || ')')
from expected e cross join (select v from st where k = 'march') s order by e.key;

-- Breakdowns
select tests.assert_eq((select v -> 'funnel' from st where k = 'march'),
  '{"leads": 5, "contacted": 3, "walkthrough": 3, "estimate": 1, "sold": 1}'::jsonb, 'lead funnel: leads → contacted → walkthrough → estimate → sold');
select tests.assert_eq((select string_agg(x ->> 'city' || ':' || (x ->> 'leads') || '/' || (x ->> 'sold_jobs') || '/' || (x ->> 'sold_cents'), ', ')
                        from st, jsonb_array_elements(v -> 'by_city') x where k = 'march'),
  'Bellevue:2/1/1000000, Kirkland:1/1/500000, Redmond:1/0/0, Sammamish:0/0/0, Issaquah:0/0/0, Outside service area:0/0/0, Unknown:1/0/0',
  'city performance lists every territory (zeros included) and Unknown');
select tests.assert_eq((select string_agg(x ->> 'name' || ':' || (x ->> 'sent') || '/' || (x ->> 'cohort_accepted') || '/' || (x ->> 'accepted') || '/' || (x ->> 'accepted_value_cents'), ', ')
                        from st, jsonb_array_elements(v -> 'by_estimator') x where k = 'march'),
  'Avery Estimator:2/1/1/1000000, Blake Estimator:1/1/1/500000', 'estimator leaderboard: sent, accepted of the cohort, accepted, sold $');
select tests.assert_eq((select string_agg(x ->> 'source' || ':' || (x ->> 'leads') || '/' || (x ->> 'converted') || '/' || (x ->> 'sold_jobs') || '/' || (x ->> 'sold_cents') || '/' || (x ->> 'spend_cents'), ', ')
                        from st, jsonb_array_elements(v -> 'by_source') x where k = 'march'),
  'google_ads:2/0/1/500000/62000, website:2/1/1/1000000/31000, nextdoor:1/0/0/0/0', 'lead source performance with prorated spend');
select tests.assert_eq((select string_agg(x ->> 'stage' || ':' || (x ->> 'jobs') || '/' || (x ->> 'value_cents'), ', ')
                        from st, jsonb_array_elements(v -> 'by_stage') x where k = 'march'),
  'estimate_sent:1/0, sold:1/0, ready_to_schedule:1/300000, scheduled:2/500000, completed:1/1000000, paid_in_full:1/300000',
  'pipeline by stage: open jobs only, in stage order');
select tests.assert_eq((select v -> 'aging' from st where k = 'march'),
  '{"current": 0, "d1_30": 0, "d31_60": 0, "d61_90": 0, "d90_plus": 600000}'::jsonb, 'A/R aging buckets');
select tests.assert_eq((select v -> 'backlog_by_work_type' from st where k = 'march'),
  '[{"work_type": "interior", "hours": 48}]'::jsonb, 'backlog by work type (open work orders on ready / scheduled / in progress jobs)');
select tests.assert_eq((select v -> 'alerts' from st where k = 'march'), '{"untouched_lead": 2}'::jsonb,
  'executive alerts count open attention items by rule (resolved ones drop out)');

-- Filters
select tests.login((select id from u where k = 'owner'));
insert into st values
  ('exterior', public.analytics_stats(timestamptz '2026-03-01 00:00 America/Los_Angeles', timestamptz '2026-04-01 00:00 America/Los_Angeles', '{"work_type": "exterior"}')),
  ('kirkland', public.analytics_stats(timestamptz '2026-03-01 00:00 America/Los_Angeles', timestamptz '2026-04-01 00:00 America/Los_Angeles',
     jsonb_build_object('territory_id', (select id from public.territories where org_id = tests.org_id() and name = 'Kirkland')))),
  ('google', public.analytics_stats(timestamptz '2026-03-01 00:00 America/Los_Angeles', timestamptz '2026-04-01 00:00 America/Los_Angeles', '{"source": "google_ads"}')),
  ('est_b', public.analytics_stats(timestamptz '2026-03-01 00:00 America/Los_Angeles', timestamptz '2026-04-01 00:00 America/Los_Angeles',
     jsonb_build_object('owner_id', (select id from u where k = 'est_b')))),
  ('junk', public.analytics_stats(timestamptz '2026-03-01 00:00 America/Los_Angeles', timestamptz '2026-04-01 00:00 America/Los_Angeles',
     '{"territory_id": "not-a-uuid", "owner_id": "nope"}'));
select tests.logout();
select tests.assert_eq((select (v ->> 'leads_created') || '/' || (v ->> 'sold_jobs') || '/' || (v ->> 'sold_cents') from st where k = 'exterior'),
  '2/1/1000000', 'work type filter: exterior leads (by service) and exterior jobs sold');
select tests.assert_eq((select (v ->> 'leads_created') || '/' || (v ->> 'sold_jobs') || '/' || (v ->> 'spend_applies') from st where k = 'kirkland'),
  '1/1/false', 'city filter: Kirkland only; spend is not split by city');
select tests.assert_eq((select (v ->> 'leads_created') || '/' || (v ->> 'sold_jobs') || '/' || (v ->> 'spend_cents') || '/' || (v ->> 'cac_jobs') from st where k = 'google'),
  '2/1/62000/1', 'source filter: Google Ads leads, sold jobs, spend and CAC jobs');
select tests.assert_eq((select (v ->> 'leads_created') || '/' || (v ->> 'estimates_sent') || '/' || (v ->> 'sold_jobs') from st where k = 'est_b'),
  '2/1/1', 'owner filter: Blake''s leads, estimates and jobs');
select tests.assert_eq((select (v ->> 'leads_created') || '/' || (v ->> 'filters_applied') from st where k = 'junk'),
  '5/false', 'malformed filter ids are ignored, never an error');

-- Roles: an office manager sees money but not costs; an estimator sees only their own records and no money.
select tests.login((select id from u where k = 'office'));
insert into st values ('office', public.analytics_stats(timestamptz '2026-03-01 00:00 America/Los_Angeles', timestamptz '2026-04-01 00:00 America/Los_Angeles', '{}'));
select tests.logout();
select tests.assert_eq((select (v ->> 'sold_cents') || '/' || coalesce(v ->> 'margin_revenue_cents', 'null') || '/' || (v ->> 'can_see_costs') from st where k = 'office'),
  '1500000/null/false', 'office manager: money yes, gross margin no');
select tests.login((select id from u where k = 'est_a'));
insert into st values ('est_a', public.analytics_stats(timestamptz '2026-03-01 00:00 America/Los_Angeles', timestamptz '2026-04-01 00:00 America/Los_Angeles', '{}'));
select tests.logout();
select tests.assert_eq((select (v ->> 'leads_created') || '/' || coalesce(v ->> 'sold_cents', 'null') || '/' || coalesce(v ->> 'ar_outstanding_cents', 'null') || '/' || (v ->> 'estimates_sent') from st where k = 'est_a'),
  '2/null/null/2', 'estimator: own leads and estimates only, no money');
select tests.login((select id from u where k = 'other_owner'));
insert into st values ('other', public.analytics_stats(timestamptz '2026-03-01 00:00 America/Los_Angeles', timestamptz '2026-04-01 00:00 America/Los_Angeles', '{}'));
select tests.logout();
select tests.assert_eq((select (v ->> 'leads_created') || '/' || (v ->> 'sold_jobs') || '/' || (v ->> 'spend_cents') || '/' || jsonb_array_length(v -> 'by_estimator') from st where k = 'other'),
  '0/0/0/0', 'another company sees none of it');

-- -----------------------------------------------------------------------------
-- 2. Monthly series, season backlog, My Numbers, My Day, Daily Brief
-- -----------------------------------------------------------------------------
select tests.login((select id from u where k = 'owner'));
insert into st values ('monthly', public.analytics_monthly(date '2026-02-01', 2, '{}')),
                      ('season', public.season_backlog(2027)),
                      ('mine_a', public.my_numbers((select id from u where k = 'est_a'),
                          timestamptz '2026-03-01 00:00 America/Los_Angeles', timestamptz '2026-04-01 00:00 America/Los_Angeles')),
                      ('brief', public.daily_brief(date '2026-03-16'));
select tests.logout();
select tests.assert_eq((select v -> 'months' from st where k = 'monthly'),
  '[{"month": "2026-02-01", "sold_jobs": 2, "sold_cents": 600000, "completed_jobs": 1, "completed_cents": 300000, "collected_cents": 0, "goal_cents": null},
    {"month": "2026-03-01", "sold_jobs": 2, "sold_cents": 1500000, "completed_jobs": 1, "completed_cents": 1000000, "collected_cents": 400000, "goal_cents": 2000000}]'::jsonb,
  'monthly sold / completed / collected and the revenue goal');
select tests.assert_eq((select v - 'months' from st where k = 'season'),
  '{"season_start": "2027-06-01", "season_end": "2027-09-30", "crews": 1, "unscheduled_jobs": 1, "unscheduled_crew_days": 7}'::jsonb,
  'season backlog: crews and sold exterior/deck work not on the schedule');
select tests.assert_eq((select v -> 'months' from st where k = 'season'),
  '[{"month": "2027-06-01", "capacity_crew_days": 22, "booked_crew_days": 0}, {"month": "2027-07-01", "capacity_crew_days": 22, "booked_crew_days": 5},
    {"month": "2027-08-01", "capacity_crew_days": 22, "booked_crew_days": 0}, {"month": "2027-09-01", "capacity_crew_days": 22, "booked_crew_days": 0}]'::jsonb,
  'season backlog: booked crew-days vs capacity by month (production days × active crews)');
select tests.assert_eq((select v from st where k = 'mine_a'),
  '{"leads_issued": 2, "walkthroughs_set": 2, "walkthroughs_ran": 1, "estimates_sent": 2, "sold_count": 1, "sold_cents": 1000000,
    "completed": 1, "invoiced": 1, "paid": 1}'::jsonb, 'My Numbers: each card on its own date field');
select tests.assert_eq((select (v ->> 'jobs_started') || '/' || (v ->> 'daily_logs') || '/' || (v ->> 'estimates_accepted') from st where k = 'brief'),
  '1/1/0', 'Daily Brief for Mar 16: one start, one daily log');

select tests.login((select id from u where k = 'est_a'));
select tests.assert_eq((public.my_numbers((select id from u where k = 'est_a'), timestamptz '2026-03-01 00:00 America/Los_Angeles',
                        timestamptz '2026-04-01 00:00 America/Los_Angeles') ->> 'sold_cents'), '1000000', 'a rep reads their own numbers');
select tests.assert_eq((public.my_numbers((select id from u where k = 'est_b'), timestamptz '2026-03-01 00:00 America/Los_Angeles',
                        timestamptz '2026-04-01 00:00 America/Los_Angeles') ->> 'leads_issued'), '0', 'another rep''s records stay hidden by row security');
select tests.logout();

insert into public.tasks (org_id, title, assignee_id, due_at, subject_type, subject_id) values
  (tests.org_id(), 'Today', (select id from u where k = 'est_a'), (app.production_today()::timestamp + interval '23 hours') at time zone 'America/Los_Angeles', 'lead', (select id from r where k = 'l2')),
  (tests.org_id(), 'Late', (select id from u where k = 'est_a'), now() - interval '3 days', null, null),
  (tests.org_id(), 'Later', (select id from u where k = 'est_a'), now() + interval '5 days', null, null),
  (tests.org_id(), 'Someday', (select id from u where k = 'est_a'), null, null, null);
select tests.login((select id from u where k = 'est_a'));
insert into st values ('myday', public.workspace_summary());
select tests.logout();
select tests.assert_eq((select ((v ->> 'tasks_due_today')::int + (v ->> 'tasks_overdue')::int) || '/' || (v ->> 'tasks_upcoming')
                               || '/' || (v ->> 'tasks_no_due') || '/' || (v ->> 'leads_follow_ups_today') || '/' || (v ->> 'jobs_active')
                               || '/' || (v ->> 'estimates_awaiting_reply') from st where k = 'myday'),
  '2/1/1/1/4/1', 'My Day: tasks due later today or overdue, upcoming, no date; lead follow-ups today; my open jobs; estimates awaiting reply');
select tests.assert((select (v ->> 'tasks_overdue')::int >= 1 from st where k = 'myday'), 'a task due three days ago is overdue');
select tests.login((select id from u where k = 'est_b'));
select tests.assert_eq((public.workspace_summary() ->> 'leads_awaiting_contact'), '1', 'My Day: new leads nobody has reached');
select tests.logout();

-- -----------------------------------------------------------------------------
-- 3. Report views and templates
-- -----------------------------------------------------------------------------
select tests.assert_eq((select count(*) from public.reports where org_id = tests.org_id() and is_template), 10::bigint,
  'the 10 report templates are seeded');
select app.seed_analytics_defaults(tests.org_id());
select tests.assert_eq((select count(*) from public.reports where org_id = tests.org_id() and is_template), 10::bigint,
  'seeding again adds nothing');
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq((select missed_daily_logs from public.report_jobs where name = 'J2'), 0, 'report_jobs: missed daily logs look at the last 30 days only');
select tests.logout();
insert into public.schedule_entries (org_id, job_id, status, crew_id, starts_on, ends_on, published_at)
values (tests.org_id(), (select id from r where k = 'j6'), 'published', (select id from r where k = 'crew'),
        app.production_today() - 9, app.production_today() - 3, now());
insert into public.rain_delays (org_id, job_id, delay_date)
select tests.org_id(), (select id from r where k = 'j6'), d
from generate_series(app.production_today() - 9, app.production_today() - 3, interval '1 day') g(d)
where extract(isodow from d) between 1 and 5 limit 1;
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq((select missed_daily_logs from public.report_jobs where name = 'J6'),
  app.production_days_between(app.production_today() - 9, app.production_today() - 3, '{1,2,3,4,5}') - 1,
  'report_jobs: production days in the last 30 with no daily log (the rain day is excluded)');
select tests.assert_eq((select started_late from public.report_jobs where name = 'J2'), true, 'report_jobs: started after the guarantee date');
select tests.assert_eq((select margin_percent from public.report_jobs where name = 'J1'), 90.0, 'report_jobs: gross margin on a completed job');
select tests.assert_eq((select sales_velocity_days from public.report_jobs where name = 'J1'), 10.0, 'report_jobs: days lead → sold');
select tests.assert_eq((select string_agg(title || ':' || coalesce(sla_met::text, 'n/a'), ', ' order by title) from public.report_estimates
                        where title like 'EST-T-%'), 'EST-T-1:true, EST-T-2:false, EST-T-3:n/a, EST-T-4:n/a', 'report_estimates: SLA met / missed / not measured');
select tests.assert_eq((select aging_bucket from public.report_invoices where id = (select id from r where k = 'prog')), '90+ days', 'report_invoices: aging bucket');
select tests.assert_eq((select speed_to_lead_minutes from public.report_leads where id = (select id from r where k = 'l2')), 10.0, 'report_leads: minutes to first contact');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert((select bool_and(cost_cents is null and margin_cents is null) and bool_or(contract_cents is not null) from public.report_jobs),
  'report_jobs: office manager sees contract amounts but no costs');
select tests.logout();
select tests.login((select id from u where k = 'est_a'));
select tests.assert((select bool_and(contract_cents is null and cost_cents is null) and count(*) = 4 from public.report_jobs),
  'report_jobs: estimators see their own jobs and no money');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.report_invoices), 0::bigint, 'report_invoices: painters see no invoices');
select tests.logout();

-- -----------------------------------------------------------------------------
-- 4. Row security on the new tables
-- -----------------------------------------------------------------------------
-- Marketing spend: settings:manage writes; analytics readers read; estimators see nothing.
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.marketing_spend), 3::bigint, 'office manager (analytics) reads marketing spend');
select tests.assert_raises(format($q$insert into public.marketing_spend (org_id, month, lead_source, amount_cents) values (%L, '2026-04-01', 'website', 1)$q$, tests.org_id()),
  'office manager cannot enter spend (settings:manage)', '42501');
select tests.logout();
select tests.login((select id from u where k = 'est_a'));
select tests.assert_eq((select count(*) from public.marketing_spend), 0::bigint, 'estimators do not read marketing spend');
select tests.assert_eq((select count(*) from public.revenue_goals), 0::bigint, 'estimators do not read revenue goals');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
insert into public.marketing_spend (org_id, month, lead_source, amount_cents) values (tests.org_id(), '2026-04-01', 'yelp', 5000);
select tests.assert_raises(format($q$insert into public.marketing_spend (org_id, month, lead_source, amount_cents) values (%L, '2026-04-01', 'not_a_source', 1)$q$, tests.org_id()),
  'spend needs a lead source from the picklist', '23514');
select tests.assert_raises(format($q$insert into public.marketing_spend (org_id, month, lead_source, amount_cents) values (%L, '2026-04-15', 'website', 1)$q$, tests.org_id()),
  'spend is per month (first of the month)', '23514');
select tests.assert_raises(format($q$insert into public.marketing_spend (org_id, month, lead_source, amount_cents) values (%L, '2026-04-01', 'website', -1)$q$, tests.org_id()),
  'spend cannot be negative', '23514');
insert into public.revenue_goals (org_id, month, goal_cents) values (tests.org_id(), '2026-04-01', 2500000);
select tests.logout();
select tests.assert((select count(*) = 1 from public.audit_log where table_name = 'public.marketing_spend' and action = 'insert'
                     and record_id = (select id::text from public.marketing_spend where lead_source = 'yelp')),
  'marketing spend changes are audit-logged');
select tests.assert((select count(*) >= 1 from public.events where type = 'marketing_spend.created'), 'and emit a domain event');
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.revenue_goals), 2::bigint, 'office manager (financials) reads revenue goals');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.marketing_spend) + (select count(*) from public.revenue_goals), 0::bigint,
  'another company reads none of our spend or goals');
select tests.logout();

-- Export log: data:export only, through log_export(); you read your own.
select tests.login((select id from u where k = 'books'));
select tests.assert(public.log_export('chart', 'kpi.lead_funnel', 'Lead Funnel', 5, '{"period": "this_month"}') is not null,
  'the bookkeeper (data:export) can export and it is logged');
select tests.assert_raises($q$insert into public.export_log (org_id, kind, dataset, title) values (app.current_org_id(), 'chart', 'x', 'x')$q$,
  'nobody writes the export log directly', '42501');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert_raises($q$select public.log_export('chart', 'kpi.lead_funnel', 'Lead Funnel', 5)$q$,
  'an office manager without data:export cannot export', '42501');
select tests.assert_eq((select count(*) from public.export_log), 0::bigint, 'and cannot read someone else''s exports');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select public.log_export('report', 'report:sold_by_month', 'Sold by month', 2);
select tests.assert_eq((select count(*) from public.export_log), 2::bigint, 'owners (audit:read) read the whole export log');
select tests.logout();
select tests.assert((select count(*) = 2 from public.events where type = 'export.created'), 'every export emits export.created');

-- Reports: templates for report readers; your own private; shared for everyone; templates are fixed.
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.reports where is_template), 10::bigint, 'office manager sees the templates');
with x as (insert into public.reports (org_id, owner_id, name, module, config) values
  (tests.org_id(), (select id from u where k = 'office'), 'My leads', 'leads', '{"columns": ["name"]}') returning id)
insert into r select 'rep_private', id from x;
with x as (insert into public.reports (org_id, owner_id, name, module, config, shared) values
  (tests.org_id(), (select id from u where k = 'office'), 'Team leads', 'leads', '{"columns": ["name"]}', true) returning id)
insert into r select 'rep_shared', id from x;
select tests.assert_eq(tests.rows_affected(format($q$update public.reports set name = 'Mine now' where template_key = 'sold_by_month' and org_id = %L$q$, tests.org_id())),
  0::bigint, 'templates cannot be edited');
select tests.assert_raises(format($q$insert into public.reports (org_id, owner_id, name, module, is_template, template_key) values (%L, %L, 'T', 'leads', true, 'x')$q$,
  tests.org_id(), (select id from u where k = 'office')), 'people cannot add templates', '42501');
select tests.assert_raises(format($q$insert into public.reports (org_id, owner_id, name, module) values (%L, %L, 'Theirs', 'leads')$q$,
  tests.org_id(), (select id from u where k = 'owner')), 'reports are saved as your own', '42501');
select public.note_report_run((select id from r where k = 'rep_shared'));
select public.note_report_run((select id from r where k = 'rep_shared'));
select tests.assert_eq((select run_count from public.report_run_stats where report_id = (select id from r where k = 'rep_shared')), 2,
  'running a report records the last run');
with x as (insert into public.report_schedules (org_id, report_id, frequency, weekday, hour, recipient_ids, next_run_at)
  values (tests.org_id(), (select id from r where k = 'rep_shared'), 'weekly', 1, 7, array[(select id from u where k = 'office')], now()) returning id)
insert into r select 'sched', id from x;
select tests.assert_raises(format($q$insert into public.report_schedules (org_id, report_id, frequency, hour, recipient_ids, next_run_at) values (%L, %L, 'daily', 7, array[%L]::uuid[], now())$q$,
  tests.org_id(), (select id from r where k = 'rep_shared'), (select id from u where k = 'other_owner')),
  'schedule recipients must be people in your company', '23514');
select tests.assert_raises(format($q$insert into public.report_schedules (org_id, report_id, frequency, hour, recipient_ids, next_run_at) values (%L, %L, 'weekly', 7, array[%L]::uuid[], now())$q$,
  tests.org_id(), (select id from r where k = 'rep_shared'), (select id from u where k = 'office')),
  'a weekly schedule needs its weekday', '23514');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq((select count(*) from public.reports where not is_template), 1::bigint,
  'an owner sees the shared report, not someone''s private one');
select tests.assert_eq((select count(*) from public.report_schedules), 1::bigint, 'owners see every schedule');
select tests.logout();
select tests.login((select id from u where k = 'ro'));
select tests.assert_eq((select count(*) from public.reports where not is_template), 1::bigint, 'read-only role reads shared reports');
select tests.assert_raises(format($q$insert into public.reports (org_id, owner_id, name, module) values (%L, %L, 'Nope', 'leads')$q$,
  tests.org_id(), (select id from u where k = 'ro')), 'read-only role cannot build reports (reports:build)', '42501');
select tests.assert_eq((select count(*) from public.report_schedules), 0::bigint, 'and sees no schedules');
select tests.logout();
select tests.login((select id from u where k = 'est_a'));
select tests.assert_eq((select count(*) from public.reports), 0::bigint, 'estimators (no reports:read) see no reports');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.reports where org_id = tests.org_id()), 0::bigint, 'another company sees none of our reports');
select tests.assert_eq((select count(*) from public.reports where is_template), 10::bigint, 'they have their own templates');
select tests.logout();

-- Dashboards and favorites
select tests.login((select id from u where k = 'office'));
insert into public.dashboards (org_id, owner_id, name, widgets) values (tests.org_id(), (select id from u where k = 'office'), 'Mine', '{kpi.revenue_sold}');
insert into public.analytics_favorites (org_id, user_id, item_type, item_key) values (tests.org_id(), (select id from u where k = 'office'), 'dashboard', 'executive');
select tests.assert_raises(format($q$insert into public.analytics_favorites (org_id, user_id, item_type, item_key) values (%L, %L, 'dashboard', 'sales')$q$,
  tests.org_id(), (select id from u where k = 'owner')), 'favorites are your own', '42501');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq((select count(*) from public.dashboards), 0::bigint, 'private dashboards stay private');
select tests.assert_eq((select count(*) from public.analytics_favorites), 0::bigint, 'and so do favorites');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.dashboards) + (select count(*) from public.marketing_spend), 0::bigint,
  'painters see no analytics configuration');
select tests.logout();

-- Worker helper: only the service role reads someone's permission scopes.
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(format($q$select public.user_permission_scopes(%L, '{leads:read}')$q$, (select id from u where k = 'est_a')),
  'people cannot call user_permission_scopes', '42501');
select tests.logout();
select tests.login_service();
select tests.assert_eq(public.user_permission_scopes((select id from u where k = 'est_a'), '{leads:read,financials:read}'),
  '{"leads:read": "own", "financials:read": null}'::jsonb, 'the worker reads a schedule owner''s scopes');
select tests.logout();

-- Migration bookkeeping: applied, rolled back and re-applied in CI (see RUNBOOK); here the rollback file exists.
select tests.assert(to_regclass('public.export_log') is not null and to_regclass('public.report_jobs') is not null,
  'the analytics migration is applied');

rollback;
