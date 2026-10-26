-- Phase 2: leads, accounts, contacts, properties and their notes/comments/tasks/
-- messages, per role and across organizations.
begin;

insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));
select app.seed_leads_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('est', tests.make_user('est@test.bb', 'estimator')),
  ('est2', tests.make_user('est2@test.bb', 'estimator')),
  ('painter', tests.make_user('painter@test.bb', 'painter')),
  ('books', tests.make_user('books@test.bb', 'bookkeeper')),
  ('other_owner', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co')));
grant select on u to authenticated, service_role;
create temp table o as select tests.org_id() as a;
grant select on o to authenticated;

create temp table t (k text primary key, id uuid) on commit drop;
insert into t select 'kirkland', id from public.territories where org_id = tests.org_id() and name = 'Kirkland';
insert into t select 'bellevue', id from public.territories where org_id = tests.org_id() and name = 'Bellevue';
grant select on t to authenticated;

-- Seed leads as postgres (created_by kept as given).
create temp table l (k text primary key, id uuid) on commit drop;
grant select on l to authenticated, service_role;
with ins as (
  insert into public.leads (org_id, first_name, last_name, mobile, email, zip, lead_source, owner_id, created_by, services, timeline)
  values
    (tests.org_id(), 'Ella', 'Estimator-Owned', '+14255550101', 'ella@example.com', '98033', 'website',
     (select id from u where k = 'est'), (select id from u where k = 'office'), '{exterior}', 'asap'),
    (tests.org_id(), 'Ben', 'Bellevue', '+14255550102', null, '98004', 'nextdoor',
     (select id from u where k = 'est2'), (select id from u where k = 'est2'), '{interior}', '1_3_months'),
    (tests.org_id(), 'Kim', 'Kirkland', null, 'kim@example.com', '98034', 'yelp',
     (select id from u where k = 'est2'), (select id from u where k = 'est2'), '{cabinets}', null),
    (tests.org_id(), 'Sam', 'Seattle', '+12065550103', null, '98101', 'website', null, (select id from u where k = 'office'), '{}', null)
  returning id, first_name
)
insert into l select lower(first_name), id from ins;
with ins as (
  insert into public.leads (org_id, first_name, mobile, lead_source)
  values (tests.org_id('other-co'), 'Otto', '+14255550199', 'website') returning id
)
insert into l select 'other', id from ins;

-- Territory, out-of-area and database rules ---------------------------------------------
select tests.assert_eq((select territory_id from public.leads where id = (select id from l where k = 'ella')),
  (select id from t where k = 'kirkland'), 'ZIP 98033 maps to Kirkland');
select tests.assert((select out_of_area and territory_id is null from public.leads where id = (select id from l where k = 'sam')),
  'ZIP 98101 is flagged out of area (not rejected)');
select tests.assert_raises(
  format($q$insert into public.leads (org_id, first_name, lead_source) values (%L, 'No', 'website')$q$, tests.org_id()),
  'a lead needs a phone or email', '23514');
select tests.assert_raises(
  format($q$insert into public.leads (org_id, first_name, email, lead_source) values (%L, 'X', 'x@example.com', 'carrier_pigeon')$q$, tests.org_id()),
  'lead source must be a picklist value', '23514');
select tests.assert_raises(
  format($q$insert into public.leads (org_id, first_name, mobile, lead_source) values (%L, 'X', '425-555-0100', 'website')$q$, tests.org_id()),
  'phones are stored in E.164', '23514');
select tests.assert_raises(
  format($q$insert into public.leads (org_id, first_name, email, lead_source, services) values (%L, 'X', 'x@example.com', 'website', '{roofing}')$q$, tests.org_id()),
  'services are limited to the website choices', '23514');
select tests.assert_raises(
  format($q$update public.leads set status = 'lost' where id = %L$q$, (select id from l where k = 'sam')),
  'lost needs a reason', '23514');

-- Audit, event and activity on create
select tests.assert_eq((select count(*) from public.audit_log where table_name = 'public.leads' and record_id = (select id::text from l where k = 'ella') and action = 'insert'),
  1::bigint, 'creating a lead writes an audit row');
select tests.assert_eq((select count(*) from public.events where type = 'lead.created' and aggregate_id = (select id::text from l where k = 'ella')),
  1::bigint, 'creating a lead emits lead.created');
select tests.assert_eq((select count(*) from public.activity where subject_type = 'lead' and subject_id = (select id::text from l where k = 'ella') and type = 'lead_created'),
  1::bigint, 'creating a lead adds a timeline entry');
select tests.assert(
  (select not (after ? 'search_text') and not (after ? 'last_activity_at') from public.audit_log
   where table_name = 'public.leads' and record_id = (select id::text from l where k = 'ella') and action = 'insert'),
  'bookkeeping columns stay out of the audit log');

-- painter: no leads at all ----------------------------------------------------------
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.leads), 0::bigint, 'painter sees no leads');
select tests.assert_raises(
  format($q$insert into public.leads (org_id, first_name, mobile, lead_source) values (%L, 'P', '+14255550111', 'website')$q$, tests.org_id()),
  'painter cannot create leads', '42501');
