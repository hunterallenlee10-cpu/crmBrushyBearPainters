-- Phase 5: onboarding checks and the Ready to Schedule gate, document uploads
-- and links, job photos — per role and across organizations.
begin;

insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('est', tests.make_user('est@test.bb', 'estimator')),
  ('pm', tests.make_user('pm@test.bb', 'project_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter')),
  ('painter2', tests.make_user('painter2@test.bb', 'painter')),
  ('books', tests.make_user('books@test.bb', 'bookkeeper')),
  ('other_owner', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co')));
grant select on u to authenticated, service_role;
create temp table r (k text primary key, id uuid) on commit drop;
grant select, insert on r to authenticated, service_role;
insert into r values ('other_org', tests.org_id('other-co')), ('org', tests.org_id());

with a as (
  insert into public.accounts (org_id, display_name, owner_id) values (tests.org_id(), 'Lee Residence', (select id from u where k = 'est'))
  returning id
) insert into r select 'acct', id from a;
with a as (
  insert into public.accounts (org_id, display_name) values (tests.org_id(), 'Other Residence') returning id
) insert into r select 'acct2', id from a;
with c as (
  insert into public.contacts (org_id, account_id, first_name, last_name, mobile, email)
  values (tests.org_id(), (select id from r where k = 'acct'), 'Maya', 'Lee', '+14255550111', 'maya@example.com') returning id
) insert into r select 'contact', id from c;
with p as (
  insert into public.properties (org_id, account_id, is_primary, street, city, zip, year_built, has_hoa)
  values (tests.org_id(), (select id from r where k = 'acct'), true, '12 Lake St', 'Kirkland', '98033', 1990, true) returning id
) insert into r select 'prop', id from p;
with j as (
  insert into public.jobs (org_id, name, account_id, property_id, primary_contact_id, work_types, owner_id, project_manager_id)
  values (tests.org_id(), 'Lee – Kirkland – Exterior', (select id from r where k = 'acct'), (select id from r where k = 'prop'),
          (select id from r where k = 'contact'), '{exterior}', (select id from u where k = 'est'), (select id from u where k = 'pm'))
  returning id
) insert into r select 'job', id from j;
with j as (
  insert into public.jobs (org_id, name, account_id, work_types)
  values (tests.org_id(), 'Lee – Kirkland – Interior', (select id from r where k = 'acct'), '{interior}') returning id
) insert into r select 'job2', id from j;
with j as (
  insert into public.jobs (org_id, name, account_id, work_types)
  values (tests.org_id(), 'Other – Bellevue – Interior', (select id from r where k = 'acct2'), '{interior}') returning id
) insert into r select 'job_other_acct', id from j;
insert into public.job_team (job_id, user_id, role, org_id)
values ((select id from r where k = 'job'), (select id from u where k = 'painter'), 'painter', tests.org_id());

-- Put the job in Onboarding with a checklist, as acceptance would.
select set_config('app.stage_change', 'on', true);
update public.jobs set stage = 'onboarding' where id = (select id from r where k = 'job');
select set_config('app.stage_change', 'off', true);
insert into public.onboarding_requirements (org_id, job_id, key, group_key, label, required, owner_role, status, auto_verify_rule, sort_order)
values
  (tests.org_id(), (select id from r where k = 'job'), 'signed_contract', 'contract', 'Signed contract/proposal on file', true, 'estimator', 'pending', 'signed_document_exists', 10),
  (tests.org_id(), (select id from r where k = 'job'), 'deposit_received', 'money', 'Deposit received', true, 'office', 'pending', 'deposit_invoice_paid', 30),
  (tests.org_id(), (select id from r where k = 'job'), 'colors_selected', 'colors', 'Color selected for every area/surface in scope', true, 'estimator', 'pending', 'color_selections_complete', 60),
  (tests.org_id(), (select id from r where k = 'job'), 'hoa_approval', 'compliance', 'HOA approval on file', false, 'office', 'not_required', 'hoa_document_uploaded', 80);
insert into public.job_holds (org_id, job_id, hold_type, reason, blocks_scheduling)
values (tests.org_id(), (select id from r where k = 'job'), 'deposit', 'Waiting for the deposit.', true);

-- Onboarding: what people may change --------------------------------------------------------
select tests.login((select id from u where k = 'office'));
select tests.assert_raises(
  format($q$update public.onboarding_requirements set status = 'verified' where job_id = %L and key = 'colors_selected'$q$,
         (select id from r where k = 'job')),
  'marking an item cleared needs a note', '23514');
select tests.assert_raises(
  format($q$update public.onboarding_requirements set status = 'missing' where job_id = %L and key = 'colors_selected'$q$,
         (select id from r where k = 'job')),
  'people cannot set other statuses (the checks do)', '23514');
select tests.assert_raises(
  format($q$update public.onboarding_requirements set required = false where job_id = %L and key = 'colors_selected'$q$,
         (select id from r where k = 'job')),
  'people cannot make an item optional', '42501');
update public.onboarding_requirements set status = 'verified', note = 'Colors confirmed by phone', verified_auto = true
where job_id = (select id from r where k = 'job') and key = 'colors_selected';
select tests.logout();
select tests.assert((select status = 'verified' and not verified_auto and verified_by = (select id from u where k = 'office')
                     from public.onboarding_requirements where job_id = (select id from r where k = 'job') and key = 'colors_selected'),
  'a manual clear is recorded as such, by the person who did it');
select tests.assert((select count(*) = 1 from public.activity where subject_id = (select id from r where k = 'job')::text
                     and type = 'onboarding_cleared'),
  'a manual clear shows on the job timeline');

-- The checks (service role) never overwrite a manual clear.
select tests.login_service();
select tests.assert_eq((public.apply_onboarding_checks((select id from r where k = 'job'), jsonb_build_array(
    jsonb_build_object('key', 'signed_contract', 'status', 'verified', 'detail', 'Signed proposal stored.'),
    jsonb_build_object('key', 'deposit_received', 'status', 'pending', 'detail', 'Waiting for $3,000.00.'),
    jsonb_build_object('key', 'colors_selected', 'status', 'missing', 'detail', '0 of 3 surfaces have a color.'),
    jsonb_build_object('key', 'hoa_approval', 'status', 'missing', 'detail', 'Upload the HOA approval.', 'required', true)
  )) ->> 'cleared')::boolean, false, 'the checklist is not cleared yet');
select tests.assert_raises(
  format($q$select public.apply_onboarding_checks(%L, '[{"key":"signed_contract","status":"done"}]')$q$, (select id from r where k = 'job')),
  'unknown statuses are refused', '22023');
select tests.logout();
select tests.assert((select status = 'verified' and verified_auto and auto_detail = 'Signed proposal stored.'
                     from public.onboarding_requirements where job_id = (select id from r where k = 'job') and key = 'signed_contract'),
  'an automatic result verifies the item and keeps its detail');
select tests.assert((select status = 'verified' and not verified_auto and auto_status = 'missing'
                     from public.onboarding_requirements where job_id = (select id from r where k = 'job') and key = 'colors_selected'),
  'the manual clear stands; the check result is kept beside it');
select tests.assert((select required and status = 'missing' from public.onboarding_requirements
                     where job_id = (select id from r where k = 'job') and key = 'hoa_approval'),
  'a check can make the HOA item required');
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(
  format($q$select public.apply_onboarding_checks(%L, '[]')$q$, (select id from r where k = 'job')),
  'only trusted code writes check results', '42501');
select tests.logout();

-- Gate: not cleared, then cleared but held, then passes.
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'onboarding'),
  'Ready to Schedule is closed while required items are open');
