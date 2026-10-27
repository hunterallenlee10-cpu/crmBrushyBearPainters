-- Phase 10: Hardening — Module Manager (definitions, values, validation rules,
-- layouts), Data Import and Bulk Update (preview → apply → revert, conflicts),
-- reversible merges, export log kinds, Help Center, commissions (off by
-- default, own vs all), demo-data purge, gate codes for the crew on site
-- today, Job Recovery facts; row security per role and across companies.
begin;

insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));
select app.seed_help_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('books', tests.make_user('books@test.bb', 'bookkeeper')),
  ('ro', tests.make_user('ro@test.bb', 'read_only')),
  ('est', tests.make_user('est@test.bb', 'estimator')),
  ('est2', tests.make_user('est2@test.bb', 'estimator')),
  ('lead', tests.make_user('lead@test.bb', 'project_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter')),
  ('painter2', tests.make_user('painter2@test.bb', 'painter')),
  ('other_owner', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co')));
grant select on u to authenticated, service_role;
create temp table r (k text primary key, id uuid) on commit drop;
grant select, insert, update on r to authenticated, service_role;

-- Fixture records (as postgres).
with a as (insert into public.accounts (org_id, display_name, tags) values (tests.org_id(), 'Alder Residence', '{vip}') returning id)
insert into r select 'acct_a', id from a;
with a as (insert into public.accounts (org_id, display_name, tags, notes) values (tests.org_id(), 'Alder Home', '{repeat}', 'Dup') returning id)
insert into r select 'acct_b', id from a;
with c as (insert into public.contacts (org_id, account_id, first_name, last_name, email)
           values (tests.org_id(), (select id from r where k = 'acct_a'), 'Ada', 'Alder', 'ada@x.test') returning id)
insert into r select 'con_a', id from c;
with c as (insert into public.contacts (org_id, account_id, first_name, last_name, email, do_not_contact)
           values (tests.org_id(), (select id from r where k = 'acct_b'), 'Ada', 'Alder', 'ada.alder@x.test', true) returning id)
insert into r select 'con_b', id from c;
with p as (insert into public.properties (org_id, account_id, street, city, zip)
           values (tests.org_id(), (select id from r where k = 'acct_b'), '1 Fir St', 'Kirkland', '98033') returning id)
insert into r select 'prop_b', id from p;
with j as (insert into public.jobs (org_id, name, account_id, property_id, primary_contact_id, work_types, owner_id)
           values (tests.org_id(), 'Alder – Kirkland – Interior', (select id from r where k = 'acct_b'), (select id from r where k = 'prop_b'),
                   (select id from r where k = 'con_b'), '{interior}', (select id from u where k = 'est')) returning id)
insert into r select 'job_b', id from j;
with l as (insert into public.leads (org_id, first_name, last_name, email, zip, status, lead_source, owner_id)
           values (tests.org_id(), 'Lee', 'One', 'lee1@x.test', '98004', 'new', 'website', (select id from u where k = 'est')) returning id)
insert into r select 'lead1', id from l;
with l as (insert into public.leads (org_id, first_name, last_name, email, zip, status, lead_source, owner_id)
           values (tests.org_id(), 'Lee', 'Two', 'lee2@x.test', '98004', 'new', 'website', (select id from u where k = 'est')) returning id)
insert into r select 'lead2', id from l;
insert into public.notes (org_id, subject_type, subject_id, body)
values (tests.org_id(), 'account', (select id from r where k = 'acct_b'), 'Gate sticks in the rain');

-- =============================================================================
-- 1. Module Manager
-- =============================================================================

select tests.login((select id from u where k = 'owner'));
insert into public.custom_field_definitions (org_id, module, api_name, label, field_type, options)
values (tests.org_id(), 'leads', 'paint_brand_pref', 'Preferred paint brand', 'picklist',
        '[{"value": "sw", "label": "Sherwin-Williams"}, {"value": "bm", "label": "Benjamin Moore"}]');
insert into public.custom_field_definitions (org_id, module, api_name, label, field_type)
values (tests.org_id(), 'leads', 'rooms', 'Rooms', 'number'),
       (tests.org_id(), 'leads', 'gate_photo', 'Gate photo link', 'url'),
       (tests.org_id(), 'leads', 'hoa_deadline', 'HOA deadline', 'date'),
       (tests.org_id(), 'jobs', 'permit_no', 'Permit number', 'text');
select tests.assert_raises($q$insert into public.custom_field_definitions (org_id, module, api_name, label, field_type)
  values (app.current_org_id(), 'leads', 'bad_pick', 'Bad', 'picklist')$q$, 'a picklist needs options', '23514');
select tests.assert_raises($q$insert into public.custom_field_definitions (org_id, module, api_name, label, field_type)
  values (app.current_org_id(), 'leads', 'Bad Name', 'Bad', 'text')$q$, 'api names are lowercase identifiers', '23514');
select tests.assert_raises($q$update public.custom_field_definitions set field_type = 'text' where api_name = 'rooms'$q$,
  'a field''s type never changes', '23514');
insert into public.validation_rules (org_id, module, field, rule_type, value, message)
values (tests.org_id(), 'leads', 'cf:rooms', 'max', '40', 'Rooms: 40 at most.'),
       (tests.org_id(), 'leads', 'zip', 'regex', '^\d{5}$', 'ZIP must be 5 digits.'),
       (tests.org_id(), 'leads', 'email', 'required', null, 'Email is required.');
select tests.assert_raises($q$insert into public.validation_rules (org_id, module, field, rule_type, value, message)
  values (app.current_org_id(), 'leads', 'score', 'min', '1', 'x')$q$, 'rules only target the listed fields', '23514');
select tests.assert_raises($q$insert into public.validation_rules (org_id, module, field, rule_type, value, message)
  values (app.current_org_id(), 'leads', 'zip', 'regex', '([', 'x')$q$, 'an invalid pattern is refused', '23514');
insert into public.module_layouts (org_id, module, sections)
values (tests.org_id(), 'jobs', '[{"key": "overview", "visible": true}, {"key": "photos", "visible": false}]');
select tests.assert_raises($q$update public.module_layouts set sections = '[{"key": "overview"}]' where module = 'jobs'$q$,
  'layout sections need a visible flag', '23514');

-- Values: checked on people's writes.
update public.leads set custom_field_values = '{"paint_brand_pref": "sw", "rooms": 6, "hoa_deadline": "2026-11-01"}'
where id = (select id from r where k = 'lead1');
select tests.assert_eq((select custom_field_values ->> 'paint_brand_pref' from public.leads where id = (select id from r where k = 'lead1')),
  'sw', 'a valid custom value is saved');
select tests.assert_raises(format($q$update public.leads set custom_field_values = '{"paint_brand_pref": "ppg"}' where id = %L$q$,
  (select id from r where k = 'lead1')), 'a picklist value must be one of the options', '23514');
select tests.assert_raises(format($q$update public.leads set custom_field_values = '{"rooms": "six"}' where id = %L$q$,
  (select id from r where k = 'lead1')), 'a number field takes numbers', '23514');
select tests.assert_raises(format($q$update public.leads set custom_field_values = '{"nope": 1}' where id = %L$q$,
  (select id from r where k = 'lead1')), 'unknown custom fields are refused', '23514');
select tests.assert_raises(format($q$update public.leads set custom_field_values = '{"gate_photo": "javascript:alert(1)"}' where id = %L$q$,
  (select id from r where k = 'lead1')), 'URL fields take http(s) links only', '23514');
select tests.assert_raises(format($q$update public.leads set custom_field_values = custom_field_values || '{"rooms": 41}' where id = %L$q$,
  (select id from r where k = 'lead1')), 'a max rule on a custom field is enforced', '23514');
select tests.assert_raises(format($q$update public.leads set zip = '980' where id = %L$q$,
  (select id from r where k = 'lead1')), 'a regex rule on a standard field is enforced', '23514');
select tests.assert_raises(format($q$update public.leads set email = null where id = %L$q$,
  (select id from r where k = 'lead1')), 'a required field can''t be cleared', '23514');
update public.leads set first_name = 'Leo' where id = (select id from r where k = 'lead1');
select tests.assert_eq((select first_name from public.leads where id = (select id from r where k = 'lead1')), 'Leo',
  'rules only check the fields a write changes');
select tests.logout();

-- Trusted code (website intake) is never blocked by an office rule.
select tests.login_service();
insert into public.leads (org_id, first_name, email, zip, status, lead_source, custom_field_values)
values (tests.org_id(), 'Web', 'web@x.test', '98004', 'new', 'website', '{"rooms": 99}');
select tests.assert_eq((select count(*) from public.leads where first_name = 'Web' and custom_field_values ->> 'rooms' = '99'), 1::bigint,
  'service-role inserts skip validation rules');
select tests.logout();

-- Who reads and writes the definitions.
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.custom_field_definitions), 5::bigint, 'everyone reads the field definitions');
select tests.assert_raises($q$insert into public.custom_field_definitions (org_id, module, api_name, label, field_type)
  values (app.current_org_id(), 'leads', 'x1', 'X', 'text')$q$, 'a painter can''t add fields', '42501');
