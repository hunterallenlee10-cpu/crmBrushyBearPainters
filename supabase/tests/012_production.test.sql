-- Phase 6: production — resources, schedule drafts and publish, gates 6–9,
-- daily logs, hours, punch list and sign-off, rain delays and on-time credits,
-- per role and across organizations.
begin;

insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));
select app.seed_production_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('lead', tests.make_user('lead@test.bb', 'project_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter')),
  ('painter2', tests.make_user('painter2@test.bb', 'painter')),
  ('books', tests.make_user('books@test.bb', 'bookkeeper')),
  ('other_owner', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co')));
grant select on u to authenticated, service_role;
create temp table r (k text primary key, id uuid) on commit drop;
grant select, insert on r to authenticated, service_role;

with a as (insert into public.accounts (org_id, display_name) values (tests.org_id(), 'Park Residence') returning id)
insert into r select 'acct', id from a;
with p as (
  insert into public.properties (org_id, account_id, is_primary, street, city, zip, year_built, stories)
  values (tests.org_id(), (select id from r where k = 'acct'), true, '9 Hill Rd', 'Redmond', '98052', 1995, 2) returning id
) insert into r select 'prop', id from p;
with j as (
  insert into public.jobs (org_id, name, account_id, property_id, work_types, owner_id)
  values (tests.org_id(), 'Park – Redmond – Interior', (select id from r where k = 'acct'), (select id from r where k = 'prop'),
          '{interior}', (select id from u where k = 'office')) returning id
) insert into r select 'job', id from j;
with j as (
  insert into public.jobs (org_id, name, account_id, work_types)
  values (tests.org_id(), 'Park – Redmond – Cabinets', (select id from r where k = 'acct'), '{cabinets}') returning id
) insert into r select 'job2', id from j;
select set_config('app.stage_change', 'on', true);
update public.jobs set stage = 'ready_to_schedule' where id = (select id from r where k = 'job');
select set_config('app.stage_change', 'off', true);

-- Configuration ---------------------------------------------------------------------------------
select tests.assert_eq((select count(*) from public.skills where org_id = tests.org_id()), 8::bigint, 'eight skills are seeded');
select tests.assert_eq((select count(*) from public.work_types where org_id = tests.org_id()), 12::bigint, 'twelve scheduling work types are seeded');
select tests.assert_eq((select default_minutes from public.work_types where org_id = tests.org_id() and key = 'final_walkthrough'), 45,
  'Final Walkthrough defaults to 45 minutes');
select tests.assert_eq((select count(*) from public.work_rules where org_id = tests.org_id()), 11::bigint, 'work rules are seeded');
select tests.assert_eq((select count(*) from public.checklist_templates where org_id = tests.org_id()), 8::bigint, 'checklist templates are seeded');
select tests.assert((select recommendations_require_approval and not recommendations_auto_execute and undo_window_minutes = 15
                     from public.schedule_settings where org_id = tests.org_id()),
  'recommendations need approval, never run on their own, 15-minute undo');
select tests.assert_raises(
  format($q$update public.schedule_settings set recommendations_auto_execute = true where org_id = %L$q$, tests.org_id()),
  'auto-execute cannot be on while approval is required', '23514');

select tests.login((select id from u where k = 'painter'));
select tests.assert((select count(*) = 11 from public.work_rules), 'crews read the work rules');
select tests.assert_eq(tests.rows_affected($q$update public.work_rules set enabled = false$q$), 0::bigint,
  'a painter cannot change work rules');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert_eq(tests.rows_affected($q$update public.work_rules set enabled = false where key = 'exterior_in_season'$q$), 0::bigint,
  'Schedule Admin needs settings:manage (owners)');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq(tests.rows_affected($q$update public.work_rules set params = '{"rain_percent": 70}' where key = 'weather_forecast'$q$), 1::bigint,
  'owners edit work rules');
select tests.assert_raises($q$update public.work_rules set key = 'other' where key = 'weather_forecast'$q$,
  'a rule key never changes', null);
select tests.logout();

-- Subcontractors: status follows the paperwork ---------------------------------------------------
select tests.login((select id from u where k = 'office'));
with s as (
  insert into public.subcontractors (org_id, company_name, lni_registration, lni_expires_on, coi_expires_on, w9_on_file)
  values (tests.org_id(), 'Cedar Brush LLC', 'CEDARBL123AB', current_date + 400, current_date + 400, true) returning id
) insert into r select 'sub', id from s;
select tests.assert_eq((select status from public.subcontractors where id = (select id from r where k = 'sub')), 'active',
  'current paperwork: active');
update public.subcontractors set coi_expires_on = current_date + 10 where id = (select id from r where k = 'sub');
select tests.assert_eq((select status from public.subcontractors where id = (select id from r where k = 'sub')), 'expiring',
  'insurance expiring within 30 days: expiring');
select tests.assert_raises(
  format($q$update public.subcontractors set status = 'suspended' where id = %L$q$, (select id from r where k = 'sub')),
  'suspending needs a reason', '23514');
update public.subcontractors set status = 'suspended', suspended_reason = 'COI lapsed' where id = (select id from r where k = 'sub');
select tests.assert_eq((select status from public.subcontractors where id = (select id from r where k = 'sub')), 'suspended',
  'a person can suspend a subcontractor');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.subcontractor_documents), 0::bigint, 'crews cannot see compliance paperwork');
