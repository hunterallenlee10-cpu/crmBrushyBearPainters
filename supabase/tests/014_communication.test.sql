-- Phase 8: Communication & growth — seeded configuration, templates (draft until
-- an owner approves), workflow switches and run idempotency, message threads
-- and unread state, cases, Bear Champions and `?ref=` attribution, campaigns and
-- drips guards, follow-up attempts, notification preferences, consent columns,
-- per-role row security and cross-company isolation.
begin;

insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));
select app.seed_communication_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner', null, 'Hunter Lee')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('books', tests.make_user('books@test.bb', 'bookkeeper')),
  ('ro', tests.make_user('ro@test.bb', 'read_only')),
  ('est', tests.make_user('est@test.bb', 'estimator')),
  ('est2', tests.make_user('est2@test.bb', 'estimator')),
  ('lead', tests.make_user('lead@test.bb', 'project_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter')),
  ('other_owner', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co')));
update public.profiles set phone = '+14255550123' where id = (select id from u where k = 'owner');
grant select on u to authenticated, service_role;
create temp table r (k text primary key, id uuid) on commit drop;
grant select, insert on r to authenticated, service_role;

with a as (insert into public.accounts (org_id, display_name, owner_id) values (tests.org_id(), 'Rivera Residence', (select id from u where k = 'est')) returning id)
insert into r select 'acct', id from a;
with c as (
  insert into public.contacts (org_id, account_id, first_name, last_name, mobile, email)
  values (tests.org_id(), (select id from r where k = 'acct'), 'Jamie', 'Rivera', '+14255550101', 'jamie@example.com') returning id
) insert into r select 'contact', id from c;
with j as (
  insert into public.jobs (org_id, name, account_id, primary_contact_id, work_types, owner_id, project_manager_id)
  values (tests.org_id(), 'Rivera – Kirkland – Exterior', (select id from r where k = 'acct'), (select id from r where k = 'contact'),
          '{exterior}', (select id from u where k = 'est'), (select id from u where k = 'lead')) returning id
) insert into r select 'job', id from j;
with j as (
  insert into public.jobs (org_id, name, account_id, work_types, owner_id)
  values (tests.org_id(), 'Someone else – Bellevue – Interior', (select id from r where k = 'acct'), '{interior}',
          (select id from u where k = 'est2')) returning id
) insert into r select 'job2', id from j;

-- 1. Seeded configuration --------------------------------------------------------------------------
select tests.assert_eq((select count(*) from public.workflows where org_id = tests.org_id() and enabled), 17::bigint,
  'the 17 SPEC §11.2 workflows are seeded and on');
select tests.assert((select count(*) >= 80 from public.message_templates where org_id = tests.org_id() and is_system and status = 'draft'),
  'every system template starts as a draft (owner to approve)');
select tests.assert_eq((select count(distinct channel) from public.message_templates where org_id = tests.org_id() and key = 'daily_update'), 2::bigint,
  'templates come in SMS and email');
select tests.assert_eq((select count(*) from public.follow_up_lists where org_id = tests.org_id()), 8::bigint, 'the 8 follow-up lists');
select tests.assert_eq((select count(distinct disposition_group) from public.follow_up_dispositions where org_id = tests.org_id()), 5::bigint,
  'dispositions in five groups');
select tests.assert_eq((select count(*) from public.drips where org_id = tests.org_id() and is_system), 2::bigint, 'two system drips');
select tests.assert((select quiet_hours_enabled and quiet_hours_start = '20:00' and quiet_hours_end = '08:00' from public.messaging_settings where org_id = tests.org_id()),
  'quiet hours 8 pm – 8 am by default');
select tests.assert_eq((select count(*) from public.attention_rules where org_id = tests.org_id() and rule_key in ('unread_message', 'warranty_request')), 2::bigint,
  'unread-message and warranty attention rules are seeded');
select app.seed_communication_defaults(tests.org_id());
select tests.assert_eq((select count(*) from public.workflows where org_id = tests.org_id()), 17::bigint, 'the seed is idempotent');

-- 2. Templates: draft until an owner approves -----------------------------------------------------------
insert into r select 'tpl', id from public.message_templates where org_id = tests.org_id() and key = 'rain_delay' and channel = 'sms';

select tests.login((select id from u where k = 'est'));
select tests.assert((select count(*) > 0 from public.message_templates), 'everyone can read templates (composers)');
select tests.assert_eq(tests.rows_affected(format($q$update public.message_templates set body = 'x' where id = %L$q$, (select id from r where k = 'tpl'))),
  0::bigint, 'an estimator cannot edit templates');
select tests.logout();

select tests.login((select id from u where k = 'office'));
select tests.assert_eq(tests.rows_affected(format($q$update public.message_templates set body = 'Hi {{contact.first_name}}, rain on {{rain_delay.date | weekday}}.' where id = %L$q$,
  (select id from r where k = 'tpl'))), 1::bigint, 'templates:manage edits wording');
select tests.assert_raises(format($q$update public.message_templates set status = 'approved' where id = %L$q$, (select id from r where k = 'tpl')),
  'approval is never typed in', '42501');
select tests.assert_raises(format($q$select public.approve_template(%L)$q$, (select id from r where k = 'tpl')),
  'only an owner approves template wording', '42501');
select tests.assert_raises(format($q$update public.message_templates set key = 'renamed' where id = %L$q$, (select id from r where k = 'tpl')),
  'a template keeps its key', '42501');
insert into public.message_templates (org_id, key, channel, name, category, body, status, is_system)
values (tests.org_id(), 'office_custom', 'sms', 'Custom', 'internal', 'Hello', 'approved', true);
select tests.assert((select status = 'draft' and not is_system from public.message_templates where key = 'office_custom'),
  'a new template is a draft and never a system template');
select tests.logout();

select tests.login((select id from u where k = 'owner'));
select public.approve_template((select id from r where k = 'tpl'));
select tests.assert((select status = 'approved' and approved_by = (select id from u where k = 'owner') from public.message_templates where id = (select id from r where k = 'tpl')),
  'an owner approves the wording');
update public.message_templates set body = body || ' Thanks.' where id = (select id from r where k = 'tpl');
select tests.assert((select status = 'draft' and approved_at is null from public.message_templates where id = (select id from r where k = 'tpl')),
  'changing approved wording puts it back to draft');
select tests.logout();

select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.message_templates where org_id = tests.org_id()), 0::bigint,
  'another company never sees our templates');