select tests.logout();
select tests.login((select id from u where k = 'est'));
select tests.assert_eq(tests.rows_affected($q$update public.custom_field_definitions set label = 'Hacked'$q$), 0::bigint,
  'an estimator can''t edit field definitions');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.custom_field_definitions), 0::bigint, 'another company sees none of our fields');
select tests.assert_eq((select count(*) from public.validation_rules), 0::bigint, 'another company sees none of our rules');
select tests.logout();

-- =============================================================================
-- 2. Bulk Update: preview → apply → revert
-- =============================================================================

select tests.login((select id from u where k = 'owner'));
with b as (insert into public.bulk_updates (org_id, module, source, title, changes, total_rows, changed_rows)
           values (app.current_org_id(), 'leads', 'selection', 'Reassign to est2',
                   jsonb_build_object('owner_id', (select id from u where k = 'est2')), 2, 2) returning id)
insert into r select 'bu', id from b;
insert into public.bulk_update_rows (org_id, bulk_update_id, row_number, record_id, label, before, after)
select app.current_org_id(), (select id from r where k = 'bu'), n, l.id, l.first_name,
       jsonb_build_object('owner_id', l.owner_id, 'custom_field_values', jsonb_build_object('rooms', l.custom_field_values -> 'rooms')),
       jsonb_build_object('owner_id', (select id from u where k = 'est2'), 'custom_field_values', '{"rooms": 3}'::jsonb)
