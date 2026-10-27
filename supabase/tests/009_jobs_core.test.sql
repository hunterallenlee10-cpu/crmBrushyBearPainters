-- Phase 3: jobs, stage engine (gates, overrides, holds), conversion, approvals,
-- attention items, money visibility, per role and across organizations.
begin;

insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('est', tests.make_user('est@test.bb', 'estimator')),
  ('est2', tests.make_user('est2@test.bb', 'estimator')),
  ('pm', tests.make_user('pm@test.bb', 'project_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter')),
  ('other_owner', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co')));
grant select on u to authenticated, service_role;
create temp table o as select tests.org_id() as a;
grant select on o to authenticated, service_role;

-- Customers (as postgres).
create temp table r (k text primary key, id uuid) on commit drop;
grant select, insert on r to authenticated, service_role;
with a as (
  insert into public.accounts (org_id, display_name, owner_id) values (tests.org_id(), 'Smith Residence', (select id from u where k = 'est'))
  returning id
) insert into r select 'acct', id from a;
with c as (
  insert into public.contacts (org_id, account_id, first_name, last_name, mobile, email)
  values (tests.org_id(), (select id from r where k = 'acct'), 'Sam', 'Smith', '+14255550111', 'sam@example.com') returning id
) insert into r select 'contact', id from c;
with p as (
  insert into public.properties (org_id, account_id, is_primary, street, city, zip, year_built)
  values (tests.org_id(), (select id from r where k = 'acct'), true, '12 Lake St', 'Kirkland', '98033', 1965) returning id
) insert into r select 'prop', id from p;

-- Creating a job --------------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
with j as (
  insert into public.jobs (org_id, name, account_id, property_id, primary_contact_id, work_types, owner_id, stage)
  values ((select a from o), 'Smith – Kirkland – Exterior', (select id from r where k = 'acct'), (select id from r where k = 'prop'),
          (select id from r where k = 'contact'), '{exterior}', (select id from u where k = 'est'), 'sold')
  returning id
) insert into r select 'job', id from j;
select tests.assert_eq((select stage from public.jobs where id = (select id from r where k = 'job')), 'walkthrough_scheduled',
  'a new job always starts at Walkthrough Scheduled');
select tests.assert((select job_number ~ '^BB-[0-9]{4}-[0-9]{4,}$' from public.jobs where id = (select id from r where k = 'job')),
  'jobs get a BB-YYYY-NNNN number');
select tests.assert_eq((select count(*) from public.stage_history where job_id = (select id from r where k = 'job') and from_stage is null),
  1::bigint, 'creating a job writes its first stage history row');
select tests.assert_raises(
  format($q$insert into public.jobs (org_id, name, account_id, owner_id) values (%L, 'X', %L, %L)$q$,
         (select a from o), (select id from r where k = 'acct'), (select id from u where k = 'est2')),
  'estimators cannot create a job for someone else', '42501');
select tests.assert_raises(
  format($q$insert into public.jobs (org_id, name, account_id, work_types) values (%L, 'X', %L, '{spaceship}')$q$,
         (select a from o), (select id from r where k = 'acct')),
  'work types must be picklist values', '23514');

-- The stage only changes through Advance stage ----------------------------------------------
select tests.assert_raises(
  format($q$update public.jobs set stage = 'sold' where id = %L$q$, (select id from r where k = 'job')),
  'people cannot change the stage directly', '42501');
select tests.assert_raises(
  format($q$update public.jobs set walkthrough_completed_at = now() where id = %L$q$, (select id from r where k = 'job')),
  'estimators cannot edit milestone dates', '42501');
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'walkthrough_scheduled', 'walkthrough_complete')$q$, (select id from r where k = 'job')),
  'signed-in users cannot call the stage function directly', '42501');
update public.jobs set priority = 'high', priority_reason = 'Customer travelling soon' where id = (select id from r where k = 'job');
select tests.logout();

select tests.login_service((select id from u where k = 'est'));
select tests.assert_raises(
  format($q$update public.jobs set stage = 'sold' where id = %L$q$, (select id from r where k = 'job')),
  'not even trusted code changes the stage without the stage function', '42501');
select tests.logout();

select tests.login((select id from u where k = 'owner'));
update public.jobs set promised_start_date = '2027-06-15', lead_created_at = '2026-10-01T10:00:00Z'
where id = (select id from r where k = 'job');
select tests.assert_eq((select lead_created_at from public.jobs where id = (select id from r where k = 'job')),
  '2026-10-01T10:00:00Z'::timestamptz, 'owners can edit milestone dates');
select tests.logout();