select tests.assert_raises(
  format($q$select public.apply_job_stage_change(%L, 'onboarding', 'ready_to_schedule')$q$, (select id from r where k = 'job')),
  'the stage cannot move without the gate', '42501');
select tests.login_service();
select public.apply_onboarding_checks((select id from r where k = 'job'), jsonb_build_array(
  jsonb_build_object('key', 'hoa_approval', 'status', 'verified', 'detail', 'HOA approval uploaded.', 'required', true)));
select tests.logout();

-- Clearing the deposit item releases the Deposit Hold.
select tests.login((select id from u where k = 'office'));
update public.onboarding_requirements set status = 'verified', note = 'Check #1042 received at the office'
where job_id = (select id from r where k = 'job') and key = 'deposit_received';
select tests.logout();
select tests.assert((select released_at is not null and release_note like 'Deposit item cleared: Check #1042%'
                     from public.job_holds where job_id = (select id from r where k = 'job') and hold_type = 'deposit'),
  'clearing the deposit item releases the Deposit Hold');
select tests.assert_eq((select blocking_hold_count from public.jobs where id = (select id from r where k = 'job')), 0,
  'and the job has no blocking hold left');
insert into public.job_holds (org_id, job_id, hold_type, reason, blocks_scheduling)
values (tests.org_id(), (select id from r where k = 'job'), 'hoa', 'Waiting on the HOA board.', true);
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'onboarding'),
  'a blocking hold keeps the gate closed even when every item is cleared');