from (select id, first_name, owner_id, custom_field_values, row_number() over (order by email) n
      from public.leads where id in ((select id from r where k = 'lead1'), (select id from r where k = 'lead2'))) l;
select tests.assert_eq((select owner_id from public.leads where id = (select id from r where k = 'lead1')), (select id from u where k = 'est'),
  'a preview changes nothing');
select tests.assert_eq((select public.bulk_update_apply((select id from r where k = 'bu')) ->> 'applied'), '2', 'apply changes every row');
select tests.assert_eq((select count(*) from public.leads where owner_id = (select id from u where k = 'est2')), 2::bigint,
  'both leads now belong to est2');
select tests.assert_eq((select (custom_field_values ->> 'rooms') from public.leads where id = (select id from r where k = 'lead2')), '3',
  'custom values are bulk updated too');
select tests.assert((select count(*) > 0 from public.audit_log where table_name = 'public.leads' and record_id = (select id from r where k = 'lead1')::text
                     and actor_id = (select id from u where k = 'owner')), 'each bulk change is in the audit log as the owner');
select tests.assert_raises(format($q$select public.bulk_update_apply(%L)$q$, (select id from r where k = 'bu')),
  'an applied bulk update can''t be applied again', '23514');
-- Someone edits lead2 afterwards: revert leaves it alone (conflict).
update public.leads set owner_id = (select id from u where k = 'owner') where id = (select id from r where k = 'lead2');
select tests.assert_eq((select public.bulk_update_revert((select id from r where k = 'bu'), 'Wrong rep') ->> 'reverted'), '1',
  'revert restores the untouched row');
select tests.assert_eq((select owner_id from public.leads where id = (select id from r where k = 'lead1')), (select id from u where k = 'est'),
  'lead1 is back with its old owner');
