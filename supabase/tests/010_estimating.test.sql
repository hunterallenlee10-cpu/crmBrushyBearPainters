-- Phase 4: catalog, estimates, send → view → accept & sign, change orders,
-- documents, invoices, onboarding, paint and work orders — per role and across
-- organizations, plus the guards that keep prices and signatures honest.
begin;

insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));
select app.seed_estimating_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('est', tests.make_user('est@test.bb', 'estimator')),
  ('est2', tests.make_user('est2@test.bb', 'estimator')),
  ('pm', tests.make_user('pm@test.bb', 'project_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter')),
  ('books', tests.make_user('books@test.bb', 'bookkeeper')),
  ('other_owner', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co')));
grant select on u to authenticated, service_role;
create temp table o as select tests.org_id() as a;
grant select on o to authenticated, service_role;
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
  insert into public.properties (org_id, account_id, is_primary, street, city, zip, year_built, has_hoa)
  values (tests.org_id(), (select id from r where k = 'acct'), true, '12 Lake St', 'Kirkland', '98033', 1965, true) returning id
) insert into r select 'prop', id from p;
with j as (
  insert into public.jobs (org_id, name, account_id, property_id, primary_contact_id, work_types, owner_id, project_manager_id)
  values (tests.org_id(), 'Smith – Kirkland – Exterior', (select id from r where k = 'acct'), (select id from r where k = 'prop'),
          (select id from r where k = 'contact'), '{exterior}', (select id from u where k = 'est'), (select id from u where k = 'pm'))
  returning id
) insert into r select 'job', id from j;
insert into public.job_financials (job_id, org_id, contract_baseline_cents)
values ((select id from r where k = 'job'), tests.org_id(), 1000000);

-- Seed ------------------------------------------------------------------------------------
select tests.assert_eq((select count(*) from public.price_books where org_id = tests.org_id() and is_default and name = 'Brushy Bear Standard'),
  1::bigint, 'the Brushy Bear Standard price book is seeded as the default');
select tests.assert((select count(*) >= 40 from public.catalog_items where org_id = tests.org_id()),
  'surfaces and add-ons are seeded in the catalog');
select tests.assert((select bool_and(is_sample) from public.production_rates where org_id = tests.org_id())
                    and (select bool_and(is_sample) from public.paint_products where org_id = tests.org_id())
                    and (select bool_and(is_sample) from public.catalog_items where org_id = tests.org_id()),
  'every seeded rate, product and catalog price is flagged Sample');
select tests.assert((select is_sample from public.estimate_settings where org_id = tests.org_id()),
  'estimate settings start as sample values');
select tests.assert_eq((select whats_included -> 'exterior' ->> 'status' from public.estimate_settings where org_id = tests.org_id()),
  'approved', 'the exterior inclusions come from the website');
select tests.assert_eq((select whats_included -> 'interior' ->> 'status' from public.estimate_settings where org_id = tests.org_id()),
  'draft', 'interior inclusions are a draft for the owners');
select tests.assert_eq((select count(*) from public.agreement_templates where org_id = tests.org_id() and status = 'draft'),
  4::bigint, 'proposal, contract, change order and lead-safe templates ship as drafts');
select tests.assert((select bool_and(body like '%[%') from public.agreement_templates where org_id = tests.org_id()),
  'agreement templates keep placeholders for legal wording');

-- Catalog permissions ---------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
select tests.assert((select count(*) > 0 from public.catalog_items), 'estimators read the catalog');
select tests.assert_eq(tests.rows_affected($q$update public.paint_products set cost_per_gal_cents = 1 where is_sample$q$), 0::bigint,
  'estimators cannot change paint costs');
select tests.assert_eq(tests.rows_affected($q$update public.estimate_settings set pricing = pricing || '{"sundries_percent": 1}'$q$), 0::bigint,
  'estimators cannot change estimate settings');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.catalog_items), 0::bigint, 'painters do not see catalog prices');
select tests.assert_eq((select count(*) from public.production_rates), 0::bigint, 'painters do not see production rates');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
update public.production_rates set units_per_labor_hour = 160 where surface = 'int_walls' and method = 'brush_roll' and condition = 'good';
select tests.assert(not (select is_sample from public.production_rates where surface = 'int_walls' and method = 'brush_roll' and condition = 'good'),
  'editing a sample rate clears its Sample flag');
