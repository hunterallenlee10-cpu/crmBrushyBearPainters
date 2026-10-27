-- Row level security on platform tables, per role and across organizations.
begin;

-- A second tenant proves isolation.
insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter')),
  ('bookkeeper', tests.make_user('books@test.bb', 'bookkeeper')),
  ('other_owner', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co')));
grant select on u to authenticated;

insert into public.profile_compensation (profile_id, org_id, hourly_cost_cents)
values ((select id from u where k = 'painter'), tests.org_id(), 3200);

-- Some audit rows exist for org A.
update public.company_settings set hours_text = '[HOURS] ' where org_id = tests.org_id();
update public.company_settings set hours_text = '[HOURS]' where org_id = tests.org_id();

-- anon --------------------------------------------------------------------------
select tests.login_anon();
select tests.assert_raises($$select count(*) from public.profiles$$, 'anon cannot read profiles', '42501');
select tests.assert_raises($$select count(*) from public.permissions$$, 'anon cannot read the permission catalog', '42501');
select tests.assert_raises($$select public.my_access()$$, 'anon cannot call my_access', '42501');
select tests.logout();

-- painter -------------------------------------------------------------------------
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.profiles where org_id = tests.org_id('other-co')), 0::bigint,
  'painter sees no profiles from another org');
select tests.assert((select count(*) from public.profiles) >= 4, 'painter sees the team directory');
select tests.assert_eq((select count(*) from public.company_settings), 1::bigint, 'painter reads own company settings only');
select tests.assert_eq(tests.rows_affected($$update public.company_settings set phone = '555'$$), 0::bigint,
  'painter cannot edit company settings');
select tests.assert_raises(
  format($q$insert into public.picklist_values (org_id, picklist_id, value, label)
            select %L, id, 'x_test', 'X test' from public.picklists where key = 'sheen'$q$, tests.org_id()),
  'painter cannot add picklist values', '42501');
select tests.assert_eq((select count(*) from public.audit_log), 0::bigint, 'painter cannot read the audit log');
select tests.assert_eq((select count(*) from public.integration_connections), 0::bigint, 'painter cannot see integrations');
select tests.assert_eq((select count(*) from public.integration_outbox), 0::bigint, 'painter cannot see the outbox');
select tests.assert_eq((select count(*) from public.profile_compensation), 0::bigint, 'painter cannot see labor cost');
select tests.assert_raises($$select count(*) from public.events$$, 'nobody signed in reads domain events directly', '42501');
select tests.assert((select count(*) from public.permissions) >= 80, 'painter can read the permission catalog');
select tests.assert_eq(
  tests.rows_affected(format($q$update public.profiles set full_name = 'Pat Painter' where id = %L$q$, (select id from u where k = 'painter'))),
  1::bigint, 'painter can edit own name');
select tests.assert_raises(
  format($q$update public.profiles set role_template_id = (select id from public.role_templates where key = 'office_manager' and org_id = %L) where id = %L$q$,
         tests.org_id(), (select id from u where k = 'painter')),
  'painter cannot change own role', '42501');
select tests.assert_eq(
  tests.rows_affected(format($q$update public.profiles set full_name = 'Hacked' where id = %L$q$, (select id from u where k = 'office'))),
  0::bigint, 'painter cannot edit someone else''s profile');
select tests.assert_eq((select count(*) from public.user_permission_overrides), 0::bigint, 'painter sees only own overrides (none)');
select tests.logout();

-- office manager --------------------------------------------------------------------
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.integration_connections), 11::bigint, 'office sees the 11 integrations');
select tests.assert_eq((select count(*) from public.audit_log), 0::bigint, 'office cannot read the audit log');
select tests.assert_eq(tests.rows_affected($$update public.company_settings set phone = '555'$$), 0::bigint,
  'office cannot edit company settings');
select tests.assert_eq(tests.rows_affected($$update public.integration_connections set notes = 'x'$$), 0::bigint,
  'office cannot configure integrations');
select tests.assert_eq(tests.rows_affected($$update public.role_templates set description = 'x' where key = 'painter'$$), 0::bigint,
  'office cannot edit role templates');
select tests.logout();

-- bookkeeper (aal2) ---------------------------------------------------------------------
select tests.login((select id from u where k = 'bookkeeper'));
-- Phase 7: job costing reads each person's hourly cost (owners and the bookkeeper, SPEC §5.6);
-- changing it stays HR-only.
select tests.assert(not app.has_perm('hr:read'), 'bookkeeper has no HR permission by default');
select tests.assert_eq(tests.rows_affected($$update public.profile_compensation set hourly_cost_cents = 1$$), 0::bigint,
  'bookkeeper cannot change labor cost');
select tests.logout();

-- owner -----------------------------------------------------------------------------------
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq((select count(*) from public.integration_connections), 11::bigint, 'owner sees 11 integrations');
select tests.assert((select count(*) from public.audit_log) > 0, 'owner reads the audit log');
select tests.assert_eq((select count(*) from public.audit_log where org_id = tests.org_id('other-co')), 0::bigint,
  'owner sees no audit rows from another org');
select tests.assert_eq((select hourly_cost_cents from public.profile_compensation), 3200::bigint, 'owner sees labor cost');
select tests.assert_eq(tests.rows_affected($$update public.company_settings set phone = '[PHONE]'$$), 1::bigint,
  'owner edits own company settings');
select tests.assert_eq(
  tests.rows_affected(format($q$update public.company_settings set phone = '1' where org_id = %L$q$, tests.org_id('other-co'))),
  0::bigint, 'owner cannot edit another org''s settings');
select tests.assert_eq((select count(*) from public.profiles where org_id = tests.org_id('other-co')), 0::bigint,
  'owner sees no profiles from another org');
select tests.assert_eq((select count(*) from public.organizations), 1::bigint, 'owner sees only their organization');
select tests.assert_eq((public.integration_summary() ->> 'total')::int, 11, 'integration summary counts 11 domains');
select tests.assert_eq((public.integration_summary() ->> 'connected')::int, 0, 'nothing is connected');
select tests.logout();

select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.profiles), 1::bigint, 'the other org''s owner sees only their own team');
select tests.assert_eq((select company_name from public.company_settings), 'Brushy Bear Painters',
  'other org has its own settings row');
select tests.logout();

rollback;