select tests.logout();

-- 3. Workflows and runs ------------------------------------------------------------------------------
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.workflows), 0::bigint, 'workflows need workflows:manage');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq(tests.rows_affected($q$update public.workflows set enabled = false, disabled_reason = 'Testing' where key = 'rain_delay'$q$),
  1::bigint, 'an owner turns a workflow off');
select tests.assert_raises($q$update public.workflows set key = 'other' where key = 'rain_delay'$q$,
  'only the switch can change', '42501');
select tests.assert_raises($q$insert into public.workflow_runs (org_id, workflow_id, workflow_key, event_type, idempotency_key)
  select org_id, id, key, 'x.y', 'k' from public.workflows where key = 'rain_delay'$q$,
  'people never write workflow runs', '42501');
update public.workflows set enabled = true where key = 'rain_delay';
select tests.assert((select disabled_reason is null from public.workflows where key = 'rain_delay' and org_id = tests.org_id()),
  'turning it back on clears the reason');
select tests.logout();

insert into public.workflow_runs (org_id, workflow_id, workflow_key, event_type, idempotency_key, subject_type, subject_id)
select org_id, id, key, 'job.rain_delay', 'rain_delay:1', 'job', (select id from r where k = 'job')::text
from public.workflows where key = 'rain_delay' and org_id = tests.org_id();
select tests.assert_raises($q$insert into public.workflow_runs (org_id, workflow_id, workflow_key, event_type, idempotency_key)
  select org_id, id, key, 'job.rain_delay', 'rain_delay:1' from public.workflows where key = 'rain_delay' and org_id = tests.org_id()$q$,
  'one run per workflow and event (idempotency key)', '23505');
select tests.assert_raises($q$insert into public.workflow_runs (org_id, workflow_id, workflow_key, event_type, idempotency_key, status)
  select org_id, id, key, 'x.y', 'w:1', 'waiting' from public.workflows where key = 'rain_delay' and org_id = tests.org_id()$q$,
  'a waiting run needs a resume time', '23514');