select tests.assert_raises(
  format($q$insert into public.subcontractors (org_id, company_name) values (%L, 'X')$q$, tests.org_id()),
  'a painter cannot add subcontractors', '42501');
select tests.logout();

-- Crews ------------------------------------------------------------------------------------------
select tests.login((select id from u where k = 'office'));
with c as (
  insert into public.crews (org_id, name, lead_user_id) values (tests.org_id(), 'Crew A', (select id from u where k = 'lead')) returning id
) insert into r select 'crew', id from c;
with c as (insert into public.crews (org_id, name) values (tests.org_id(), 'Crew B') returning id)
insert into r select 'crew_b', id from c;
insert into public.crew_members (org_id, crew_id, user_id, role)
values (tests.org_id(), (select id from r where k = 'crew'), (select id from u where k = 'painter'), 'painter');
insert into public.crew_skills (org_id, crew_id, skill_id)
select tests.org_id(), (select id from r where k = 'crew'), s.id from public.skills s where s.org_id = tests.org_id() and s.key = 'interior';
select tests.assert_raises(
  format($q$insert into public.crews (org_id, name, crew_type) values (%L, 'Sub crew', 'subcontractor')$q$, tests.org_id()),
  'a subcontractor crew names its subcontractor', '23514');
select tests.assert_raises(
  format($q$insert into public.crew_members (org_id, crew_id, user_id) values (%L, %L, %L)$q$,
         tests.org_id(), (select id from r where k = 'crew'), (select id from u where k = 'other_owner')),
  'crew members come from this company', null);
select tests.logout();

select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.jobs where id = (select id from r where k = 'job')), 0::bigint,
  'before the crew is assigned, the painter cannot see the job');
select tests.assert_eq(tests.rows_affected(
  format($q$update public.jobs set crew_id = %L where id = %L$q$, (select id from r where k = 'crew'), (select id from r where k = 'job'))),
  0::bigint, 'a painter cannot assign crews');
select tests.logout();
select tests.login((select id from u where k = 'office'));
update public.jobs set crew_id = (select id from r where k = 'crew') where id = (select id from r where k = 'job');
select tests.assert_raises(
  format($q$update public.jobs set guarantee_start_date = current_date where id = %L$q$, (select id from r where k = 'job')),
  'the guarantee date is set by Publish only', '42501');
select tests.assert_raises(
  format($q$update public.jobs set on_time_guarantee_status = 'met' where id = %L$q$, (select id from r where k = 'job')),
  'only owners change the on-time status', '42501');
