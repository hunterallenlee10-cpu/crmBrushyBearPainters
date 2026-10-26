-- View as user (SPEC §4.2): owners only, read-only, scoped to one login session, audited.
begin;

insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter', null, 'Pat Painter')),
  ('former', tests.make_user('former@test.bb', 'painter')),
  ('other', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co')));
update public.profiles set is_active = false where id = (select id from u where k = 'former');
grant select on u to authenticated;

-- Session S1 starts viewing as the painter.
select tests.login((select id from u where k = 'owner'), 'aal2', '00000000-0000-0000-0000-000000000001'::uuid);
select public.start_view_as((select id from u where k = 'painter'));
select tests.assert(app.is_impersonating(), 'owner is now viewing as the painter');
select tests.assert_eq(app.effective_user_id(), (select id from u where k = 'painter'), 'effective user is the painter');
select tests.assert(not app.has_perm('financials:read'), 'permissions are the painter''s (no financials)');
select tests.assert(app.has_perm('photos:upload'), 'painter permissions apply');
select tests.assert_eq(public.my_access() -> 'effective_user' ->> 'full_name', 'Pat Painter', 'my_access shows who is being viewed');
select tests.assert(public.my_access() -> 'impersonation' is not null and public.my_access() -> 'impersonation' <> 'null'::jsonb,
  'my_access reports the impersonation');
select tests.assert_eq(public.my_access() -> 'user' ->> 'email', 'owner@test.bb', 'my_access still names the real user');
select tests.assert((select count(*) from public.profiles) >= 3, 'reads still work while viewing');
select tests.assert_eq(
  tests.rows_affected(format($q$update public.profiles set full_name = 'Changed' where id = %L$q$, (select id from u where k = 'owner'))),
  0::bigint, 'the owner cannot edit even their own profile while viewing');
select tests.assert_eq(
  tests.rows_affected(format($q$update public.profiles set full_name = 'Changed' where id = %L$q$, (select id from u where k = 'painter'))),
  0::bigint, 'the viewed user''s own-profile right does not transfer');
select tests.assert(not app.can_write('photos:upload'), 'no write permission holds while viewing');
select tests.assert_raises($$select public.soft_delete_record('territories', (select id from public.territories limit 1), 'test')$$,
  'RPC writes are blocked while viewing', '42501');
select tests.logout();

-- The same owner in another login session is not affected.
select tests.login((select id from u where k = 'owner'), 'aal2', '00000000-0000-0000-0000-000000000002'::uuid);
select tests.assert(not app.is_impersonating(), 'another session of the same owner is not impersonating');
select tests.assert(app.has_perm('financials:read'), 'the other session keeps owner permissions');
select tests.logout();

-- Audit + event
select tests.assert_eq(
  (select count(*) from public.audit_log where table_name = 'app.impersonation_sessions'
     and after ->> 'event' = 'view_as_started' and actor_id = (select id from u where k = 'owner')),
  1::bigint, 'starting View as user is audit-logged');
select tests.assert_eq((select count(*) from public.events where type = 'user.view_as_started'
    and (select id from u where k = 'owner') in (actor_id, impersonated_by)), 1::bigint,
  'starting View as user emits an event');

-- Stop
select tests.login((select id from u where k = 'owner'), 'aal2', '00000000-0000-0000-0000-000000000001'::uuid);
select public.stop_view_as();
select tests.assert(not app.is_impersonating(), 'stop returns to the owner''s own view');
select tests.assert(app.has_perm('financials:read'), 'owner permissions are back');
select tests.logout();
select tests.assert_eq((select count(*) from public.audit_log where after ->> 'event' = 'view_as_ended'
    and (select id from u where k = 'owner') in (actor_id, impersonated_by)), 1::bigint,
  'stopping is audit-logged');

-- Sessions expire after an hour
select tests.login((select id from u where k = 'owner'), 'aal2', '00000000-0000-0000-0000-000000000001'::uuid);
select public.start_view_as((select id from u where k = 'painter'));
select tests.logout();
update app.impersonation_sessions set expires_at = now() - interval '1 second' where ended_at is null;
select tests.login((select id from u where k = 'owner'), 'aal2', '00000000-0000-0000-0000-000000000001'::uuid);
select tests.assert(not app.is_impersonating(), 'an expired session no longer applies');
select tests.logout();

-- Who can start, and whom
select tests.login((select id from u where k = 'office'));
select tests.assert_raises(format('select public.start_view_as(%L)', (select id from u where k = 'painter')),
  'non-owners cannot view as another user', '42501');
select tests.logout();

select tests.login((select id from u where k = 'owner'), 'aal1');
select tests.assert_raises(format('select public.start_view_as(%L)', (select id from u where k = 'painter')),
  'owners must have completed MFA', '42501');
select tests.logout();

select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(format('select public.start_view_as(%L)', (select id from u where k = 'owner')),
  'cannot view as yourself', '22023');
select tests.assert_raises(format('select public.start_view_as(%L)', (select id from u where k = 'other')),
  'cannot view as a user in another org', '22023');
select tests.assert_raises(format('select public.start_view_as(%L)', (select id from u where k = 'former')),
  'cannot view as a deactivated user', '22023');
select tests.logout();

rollback;
