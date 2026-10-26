-- Permission engine (SPEC §4.1–4.2): what each seeded role template resolves to,
-- overrides, deleted packs, inactive users, and MFA enforcement in the database.
begin;

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('estimator', tests.make_user('estimator@test.bb', 'estimator')),
  ('pm', tests.make_user('pm@test.bb', 'project_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter')),
  ('sub', tests.make_user('sub@test.bb', 'subcontractor')),
  ('bookkeeper', tests.make_user('books@test.bb', 'bookkeeper')),
  ('readonly', tests.make_user('advisor@test.bb', 'read_only'));
grant select on u to authenticated;

create function pg_temp.scope(p_user text, p_perm text) returns text language sql as $$
  select app.user_perm_scope((select id from u where k = p_user), p_perm);
$$;

-- Seeded catalog --------------------------------------------------------------
select tests.assert_eq((select count(*) from public.role_templates where org_id = tests.org_id() and is_system), 8::bigint,
  '8 role templates are seeded');
select tests.assert((select count(*) from public.permissions) >= 80, 'permission catalog is seeded');
select tests.assert_eq(
  (select string_agg(key, ',' order by key) from public.role_templates
   where org_id = tests.org_id() and is_system and requires_mfa),
  'bookkeeper,owner', 'MFA is required for Owner and Bookkeeper only');

-- Owner: everything -----------------------------------------------------------
select tests.assert_eq(
  (select count(*) from public.permissions c where pg_temp.scope('owner', c.key) = 'all'),
  (select count(*) from public.permissions), 'owner holds every permission');

-- Office manager --------------------------------------------------------------
select tests.assert_eq(pg_temp.scope('office', 'leads:read'), 'all', 'office reads every lead');
select tests.assert_eq(pg_temp.scope('office', 'payments:record'), 'all', 'office records payments');
select tests.assert_eq(pg_temp.scope('office', 'financials:read'), 'all', 'office sees contract amounts');
select tests.assert(pg_temp.scope('office', 'job_costing:read') is null, 'office cannot see margins');
select tests.assert(pg_temp.scope('office', 'roles:manage') is null, 'office cannot edit permissions');
select tests.assert(pg_temp.scope('office', 'estimates:approve_discount') is null, 'office cannot approve discounts');

-- Estimator -------------------------------------------------------------------
select tests.assert_eq(pg_temp.scope('estimator', 'leads:read'), 'own', 'estimator reads own leads');
select tests.assert_eq(pg_temp.scope('estimator', 'jobs:read'), 'own', 'estimator reads own jobs');
select tests.assert_eq(pg_temp.scope('estimator', 'estimates:send'), 'all', 'estimator sends estimates');
select tests.assert_eq(pg_temp.scope('estimator', 'commissions:read'), 'own', 'estimator sees own commissions');
select tests.assert(pg_temp.scope('estimator', 'financials:read') is null, 'estimator has no company financials');

-- Crew lead / painter / sub: nothing financial (SPEC §4.1) ----------------------
select tests.assert_eq(pg_temp.scope('pm', 'jobs:read'), 'own', 'crew lead reads assigned jobs');
select tests.assert_eq(pg_temp.scope('pm', 'contacts:read'), 'own', 'crew lead sees contacts on own jobs');
select tests.assert_eq(pg_temp.scope('pm', 'punch_list:manage'), 'all', 'crew lead manages punch lists');
select tests.assert_eq(pg_temp.scope('painter', 'photos:upload'), 'all', 'painter uploads photos');
select tests.assert(pg_temp.scope('painter', 'contacts:read') is null, 'painter has no customer contact list');
select tests.assert_eq(
  (select count(*) from u cross join public.permissions c
   where u.k in ('pm', 'painter', 'sub') and c.category = 'finance' and pg_temp.scope(u.k, c.key) is not null),
  0::bigint, 'crew lead, painter and subcontractor hold no finance permission');
select tests.assert_eq(
  (select string_agg(c.key, ',' order by c.key) from public.permissions c where pg_temp.scope('sub', c.key) is not null),
  (select string_agg(c.key, ',' order by c.key) from public.permissions c where pg_temp.scope('painter', c.key) is not null),
  'subcontractor matches painter until compliance docs arrive');