select tests.logout();
select tests.assert((select (select id from u where k = 'painter') = any(team_user_ids) and (select id from u where k = 'lead') = any(team_user_ids)
                     from public.jobs where id = (select id from r where k = 'job')),
  'the crew''s members and lead count as on the job');
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.jobs where id = (select id from r where k = 'job')), 1::bigint,
  'the painter on the crew now sees the job');
select tests.logout();
select tests.login((select id from u where k = 'office'));
update public.crew_members set active = false where user_id = (select id from u where k = 'painter');
select tests.logout();
select tests.assert(not (select (select id from u where k = 'painter') = any(team_user_ids) from public.jobs where id = (select id from r where k = 'job')),
  'a member taken off the crew drops off the job');
select tests.login((select id from u where k = 'office'));
update public.crew_members set active = true where user_id = (select id from u where k = 'painter');
select tests.logout();

-- Schedule drafts and Publish --------------------------------------------------------------------
select tests.login((select id from u where k = 'office'));
with s as (
  insert into public.schedule_entries (org_id, job_id, status, crew_id, starts_on, ends_on, published_at,
                                       draft_action, draft_crew_id, draft_starts_on, draft_ends_on)
  values (tests.org_id(), (select id from r where k = 'job'), 'published', (select id from r where k = 'crew'), current_date, current_date, now(),
          'create', (select id from r where k = 'crew'), current_date + 1, current_date + 3) returning id
) insert into r select 'entry', id from s;
select tests.assert((select status = 'draft' and published_at is null and crew_id is null and drafted_by = (select id from u where k = 'office')
                     from public.schedule_entries where id = (select id from r where k = 'entry')),
  'a new entry is always a draft (published fields are Publish''s job)');
select tests.assert_raises(
  format($q$update public.schedule_entries set status = 'published' where id = %L$q$, (select id from r where k = 'entry')),
  'people cannot publish by editing the row', '42501');
select tests.assert_raises(
  format($q$update public.schedule_entries set override_rules = '{exterior_in_season}', override_reason = 'Owner said so' where id = %L$q$, (select id from r where k = 'entry')),
  'only owners override a work rule', '42501');
select tests.logout();
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'ready_to_schedule'),
  'Ready to Schedule → Scheduled needs published dates');
select tests.login_service((select id from u where k = 'office'));
update public.schedule_entries set status = 'published', crew_id = draft_crew_id, starts_on = draft_starts_on, ends_on = draft_ends_on,
  published_at = now(), published_by = (select id from u where k = 'office'), draft_action = null
where id = (select id from r where k = 'entry');
select tests.logout();
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'ready_to_schedule'),
  'publishing opens the Scheduled gate');
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.schedule_entries), 1::bigint, 'crews read the schedule');
select tests.assert_eq(tests.rows_affected(format($q$update public.schedule_entries set draft_action = 'cancel' where id = %L$q$,
  (select id from r where k = 'entry'))), 0::bigint, 'crews cannot change it');
select tests.logout();

-- Gate: Scheduled → In Progress (materials ready and the first day arrived).
select set_config('app.stage_change', 'on', true);
update public.jobs set stage = 'scheduled' where id = (select id from r where k = 'job');
select set_config('app.stage_change', 'off', true);
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'scheduled'), 'the start day has not arrived yet');
update public.schedule_entries set starts_on = current_date - 1 where id = (select id from r where k = 'entry');
with o as (insert into public.paint_orders (org_id, job_id, status) values (tests.org_id(), (select id from r where k = 'job'), 'ordered') returning id)
insert into r select 'po', id from o;
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'scheduled'), 'paint ordered but not picked up: not ready');
update public.paint_orders set status = 'picked_up' where id = (select id from r where k = 'po');
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'scheduled'), 'materials ready and the day arrived: In Progress opens');