update public.production_rates set active = false where surface = 'int_walls' and method = 'spray' and condition = 'good';
select tests.assert((select is_sample from public.production_rates where surface = 'int_walls' and method = 'spray' and condition = 'good'),
  'turning a rate off is not calibrating it');
update public.estimate_settings set pricing = pricing || '{"sundries_percent": 9}';
select tests.assert((select not is_sample and calibrated_by = (select id from u where k = 'owner') from public.estimate_settings),
  'saving Estimate Setup marks the settings calibrated by that owner');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.catalog_items where org_id = tests.org_id()), 0::bigint,
  'another company cannot read this catalog');
select tests.logout();

-- Building an estimate ---------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
insert into r select 'est', public.create_estimate((select id from r where k = 'job'), 'Exterior repaint');
select tests.assert((select estimate_number ~ '^EST-[0-9]{4}-[0-9]{4,}$' from public.estimates where id = (select id from r where k = 'est')),
  'estimates get an EST-YYYY-NNNN number');
insert into r select 'v1', current_version_id from public.estimates where id = (select id from r where k = 'est');
select tests.assert((select id is not null from r where k = 'v1'), 'a new estimate starts with version 1 as its current version');
insert into r select 'optA', id from public.estimate_options where version_id = (select id from r where k = 'v1');
with a as (
  insert into public.estimate_areas (org_id, version_id, option_id, name, work_type)
  values ((select a from o), (select id from r where k = 'v1'), (select id from r where k = 'optA'), 'Front elevation', 'exterior')
  returning id
) insert into r select 'area', id from a;
with l as (
  insert into public.estimate_line_items (org_id, version_id, option_id, area_id, kind, name, unit, surface, quantity,
                                          work_type, price_cents, cost_cents, lead_safe)
  values ((select a from o), (select id from r where k = 'v1'), (select id from r where k = 'optA'), (select id from r where k = 'area'),
          'production_rate', 'Body siding – cedar/wood', 'sqft', 'ext_siding_cedar', 640, 'exterior', 1, 1, true)
  returning id
) insert into r select 'line', id from l;
select tests.assert((select price_cents is null and cost_cents is null from public.estimate_line_items where id = (select id from r where k = 'line')),
  'people cannot write engine prices onto a line');
with l as (
  insert into public.estimate_line_items (org_id, version_id, kind, is_optional, name, unit, catalog_code, quantity,
                                          unit_price_cents, unit_cost_cents, is_repair_allowance)
  values ((select a from o), (select id from r where k = 'v1'), 'flat', true, 'Wood rot repair allowance', 'lf',
          'rot_repair_allowance', 10, 2500, 1200, true)
  returning id
) insert into r select 'addon', id from l;
select tests.assert_raises(
  format($q$insert into public.estimate_line_items (org_id, version_id, kind, is_optional, name, unit, quantity, unit_price_cents)
            values (%L, %L, 'flat', false, 'Loose line', 'each', 1, 100)$q$, (select a from o), (select id from r where k = 'v1')),
  'a line outside an option must be an optional add-on', '23514');
update public.estimates set status = 'accepted', total_cents = 1 where id = (select id from r where k = 'est');
select tests.assert_eq((select status from public.estimates where id = (select id from r where k = 'est')), 'draft',
  'people cannot change an estimate''s status');
select tests.assert_raises(
  format($q$select public.store_version_pricing(%L, '{}', '{}', 0, '[]', '[]')$q$, (select id from r where k = 'v1')),
  'signed-in users cannot store engine results directly', '42501');
select tests.assert_raises(
  format($q$select public.mark_estimate_sent(%L, repeat('a', 64), now() + interval '30 days', '{}', 0, '{}')$q$, (select id from r where k = 'v1')),
  'signed-in users cannot mark an estimate sent themselves', '42501');
select tests.logout();

select tests.login((select id from u where k = 'est2'));
select tests.assert_eq((select count(*) from public.estimates), 0::bigint, 'other estimators do not see the estimate');
select tests.assert_eq((select count(*) from public.estimate_line_items), 0::bigint, 'or its lines');
select tests.assert_raises(format($q$select public.create_estimate(%L)$q$, (select id from r where k = 'job')),
  'other estimators cannot start an estimate on a job they cannot see', 'P0002');