update public.job_holds set released_at = now(), release_note = 'Board approved'
where job_id = (select id from r where k = 'job') and hold_type = 'hoa';
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'onboarding'),
  'every required item cleared and no blocking holds: the gate passes');
select tests.assert(not app.job_gate_passes((select id from r where k = 'job2'), 'onboarding'),
  'a job without a checklist does not pass');
select public.apply_job_stage_change((select id from r where k = 'job'), 'onboarding', 'ready_to_schedule');
select tests.assert_eq((select stage from public.jobs where id = (select id from r where k = 'job')), 'ready_to_schedule',
  'the job moves to Ready to Schedule through the stage engine');

-- Reopening a manual clear.
select tests.login((select id from u where k = 'office'));
update public.onboarding_requirements set status = 'pending'
where job_id = (select id from r where k = 'job') and key = 'colors_selected';
select tests.assert((select status = 'pending' and verified_at is null from public.onboarding_requirements
                     where job_id = (select id from r where k = 'job') and key = 'colors_selected'),
  'a manual clear can be reopened');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq(tests.rows_affected(format(
  $q$update public.onboarding_requirements set status = 'verified', note = 'done' where job_id = %L$q$,
  (select id from r where k = 'job'))), 0::bigint, 'painters cannot clear onboarding items');
select tests.assert((select count(*) > 0 from public.onboarding_requirements), 'painters on the job see its checklist');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.onboarding_requirements), 0::bigint,
  'another company sees none of this checklist');
select tests.logout();

-- Messages remember their template (sends are recorded by trusted code with the outbox) ----------
select tests.login_service((select id from u where k = 'office'));
insert into public.messages (org_id, channel, direction, subject_type, subject_id, contact_id, to_address, body, status, simulated, template_key)
values (tests.org_id(), 'sms', 'outbound', 'job', (select id from r where k = 'job'), (select id from r where k = 'contact'),
        '+14255550111', 'Prep instructions', 'simulated', true, 'prep_instructions');
select tests.assert_raises(
  format($q$insert into public.messages (org_id, channel, direction, subject_type, subject_id, body, status, template_key)
            values (%L, 'sms', 'outbound', 'job', %L, 'x', 'simulated', 'Bad Key!')$q$, tests.org_id(), (select id from r where k = 'job')),
  'template keys are checked', '23514');
select tests.logout();

-- Documents ------------------------------------------------------------------------------------
select tests.login((select id from u where k = 'office'));
with d as (
  insert into public.documents (org_id, job_id, category, title, file_name, storage_path, mime_type, size_bytes, source, signature_id)
  values (tests.org_id(), (select id from r where k = 'job'), 'hoa', 'HOA approval', 'hoa.pdf',
          tests.org_id() || '/jobs/' || (select id from r where k = 'job') || '/hoa.pdf', 'application/pdf', 1200, 'generated', null)
  returning id
) insert into r select 'doc_hoa', id from d;
select tests.assert((select source = 'upload' and uploaded_by = (select id from u where k = 'office') and account_id = (select id from r where k = 'acct')
                     from public.documents where id = (select id from r where k = 'doc_hoa')),
  'uploads are marked as uploads by the uploader, and get the job''s customer');
select tests.assert_raises(
  format($q$insert into public.documents (org_id, job_id, category, title, file_name, storage_path, mime_type, size_bytes)
            values (%L, %L, 'other', 'x', 'x.pdf', %L, 'application/pdf', 1)$q$,
         (select id from r where k = 'org'), (select id from r where k = 'job'), (select id from r where k = 'other_org') || '/x.pdf'),
  'a document must point at this company''s storage', '42501');
update public.documents set job_id = (select id from r where k = 'job2'), title = 'HOA approval (2026)', category = 'other'
where id = (select id from r where k = 'doc_hoa');
select tests.assert((select job_id = (select id from r where k = 'job2') and title = 'HOA approval (2026)'
                     from public.documents where id = (select id from r where k = 'doc_hoa')),
  'a document can be renamed, recategorized and moved to another job of the same customer');
select tests.assert_raises(
  format($q$update public.documents set job_id = %L where id = %L$q$, (select id from r where k = 'job_other_acct'), (select id from r where k = 'doc_hoa')),
  'but not to another customer''s job', '23514');