-- Gate: In Progress → Final Walkthrough (every work order complete).
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'in_progress'), 'a job with no work orders does not pass');
with w as (insert into public.work_orders (org_id, job_id, phase, title) values (tests.org_id(), (select id from r where k = 'job'), 'paint', 'Paint walls') returning id)
insert into r select 'wo', id from w;
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'in_progress'), 'an open work order keeps the gate closed');
update public.work_orders set status = 'completed' where id = (select id from r where k = 'wo');
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'in_progress'), 'all work orders complete: Final Walkthrough opens');

-- Daily logs and photos --------------------------------------------------------------------------
insert into public.job_photos (org_id, job_id, category, storage_path, thumb_path, mime_type, size_bytes, uploaded_by)
values (tests.org_id(), (select id from r where k = 'job'), 'cleanup',
        tests.org_id() || '/jobs/' || (select id from r where k = 'job') || '/c.jpg',
        tests.org_id() || '/jobs/' || (select id from r where k = 'job') || '/c-thumb.jpg', 'image/jpeg', 1000, (select id from u where k = 'lead'));
insert into r select 'photo', id from public.job_photos where job_id = (select id from r where k = 'job');
insert into public.job_photos (org_id, job_id, category, storage_path, thumb_path, mime_type, size_bytes)
values (tests.org_id(), (select id from r where k = 'job2'), 'cleanup',
        tests.org_id() || '/jobs/' || (select id from r where k = 'job2') || '/c.jpg',
        tests.org_id() || '/jobs/' || (select id from r where k = 'job2') || '/c-thumb.jpg', 'image/jpeg', 1000);
insert into r select 'photo2', id from public.job_photos where job_id = (select id from r where k = 'job2');

select tests.login((select id from u where k = 'lead'));
select tests.assert_raises(
  format($q$insert into public.daily_logs (org_id, job_id, log_date, finished_today, cleanup_done, cleanup_photo_id)
            values (%L, %L, current_date, 'Walls', false, %L)$q$, tests.org_id(), (select id from r where k = 'job'), (select id from r where k = 'photo')),
  'a daily log needs cleanup done', '23514');
select tests.assert_raises(
  format($q$insert into public.daily_logs (org_id, job_id, log_date, finished_today, cleanup_done, cleanup_photo_id)
            values (%L, %L, current_date, 'Walls', true, %L)$q$, tests.org_id(), (select id from r where k = 'job'), (select id from r where k = 'photo2')),
  'the cleanup photo must be from this job', '23514');
with l as (
  insert into public.daily_logs (org_id, job_id, log_date, finished_today, next_up, cleanup_done, cleanup_photo_id, customer_update_status)
  values (tests.org_id(), (select id from r where k = 'job'), current_date, 'Primed the living room', 'First coat', true,
          (select id from r where k = 'photo'), 'sent') returning id
) insert into r select 'log', id from l;
select tests.assert((select author_id = (select id from u where k = 'lead') and customer_update_status = 'draft'
                     from public.daily_logs where id = (select id from r where k = 'log')),
  'the author is stamped and the customer update starts as a draft');
select tests.assert_raises(
  format($q$update public.daily_logs set customer_update_status = 'simulated' where id = %L$q$, (select id from r where k = 'log')),
  'the customer update is the system''s job', '42501');
insert into public.time_entries (org_id, job_id, daily_log_id, user_id, entry_date, hours)
values (tests.org_id(), (select id from r where k = 'job'), (select id from r where k = 'log'), (select id from u where k = 'painter'), current_date, 7.5);
select tests.assert_eq(tests.rows_affected(
  format($q$update public.time_entries set approved_at = now(), approved_by = %L where daily_log_id = %L$q$,
         (select id from u where k = 'lead'), (select id from r where k = 'log'))),
  0::bigint, 'crew leads cannot approve hours');
select tests.logout();
select tests.assert((select count(*) = 1 from public.events where type = 'daily_log.submitted' and aggregate_id = (select id from r where k = 'log')::text),
  'submitting a log emits daily_log.submitted');