select tests.assert_eq((select custom_field_values ->> 'rooms' from public.leads where id = (select id from r where k = 'lead1')), '6',
  'lead1''s custom value is back too');
select tests.assert_eq((select status from public.bulk_update_rows where record_id = (select id from r where k = 'lead2')), 'conflict',
  'a row changed since the bulk update is a conflict, not overwritten');
select tests.assert_eq((select owner_id from public.leads where id = (select id from r where k = 'lead2')), (select id from u where k = 'owner'),
  'the later edit survives');
-- Stage is never a bulk field.
with b as (insert into public.bulk_updates (org_id, module, source, title, total_rows)
           values (app.current_org_id(), 'jobs', 'selection', 'Sneaky stage', 1) returning id)
insert into r select 'bu2', id from b;
insert into public.bulk_update_rows (org_id, bulk_update_id, row_number, record_id, before, after)
values (app.current_org_id(), (select id from r where k = 'bu2'), 1, (select id from r where k = 'job_b'),
        '{"stage": "walkthrough_scheduled"}', '{"stage": "closed_won"}');
select tests.assert_eq((select public.bulk_update_apply((select id from r where k = 'bu2')) ->> 'failed'), '1',
  'a stage change in a bulk update fails');
select tests.assert_eq((select stage from public.jobs where id = (select id from r where k = 'job_b')), 'walkthrough_scheduled',
  'the job''s stage is unchanged');
select tests.logout();

select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.bulk_updates), 0::bigint, 'an estimator can''t see bulk updates');
select tests.assert_raises(format($q$select public.bulk_update_revert(%L)$q$, (select id from r where k = 'bu2')),
  'an estimator can''t run a bulk update', '42501');
select tests.assert_raises($q$insert into public.imports (org_id, module, file_name) values (app.current_org_id(), 'leads', 'x.csv')$q$,
  'an estimator can''t import', '42501');
select tests.logout();

-- Imports: the review queue follows its import.
select tests.login((select id from u where k = 'owner'));
with i as (insert into public.imports (org_id, module, file_name, headers, total_rows) values (app.current_org_id(), 'leads', 'leads.csv', '{Name,Email}', 1) returning id)
insert into r select 'imp', id from i;
insert into public.import_rows (org_id, import_id, row_number, raw, data, status)
values (app.current_org_id(), (select id from r where k = 'imp'), 1, '{"Name": "Ivy"}', '{"first_name": "Ivy"}', 'valid');
update public.imports set status = 'applied' where id = (select id from r where k = 'imp');
select tests.assert_raises(format($q$insert into public.import_rows (org_id, import_id, row_number, raw) values (app.current_org_id(), %L, 2, '{}')$q$,
  (select id from r where k = 'imp')), 'no rows are added to an applied import', '42501');
select tests.assert_eq(tests.rows_affected(format($q$delete from public.imports where id = %L$q$, (select id from r where k = 'imp'))), 0::bigint,
  'an applied import stays on record');
select tests.logout();