-- Visibility ------------------------------------------------------------------------------
select tests.login((select id from u where k = 'est2'));
select tests.assert_eq((select count(*) from public.jobs), 0::bigint, 'other estimators do not see the job');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.jobs), 0::bigint, 'painters do not see jobs they are not on');
select tests.logout();
select tests.login((select id from u where k = 'office'));
insert into public.job_team (org_id, job_id, user_id, role)
values ((select a from o), (select id from r where k = 'job'), (select id from u where k = 'painter'), 'painter');
update public.jobs set project_manager_id = (select id from u where k = 'pm') where id = (select id from r where k = 'job');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.jobs), 1::bigint, 'painters see jobs they are on the team of');
select tests.assert_eq((select count(*) from public.job_financials), 0::bigint, 'painters never see job money');
select tests.logout();
select tests.login((select id from u where k = 'pm'));
select tests.assert_eq((select count(*) from public.jobs), 1::bigint, 'the project manager sees the job');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.jobs), 0::bigint, 'another company sees nothing');
select tests.logout();

-- Money ----------------------------------------------------------------------------------
select tests.login((select id from u where k = 'office'));
select tests.assert_raises(
  format($q$insert into public.job_financials (job_id, org_id, contract_baseline_cents) values (%L, %L, 100)$q$,
         (select id from r where k = 'job'), (select a from o)),
  'only owners set the contract baseline', '42501');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
insert into public.job_financials (job_id, org_id, contract_baseline_cents)
values ((select id from r where k = 'job'), (select a from o), 1250000);
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select contract_baseline_cents from public.job_financials), 1250000::bigint,
  'office managers (financials:read) see the contract amount');
select tests.logout();
select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.job_financials), 0::bigint, 'estimators without financials:read see no money');
select tests.assert((public.job_stats(now() - interval '30 days', now(), now() - interval '60 days') ->> 'pipeline_value_cents') is null,
  'job stats show no money without financials:read');
select tests.logout();

-- Gates -----------------------------------------------------------------------------------
select tests.login_service((select id from u where k = 'est'));
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'walkthrough_scheduled', 'walkthrough_complete')$q$, (select id from r where k = 'job')),
  'the walkthrough gate needs a completed, measured walkthrough', '42501');
select tests.logout();

select tests.login((select id from u where k = 'est'));
with ap as (
  insert into public.appointments (org_id, job_id, type, starts_at, ends_at)
  values ((select a from o), (select id from r where k = 'job'), 'walkthrough', now() - interval '2 hours', now() - interval '1 hour')
  returning id
) insert into r select 'appt', id from ap;
select tests.assert_raises(
  format($q$update public.appointments set status = 'completed' where id = %L$q$, (select id from r where k = 'appt')),
  'a completed walkthrough needs a result', '23514');
update public.appointments set status = 'completed', result = 'measured' where id = (select id from r where k = 'appt');
select tests.logout();

select tests.login_service((select id from u where k = 'est'));
select public.apply_job_stage_change((select id from r where k = 'job'), 'walkthrough_scheduled', 'walkthrough_complete');
select tests.assert_eq((select stage from public.jobs where id = (select id from r where k = 'job')), 'walkthrough_complete',
  'a passed gate advances one stage');
select tests.assert((select walkthrough_completed_at is not null from public.jobs where id = (select id from r where k = 'job')),
  'advancing stamps the milestone');
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'walkthrough_complete', 'estimate_sent')$q$, (select id from r where k = 'job')),
  'a gate whose data does not exist yet stays closed', '42501');
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'walkthrough_complete', 'sold')$q$, (select id from r where k = 'job')),
  'skipping stages needs an override', '42501');
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'walkthrough_complete', 'sold', true, 'Signed on paper at the walkthrough')$q$,
         (select id from r where k = 'job')),
  'estimators cannot override', '42501');
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'walkthrough_scheduled', 'walkthrough_complete')$q$, (select id from r where k = 'job')),
  'a stale "from" stage is refused', '40001');
select tests.logout();

select tests.login_service((select id from u where k = 'owner'));
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'walkthrough_complete', 'sold', true, 'ok')$q$, (select id from r where k = 'job')),
  'an override needs a real reason', '23514');
select public.apply_job_stage_change((select id from r where k = 'job'), 'walkthrough_complete', 'sold', true,
  'Signed on paper at the walkthrough');
select tests.logout();
select tests.assert_eq((select count(*) from public.stage_history
                        where job_id = (select id from r where k = 'job') and to_stage = 'sold' and override
                          and reason = 'Signed on paper at the walkthrough' and changed_by = (select id from u where k = 'owner')),
  1::bigint, 'the override is recorded with its reason and who did it');