select tests.login((select id from u where k = 'painter'));
select tests.assert_raises(
  format($q$insert into public.daily_logs (org_id, job_id, log_date, finished_today, cleanup_done, cleanup_photo_id)
            values (%L, %L, current_date, 'x', true, %L)$q$, tests.org_id(), (select id from r where k = 'job'), (select id from r where k = 'photo')),
  'painters do not submit daily logs', '42501');
select tests.assert_eq((select count(*) from public.daily_logs), 1::bigint, 'the painter on the job reads its daily log');
select tests.assert_eq((select sum(hours) from public.time_entries), 7.5::numeric, 'and their own hours');
select tests.logout();
select tests.login((select id from u where k = 'painter2'));
select tests.assert_eq((select count(*) from public.daily_logs), 0::bigint, 'a painter not on the job sees no logs');
select tests.assert_eq((select count(*) from public.time_entries), 0::bigint, 'or hours');
select tests.logout();

-- Punch list and sign-off (gate: Final Walkthrough → Completed) -------------------------------------
select tests.login((select id from u where k = 'lead'));
with p as (
  insert into public.punch_items (org_id, job_id, area, description, photo_id)
  values (tests.org_id(), (select id from r where k = 'job'), 'Living room', 'Touch up the outlet cover edge', (select id from r where k = 'photo')) returning id
) insert into r select 'punch', id from p;
select tests.logout();
insert into public.appointments (org_id, job_id, type, starts_at, ends_at, status)
values (tests.org_id(), (select id from r where k = 'job'), 'final_walkthrough', now() - interval '2 hours', now() - interval '1 hour', 'completed');
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'final_walkthrough'), 'an open punch item keeps Completed closed');
select tests.login((select id from u where k = 'lead'));
update public.punch_items set status = 'fixed' where id = (select id from r where k = 'punch');
select tests.logout();
select tests.assert((select fixed_by = (select id from u where k = 'lead') and fixed_at is not null from public.punch_items where id = (select id from r where k = 'punch')),
  'fixing an item stamps who and when');
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'final_walkthrough'),
  'walkthrough done and nothing open: Completed opens');
update public.punch_items set status = 'open' where id = (select id from r where k = 'punch');
select tests.login((select id from u where k = 'lead'));
insert into public.punch_signoffs (org_id, job_id, signer_name, signature_png, signature_sha256, statement)
values (tests.org_id(), (select id from r where k = 'job'), 'Dana Park', 'data:image/png;base64,iVBORw0KGgo=',
        repeat('a', 64), 'I walked the job and accept the work.');
select tests.assert_raises(
  format($q$update public.punch_signoffs set signer_name = 'Someone else' where job_id = %L$q$, (select id from r where k = 'job')),
  'a sign-off cannot be changed', null);
select tests.logout();
select tests.assert((select open_items = 1 and captured_by = (select id from u where k = 'lead') from public.punch_signoffs where job_id = (select id from r where k = 'job')),
  'the sign-off records how many items were still open and who captured it');
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'final_walkthrough'), 'a customer sign-off opens Completed');

-- Rain delays never cost the customer; on-time credits ------------------------------------------
select tests.login_service();
update public.jobs set guarantee_start_date = current_date - 5 where id = (select id from r where k = 'job2');
select tests.logout();
select tests.login((select id from u where k = 'office'));
insert into public.rain_delays (org_id, job_id, delay_date, note) values (tests.org_id(), (select id from r where k = 'job2'), current_date - 5, 'Heavy rain');
select tests.logout();
select tests.assert((select is_priority_reschedule and priority_reschedule_at is not null from public.jobs where id = (select id from r where k = 'job2')),
  'a rain delay puts the job first on the reschedule list');
select tests.assert_eq((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'rain_delays' and column_name like '%cents%'),
  0::bigint, 'rain delays carry no money');
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(
  format($q$insert into public.on_time_credits (org_id, job_id, amount_cents, promised_date, reason) values (%L, %L, 25000, current_date - 5, 'late')$q$,
         tests.org_id(), (select id from r where k = 'job2')),
  'people cannot draft credits', '42501');