select tests.assert_eq((select count(*) from public.search_records('ella')), 0::bigint, 'painter finds no leads in search');
select tests.logout();

-- estimator (own scope) ------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.leads), 1::bigint, 'estimator sees only leads they own or created');
select tests.assert_eq((select first_name from public.leads), 'Ella', 'estimator sees their own lead');
select tests.assert_eq(tests.rows_affected(format($q$update public.leads set customer_notes = 'hi' where id = %L$q$, (select id from l where k = 'ben'))),
  0::bigint, 'estimator cannot edit someone else''s lead');
select tests.assert_raises(
  format($q$update public.leads set owner_id = %L where id = %L$q$, (select id from u where k = 'est2'), (select id from l where k = 'ella')),
  'estimator cannot reassign a lead', '42501');
select tests.assert_raises(
  format($q$insert into public.leads (org_id, first_name, mobile, lead_source, owner_id) values (%L, 'Q', '+14255550112', 'website', %L)$q$,
         tests.org_id(), (select id from u where k = 'est2')),
  'estimator cannot create a lead for someone else', '42501');
select tests.assert_eq(
  tests.rows_affected(format($q$insert into public.leads (org_id, first_name, mobile, lead_source, owner_id) values (%L, 'Mine', '+14255550113', 'website', %L)$q$,
         tests.org_id(), (select id from u where k = 'est'))),
  1::bigint, 'estimator can create their own lead');
select tests.assert_raises(
  format($q$update public.leads set status = 'converted' where id = %L$q$, (select id from l where k = 'ella')),
  'leads are only converted through Convert to Job', '42501');
select tests.assert_eq((select count(*) from public.search_records('bellevue')), 0::bigint, 'search hides leads the estimator cannot see');
select tests.assert_eq(((select public.lead_stats()) ->> 'total')::int, 2, 'lead stats count only visible leads');
select tests.assert_raises($$select public.soft_delete_record('leads', (select id from l where k = 'ella'), 'test reason')$$,
  'estimator cannot delete leads', '42501');
select tests.logout();

-- First contact is recorded once
update public.leads set first_contacted_at = now() - interval '1 hour', speed_to_lead_seconds = 300, status = 'contacted'
where id = (select id from l where k = 'ella');
update public.leads set first_contacted_at = now(), speed_to_lead_seconds = 5 where id = (select id from l where k = 'ella');
select tests.assert_eq((select speed_to_lead_seconds from public.leads where id = (select id from l where k = 'ella')), 300,
  'speed-to-lead never changes after the first contact');