select tests.assert_eq((select count(*) from public.events where type = 'job.stage_changed'
                        and aggregate_id = (select id from r where k = 'job')::text),
  2::bigint, 'each stage change emits job.stage_changed');
select tests.assert_raises(
  format($q$update public.stage_history set reason = 'changed' where job_id = %L$q$, (select id from r where k = 'job')),
  'stage history cannot be edited', '42501');

-- Holds -----------------------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
with h as (
  insert into public.job_holds (org_id, job_id, hold_type, reason)
  values ((select a from o), (select id from r where k = 'job'), 'hoa', 'Waiting on HOA color approval') returning id
) insert into r select 'hold', id from h;
select tests.assert_eq((select status from public.jobs where id = (select id from r where k = 'job')), 'on_hold',
  'an active hold puts the job on hold');
select tests.assert_eq((select stage from public.jobs where id = (select id from r where k = 'job')), 'sold',
  'a hold does not change the stage');
select tests.assert_raises(
  format($q$update public.job_holds set reason = 'something else' where id = %L$q$, (select id from r where k = 'hold')),
  'a hold can only be released', '23514');
select tests.logout();

select tests.login_service((select id from u where k = 'owner'));
select public.apply_job_stage_change((select id from r where k = 'job'), 'sold', 'onboarding', true, 'Deposit taken by check');
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'onboarding', 'ready_to_schedule', true, 'Everything is ready to go')$q$,
         (select id from r where k = 'job')),
  'a blocking hold stops Ready to Schedule even with an override', '23514');
select tests.logout();

select tests.login((select id from u where k = 'est'));
update public.job_holds set released_at = now(), release_note = 'HOA approved' where id = (select id from r where k = 'hold');
select tests.assert_eq((select status from public.jobs where id = (select id from r where k = 'job')), 'open',
  'releasing the hold takes the job off hold');
select tests.assert_eq((select released_by from public.job_holds where id = (select id from r where k = 'hold')),
  (select id from u where k = 'est'), 'releases record who released');
select tests.assert_raises(
  format($q$update public.job_holds set release_note = 'again' where id = %L$q$, (select id from r where k = 'hold')),
  'a released hold cannot change', '23514');
select tests.logout();

select tests.login_service((select id from u where k = 'owner'));
select public.apply_job_stage_change((select id from r where k = 'job'), 'onboarding', 'ready_to_schedule', true, 'Everything is ready to go');
select tests.logout();

-- Closed Lost and reopening --------------------------------------------------------------------
select tests.login_service((select id from u where k = 'est'));
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'ready_to_schedule', 'closed_lost')$q$, (select id from r where k = 'job')),
  'Closed Lost needs a lost reason', '23514');
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'ready_to_schedule', 'closed_lost', false, null, 'bored')$q$, (select id from r where k = 'job')),
  'the lost reason must be a picklist value', '23514');
select public.apply_job_stage_change((select id from r where k = 'job'), 'ready_to_schedule', 'closed_lost', false, null, 'price');
select tests.assert_eq((select status from public.jobs where id = (select id from r where k = 'job')), 'lost', 'closed lost jobs are lost');
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'closed_lost', 'ready_to_schedule')$q$, (select id from r where k = 'job')),
  'reopening needs an override', '42501');
select tests.logout();
select tests.login_service((select id from u where k = 'owner'));
select public.apply_job_stage_change((select id from r where k = 'job'), 'closed_lost', 'ready_to_schedule', true, 'Customer called back and wants to go ahead');
select tests.logout();
select tests.assert((select status = 'open' and lost_reason is null and closed_at is null
                     from public.jobs where id = (select id from r where k = 'job')),
  'reopening clears the lost reason and close date');
select tests.assert_eq(
  (select string_agg(coalesce(from_stage, '∅') || '>' || to_stage, ',' order by seq)
   from public.stage_history where job_id = (select id from r where k = 'job')),
  '∅>walkthrough_scheduled,walkthrough_scheduled>walkthrough_complete,walkthrough_complete>sold,sold>onboarding,onboarding>ready_to_schedule,ready_to_schedule>closed_lost,closed_lost>ready_to_schedule',
  'stage history lists every move in order');

-- Approvals -------------------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
with q as (
  insert into public.approval_requests (org_id, type, job_id, requested_by, reason, payload)
  values ((select a from o), 'stage_override', (select id from r where k = 'job'), (select id from u where k = 'owner'),
          'Customer confirmed the schedule by phone', '{"to_stage": "scheduled"}') returning id
) insert into r select 'approval', id from q;
select tests.assert_eq((select requested_by from public.approval_requests where id = (select id from r where k = 'approval')),
  (select id from u where k = 'est'), 'the requester is whoever asked');