update public.workflow_runs set status = 'waiting', resume_at = now() - interval '1 minute' where idempotency_key = 'rain_delay:1';
select tests.login_service();
select tests.assert_eq((select count(*) from public.claim_workflow_runs(10)), 1::bigint, 'the worker claims a run whose wait is over');
select tests.assert_eq((select count(*) from public.claim_workflow_runs(10)), 0::bigint, 'a claimed run is not claimed twice');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq((select runs from public.workflow_stats() where workflow_key = 'rain_delay'), 1::bigint, 'workflow_stats counts runs');
select tests.logout();

-- 4. Threads ------------------------------------------------------------------------------------------
select tests.login_service();
insert into public.integration_outbox (org_id, domain, provider, operation, status) values (tests.org_id(), 'sms_voice', 'outbox', 'sms.send', 'simulated');
insert into public.messages (org_id, channel, direction, subject_type, subject_id, contact_id, body, status, simulated, outbox_id, message_type)
select tests.org_id(), 'sms', 'outbound', 'job', (select id from r where k = 'job'), (select id from r where k = 'contact'),
       'Hi Jamie, rain on Thursday.', 'simulated', true, (select id from public.integration_outbox order by created_at desc limit 1), 'transactional';
insert into r select 'thread', id from public.message_threads where subject_id = (select id from r where k = 'job');
select tests.assert((select thread_id = (select id from r where k = 'thread') from public.messages where subject_id = (select id from r where k = 'job')),
  'a message lands in its record''s thread');
select tests.assert((select message_count = 1 and not unread and last_direction = 'outbound' from public.message_threads where id = (select id from r where k = 'thread')),
  'the thread keeps a summary; outbound is never unread');
insert into public.messages (org_id, channel, direction, subject_type, subject_id, contact_id, from_address, body, status, simulated, provider_message_id)
values (tests.org_id(), 'sms', 'inbound', 'job', (select id from r where k = 'job'), (select id from r where k = 'contact'),
        '+14255550101', 'Thursday works, thanks!', 'received', false, 'SM123');
select tests.assert((select unread and inbound_count = 1 and last_preview = 'Thursday works, thanks!' from public.message_threads where id = (select id from r where k = 'thread')),
  'an inbound message makes the thread unread');
select tests.assert_raises($q$insert into public.messages (org_id, channel, direction, subject_type, subject_id, body, status, simulated, provider_message_id)
  values (tests.org_id(), 'sms', 'inbound', 'job', (select id from r where k = 'job'), 'dup', 'received', false, 'SM123')$q$,
  'an inbound provider message is recorded once', '23505');
select tests.assert_raises(format($q$insert into public.messages (org_id, channel, direction, subject_type, subject_id, body, status, simulated, thread_id)
  values (%L, 'sms', 'inbound', 'job', %L, 'x', 'received', false, %L)$q$, tests.org_id(), (select id from r where k = 'job2'), (select id from r where k = 'thread')),
  'a message cannot be put in another record''s thread', '42501');
select tests.logout();

select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.message_threads), 0::bigint, 'a painter sees no customer conversations');
select tests.logout();
select tests.login((select id from u where k = 'lead'));
select tests.assert_eq((select count(*) from public.message_threads), 1::bigint, 'a crew lead reads conversations on their own job');
select tests.assert_raises(format($q$select public.mark_thread_read(%L)$q$, (select id from r where k = 'thread')), 'but cannot mark them read (they don''t reply to customers)', '42501');
select tests.logout();
select tests.login((select id from u where k = 'est2'));
select tests.assert_eq((select count(*) from public.message_threads), 0::bigint, 'an estimator sees only their own jobs'' conversations');
select tests.logout();
select tests.login((select id from u where k = 'est'));
select public.mark_thread_read((select id from r where k = 'thread'));
select tests.assert((select not unread and read_by = (select id from u where k = 'est') from public.message_threads where id = (select id from r where k = 'thread')),
  'marking read clears unread for everyone');
select public.mark_thread_read((select id from r where k = 'thread'), false);
select tests.assert((select unread from public.message_threads where id = (select id from r where k = 'thread')), 'and it can be marked unread again');
select tests.logout();