select tests.assert_eq((select count(*) from public.activity where subject_id = (select id::text from l where k = 'ella') and type = 'status_changed'),
  1::bigint, 'status changes are on the timeline');

-- team scope = same territory (via a per-user grant) -------------------------------------
update public.profiles set default_territory_id = (select id from t where k = 'kirkland') where id = (select id from u where k = 'est');
insert into public.user_permission_overrides (org_id, user_id, permission, effect, scope, reason)
values (tests.org_id(), (select id from u where k = 'est'), 'leads:read', 'grant', 'team', 'Team scope test');
select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select string_agg(first_name, ',' order by first_name) from public.leads), 'Ella,Kim,Mine',
  'team scope adds leads in the estimator''s territory');
select tests.logout();
delete from public.user_permission_overrides where user_id = (select id from u where k = 'est');

-- office manager (everyone's) -----------------------------------------------------------
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.leads), 5::bigint, 'office manager sees every lead in the org');
select tests.assert_eq((select count(*) from public.leads where org_id = tests.org_id('other-co')), 0::bigint, 'no leads from another org');
select tests.assert_eq(
  tests.rows_affected(format($q$update public.leads set owner_id = %L where id = %L$q$, (select id from u where k = 'est'), (select id from l where k = 'sam'))),
  1::bigint, 'office manager can assign leads');
select tests.assert_eq((select count(*) from public.search_records('4255550102')), 1::bigint, 'search finds leads by phone digits');
select tests.assert_eq((select count(*) from public.search_records('kim@exa')), 1::bigint, 'search finds leads by partial email');
select public.soft_delete_record('leads', (select id from l where k = 'kim'), 'Duplicate of another lead');
select tests.assert_eq((select count(*) from public.leads where id = (select id from l where k = 'kim')), 0::bigint, 'deleted leads disappear');
select tests.assert_eq((select count(*) from public.list_deleted_records() where table_name = 'leads'), 1::bigint,
  'deleted leads show in Deleted Records');
select public.restore_record('leads', (select id from l where k = 'kim'));
select tests.assert_eq((select count(*) from public.leads where id = (select id from l where k = 'kim')), 1::bigint, 'leads can be restored');
select tests.logout();

-- bookkeeper (read everything, edit nothing) -------------------------------------------
select tests.login((select id from u where k = 'books'));
select tests.assert_eq((select count(*) from public.leads), 5::bigint, 'bookkeeper reads all leads');
select tests.assert_eq(tests.rows_affected($$update public.leads set customer_notes = 'x'$$), 0::bigint, 'bookkeeper cannot edit leads');
select tests.logout();

-- other org owner --------------------------------------------------------------------
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.leads), 1::bigint, 'the other company sees only its own lead');
select tests.assert_raises(
  format($q$insert into public.leads (org_id, first_name, mobile, lead_source) values (%L, 'Sneaky', '+14255550120', 'website')$q$, (select a from o)),
  'cannot create a lead in another org', '42501');
select tests.logout();

-- Accounts, contacts, properties, access codes ----------------------------------------------
select tests.login((select id from u where k = 'office'));
insert into public.accounts (org_id, display_name, owner_id) values (tests.org_id(), 'Smith Residence', (select id from u where k = 'est2'));
insert into public.contacts (org_id, account_id, first_name, last_name, mobile, sms_opt_in, sms_opt_in_source)
select tests.org_id(), id, 'Jane', 'Smith', '+14255550130', true, 'Website form' from public.accounts where display_name = 'Smith Residence';
insert into public.properties (org_id, account_id, is_primary, street, city, zip, year_built)
select tests.org_id(), id, true, '1 Main St', 'Kirkland', '98033', 1965 from public.accounts where display_name = 'Smith Residence';
select tests.assert((select sms_opt_in_at is not null from public.contacts where first_name = 'Jane'), 'SMS consent records when');
select tests.assert((select lead_safe_required from public.properties where street = '1 Main St'), 'a 1965 home needs lead-safe prep');
select tests.assert_eq((select territory_id from public.accounts where display_name = 'Smith Residence'), (select id from t where k = 'kirkland'),
  'the account takes its primary property''s territory');
