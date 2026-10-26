-- Business invariants enforced in the database.
begin;

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter'));
grant select on u to authenticated;

-- At least one active owner ----------------------------------------------------------
update public.profiles set is_active = false where id = (select id from u where k = 'owner');
select tests.assert_raises($$set constraints all immediate$$, 'the last active owner cannot be deactivated', '23514');
rollback;

begin;
create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('owner2', tests.make_user('owner2@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter'));
grant select on u to authenticated;
set constraints all immediate;

update public.profiles set is_active = false where id = (select id from u where k = 'owner2');
select tests.assert(
  (select deactivated_at is not null from public.profiles where id = (select id from u where k = 'owner2')),
  'with another owner active, an owner can be deactivated (and deactivated_at is stamped)');
update public.profiles set is_active = true where id = (select id from u where k = 'owner2');
select tests.assert(
  (select deactivated_at is null from public.profiles where id = (select id from u where k = 'owner2')),
  'reactivating clears deactivated_at');

-- Owners cannot deactivate themselves
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(
  format($q$update public.profiles set is_active = false where id = %L$q$, (select id from u where k = 'owner')),
  'you cannot deactivate yourself', '42501');
select tests.logout();

-- Only owners can hand out the Owner role (even with users:manage)
insert into public.user_permission_overrides (org_id, user_id, permission, effect, reason)
values (tests.org_id(), (select id from u where k = 'office'), 'users:manage', 'grant', 'Guard test');
select tests.login((select id from u where k = 'office'));
select tests.assert_raises(
  format($q$update public.profiles set role_template_id = (select id from public.role_templates where org_id = %L and key = 'owner') where id = %L$q$,
         tests.org_id(), (select id from u where k = 'painter')),
  'a non-owner cannot assign the Owner role', '42501');
select tests.assert_eq(
  tests.rows_affected(format($q$update public.profiles set title = 'Crew Lead' where id = %L$q$, (select id from u where k = 'painter'))),
  1::bigint, 'users:manage can edit another user''s profile');
select tests.logout();

-- Role templates and packs -------------------------------------------------------------
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises($$update public.role_templates set name = 'Boss' where key = 'owner'$$,
  'the Owner template is locked', '42501');
select tests.assert_raises(
  format($q$insert into public.template_packs (org_id, template_id, pack_id)
            select %L, t.id, p.id from public.role_templates t, public.permission_packs p
            where t.key = 'owner' and p.key = 'reporting'$q$, tests.org_id()),
  'the Owner template''s packs are locked', '42501');
select tests.assert_raises(
  format($q$insert into public.role_templates (org_id, key, name, grants_all) values (%L, 'boss', 'Boss', true)$q$, tests.org_id()),
  'custom templates cannot be owner-level', '42501');
select tests.assert_raises(
  format($q$insert into public.pack_permissions (org_id, pack_id, permission)
            select %L, id, 'hr:read' from public.permission_packs where key = 'field_crew'$q$, tests.org_id()),
  'system packs are read-only', '42501');
insert into public.permission_packs (org_id, key, name, category) values (tests.org_id(), 'custom_pack', 'Custom pack', 'production');
insert into public.pack_permissions (org_id, pack_id, permission)
select tests.org_id(), id, 'crews:read' from public.permission_packs where key = 'custom_pack';
select tests.assert_eq(
  (select count(*) from public.pack_permissions pp join public.permission_packs p on p.id = pp.pack_id where p.key = 'custom_pack'),
  1::bigint, 'custom packs are editable');
insert into public.role_templates (org_id, key, name) values (tests.org_id(), 'helper', 'Helper');
insert into public.template_packs (org_id, template_id, pack_id)
select tests.org_id(), t.id, p.id from public.role_templates t, public.permission_packs p where t.key = 'helper' and p.key = 'custom_pack';
select tests.assert_eq(
  (select count(*) from public.template_packs tp join public.role_templates t on t.id = tp.template_id where t.key = 'helper'),
  1::bigint, 'custom templates can be built from packs');
select tests.assert_raises($$update public.integration_connections set status = 'connected' where domain = 'sms_voice'$$,
  'no integration can be marked connected in this build', '42501');
select tests.logout();

-- Picklists ----------------------------------------------------------------------------
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises($$update public.picklist_values set value = 'glossy' where value = 'gloss'$$,
  'a value''s key cannot change', '42501');
select tests.assert_eq(tests.rows_affected($$delete from public.picklist_values where value = 'gloss'$$), 0::bigint,
  'values cannot be deleted (turn them off instead)');