select tests.logout();
select tests.login((select id from u where k = 'pm'));
select tests.assert_eq((select count(*) from public.jobs), 1::bigint, 'the project manager sees the job');
select tests.assert_eq((select count(*) from public.estimates), 0::bigint, 'crew leads never see estimates (prices)');
select tests.logout();

-- Pricing and sending (trusted server code) ----------------------------------------------------
select tests.login_service((select id from u where k = 'est'));
select public.store_version_pricing((select id from r where k = 'v1'), '{"targetMarginPercent": 50}'::jsonb, '{"options": []}'::jsonb, 0,
  jsonb_build_array(
    jsonb_build_object('id', (select id from r where k = 'line'), 'laborHours', 60.55, 'prepHours', 30.3, 'gallons', 5,
                       'gallonsNeeded', 4.02, 'primerGallons', 3, 'primerGallonsNeeded', 2.35, 'laborCostCents', 393575,
                       'materialCostCents', 64486, 'sundriesCents', 31486, 'costCents', 458061,
                       'computedPriceCents', 916122, 'priceCents', 916122, 'containers', '{"five_gallon": 1}'::jsonb)),
  jsonb_build_array(jsonb_build_object('id', (select id from r where k = 'optA'), 'subtotalCents', 931122, 'totalCents', 931122)));
select tests.assert_eq((select price_cents from public.estimate_line_items where id = (select id from r where k = 'line')), 916122::bigint,
  'the engine''s price is stored by trusted code');
select public.mark_estimate_sent((select id from r where k = 'v1'), repeat('a', 64), now() + interval '30 days',
  '{"version": 1, "options": []}'::jsonb, 931122, array['sms', 'email']);
select tests.logout();
select tests.assert_eq((select status from public.estimate_versions where id = (select id from r where k = 'v1')), 'sent',
  'the version is sent');
select tests.assert((select status = 'sent' and total_cents = 931122 and expires_at > now() from public.estimates where id = (select id from r where k = 'est')),
  'the estimate is sent with its total and expiry');
select tests.assert((select estimate_sent_at is not null from public.jobs where id = (select id from r where k = 'job')),
  'sending stamps the job''s Estimate Sent milestone (24h SLA)');
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'walkthrough_complete'),
  'the Walkthrough Complete gate passes once an estimate is sent');
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'estimate_sent'),
  'the Estimate Sent gate waits for acceptance');
select tests.assert_eq((select count(*) from public.events where type = 'estimate.sent' and aggregate_id = (select id from r where k = 'est')::text),
  1::bigint, 'estimate.sent is emitted');

select tests.login((select id from u where k = 'est'));
select tests.assert_raises(
  format($q$update public.estimate_line_items set quantity = 700 where id = %L$q$, (select id from r where k = 'line')),
  'a sent version cannot be edited', '23514');
select tests.assert_raises(
  format($q$update public.estimate_versions set customer_notes = 'x' where id = %L$q$, (select id from r where k = 'v1')),
  'a sent version''s notes cannot be edited either', '23514');
select tests.logout();

-- Viewing ------------------------------------------------------------------------------------
select tests.login_service();
select tests.assert((public.record_proposal_view(repeat('a', 64)) ->> 'first_view')::boolean, 'the first view is recorded');
select tests.assert(not (public.record_proposal_view(repeat('a', 64)) ->> 'first_view')::boolean, 'later views are counted, not re-announced');
select tests.logout();
select tests.assert((select status = 'viewed' and view_count = 2 from public.estimate_versions where id = (select id from r where k = 'v1')),
  'the version shows viewed with its view count');
select tests.assert_eq((select count(*) from public.events where type = 'estimate.viewed'), 1::bigint, 'estimate.viewed is emitted once');

-- Accept & sign ------------------------------------------------------------------------------
select tests.login_service();
select tests.assert_raises(
  format($q$select public.accept_estimate(repeat('a', 64), gen_random_uuid(), '{}', 'Sam Smith', null,
            'data:image/png;base64,iVBORw0KGgo=', repeat('b', 64), 'I accept this proposal.', '203.0.113.9', 'test',
            '{"totalCents": 1}', '{}')$q$),
  'accepting needs an option from the proposal', '22023');