insert into public.property_secrets (property_id, org_id, access_code_ciphertext)
select id, tests.org_id(), 'v1:aaaa:bbbb:cccc' from public.properties where street = '1 Main St';
select tests.assert_eq((select count(*) from public.property_secrets), 1::bigint, 'office manager can store and read access codes');
update public.contacts set do_not_contact = true where first_name = 'Jane';
select tests.assert((select not sms_opt_in from public.contacts where first_name = 'Jane'), 'Do Not Contact clears SMS consent');
select tests.logout();
select tests.assert_eq((select count(*) from public.audit_log where table_name = 'public.property_secrets' and after ? 'access_code_ciphertext'),
  0::bigint, 'access codes never enter the audit log');

select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.accounts), 0::bigint, 'estimator does not see accounts they do not own');
select tests.assert_eq((select count(*) from public.contacts), 0::bigint, 'contacts follow their account');
select tests.assert_eq((select count(*) from public.properties), 0::bigint, 'properties follow their account');
select tests.logout();
select tests.login((select id from u where k = 'est2'));
select tests.assert_eq((select count(*) from public.contacts), 1::bigint, 'the account owner sees its contacts');
select tests.assert_eq((select count(*) from public.property_secrets), 0::bigint, 'estimators cannot read access codes');
select tests.logout();

-- Notes, comments, mentions, notifications ------------------------------------------------
select tests.login((select id from u where k = 'office'));
insert into public.notes (org_id, subject_type, subject_id, body) values (tests.org_id(), 'lead', (select id from l where k = 'ben'), 'Gate code is on the account.');
insert into public.comments (org_id, subject_type, subject_id, body, mentions)
values (tests.org_id(), 'lead', (select id from l where k = 'ben'), 'Can you call back today?', array[(select id from u where k = 'est2')]);
select tests.assert_raises(
  format($q$insert into public.comments (org_id, subject_type, subject_id, body, mentions) values (%L, 'lead', %L, 'x', array[%L::uuid])$q$,
         tests.org_id(), (select id from l where k = 'ben'), (select id from u where k = 'other_owner')),
  'cannot mention someone from another company', '23514');
select tests.assert_raises(
  format($q$insert into public.notes (org_id, subject_type, subject_id, body) values (%L, 'lead', %L, 'x')$q$, tests.org_id(), (select id from l where k = 'other')),
  'cannot attach a note to another org''s lead', '42501');
select tests.logout();

select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.notes), 0::bigint, 'notes follow lead visibility');
select tests.assert_eq((select count(*) from public.comments), 0::bigint, 'comments follow lead visibility');
select tests.assert_eq((select count(*) from public.activity where subject_id = (select id::text from l where k = 'ben')), 0::bigint,
  'timeline entries follow lead visibility');
select tests.assert_eq((select count(*) from public.notifications), 0::bigint, 'people only see their own notifications');
select tests.logout();

select tests.login((select id from u where k = 'est2'));
select tests.assert_eq((select count(*) from public.notifications where type = 'mention'), 1::bigint, 'a mention notifies the person mentioned');
select tests.assert_eq(tests.rows_affected($$update public.notifications set read_at = now()$$), 1::bigint, 'people can mark their notifications read');
select tests.assert_raises($$update public.notifications set title = 'changed'$$, 'notification text cannot be changed', '42501');
select tests.assert_eq(tests.rows_affected($$update public.notes set body = 'edited'$$), 0::bigint, 'only the author edits a note');
select tests.assert(
  (select last_activity_at > now() - interval '1 minute' from public.leads where id = (select id from l where k = 'ben')),
  'notes and comments count as lead activity');
select tests.logout();