-- 5. Cases ---------------------------------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
with c as (
  insert into public.cases (org_id, job_id, contact_id, type, title, description, owner_id, sla_due_at)
  values (tests.org_id(), (select id from r where k = 'job'), (select id from r where k = 'contact'), 'warranty',
          'Peeling on the back door', 'Customer called.', (select id from u where k = 'est'), now() + interval '2 days') returning id
) insert into r select 'case', id from c;
select tests.assert((select case_number ~ '^CASE-\d{4}-\d{4}$' and account_id = (select id from r where k = 'acct') from public.cases where id = (select id from r where k = 'case')),
  'a case gets a number and the job''s account');
select tests.assert_raises(format($q$update public.cases set status = 'resolved' where id = %L$q$, (select id from r where k = 'case')),
  'resolving needs what was done', '23514');
update public.cases set status = 'in_progress' where id = (select id from r where k = 'case');
select tests.assert((select first_response_at is not null from public.cases where id = (select id from r where k = 'case')), 'first response is stamped');
update public.cases set status = 'resolved', resolution = 'Sanded and repainted the door.' where id = (select id from r where k = 'case');
select tests.assert((select resolved_at is not null and resolved_by = (select id from u where k = 'est') from public.cases where id = (select id from r where k = 'case')),
  'resolving stamps who and when');
select tests.assert_raises(format($q$update public.cases set case_number = 'CASE-1' where id = %L$q$, (select id from r where k = 'case')),
  'a case keeps its number', '42501');
select tests.logout();
select tests.assert((select count(*) = 2 from public.activity where subject_id = (select id from r where k = 'job')::text and type in ('case_opened', 'case_resolved')),
  'opening and resolving a case go on the job timeline');
select tests.login((select id from u where k = 'lead'));
select tests.assert_eq((select count(*) from public.cases), 1::bigint, 'a crew lead sees cases on their job');
select tests.assert_eq(tests.rows_affected(format($q$update public.cases set title = 'x' where id = %L$q$, (select id from r where k = 'case'))),
  0::bigint, 'but cannot change them');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.cases), 0::bigint, 'painters see no cases');
select tests.logout();
select tests.login((select id from u where k = 'est2'));
select tests.assert_eq((select count(*) from public.cases), 0::bigint, 'another estimator does not see the case');
select tests.logout();
select tests.login((select id from u where k = 'ro'));
select tests.assert_eq((select count(*) from public.cases), 1::bigint, 'read-only sees every case');
select tests.assert_raises($q$insert into public.cases (org_id, account_id, title, sla_due_at) select org_id, id, 'Nope', now() from public.accounts limit 1$q$,
  'read-only cannot open cases', '42501');
select tests.logout();

-- 6. Bear Champions and ?ref= attribution ---------------------------------------------------------------
select tests.login((select id from u where k = 'office'));
with c as (insert into public.referral_champions (org_id, contact_id, code) values (tests.org_id(), (select id from r where k = 'contact'), 'BEAR-HACK') returning id)
insert into r select 'champ', id from c;
select tests.assert((select code ~ '^BEAR-[A-HJ-NP-Z2-9]{4}$' and code <> 'BEAR-HACK' and account_id = (select id from r where k = 'acct') from public.referral_champions where id = (select id from r where k = 'champ')),
  'a champion gets a generated BEAR-XXXX code (people cannot pick one)');
select tests.assert_raises(format($q$update public.referral_champions set code = 'BEAR-AAAA' where id = %L$q$, (select id from r where k = 'champ')),
  'a champion keeps their code', '42501');
select tests.logout();

insert into public.leads (org_id, first_name, last_name, email, lead_source, intake_channel, referral_code)
values (tests.org_id(), 'Pat', 'Neighbor', 'pat@example.com', 'website', 'website',
        lower((select code from public.referral_champions where id = (select id from r where k = 'champ'))) || ' ');
insert into r select 'ref_lead', id from public.leads where email = 'pat@example.com';
select tests.assert((select champion_id = (select id from r where k = 'champ') and source = 'ref_link' and ineligible_reason is null and referred_name = 'Pat Neighbor'
                       from public.referrals where lead_id = (select id from r where k = 'ref_lead')),
  'a website lead with ?ref=CODE becomes a referral (code matched case-insensitively)');