update public.documents set job_id = null where id = (select id from r where k = 'doc_hoa');
select tests.assert((select job_id is null and account_id = (select id from r where k = 'acct')
                     from public.documents where id = (select id from r where k = 'doc_hoa')),
  'or kept on the customer only');
update public.documents set job_id = (select id from r where k = 'job'), category = 'hoa' where id = (select id from r where k = 'doc_hoa');
select tests.assert_eq((public.document_stats((select id from r where k = 'job')) ->> 'total')::int, 1,
  'document stats count a job''s documents');
select public.soft_delete_record('documents', (select id from r where k = 'doc_hoa'), 'Uploaded the wrong file');
select tests.assert_eq((select count(*) from public.documents where id = (select id from r where k = 'doc_hoa')), 0::bigint,
  'a deleted document disappears');
select tests.logout();
select tests.assert((select deleted_by = (select id from u where k = 'office') from public.documents where id = (select id from r where k = 'doc_hoa')),
  'soft delete records who and why');
select tests.login((select id from u where k = 'owner'));
select tests.assert((select count(*) = 1 from public.list_deleted_records() where table_name = 'documents'),
  'deleted documents are listed in Deleted Records');
select public.restore_record('documents', (select id from r where k = 'doc_hoa'));
select tests.assert_eq((select count(*) from public.documents where id = (select id from r where k = 'doc_hoa')), 1::bigint,
  'and can be restored');
select tests.logout();

-- A signed contract (trusted code) can't be deleted; painters see HOA paperwork but not money documents.
with e as (
  insert into public.estimates (org_id, job_id) values (tests.org_id(), (select id from r where k = 'job')) returning id
) insert into r select 'est', id from e;
with v as (
  insert into public.estimate_versions (org_id, estimate_id, version_no)
  values (tests.org_id(), (select id from r where k = 'est'), 1) returning id
) insert into r select 'ver', id from v;
with s as (
  insert into public.signatures (org_id, job_id, estimate_version_id, signer_name, signature_png, signature_sha256, consent_text, selection)
  values (tests.org_id(), (select id from r where k = 'job'), (select id from r where k = 'ver'), 'Maya Lee',
          'data:image/png;base64,iVBORw0KGgo=', repeat('a', 64), 'I agree to this proposal.', '{}')
  returning id
) insert into r select 'sig', id from s;
with d as (
  insert into public.documents (org_id, job_id, category, title, file_name, storage_path, mime_type, size_bytes, source, status, signature_id)
  values (tests.org_id(), (select id from r where k = 'job'), 'contract', 'Signed contract', 'c.pdf',
          tests.org_id() || '/jobs/' || (select id from r where k = 'job') || '/c.pdf', 'application/pdf', 1, 'generated', 'signed',
          (select id from r where k = 'sig'))
  returning id
) insert into r select 'doc_contract', id from d;
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(
  format($q$select public.soft_delete_record('documents', %L, 'testing delete')$q$, (select id from r where k = 'doc_contract')),
  'signed documents cannot be deleted', '23514');
select tests.assert_raises(
  format($q$update public.documents set job_id = %L where id = %L$q$, (select id from r where k = 'job2'), (select id from r where k = 'doc_contract')),
  'generated documents stay on their job', '42501');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.documents where category = 'hoa'), 1::bigint, 'painters on the job see the HOA approval');
select tests.assert_eq((select count(*) from public.documents where category = 'contract'), 0::bigint, 'but not the contract');
select tests.assert_raises(
  format($q$insert into public.documents (org_id, job_id, category, title, file_name, storage_path, mime_type, size_bytes)
            values (%L, %L, 'other', 'x', 'x.pdf', %L, 'application/pdf', 1)$q$,
         tests.org_id(), (select id from r where k = 'job'), tests.org_id() || '/jobs/x.pdf'),
  'painters cannot upload documents', '42501');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.documents), 0::bigint, 'another company sees none of the documents');
select tests.assert_eq((public.document_stats() ->> 'total')::int, 0, 'and its document stats are its own');
select tests.logout();

-- Photos ---------------------------------------------------------------------------------------
select tests.login((select id from u where k = 'painter'));
with p as (
  insert into public.job_photos (org_id, job_id, category, area, storage_path, thumb_path, mime_type, size_bytes, client_id,
                                 customer_visible, uploaded_by)
  values (tests.org_id(), (select id from r where k = 'job'), 'before', 'Front',
          tests.org_id() || '/jobs/' || (select id from r where k = 'job') || '/a.jpg',
          tests.org_id() || '/jobs/' || (select id from r where k = 'job') || '/a-thumb.jpg', 'image/jpeg', 1000,
          '00000000-0000-0000-0000-0000000000c1', true, (select id from u where k = 'owner'))
  returning id
) insert into r select 'photo', id from p;
select tests.assert((select uploaded_by = (select id from u where k = 'painter') and not customer_visible and shared_at is null
                     from public.job_photos where id = (select id from r where k = 'photo')),
  'a painter on the job uploads a photo; uploader and sharing are set by the database');