-- Tasks ---------------------------------------------------------------------------------
select tests.login((select id from u where k = 'office'));
insert into public.tasks (org_id, subject_type, subject_id, title, assignee_id, due_at)
values (tests.org_id(), 'lead', (select id from l where k = 'ella'), 'Call Ella back', (select id from u where k = 'est'), now() + interval '1 day');
select tests.logout();
select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.tasks), 1::bigint, 'assignees see their tasks');
update public.tasks set status = 'done' where title = 'Call Ella back';
select tests.assert((select completed_at is not null and completed_by = (select id from u where k = 'est') from public.tasks where title = 'Call Ella back'),
  'completing a task records who and when');
select tests.logout();
select tests.login((select id from u where k = 'est2'));
select tests.assert_eq((select count(*) from public.tasks), 0::bigint, 'other estimators do not see the task');
select tests.logout();

-- Messages --------------------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
select tests.assert_raises(
  format($q$insert into public.messages (org_id, channel, direction, subject_type, subject_id, body, status) values (%L, 'sms', 'outbound', 'lead', %L, 'Hi', 'simulated')$q$,
         tests.org_id(), (select id from l where k = 'ella')),
  'texts must go through the outbox', '42501');
insert into public.messages (org_id, channel, direction, subject_type, subject_id, body, call_outcome, status)
values (tests.org_id(), 'call', 'outbound', 'lead', (select id from l where k = 'ella'), 'Left a voicemail', 'left_voicemail', 'logged');
select tests.assert_eq((select sent_by from public.messages where channel = 'call'), (select id from u where k = 'est'), 'calls record who logged them');
select tests.assert_raises($$update public.messages set body = 'changed'$$, 'messages are append-only', '42501');
select tests.logout();
select tests.assert_eq((select count(*) from public.audit_log where table_name = 'public.messages' and after ? 'body'), 0::bigint,
  'message text stays out of the audit log');

-- Saved views and scoring rules -------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
insert into public.saved_views (org_id, user_id, module, name, config) values (tests.org_id(), (select id from u where k = 'est'), 'leads', 'My hot leads', '{"chips":["hot"]}');
insert into public.saved_views (org_id, user_id, module, name, shared, config) values (tests.org_id(), (select id from u where k = 'est'), 'leads', 'Team view', true, '{}');
select tests.assert_eq((select count(*) from public.lead_scoring_rules), 14::bigint, 'everyone can read the scoring rules');
select tests.assert_eq(tests.rows_affected($$update public.lead_scoring_rules set points = 50$$), 0::bigint, 'estimators cannot change scoring rules');
select tests.logout();
select tests.login((select id from u where k = 'est2'));
select tests.assert_eq((select string_agg(name, ',') from public.saved_views), 'Team view', 'shared views are visible; personal ones are not');
select tests.assert_eq(tests.rows_affected($$update public.saved_views set name = 'Hijacked'$$), 0::bigint, 'only the owner edits a view');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq(tests.rows_affected($$update public.lead_scoring_rules set points = 12 where factor = 'in_service_area'$$), 1::bigint,
  'owners can change scoring rules');
select tests.logout();

-- Intake bookkeeping and rate limits are server-only ------------------------------------------
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises($$select count(*) from public.intake_requests$$, 'clients cannot read intake requests', '42501');
select tests.assert_raises($$select count(*) from public.rate_limits$$, 'clients cannot read rate limits', '42501');
select tests.assert_raises($$select app.consume_rate_limit('x', 1, 60)$$, 'clients cannot use the rate limiter', '42501');
select tests.logout();
select tests.login_service();
select tests.assert(app.consume_rate_limit('test-bucket', 2, 60), 'first hit is allowed');
select tests.assert(app.consume_rate_limit('test-bucket', 2, 60), 'second hit is allowed');
select tests.assert(not app.consume_rate_limit('test-bucket', 2, 60), 'third hit in the window is refused');
select tests.logout();

rollback;