select tests.assert_raises(
  format($q$insert into public.approval_requests (org_id, type, job_id, requested_by, reason) values (%L, 'stage_override', %L, %L, 'Another one please')$q$,
         (select a from o), (select id from r where k = 'job'), (select id from u where k = 'est')),
  'one pending request per job', '23505');
select tests.assert_raises(
  format($q$update public.approval_requests set status = 'approved' where id = %L$q$, (select id from r where k = 'approval')),
  'requesters cannot approve their own request', '42501');
select tests.logout();
select tests.login((select id from u where k = 'est2'));
select tests.assert_eq((select count(*) from public.approval_requests), 0::bigint, 'others do not see the request');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
update public.approval_requests set status = 'rejected', decision_note = 'Wait for the deposit' where id = (select id from r where k = 'approval');
select tests.assert_eq((select decided_by from public.approval_requests where id = (select id from r where k = 'approval')),
  (select id from u where k = 'owner'), 'decisions record the owner');
select tests.logout();

-- Notes on jobs ----------------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
insert into public.notes (org_id, subject_type, subject_id, body) values ((select a from o), 'job', (select id from r where k = 'job'), 'Gate code is with the office');
select tests.logout();
select tests.login((select id from u where k = 'est2'));
select tests.assert_raises(
  format($q$insert into public.notes (org_id, subject_type, subject_id, body) values (%L, 'job', %L, 'hi')$q$,
         (select a from o), (select id from r where k = 'job')),
  'you can only write notes on jobs you can see', '42501');
select tests.logout();

-- Deleting your own note; mentions on a job link to it ------------------------------------
select tests.login((select id from u where k = 'est'));
with n as (
  insert into public.notes (org_id, subject_type, subject_id, body) values ((select a from o), 'job', (select id from r where k = 'job'), 'Delete me')
  returning id
) insert into r select 'note', id from n;
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(
  format($q$select public.soft_delete_post('notes', %L)$q$, (select id from r where k = 'note')),
  'you can only delete your own notes', 'P0002');
insert into public.comments (org_id, subject_type, subject_id, body, mentions)
values ((select a from o), 'job', (select id from r where k = 'job'), 'Can you check the HOA letter?', array[(select id from u where k = 'est')]);
select tests.logout();
select tests.assert_eq((select link from public.notifications where user_id = (select id from u where k = 'est') and type = 'mention'),
  '/jobs/' || (select id from r where k = 'job') || '?section=notes', 'job mentions link to the job''s notes');
select tests.login((select id from u where k = 'est'));
select public.soft_delete_post('notes', (select id from r where k = 'note'));
select tests.assert_raises($$select public.soft_delete_post('leads', gen_random_uuid())$$, 'only notes and comments', '22023');
select tests.logout();
select tests.assert((select deleted_at is not null from public.notes where id = (select id from r where k = 'note')),
  'the author can delete their own note');

-- Attention items ---------------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
select tests.assert_raises(
  format($q$insert into public.attention_items (org_id, rule_key, category, priority, title, subject_type, subject_id, dedupe_key) values (%L, 'x', 'tasks', 'high', 'x', 'job', %L, 'x')$q$,
         (select a from o), (select id from r where k = 'job')),
  'people cannot create attention items', '42501');
select tests.logout();
select tests.login_service();
with ai as (
  insert into public.attention_items (org_id, rule_key, category, priority, title, subject_type, subject_id, owner_id, dedupe_key)
  values ((select a from o), 'onboarding_stalled', 'production', 'medium', 'Onboarding stalled', 'job', (select id from r where k = 'job'),
          (select id from u where k = 'est'), 'onboarding_stalled:test') returning id
) insert into r select 'item', id from ai;
select tests.logout();
select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.attention_items), 1::bigint, 'the job owner sees the item');
select tests.assert_raises(
  format($q$update public.attention_items set title = 'changed' where id = %L$q$, (select id from r where k = 'item')),
  'people can only assign, snooze and resolve', '42501');
select tests.assert_raises(
  format($q$update public.attention_items set status = 'resolved' where id = %L$q$, (select id from r where k = 'item')),
  'resolving needs a note', '23514');
update public.attention_items set status = 'resolved', resolution_note = 'Called the customer' where id = (select id from r where k = 'item');
select tests.assert_eq((select resolution from public.attention_items where id = (select id from r where k = 'item')), 'manual',
  'a person resolving marks it manual');