insert into public.leads (org_id, first_name, email, lead_source, intake_channel, referral_code)
values (tests.org_id(), 'Jamie', 'jamie@example.com', 'website', 'website', (select code from public.referral_champions where id = (select id from r where k = 'champ')));
select tests.assert((select ineligible_reason is not null from public.referrals r2 join public.leads l on l.id = r2.lead_id where l.first_name = 'Jamie' and l.email = 'jamie@example.com'),
  'a champion referring themselves is not eligible');
insert into public.leads (org_id, first_name, email, lead_source, intake_channel, referral_code)
values (tests.org_id(), 'Nobody', 'nobody@example.com', 'website', 'website', 'BEAR-ZZZZ');
select tests.assert_eq((select count(*) from public.referrals r2 join public.leads l on l.id = r2.lead_id where l.email = 'nobody@example.com'), 0::bigint,
  'an unknown code is ignored');
update public.leads set converted_job_id = (select id from r where k = 'job2'), status = 'converted' where id = (select id from r where k = 'ref_lead');
select tests.assert((select job_id = (select id from r where k = 'job2') from public.referrals where lead_id = (select id from r where k = 'ref_lead')),
  'converting the lead carries the job onto the referral');

select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.referrals), 0::bigint, 'referrals need referrals:manage');
select tests.logout();
select tests.login((select id from u where k = 'office'));
update public.referrals set paid_at = now(), payout_method = 'gift_card' where lead_id = (select id from r where k = 'ref_lead');
select tests.assert((select paid_by = (select id from u where k = 'office') from public.referrals where lead_id = (select id from r where k = 'ref_lead')),
  'recording the payout stamps who paid');
select tests.assert_raises(format($q$update public.referrals set reward_cents = 1 where lead_id = %L$q$, (select id from r where k = 'ref_lead')),
  'a paid reward cannot change', '42501');
select tests.logout();

-- 7. Campaigns, drips, follow-ups -------------------------------------------------------------------------
select tests.login((select id from u where k = 'office'));
with c as (insert into public.campaigns (org_id, name, channel, status, body, started_at) values (tests.org_id(), 'Fall interiors', 'email', 'sent', 'Hi', now()) returning id)
insert into r select 'camp', id from c;
select tests.assert((select status = 'draft' and started_at is null from public.campaigns where id = (select id from r where k = 'camp')),
  'a new campaign is a draft, whatever was asked');
select tests.assert_raises(format($q$update public.campaigns set status = 'scheduled' where id = %L$q$, (select id from r where k = 'camp')),
  'scheduling needs a time', '23514');
update public.campaigns set status = 'scheduled', scheduled_at = now() + interval '1 day' where id = (select id from r where k = 'camp');
select tests.assert_raises(format($q$update public.campaigns set body = 'Changed' where id = %L$q$, (select id from r where k = 'camp')),
  'a scheduled campaign is unscheduled before changing it', '42501');
select tests.assert_raises(format($q$update public.campaigns set status = 'sent' where id = %L$q$, (select id from r where k = 'camp')),
  'only the worker marks a campaign sent', '42501');
select tests.assert_raises(format($q$insert into public.campaign_recipients (org_id, campaign_id, subject_type, subject_id) values (%L, %L, 'contact', %L)$q$,
  tests.org_id(), (select id from r where k = 'camp'), (select id from r where k = 'contact')), 'recipients are written by the worker', '42501');
insert into public.drip_enrollments (org_id, drip_id, subject_type, subject_id, next_run_at)
select tests.org_id(), id, 'lead', (select id from r where k = 'ref_lead'), now() from public.drips where key = 'just_planning_nurture' and org_id = tests.org_id();
select tests.assert_raises(format($q$insert into public.drip_enrollments (org_id, drip_id, subject_type, subject_id, next_run_at)
  select %L, id, 'lead', %L, now() from public.drips where key = 'just_planning_nurture' and org_id = %L$q$,
  tests.org_id(), (select id from r where k = 'ref_lead'), tests.org_id()), 'one active enrollment per drip and record', '23505');