-- =============================================================================
-- 3. Merge Customers (service role after the app's checks), reversible
-- =============================================================================

select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(format($q$select public.merge_customers('accounts', %L, %L)$q$,
  (select id from r where k = 'acct_a'), (select id from r where k = 'acct_b')), 'people can''t call the merge function directly', '42501');
select tests.logout();

select tests.login_service((select id from u where k = 'owner'));
insert into r select 'merge', public.merge_customers('accounts', (select id from r where k = 'acct_a'), (select id from r where k = 'acct_b'),
  '{"notes": "merged", "tags": "union"}', 'Same household');
select tests.assert_eq((select account_id from public.jobs where id = (select id from r where k = 'job_b')), (select id from r where k = 'acct_a'),
  'the merged account''s job moves to the survivor');
select tests.assert_eq((select account_id from public.contacts where id = (select id from r where k = 'con_b')), (select id from r where k = 'acct_a'),
  'its contacts move too');
select tests.assert_eq((select account_id from public.properties where id = (select id from r where k = 'prop_b')), (select id from r where k = 'acct_a'),
  'and its properties');
select tests.assert_eq((select subject_id from public.notes where body = 'Gate sticks in the rain'), (select id from r where k = 'acct_a'),
  'and its notes');
select tests.assert_eq((select notes from public.accounts where id = (select id from r where k = 'acct_a')), 'Dup',
  'a field chosen from the merged record is copied');
select tests.assert_eq((select tags from public.accounts where id = (select id from r where k = 'acct_a')), '{repeat,vip}'::text[],
  'tags can be combined');
select tests.assert((select deleted_at is not null from public.accounts where id = (select id from r where k = 'acct_b')),
  'the merged account is soft-deleted');
select tests.assert_raises(format($q$select public.merge_customers('accounts', %L, %L)$q$,
  (select id from r where k = 'acct_a'), (select id from r where k = 'acct_b')), 'a deleted record can''t be merged again', 'P0002');

-- Contacts: consent keeps the stricter answer; messages move with the merge.
insert into public.messages (org_id, channel, direction, status, body, contact_id, subject_type, subject_id, simulated)
values (tests.org_id(), 'sms', 'outbound', 'simulated', 'Hi', (select id from r where k = 'con_b'), 'job', (select id from r where k = 'job_b'), true);
insert into r select 'cmerge', public.merge_customers('contacts', (select id from r where k = 'con_a'), (select id from r where k = 'con_b'), '{}');
select tests.assert((select do_not_contact from public.contacts where id = (select id from r where k = 'con_a')),
  'Do Not Contact on either contact wins');
select tests.assert_eq((select contact_id from public.messages where body = 'Hi' and subject_id = (select id from r where k = 'job_b')),
  (select id from r where k = 'con_a'), 'messages move to the surviving contact');
select tests.assert_eq((select primary_contact_id from public.jobs where id = (select id from r where k = 'job_b')),
  (select id from r where k = 'con_a'), 'the job''s primary contact moves');
select tests.assert_raises(format($q$select public.undo_merge(%L)$q$, (select id from r where k = 'merge')),
  'the earlier merge waits until the later one is undone', '23514');
select public.undo_merge((select id from r where k = 'cmerge'), 'Different people');
select public.undo_merge((select id from r where k = 'merge'), 'Different households');
select tests.logout();
select tests.assert_eq((select account_id from public.jobs where id = (select id from r where k = 'job_b')), (select id from r where k = 'acct_b'),
  'undo moves the job back');
select tests.assert_eq((select primary_contact_id from public.jobs where id = (select id from r where k = 'job_b')), (select id from r where k = 'con_b'),
  'undo moves the primary contact back');
select tests.assert_eq((select contact_id from public.messages where body = 'Hi' and subject_id = (select id from r where k = 'job_b')),
  (select id from r where k = 'con_b'), 'undo moves the message back');
select tests.assert((select not do_not_contact from public.contacts where id = (select id from r where k = 'con_a')),
  'undo restores the survivor''s own consent');
select tests.assert_eq((select (notes, tags) from public.accounts where id = (select id from r where k = 'acct_a')), (null::text, '{vip}'::text[]),
  'undo restores the survivor''s fields');
select tests.assert((select deleted_at is null from public.accounts where id = (select id from r where k = 'acct_b')),
  'undo restores the merged account');
select tests.assert_eq((select subject_id from public.notes where body = 'Gate sticks in the rain'), (select id from r where k = 'acct_b'),
  'undo moves the note back');
select tests.assert_raises($q$update public.messages set body = 'edited' where body = 'Hi'$q$, 'messages still can''t be edited', '42501');

select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.record_merges), 0::bigint, 'an estimator can''t see merges');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.record_merges), 0::bigint, 'the office manager can''t see merges (no records:merge)');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq((select count(*) from public.record_merges), 2::bigint, 'owners see the merge history');
select tests.logout();

-- =============================================================================
-- 4. Export log kinds
-- =============================================================================

select tests.login((select id from u where k = 'books'));
select tests.assert((select public.log_export('list', 'leads', 'Lead List', 12, '{"tab": "all"}') is not null),
  'list exports are logged');