select tests.assert_raises(
  format($q$select public.accept_estimate(repeat('a', 64), %L, array[gen_random_uuid()], 'Sam Smith', null,
            'data:image/png;base64,iVBORw0KGgo=', repeat('b', 64), 'I accept this proposal.', '203.0.113.9', 'test',
            '{"totalCents": 1}', '{}')$q$, (select id from r where k = 'optA')),
  'accepting refuses add-ons that are not on the proposal', '22023');
insert into r select 'accept', (public.accept_estimate(
  repeat('a', 64), (select id from r where k = 'optA'), array[(select id from r where k = 'addon')], 'Sam Smith', 'sam@example.com',
  'data:image/png;base64,iVBORw0KGgo=', repeat('b', 64), 'I accept this proposal and the attached terms.', '203.0.113.9',
  'Mozilla/5.0 (test)',
  jsonb_build_object('totalCents', 956122, 'depositCents', 286837, 'depositPercent', 30, 'subtotalCents', 956122),
  jsonb_build_object(
    'onboarding', jsonb_build_array(
      jsonb_build_object('key', 'signed_contract', 'group', 'contract', 'label', 'Signed contract/proposal on file', 'required', true,
                         'ownerRole', 'estimator', 'status', 'pending', 'autoVerifyRule', 'signed_document_exists', 'sortOrder', 10),
      jsonb_build_object('key', 'change_orders_resolved', 'group', 'contract', 'label', 'Change orders resolved', 'required', false,
                         'ownerRole', 'estimator', 'status', 'not_required', 'autoVerifyRule', 'no_change_order_sent', 'sortOrder', 20),
      jsonb_build_object('key', 'hoa_approval', 'group', 'compliance', 'label', 'HOA approval on file', 'required', true,
                         'ownerRole', 'office', 'status', 'pending', 'autoVerifyRule', 'hoa_document_uploaded', 'sortOrder', 80),
      jsonb_build_object('key', 'lead_safe_plan', 'group', 'compliance', 'label', 'Lead-safe plan', 'required', true,
                         'ownerRole', 'project_manager', 'status', 'pending', 'autoVerifyRule', 'lead_safe_ack_signed_and_certified_renovator', 'sortOrder', 90)),
    'paintOrder', jsonb_build_array(
      jsonb_build_object('label', 'Exterior acrylic house paint', 'gallons', 5, 'gallonsNeeded', 4.02, 'unitCostCents', 5000, 'costCents', 25000),
      jsonb_build_object('label', 'Sundries', 'isSundries', true, 'unitCostCents', 31486, 'costCents', 31486)),
    'workOrders', jsonb_build_array(
      jsonb_build_object('phase', 'prep', 'title', 'Prep', 'budgetedHours', 30.3, 'scopeSummary', 'Body siding'),
      jsonb_build_object('phase', 'paint', 'title', 'Paint', 'budgetedHours', 30.25, 'scopeSummary', 'Body siding')),
    'colors', jsonb_build_array(
      jsonb_build_object('lineId', (select id from r where k = 'line'), 'area', 'Front elevation', 'surface', 'Body siding – cedar/wood',
                         'sheen', 'satin'))
  )) ->> 'invoice_id')::uuid;
select tests.logout();

select tests.assert((select status = 'accepted' and accepted_version_id = (select id from r where k = 'v1') and total_cents = 956122
                     from public.estimates where id = (select id from r where k = 'est')),
  'the estimate is accepted at the selected total');
select tests.assert((select accepted_addon_ids = array[(select id from r where k = 'addon')] from public.estimate_versions where id = (select id from r where k = 'v1')),
  'the selected add-ons are recorded');
select tests.assert((select signer_name = 'Sam Smith' and ip = '203.0.113.9'::inet and user_agent like 'Mozilla%' and signed_at is not null
                     from public.signatures where estimate_version_id = (select id from r where k = 'v1')),
  'the signature keeps the typed name, timestamp, IP and user agent');
select tests.assert((select invoice_type = 'deposit' and status = 'draft' and total_cents = 286837 and invoice_number ~ '^INV-'
                     from public.invoices where id = (select id from r where k = 'accept')),
  'a deposit invoice is created for the deposit amount');
select tests.assert_eq((select count(*) from public.job_holds where job_id = (select id from r where k = 'job') and hold_type = 'deposit' and released_at is null),
  1::bigint, 'a Deposit Hold waits for the deposit');