select tests.assert_raises($q$update public.drip_enrollments set current_step = 2$q$, 'people can only stop an enrollment', '42501');
update public.drip_enrollments set status = 'canceled';
select tests.assert((select ended_at is not null and next_run_at is null from public.drip_enrollments limit 1), 'stopping ends the enrollment');
select tests.logout();
select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.campaigns), 0::bigint, 'estimators don''t manage campaigns');
insert into public.follow_up_attempts (org_id, list_key, subject_type, subject_id, disposition_key, disposition_group, actor_id, callback_at)
values (tests.org_id(), 'estimates_awaiting_reply', 'job', (select id from r where k = 'job'), 'call_back', 'callback', (select id from u where k = 'est'), now() + interval '1 day');
select tests.assert_raises($q$update public.follow_up_attempts set notes = 'edited'$q$, 'follow-up attempts are a log', '42501');
select tests.assert_raises(format($q$insert into public.follow_up_attempts (org_id, list_key, subject_type, subject_id, disposition_key, disposition_group, actor_id)
  values (%L, 'x', 'job', %L, 'no_answer', 'no_contact', %L)$q$, tests.org_id(), (select id from r where k = 'job2'), (select id from u where k = 'est')),
  'no attempts on records you cannot see', '42501');
select tests.assert_raises(format($q$insert into public.follow_up_attempts (org_id, list_key, subject_type, subject_id, disposition_key, disposition_group, actor_id)
  values (%L, 'x', 'job', %L, 'no_answer', 'no_contact', %L)$q$, tests.org_id(), (select id from r where k = 'job'), (select id from u where k = 'owner')),
  'an attempt is always your own', '42501');
select tests.logout();

-- 8. Notification preferences -------------------------------------------------------------------------------
select tests.login((select id from u where k = 'owner'));
insert into public.notification_preferences (org_id, user_id, type, in_app, email, sms) values
  (tests.org_id(), (select id from u where k = 'owner'), 'job_stage', false, true, true),
  (tests.org_id(), (select id from u where k = 'owner'), 'mention', false, false, false);
select tests.logout();
select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.notification_preferences), 0::bigint, 'preferences are private');
select tests.assert_raises(format($q$insert into public.notification_preferences (org_id, user_id, type) values (%L, %L, 'x')$q$,
  tests.org_id(), (select id from u where k = 'owner')), 'nobody sets someone else''s preferences', '42501');
select tests.logout();
select tests.login_service();
insert into public.notifications (org_id, user_id, type, title, link) values
  (tests.org_id(), (select id from u where k = 'owner'), 'job_stage', 'Rivera moved to Scheduled', '/jobs/x'),
  (tests.org_id(), (select id from u where k = 'owner'), 'mention', 'Erik mentioned you', '/jobs/x');
select tests.logout();
select tests.assert_eq((select count(*) from public.notifications where user_id = (select id from u where k = 'owner') and type = 'job_stage'), 0::bigint,
  'in-app turned off: no bell notification');
select tests.assert_eq((select count(*) from public.integration_outbox where related_type = 'notification' and payload ->> 'notification_type' = 'job_stage'), 2::bigint,
  'email and text copies go to the outbox (simulated)');
select tests.assert_eq((select count(*) from public.notifications where user_id = (select id from u where k = 'owner') and type = 'mention'), 1::bigint,
  'a locked type stays in-app even when turned off');

-- 9. Consent columns, stats, isolation -------------------------------------------------------------------------
select tests.assert((select count(*) = 3 from information_schema.columns where table_schema = 'public'
                     and ((table_name = 'leads' and column_name in ('sms_opted_out_at', 'email_opted_out_at'))
                          or (table_name = 'contacts' and column_name = 'email_opted_out_at'))),
  'leads and contacts record STOP and unsubscribe');
select tests.login((select id from u where k = 'owner'));
select tests.assert(((public.communication_stats()) ->> 'threads_unread')::int = 1, 'communication_stats counts unread threads');
select tests.assert(((public.communication_stats()) ->> 'champions_active')::int = 1, 'and active champions');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert(((public.communication_stats()) ->> 'threads_unread')::int = 0, 'stats follow row security');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.message_threads) + (select count(*) from public.cases) + (select count(*) from public.referral_champions)
  + (select count(*) from public.campaigns) + (select count(*) from public.workflow_runs), 0::bigint,
  'another company sees none of our threads, cases, champions, campaigns or runs');
select tests.assert_eq((select count(*) from public.workflows), 17::bigint, 'it has its own 17 workflows');
select tests.logout();

rollback;