select tests.logout();
select tests.login((select id from u where k = 'est2'));
select tests.assert_eq((select count(*) from public.attention_items), 0::bigint, 'others do not see items on jobs they cannot open');
select tests.logout();

-- Conversion --------------------------------------------------------------------------------
create temp table l (k text primary key, id uuid) on commit drop;
grant select on l to authenticated, service_role;
with ins as (
  insert into public.leads (org_id, first_name, last_name, mobile, email, street, city, zip, lead_source, services, owner_id)
  values
    (tests.org_id(), 'Sam', 'Smith', '+14255550111', null, '12 Lake St', 'Kirkland', '98033', 'website', '{interior}', (select id from u where k = 'est')),
    (tests.org_id(), 'Nina', 'Nguyen', '+14255550122', 'nina@example.com', '9 Pine Ave', 'Redmond', '98052', 'nextdoor', '{interior,exterior,other}', (select id from u where k = 'est')),
    (tests.org_id(), 'Lou', 'Lost', '+14255550133', null, null, null, null, 'website', '{}', null)
  returning id, first_name
) insert into l select lower(first_name), id from ins;
update public.leads set status = 'lost', lost_reason = 'price' where id = (select id from l where k = 'lou');
insert into public.notes (org_id, subject_type, subject_id, body) values (tests.org_id(), 'lead', (select id from l where k = 'nina'), 'Prefers mornings');
insert into public.appointments (org_id, lead_id, type, starts_at, ends_at)
values (tests.org_id(), (select id from l where k = 'nina'), 'walkthrough', now() + interval '1 day', now() + interval '1 day 1 hour');

select tests.login((select id from u where k = 'est'));
select tests.assert_raises(
  format($q$select public.convert_lead_to_job(%L)$q$, (select id from l where k = 'sam')),
  'signed-in users cannot call conversion directly', '42501');
select tests.logout();

select tests.login_service((select id from u where k = 'est'));
insert into r select 'sam_job', public.convert_lead_to_job((select id from l where k = 'sam'));
insert into r select 'nina_job', public.convert_lead_to_job((select id from l where k = 'nina'));
select tests.assert_raises(
  format($q$select public.convert_lead_to_job(%L)$q$, (select id from l where k = 'sam')),
  'a lead converts only once', '23505');
select tests.assert_raises(
  format($q$select public.convert_lead_to_job(%L)$q$, (select id from l where k = 'lou')),
  'lost leads must be reopened first', '23514');
select tests.logout();

select tests.assert((select account_id = (select id from r where k = 'acct') and primary_contact_id = (select id from r where k = 'contact')
                            and property_id = (select id from r where k = 'prop')
                     from public.jobs where id = (select id from r where k = 'sam_job')),
  'conversion reuses the matching contact, account and property');
select tests.assert_eq((select count(*) from public.accounts where display_name = 'Nguyen Residence'), 1::bigint,
  'conversion creates a household when nothing matches');
select tests.assert_eq((select name from public.jobs where id = (select id from r where k = 'nina_job')),
  'Nguyen – Redmond – Interior, Exterior, Add-on Only', 'the job is named Lastname – City – Work types');
select tests.assert((select status = 'converted' and converted_job_id = (select id from r where k = 'nina_job') and contact_id is not null
                     from public.leads where id = (select id from l where k = 'nina')),
  'the lead links to its job');
select tests.assert_eq((select count(*) from public.notes where subject_type = 'job' and subject_id = (select id from r where k = 'nina_job')),
  1::bigint, 'notes move to the job');
select tests.assert_eq((select count(*) from public.appointments where job_id = (select id from r where k = 'nina_job')),
  1::bigint, 'the walkthrough appointment moves to the job');
select tests.assert_eq((select stage from public.jobs where id = (select id from r where k = 'nina_job')), 'walkthrough_scheduled',
  'converted jobs start at Walkthrough Scheduled');

-- Soft delete, search, counts ---------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
select tests.assert_eq(((public.job_status_counts()) ->> 'total')::int, 3, 'estimators count only their own jobs');
select tests.assert((select count(*) > 0 from public.search_records((select lower(job_number) from public.jobs where id = (select id from r where k = 'job')), 'jobs', 8)),
  'universal search finds jobs by number');
select tests.assert_raises(
  format($q$select public.soft_delete_record('jobs', %L, 'Duplicate job')$q$, (select id from r where k = 'nina_job')),
  'estimators cannot delete jobs', '42501');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select public.soft_delete_record('jobs', (select id from r where k = 'nina_job'), 'Duplicate job');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert((select count(*) = 1 from public.list_deleted_records() where table_name = 'jobs'),
  'deleted jobs show in Deleted Records');
select tests.logout();

rollback;