select tests.assert_eq((select count(*) from public.onboarding_requirements where job_id = (select id from r where k = 'job')), 4::bigint,
  'onboarding requirements are seeded');
select tests.assert((select total_cost_cents = 56486 and po_number ~ '^PO-' from public.paint_orders where job_id = (select id from r where k = 'job')),
  'a paint order draft is created with its cost');
select tests.assert_eq((select count(*) from public.work_orders where job_id = (select id from r where k = 'job') and work_order_number ~ '^WO-' and status = 'new'),
  2::bigint, 'work order drafts are created by phase');
select tests.assert_eq((select status from public.color_selections where job_id = (select id from r where k = 'job')), 'needed',
  'color sheet rows wait for colors');
select tests.assert((select estimate_contract_cents = 956122 and contract_cents = 956122 from public.job_financials where job_id = (select id from r where k = 'job')),
  'the contract comes from the accepted estimate, not the baseline');
select tests.assert((select contract_signed_at is not null and estimate_accepted_at is not null and accepted_estimate_id = (select id from r where k = 'est')
                     from public.jobs where id = (select id from r where k = 'job')),
  'the job records the accepted estimate and when the contract was signed');
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'estimate_sent'), 'the Estimate Sent gate passes once signed');
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'sold'), 'the Sold gate passes once the deposit invoice exists');
select tests.assert_eq((select count(*) from public.events where type = 'estimate.accepted'), 1::bigint, 'estimate.accepted is emitted');

select tests.login_service();
select tests.assert_raises(
  format($q$select public.accept_estimate(repeat('a', 64), %L, '{}', 'Sam Smith', null, 'data:image/png;base64,iVBORw0KGgo=',
            repeat('b', 64), 'I accept this proposal.', null, null, '{"totalCents": 1}', '{}')$q$, (select id from r where k = 'optA')),
  'a proposal can only be signed once', '23505');
-- The signed PDF is stored as a document and linked to the signature.
with d as (
  insert into public.documents (org_id, job_id, category, title, file_name, storage_path, mime_type, size_bytes, source, status,
                                related_type, related_id, signature_id)
  values ((select a from o), (select id from r where k = 'job'), 'contract', 'Signed proposal & contract', 'signed.pdf',
          (select a from o)::text || '/jobs/signed.pdf', 'application/pdf', 1234, 'generated', 'signed', 'estimate_version',
          (select id from r where k = 'v1'), (select id from public.signatures where estimate_version_id = (select id from r where k = 'v1')))
  returning id
) insert into r select 'doc', id from d;
insert into public.documents (org_id, job_id, category, title, file_name, storage_path, mime_type, size_bytes, source)
values ((select a from o), (select id from r where k = 'job'), 'color_sheet', 'Color sheet', 'colors.pdf',
        (select a from o)::text || '/jobs/colors.pdf', 'application/pdf', 99, 'generated');
select public.attach_signed_document((select id from public.signatures where estimate_version_id = (select id from r where k = 'v1')),
  (select id from r where k = 'doc'));
select tests.logout();
select tests.assert((select status = 'verified' and verified_auto from public.onboarding_requirements
                     where job_id = (select id from r where k = 'job') and key = 'signed_contract'),
  'storing the signed PDF clears the contract onboarding item');

-- Who sees what after acceptance -------------------------------------------------------------
select tests.login((select id from u where k = 'pm'));
select tests.assert_eq((select count(*) from public.onboarding_requirements), 4::bigint, 'the crew lead sees the onboarding checklist');
select tests.assert_eq((select count(*) from public.color_selections), 1::bigint, 'the crew lead sees the color sheet');
select tests.assert_eq((select count(*) from public.work_orders), 2::bigint, 'the crew lead sees the work orders');
select tests.assert_eq((select count(*) from public.invoices), 0::bigint, 'crew leads never see invoices');
select tests.assert_eq((select count(*) from public.signatures), 0::bigint, 'or signatures');
select tests.assert_eq((select count(*) from public.paint_orders), 0::bigint, 'or paint order costs');
select tests.assert_eq((select string_agg(category, ',') from public.documents), 'color_sheet',
  'crew leads see the color sheet but not the signed contract');