select tests.assert((select public.log_export('audit_log', 'audit_log', 'Audit Log', 40) is not null), 'audit-log exports are logged');
select tests.logout();
select tests.login((select id from u where k = 'est'));
select tests.assert_raises($q$select public.log_export('list', 'leads', 'Lead List', 3)$q$, 'an estimator can''t export', '42501');
select tests.logout();

-- =============================================================================
-- 5. Help Center
-- =============================================================================

select tests.assert_eq((select count(*) from public.kb_articles where org_id = tests.org_id() and status = 'published' and seed_key is not null),
  10::bigint, 'ten how-to articles are seeded and published');
select tests.login((select id from u where k = 'owner'));
insert into public.kb_articles (org_id, slug, title, body, status, tags)
values (app.current_org_id(), 'draft-tip', 'Draft tip', 'Not ready', 'draft', array['Tips', ' tips ', '']);
select tests.assert_eq((select tags from public.kb_articles where slug = 'draft-tip'), '{tips}'::text[], 'tags are cleaned');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.kb_articles), 10::bigint, 'crew read published articles only');
select tests.assert_eq((select count(*) from public.kb_articles where search @@ websearch_to_tsquery('english', 'daily log cleanup')), 1::bigint,
  'search finds the daily log article');
select public.kb_article_viewed((select id from public.kb_articles where seed_key = 'submit_daily_log'));
select public.kb_article_viewed((select id from public.kb_articles where seed_key = 'submit_daily_log'));
select tests.assert_eq((select view_count from public.kb_article_stats s join public.kb_articles a on a.id = s.article_id
                        where a.seed_key = 'submit_daily_log'), 2, 'reads are counted');
select tests.assert_raises($q$insert into public.kb_articles (org_id, slug, title) values (app.current_org_id(), 'x', 'x')$q$,
  'crew can''t write articles', '42501');
select tests.assert_raises($q$insert into public.kb_article_stats (article_id, org_id) values (gen_random_uuid(), app.current_org_id())$q$,
  'read counts are only written by the function', '42501');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq((select count(*) from public.kb_articles), 11::bigint, 'owners see drafts too');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.kb_articles where slug = 'draft-tip'), 0::bigint, 'another company sees none of our drafts');
select tests.assert_eq((select count(*) from public.kb_article_stats), 0::bigint, 'nor our read counts');
select tests.logout();

-- =============================================================================
-- 6. Commissions: off by default; your own entries unless you see everyone's
-- =============================================================================

select tests.assert((select not enabled from public.commission_settings where org_id = tests.org_id()), 'commissions start disabled');
select tests.login((select id from u where k = 'owner'));
update public.commission_settings set enabled = true, review_threshold_cents = 500000 where org_id = app.current_org_id();
with p as (insert into public.commission_plans (org_id, name, role_template_id, company_rate_percent, self_rate_percent)
           values (app.current_org_id(), 'Estimators', (select id from public.role_templates where org_id = app.current_org_id() and key = 'estimator'), 5, 8)
           returning id)
insert into r select 'plan', id from p;
insert into public.commission_entries (org_id, job_id, user_id, plan_id, source_kind, basis_cents, rate_percent, amount_cents, status)
values (app.current_org_id(), (select id from r where k = 'job_b'), (select id from u where k = 'est'), (select id from r where k = 'plan'), 'company', 1000000, 5, 50000, 'pending'),
       (app.current_org_id(), (select id from r where k = 'job_b'), (select id from u where k = 'est2'), (select id from r where k = 'plan'), 'company', 1000000, 5, 50000, 'pending');
insert into public.commission_adjustments (org_id, user_id, kind, amount_cents, reason)
values (app.current_org_id(), (select id from u where k = 'est'), 'bonus', 10000, 'Spring referral push bonus');
update public.commission_entries set status = 'paid', approved_at = now(), approved_by = auth.uid(), paid_on = current_date
where user_id = (select id from u where k = 'est2');
select tests.assert_raises($q$update public.commission_entries set amount_cents = 1 where status = 'paid'$q$,
  'a paid commission can''t change', '42501');