select tests.logout();
select tests.login_service();
select tests.assert_raises(
  format($q$insert into public.on_time_credits (org_id, job_id, amount_cents, promised_date, reason) values (%L, %L, 25000, current_date - 5, 'late')$q$,
         tests.org_id(), (select id from r where k = 'job2')),
  'a weather slip never drafts a credit', '23514');
insert into public.on_time_credits (org_id, job_id, amount_cents, promised_date, actual_start_date, reason)
values (tests.org_id(), (select id from r where k = 'job'), 25000, current_date - 3, current_date - 1, 'Started 2 days late (crew double-booked).');
select tests.logout();
select tests.login((select id from u where k = 'lead'));
select tests.assert_eq((select count(*) from public.on_time_credits), 0::bigint, 'crew leads cannot see credits (money)');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.on_time_credits), 1::bigint, 'the office sees the drafted credit');
select tests.assert_eq(tests.rows_affected(format($q$update public.on_time_credits set status = 'approved' where job_id = %L$q$, (select id from r where k = 'job'))),
  0::bigint, 'but only owners approve credits');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(
  format($q$update public.on_time_credits set amount_cents = 1 where job_id = %L$q$, (select id from r where k = 'job')),
  'the amount comes from Company Settings', '42501');
select tests.assert_raises(
  format($q$update public.on_time_credits set status = 'waived' where job_id = %L$q$, (select id from r where k = 'job')),
  'waiving needs a note', '23514');
update public.on_time_credits set status = 'waived', decision_note = 'Customer asked to move the start.' where job_id = (select id from r where k = 'job');
select tests.logout();
select tests.assert_eq((select on_time_guarantee_status from public.jobs where id = (select id from r where k = 'job')), 'waived_by_owner',
  'waiving the credit marks the guarantee waived');

-- Recommendations: people only reject (approving runs through the server) -------------------------------
insert into public.schedule_recommendations (org_id, kind, job_id, crew_id, title, dedupe_key)
values (tests.org_id(), 'assign_crew', (select id from r where k = 'job2'), (select id from r where k = 'crew_b'), 'Assign Crew B', 'assign:job2');
select tests.login((select id from u where k = 'office'));
select tests.assert_raises(
  format($q$update public.schedule_recommendations set status = 'approved' where job_id = %L$q$, (select id from r where k = 'job2')),
  'approving goes through the server', '42501');
update public.schedule_recommendations set status = 'rejected' where job_id = (select id from r where k = 'job2');
select tests.assert((select decided_by = (select id from u where k = 'office') from public.schedule_recommendations where job_id = (select id from r where k = 'job2')),
  'rejecting records who decided');
select tests.logout();

-- Numbers and isolation -------------------------------------------------------------------------
select tests.login((select id from u where k = 'office'));
select tests.assert(((public.production_stats()) ->> 'crews_active')::int = 2, 'production stats count active crews');
select tests.assert(((public.production_stats()) ->> 'can_see_money')::boolean, 'the office sees scheduled revenue');
select tests.logout();
select tests.login((select id from u where k = 'lead'));
select tests.assert((public.production_stats()) ->> 'scheduled_revenue_next_30_cents' is null, 'crew leads get no money in the stats');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.crews), 0::bigint, 'another company sees none of the crews');
select tests.assert_eq((select count(*) from public.schedule_entries), 0::bigint, 'or the schedule');
select tests.assert_eq((select count(*) from public.daily_logs), 0::bigint, 'or daily logs');
select tests.assert_eq((select count(*) from public.punch_items), 0::bigint, 'or punch items');
select tests.assert_eq((select count(*) from public.subcontractors), 0::bigint, 'or subcontractors');
select tests.assert_eq((select count(*) from public.work_rules), 11::bigint, 'and reads only its own work rules');
select tests.logout();

rollback;