select tests.logout();
select tests.login((select id from u where k = 'est'));
select tests.assert_eq((select count(*) from public.documents), 2::bigint, 'the estimator sees the signed contract and the color sheet');
select tests.assert_eq((select count(*) from public.invoices), 0::bigint, 'estimators without invoice access do not see invoices');
select tests.assert_raises(
  format($q$update public.signatures set signer_name = 'Someone Else' where estimate_version_id = %L$q$, (select id from r where k = 'v1')),
  'signatures cannot be edited', '42501');
select tests.assert_raises(
  format($q$select public.copy_estimate_version(%L)$q$, (select id from r where k = 'v1')),
  'an accepted estimate cannot get a new version (use a change order)', '23514');
select tests.logout();
select tests.login((select id from u where k = 'books'));
select tests.assert_eq((select count(*) from public.invoices), 1::bigint, 'the bookkeeper sees the deposit invoice');
select tests.assert_eq((select sum(amount_cents) from public.invoice_lines), 286837::numeric, 'and its line');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.paint_orders), 1::bigint, 'the office (paint orders) sees the paint order');
select tests.logout();
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.estimates) + (select count(*) from public.invoices) + (select count(*) from public.documents)
                       + (select count(*) from public.onboarding_requirements) + (select count(*) from public.work_orders),
  0::bigint, 'another company sees none of it');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
update public.job_financials set estimate_contract_cents = 1 where job_id = (select id from r where k = 'job');
select tests.assert_eq((select estimate_contract_cents from public.job_financials where job_id = (select id from r where k = 'job')), 956122::bigint,
  'not even an owner can type over the accepted contract amount');
select tests.logout();

-- Discount approvals -------------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
with a as (
  insert into public.approval_requests (org_id, type, job_id, reason, payload)
  values ((select a from o), 'estimate_discount', (select id from r where k = 'job'), 'Neighbor discount for two houses',
          jsonb_build_object('version_id', (select id from r where k = 'v1'), 'discount_percent', 12))
  returning id
) insert into r select 'approval', id from a;
select tests.assert_raises(
  format($q$update public.approval_requests set status = 'approved' where id = %L$q$, (select id from r where k = 'approval')),
  'estimators cannot approve their own discount', '42501');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.approval_requests where type = 'estimate_discount'), 0::bigint,
  'office managers without discount approval do not see discount requests');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
update public.approval_requests set status = 'approved', decision_note = 'OK' where id = (select id from r where k = 'approval');
select tests.assert_eq((select status from public.approval_requests where id = (select id from r where k = 'approval')), 'approved',
  'owners approve discount requests');
select tests.logout();

-- Change orders ------------------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
with c as (
  insert into public.change_orders (org_id, job_id, estimate_id, title, reason, status, total_cents)
  values ((select a from o), (select id from r where k = 'job'), (select id from r where k = 'est'), 'Rot under the front window',
          'Found soft wood during prep', 'signed', 999)
  returning id
) insert into r select 'co', id from c;
select tests.assert((select change_order_number ~ '^CO-' and status = 'draft' and total_cents is null from public.change_orders where id = (select id from r where k = 'co')),
  'a change order starts as a numbered draft (people cannot set its status or total)');
insert into public.estimate_line_items (org_id, change_order_id, kind, name, unit, quantity, unit_price_cents, unit_cost_cents, is_repair_allowance)
values ((select a from o), (select id from r where k = 'co'), 'flat', 'Replace rotted trim', 'lf', 8, 2500, 1200, true);
select tests.logout();
select tests.login_service((select id from u where k = 'owner'));
select public.store_change_order_pricing((select id from r where k = 'co'), '{}', '{}', 20000, 0, 20000, '[]');
select public.mark_change_order_sent((select id from r where k = 'co'), repeat('c', 64), now() + interval '14 days',
  '{"version": 1}'::jsonb, array['email']);
select tests.logout();
select tests.assert((select required and status = 'pending' from public.onboarding_requirements
                     where job_id = (select id from r where k = 'job') and key = 'change_orders_resolved'),
  'a change order waiting on the customer becomes an onboarding item');
select tests.login_service();
select public.accept_change_order(repeat('c', 64), 'Sam Smith', null, 'data:image/png;base64,iVBORw0KGgo=', repeat('d', 64),
  'I approve this change order.', '203.0.113.9', 'test', '{}'::jsonb);