select tests.assert_raises(
  format($q$insert into public.job_photos (org_id, job_id, storage_path, thumb_path, mime_type, size_bytes, client_id)
            values (%L, %L, %L, %L, 'image/jpeg', 1, '00000000-0000-0000-0000-0000000000c1')$q$,
         tests.org_id(), (select id from r where k = 'job'),
         tests.org_id() || '/jobs/' || (select id from r where k = 'job') || '/b.jpg',
         tests.org_id() || '/jobs/' || (select id from r where k = 'job') || '/b-thumb.jpg'),
  'the same client id cannot upload twice (offline retries)', '23505');
select tests.assert_raises(
  format($q$insert into public.job_photos (org_id, job_id, storage_path, thumb_path, mime_type, size_bytes)
            values (%L, %L, %L, %L, 'image/jpeg', 1)$q$,
         tests.org_id(), (select id from r where k = 'job'),
         tests.org_id() || '/jobs/' || (select id from r where k = 'job2') || '/c.jpg',
         tests.org_id() || '/jobs/' || (select id from r where k = 'job2') || '/c-thumb.jpg'),
  'a photo''s file must be stored with its job', '42501');
select tests.assert_raises(
  format($q$insert into public.job_photos (org_id, job_id, storage_path, thumb_path, mime_type, size_bytes)
            values (%L, %L, %L, %L, 'image/jpeg', 1)$q$,
         tests.org_id(), (select id from r where k = 'job2'),
         tests.org_id() || '/jobs/' || (select id from r where k = 'job2') || '/d.jpg',
         tests.org_id() || '/jobs/' || (select id from r where k = 'job2') || '/d-thumb.jpg'),
  'painters cannot upload to jobs they are not on', '42501');
update public.job_photos set area = 'Front elevation', caption = 'North side', category = 'damage' where id = (select id from r where k = 'photo');
select tests.assert((select area = 'Front elevation' and category = 'damage' from public.job_photos where id = (select id from r where k = 'photo')),
  'the uploader can tag their photo');
select tests.assert_raises(
  format($q$select public.soft_delete_record('job_photos', %L, 'blurry photo')$q$, (select id from r where k = 'photo')),
  'painters cannot delete photos', '42501');
select tests.assert_eq((public.job_photo_summary((select id from r where k = 'job')) ->> 'total')::int, 1,
  'the photo summary counts the job''s photos');
select tests.logout();

select tests.login((select id from u where k = 'painter2'));
select tests.assert_eq((select count(*) from public.job_photos), 0::bigint, 'a painter not on the job sees none of its photos');
select tests.logout();
select tests.login((select id from u where k = 'books'));
select tests.assert_eq((select count(*) from public.job_photos), 1::bigint, 'read-all roles see every photo');
select tests.assert_eq(tests.rows_affected(format($q$update public.job_photos set caption = 'x' where id = %L$q$, (select id from r where k = 'photo'))),
  0::bigint, 'but cannot change them');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.job_photos), 0::bigint, 'another company sees none of the photos');
select tests.logout();

select tests.login((select id from u where k = 'office'));
update public.job_photos set customer_visible = true where id = (select id from r where k = 'photo');
select tests.assert((select customer_visible and shared_at is not null from public.job_photos where id = (select id from r where k = 'photo')),
  'sharing a photo with the customer stamps when');
select tests.assert_raises(
  format($q$update public.job_photos set storage_path = %L where id = %L$q$,
         tests.org_id() || '/jobs/' || (select id from r where k = 'job') || '/z.jpg', (select id from r where k = 'photo')),
  'a photo''s file cannot change', '42501');
select public.soft_delete_record('job_photos', (select id from r where k = 'photo'), 'Duplicate photo');
select tests.assert_eq((select count(*) from public.job_photos), 0::bigint, 'office deletes a photo (soft)');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
select tests.assert((select count(*) = 1 from public.list_deleted_records() where table_name = 'job_photos'),
  'deleted photos are listed in Deleted Records');
select tests.logout();

rollback;