-- Bookkeeper / read-only ----------------------------------------------------------
select tests.assert_eq(pg_temp.scope('bookkeeper', 'job_costing:read'), 'all', 'bookkeeper sees job costing');
select tests.assert_eq(pg_temp.scope('bookkeeper', 'data:export'), 'all', 'bookkeeper exports');
select tests.assert_eq(pg_temp.scope('bookkeeper', 'leads:read'), 'all', 'bookkeeper reads everything');
select tests.assert(pg_temp.scope('bookkeeper', 'leads:update') is null, 'bookkeeper is read-only outside finance');
select tests.assert_eq(pg_temp.scope('readonly', 'financials:read'), 'all', 'read-only sees dashboard money');
select tests.assert(pg_temp.scope('readonly', 'data:export') is null, 'read-only cannot export');
select tests.assert(pg_temp.scope('readonly', 'leads:update') is null, 'read-only cannot edit');
select tests.assert(pg_temp.scope('readonly', 'reports:build') is null, 'read-only cannot build reports');

-- Overrides ---------------------------------------------------------------------
insert into public.user_permission_overrides (org_id, user_id, permission, effect, reason)
values (tests.org_id(), (select id from u where k = 'painter'), 'financials:read', 'grant', 'Test grant'),
       (tests.org_id(), (select id from u where k = 'office'), 'leads:delete', 'revoke', 'Test revoke');
select tests.assert_eq(pg_temp.scope('painter', 'financials:read'), 'all', 'grant override adds a permission');
select tests.assert(pg_temp.scope('office', 'leads:delete') is null, 'revoke override removes a permission');
select tests.assert_raises(
  format($q$insert into public.user_permission_overrides (org_id, user_id, permission, effect, reason)
            values (%L, %L, 'leads:read', 'revoke', 'nope')$q$, tests.org_id(), (select id from u where k = 'owner')),
  'overrides cannot be set on owners', '23514');

-- Deleted packs and inactive users ------------------------------------------------
update public.permission_packs set deleted_at = now() where org_id = tests.org_id() and key = 'office_admin';
select tests.assert(pg_temp.scope('office', 'users:read') is null, 'a deleted pack no longer grants anything');
update public.permission_packs set deleted_at = null where org_id = tests.org_id() and key = 'office_admin';

update public.profiles set is_active = false where id = (select id from u where k = 'readonly');
select tests.assert(pg_temp.scope('readonly', 'reports:read') is null, 'an inactive user holds no permissions');

-- Sessions and MFA (enforced in Postgres) -----------------------------------------
select tests.login((select id from u where k = 'bookkeeper'), 'aal1');
select tests.assert(not app.session_ok(), 'bookkeeper session at aal1 is not valid');
select tests.assert(app.current_org_id() is null, 'aal1 bookkeeper has no org access');
select tests.assert(not app.has_perm('invoices:read'), 'aal1 bookkeeper has no permissions');
select tests.assert_eq((public.my_access() -> 'mfa' ->> 'required')::boolean, true, 'my_access reports MFA required');
select tests.assert_eq(public.my_access() -> 'permissions', '{}'::jsonb, 'my_access returns no permissions before MFA');
select tests.logout();

select tests.login((select id from u where k = 'bookkeeper'), 'aal2');
select tests.assert(app.has_perm('invoices:read'), 'bookkeeper at aal2 has permissions');
select tests.logout();

select tests.login((select id from u where k = 'owner'), 'aal1');
select tests.assert(not app.has_perm('leads:read'), 'owner without MFA has no permissions');
select tests.logout();

select tests.login((select id from u where k = 'owner'), 'aal2');
select tests.assert_eq(
  (select count(*) from jsonb_object_keys(public.my_access() -> 'permissions')),
  (select count(*) from public.permissions), 'owner at aal2 gets every permission from my_access');
select tests.assert_eq((public.my_access() ->> 'session_ok')::boolean, true, 'owner at aal2 has a valid session');
select tests.logout();

select tests.login((select id from u where k = 'painter'), 'aal1');
select tests.assert(app.has_perm('photos:upload'), 'painter does not need MFA');
select tests.assert_eq(public.my_access() -> 'user' ->> 'email', 'painter@test.bb', 'my_access returns the user');
select tests.logout();

select tests.login((select id from u where k = 'readonly'), 'aal2');
select tests.assert(not app.session_ok(), 'a deactivated user has no valid session');
select tests.logout();

rollback;