select tests.logout();
select tests.assert((select change_orders_cents = 20000 and contract_cents = 976122 from public.job_financials where job_id = (select id from r where k = 'job')),
  'a signed change order updates the contract amount');
select tests.assert((select invoice_type = 'change_order' and status = 'draft' and total_cents = 20000 from public.invoices where change_order_id = (select id from r where k = 'co')),
  'and drafts a change-order invoice');
select tests.assert((select status = 'verified' from public.onboarding_requirements where job_id = (select id from r where k = 'job') and key = 'change_orders_resolved'),
  'and resolves the change-order onboarding item');

-- Declining and expiring ---------------------------------------------------------------------
select tests.login((select id from u where k = 'est'));
with c as (
  insert into public.change_orders (org_id, job_id, title) values ((select a from o), (select id from r where k = 'job'), 'Extra coat on the garage')
  returning id
) insert into r select 'co2', id from c;
select tests.logout();
select tests.login_service();
select public.mark_change_order_sent((select id from r where k = 'co2'), repeat('e', 64), now() + interval '14 days', '{"version": 1}'::jsonb, '{}');
select public.decline_proposal(repeat('e', 64), 'Not this year');
select tests.logout();
select tests.assert((select status = 'declined' and decline_reason = 'Not this year' from public.change_orders where id = (select id from r where k = 'co2')),
  'customers can decline a change order with a reason');

with j as (
  insert into public.jobs (org_id, name, account_id, work_types, owner_id)
  values (tests.org_id(), 'Smith – Kirkland – Interior', (select id from r where k = 'acct'), '{interior}', (select id from u where k = 'est'))
  returning id
) insert into r select 'job2', id from j;
select tests.login((select id from u where k = 'est'));
insert into r select 'est2', public.create_estimate((select id from r where k = 'job2'));
insert into r select 'v2a', current_version_id from public.estimates where id = (select id from r where k = 'est2');
insert into r select 'v2b', public.copy_estimate_version((select id from r where k = 'v2a'));
select tests.assert_eq((select version_no from public.estimate_versions where id = (select id from r where k = 'v2b')), 2,
  'a copied draft becomes version 2');
select tests.assert_eq((select current_version_id from public.estimates where id = (select id from r where k = 'est2')), (select id from r where k = 'v2b'),
  'and the current version');
select tests.assert_eq((select count(*) from public.estimate_options where version_id = (select id from r where k = 'v2b')), 1::bigint,
  'with its options copied');
delete from public.estimate_versions where id = (select id from r where k = 'v2a');
select tests.assert_eq((select count(*) from public.estimate_versions where estimate_id = (select id from r where k = 'est2')), 1::bigint,
  'a draft version can be discarded');
select tests.assert_raises(format($q$delete from public.estimate_versions where id = %L$q$, (select id from r where k = 'v2b')),
  'but not the last one', '23514');
select tests.logout();
select tests.login_service();
select public.mark_estimate_sent((select id from r where k = 'v2b'), repeat('f', 64), now() + interval '1 day', '{"version": 1}'::jsonb, 50000, '{}');
select tests.logout();
update public.estimate_versions set expires_at = now() - interval '1 minute' where id = (select id from r where k = 'v2b');
update public.proposal_tokens set expires_at = now() - interval '1 minute' where token_hash = repeat('f', 64);
select tests.login_service();
select tests.assert_eq(public.expire_proposals(), 1, 'sent proposals past their date expire');
select tests.assert_raises(
  format($q$select public.accept_estimate(repeat('f', 64), gen_random_uuid(), '{}', 'Sam', null, 'data:image/png;base64,iVBORw0KGgo=',
            repeat('b', 64), 'I accept this proposal.', null, null, '{"totalCents": 1}', '{}')$q$),
  'an expired proposal cannot be signed', '23514');
select tests.logout();
select tests.assert_eq((select status from public.estimates where id = (select id from r where k = 'est2')), 'expired',
  'the estimate shows expired');

-- Metrics ------------------------------------------------------------------------------------
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq((public.estimate_stats(now() - interval '1 day', now() + interval '1 day') ->> 'sent')::int, 2,
  'estimate stats count estimates first sent in the period');
select tests.assert_eq((public.estimate_stats(now() - interval '1 day', now() + interval '1 day') ->> 'accepted_value_cents')::bigint, 956122::bigint,
  'and the accepted value');
select tests.logout();

rollback;