select tests.assert_raises($q$delete from public.commission_entries where status = 'paid'$q$, 'a paid commission stays on record', '42501');
select tests.logout();
select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.commission_entries), 1::bigint, 'an estimator sees only their own commission');
select tests.assert_eq((select count(*) from public.commission_adjustments), 1::bigint, 'and their own adjustments');
select tests.assert_eq((select count(*) from public.commission_plans), 1::bigint, 'and the plans');
select tests.assert_eq(tests.rows_affected($q$update public.commission_entries set amount_cents = 999999$q$), 0::bigint,
  'an estimator can''t change a commission');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.commission_entries), 0::bigint, 'the office manager sees no commissions');
select tests.assert_eq((select count(*) from public.commission_settings), 0::bigint, 'nor the commission settings');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.commission_entries), 0::bigint, 'crew see no commissions');
select tests.logout();

-- =============================================================================
-- 7. Gate / lockbox codes: the crew on site today
-- =============================================================================

with c as (insert into public.crews (org_id, name, lead_user_id) values (tests.org_id(), 'Crew Alder', (select id from u where k = 'lead')) returning id)
insert into r select 'crew', id from c;
insert into public.crew_members (org_id, crew_id, user_id, role)
values (tests.org_id(), (select id from r where k = 'crew'), (select id from u where k = 'painter'), 'painter');
insert into public.property_secrets (org_id, property_id, access_code_ciphertext)
values (tests.org_id(), (select id from r where k = 'prop_b'), 'v1:aaaa:bbbb:cccc');
select set_config('app.system_update', 'on', true);
insert into public.schedule_entries (org_id, job_id, status, crew_id, starts_on, ends_on, published_at)
values (tests.org_id(), (select id from r where k = 'job_b'), 'published', (select id from r where k = 'crew'),
        app.production_today() + 3, app.production_today() + 4, now());
select set_config('app.system_update', 'off', true);
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.property_secrets), 0::bigint, 'the crew can''t read the code before their scheduled day');
select tests.logout();
update public.schedule_entries set starts_on = app.production_today(), ends_on = app.production_today() + 1
where job_id = (select id from r where k = 'job_b');
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.property_secrets), 1::bigint, 'a crew member scheduled there today reads the code');
select tests.logout();
select tests.login((select id from u where k = 'lead'));
select tests.assert_eq((select count(*) from public.property_secrets), 1::bigint, 'so does the crew lead');
select tests.logout();
select tests.login((select id from u where k = 'painter2'));
select tests.assert_eq((select count(*) from public.property_secrets), 0::bigint, 'a painter on another crew doesn''t');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.property_secrets), 1::bigint, 'the office keeps its access');
select tests.logout();
select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.property_secrets), 0::bigint, 'an estimator without the permission doesn''t');
select tests.logout();

-- =============================================================================
-- 8. Job Recovery facts (service role)
-- =============================================================================

select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(format($q$select * from public.job_recovery_scan(%L)$q$, tests.org_id()),
  'people can''t call the recovery scan directly', '42501');
select tests.logout();
select tests.login_service();
select tests.assert((select count(*) >= 1 from public.job_recovery_scan(tests.org_id()) where job_id = (select id from r where k = 'job_b')),
  'the scan lists open jobs');
select tests.assert((select milestones ? 'estimate_sent_at' from public.job_recovery_scan(tests.org_id()) where job_id = (select id from r where k = 'job_b')),
  'with their milestones');
select tests.assert_eq((select count(*) from public.job_recovery_scan(tests.org_id('other-co'))), 0::bigint, 'one company at a time');
select tests.logout();

-- =============================================================================
-- 9. Demo data purge: only is_demo records (and what hangs off them)
-- =============================================================================

with a as (insert into public.accounts (org_id, display_name, is_demo) values (tests.org_id(), 'Demo Residence', true) returning id)
insert into r select 'd_acct', id from a;
with c as (insert into public.contacts (org_id, account_id, first_name, is_demo) values (tests.org_id(), (select id from r where k = 'd_acct'), 'Demo', true) returning id)
insert into r select 'd_con', id from c;
with p as (insert into public.properties (org_id, account_id, street, city, zip, is_demo) values (tests.org_id(), (select id from r where k = 'd_acct'), '9 Demo Way', 'Redmond', '98052', true) returning id)
insert into r select 'd_prop', id from p;
with l as (insert into public.leads (org_id, first_name, email, zip, status, lead_source, account_id, contact_id, is_demo)
           values (tests.org_id(), 'Demo', 'demo@x.test', '98052', 'converted', 'website', (select id from r where k = 'd_acct'), (select id from r where k = 'd_con'), true) returning id)