select tests.assert_eq(tests.rows_affected($$update public.picklist_values set label = 'High gloss', active = false where value = 'gloss'$$),
  1::bigint, 'labels can be edited and values turned off');
select tests.assert_raises(
  format($q$insert into public.picklist_values (org_id, picklist_id, value, label)
            select %L, id, 'satin_2', 'SATIN' from public.picklists where key = 'sheen'$q$, tests.org_id()),
  'labels are unique per picklist, ignoring case', '23505');
select public.reorder_picklist_values(
  (select id from public.picklists where key = 'sheen'),
  (select array_agg(id order by sort_order desc) from public.picklist_values pv
   where pv.picklist_id = (select id from public.picklists where key = 'sheen')));
select tests.assert_eq(
  (select value from public.picklist_values
   where picklist_id = (select id from public.picklists where key = 'sheen') order by sort_order limit 1),
  'gloss', 'values can be reordered');
select tests.assert_raises(
  format('select public.reorder_picklist_values(%L, array[]::uuid[])', (select id from public.picklists where key = 'sheen')),
  'a reorder must list every value', '22023');
select tests.logout();

select tests.login((select id from u where k = 'painter'));
select tests.assert_raises(
  format('select public.reorder_picklist_values(%L, array[]::uuid[])', (select id from public.picklists where key = 'sheen')),
  'painters cannot reorder picklists', '42501');
select tests.logout();

-- Territories ------------------------------------------------------------------------
select tests.assert_eq(app.territory_for_zip(tests.org_id(), '98033'),
  (select id from public.territories where name = 'Kirkland'), 'ZIP 98033 maps to Kirkland');
select tests.assert_eq(app.territory_for_zip(tests.org_id(), '98033-1234'),
  (select id from public.territories where name = 'Kirkland'), 'ZIP+4 maps by its first five digits');
select tests.assert(app.territory_for_zip(tests.org_id(), '98101') is null, 'a Seattle ZIP is out of area');

select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(
  format($q$insert into public.territories (org_id, name, zip_codes) values (%L, 'Medina', array['98004'])$q$, tests.org_id()),
  'a ZIP can belong to only one territory', '23505');
select tests.assert_raises(
  format($q$insert into public.territories (org_id, name, zip_codes) values (%L, 'Bad', array['9800'])$q$, tests.org_id()),
  'ZIPs must be five digits', '23514');

-- Soft delete and restore
select public.soft_delete_record('territories', (select id from public.territories where name = 'Kirkland'), 'Merged into Redmond');
select tests.assert_eq((select count(*) from public.territories where name = 'Kirkland'), 0::bigint, 'deleted records disappear');
select tests.assert_eq((select count(*) from public.list_deleted_records() where label = 'Kirkland'), 1::bigint,
  'deleted records are listed for restore');
select public.restore_record('territories', (select record_id from public.list_deleted_records() where label = 'Kirkland'));
select tests.assert_eq((select count(*) from public.territories where name = 'Kirkland'), 1::bigint, 'restore brings it back');
select tests.assert_raises(
  format($q$select public.soft_delete_record('role_templates', %L, 'cleanup')$q$, (select id from public.role_templates where key = 'painter')),
  'built-in templates cannot be deleted', '42501');
select tests.assert_raises($$select public.soft_delete_record('profiles', gen_random_uuid(), 'nope')$$,
  'only supported modules can be soft-deleted', '22023');
select tests.assert_raises(
  format($q$select public.soft_delete_record('territories', %L, '')$q$, (select id from public.territories where name = 'Redmond')),
  'a reason is required', '22023');
select tests.assert_eq(public.open_work_counts((select id from u where k = 'painter')), '{}'::jsonb,
  'open work counts are empty until modules exist');
select tests.logout();

select tests.login((select id from u where k = 'painter'));
select tests.assert_raises(
  format($q$select public.soft_delete_record('territories', %L, 'nope')$q$, (select id from public.territories where name = 'Redmond')),
  'painters cannot delete territories', '42501');
select tests.assert_raises($$select * from public.list_deleted_records()$$, 'painters cannot list deleted records', '42501');
select tests.assert_raises(format('select public.open_work_counts(%L)', (select id from u where k = 'painter')),
  'painters cannot see open work counts', '42501');
select tests.logout();

-- Profiles data hygiene
select tests.assert_raises(
  $$insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000bad1', 'Bad@Example.com');
    insert into public.profiles (id, org_id, email, full_name, role_template_id)
    select '00000000-0000-0000-0000-00000000bad1', tests.org_id(), 'Bad@Example.com', 'Bad', id
    from public.role_templates where key = 'painter' and org_id = tests.org_id()$$,
  'emails are stored lowercase', '23514');

rollback;