insert into r select 'd_lead', id from l;
with j as (insert into public.jobs (org_id, name, account_id, property_id, primary_contact_id, lead_id, work_types, is_demo)
           values (tests.org_id(), 'Demo – Redmond – Exterior', (select id from r where k = 'd_acct'), (select id from r where k = 'd_prop'),
                   (select id from r where k = 'd_con'), (select id from r where k = 'd_lead'), '{exterior}', true) returning id)
insert into r select 'd_job', id from j;
update public.leads set converted_job_id = (select id from r where k = 'd_job') where id = (select id from r where k = 'd_lead');
insert into public.job_financials (job_id, org_id, contract_baseline_cents) values ((select id from r where k = 'd_job'), tests.org_id(), 400000);
select tests.login_service((select id from u where k = 'owner'));
insert into r select 'd_inv', public.create_invoice((select id from r where k = 'd_job'), 'deposit', '[{"description": "Deposit", "unit_price_cents": 100000}]'::jsonb);
insert into r select 'd_pay', public.record_payment((select id from r where k = 'd_job'), 'check', 100000, app.production_today(),
  jsonb_build_array(jsonb_build_object('invoice_id', (select id from r where k = 'd_inv'), 'amount_cents', 100000)));
insert into public.notes (org_id, subject_type, subject_id, body, is_demo) values (tests.org_id(), 'job', (select id from r where k = 'd_job'), 'Demo note', true);
insert into public.messages (org_id, channel, direction, status, body, contact_id, subject_type, subject_id, simulated, is_demo)
values (tests.org_id(), 'sms', 'outbound', 'simulated', 'Demo text', (select id from r where k = 'd_con'), 'job', (select id from r where k = 'd_job'), true, true);
with c as (insert into public.crews (org_id, name, is_demo) values (tests.org_id(), 'Demo Crew', true) returning id)
insert into r select 'd_crew', id from c;
select tests.assert_eq((select (public.demo_data_counts(tests.org_id()) ->> 'jobs')::int), 1, 'demo records are counted');
select tests.logout();

select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(format($q$select public.purge_demo_data(%L)$q$, tests.org_id()), 'people can''t call the purge directly', '42501');
select tests.logout();

create temp table before_counts on commit drop as
  select (select count(*) from public.jobs where not is_demo) jobs, (select count(*) from public.leads where not is_demo) leads,
         (select count(*) from public.accounts where not is_demo) accounts, (select count(*) from public.contacts where not is_demo) contacts;
select tests.login_service((select id from u where k = 'owner'));
select tests.assert_eq((select (public.purge_demo_data(tests.org_id()) ->> 'jobs')::int), 1, 'the purge removes the demo job');
select tests.logout();
select tests.assert_eq((select count(*) from public.jobs where is_demo) + (select count(*) from public.leads where is_demo)
                     + (select count(*) from public.accounts where is_demo) + (select count(*) from public.contacts where is_demo)
                     + (select count(*) from public.properties where is_demo) + (select count(*) from public.crews where is_demo), 0::bigint,
  'no demo records are left');
select tests.assert_eq((select count(*) from public.payments where id = (select id from r where k = 'd_pay')), 0::bigint, 'demo payments are gone');
select tests.assert_eq((select count(*) from public.invoices where id = (select id from r where k = 'd_inv')), 0::bigint, 'demo invoices are gone');
select tests.assert_eq((select count(*) from public.notes where body = 'Demo note'), 0::bigint, 'notes on demo records are gone');
select tests.assert_eq((select count(*) from public.messages where body = 'Demo text'), 0::bigint, 'messages on demo records are gone');
select tests.assert_eq((select (jobs, leads, accounts, contacts) from before_counts),
  ((select count(*) from public.jobs), (select count(*) from public.leads), (select count(*) from public.accounts), (select count(*) from public.contacts)),
  'real records are untouched');

rollback;
