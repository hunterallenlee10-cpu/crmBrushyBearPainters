-- Audit log (append-only, every mutation) and domain events (SPEC §5, §11.1, §13.1).
begin;

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('painter', tests.make_user('painter@test.bb', 'painter'));
grant select on u to authenticated, service_role;

-- A signed-in owner edits company settings, with request context headers.
select tests.login((select id from u where k = 'owner'));
select set_config('request.headers',
  '{"x-bb-client-ip":"203.0.113.9","x-bb-user-agent":"Playwright Test","x-bb-request-id":"req-123"}', true);
update public.company_settings set phone = '(425) 555-0100';
select tests.logout();

create temp table a as
  select * from public.audit_log
  where table_name = 'public.company_settings' and action = 'update'
  order by id desc limit 1;

select tests.assert_eq((select actor_id from a), (select id from u where k = 'owner'), 'audit row records the actor');
select tests.assert_eq((select before ->> 'phone' from a), '[PHONE]', 'audit row keeps the before value');
select tests.assert_eq((select after ->> 'phone' from a), '(425) 555-0100', 'audit row keeps the after value');
select tests.assert((select 'phone' = any (changed_fields) from a), 'audit row lists changed fields');
select tests.assert_eq((select host(ip) from a), '203.0.113.9', 'audit row records the client IP');
select tests.assert_eq((select user_agent from a), 'Playwright Test', 'audit row records the user agent');
select tests.assert_eq((select request_id from a), 'req-123', 'audit row records the request id');
select tests.assert_eq((select org_id from a), tests.org_id(), 'audit row carries the org');
select tests.assert_eq(
  (select updated_by from public.company_settings where org_id = tests.org_id()),
  (select id from u where k = 'owner'), 'updated_by is stamped server-side');

-- Domain event
select tests.assert_eq(
  (select count(*) from public.events e
   where e.type = 'settings.updated' and e.org_id = tests.org_id()
     and e.payload -> 'changed' ? 'phone' and e.actor_id = (select id from u where k = 'owner')),
  1::bigint, 'settings.updated event emitted with changed fields and actor');

-- No-op updates do not create audit noise
select tests.login((select id from u where k = 'owner'));
select tests.assert_eq(
  (select count(*) from public.audit_log where table_name = 'public.company_settings'),
  (select count(*) from public.audit_log where table_name = 'public.company_settings'), 'baseline');
create temp table before_count as select count(*) as n from public.audit_log where table_name = 'public.company_settings';
update public.company_settings set phone = '(425) 555-0100';
select tests.assert_eq(
  (select count(*) from public.audit_log where table_name = 'public.company_settings'),
  (select n from before_count), 'an update that changes nothing writes no audit row');
select tests.logout();

-- Inserts and deletes are audited too (only rows from here on count)
create temp table marks as
  select (select coalesce(max(id), 0) from public.audit_log) as audit_id,
         (select coalesce(max(id), 0) from public.events) as event_id;
insert into public.user_permission_overrides (org_id, user_id, permission, effect, reason)
values (tests.org_id(), (select id from u where k = 'painter'), 'reports:read', 'grant', 'Audit test');
delete from public.user_permission_overrides where user_id = (select id from u where k = 'painter');
select tests.assert_eq(
  (select string_agg(action, ',' order by id) from public.audit_log where table_name = 'public.user_permission_overrides'
     and id > (select audit_id from marks)),
  'insert,delete', 'insert and delete are audited');
select tests.assert_eq(
  (select string_agg(type, ',' order by id) from public.events where aggregate_type = 'user_permission'
     and id > (select event_id from marks)),
  'user_permission.created,user_permission.deleted', 'insert and delete emit events');

-- Service-role writes carry the acting user from our server
select tests.login_service((select id from u where k = 'owner'));
insert into public.picklist_values (org_id, picklist_id, value, label)
select tests.org_id(), id, 'test_sheen', 'Test sheen' from public.picklists where org_id = tests.org_id() and key = 'sheen';
select tests.logout();
select tests.assert_eq(
  (select actor_id from public.audit_log where table_name = 'public.picklist_values' and after ->> 'value' = 'test_sheen'),
  (select id from u where k = 'owner'), 'service-role writes record the acting user from x-bb-actor-id');
select tests.assert_eq(
  (select created_by from public.picklist_values where value = 'test_sheen'),
  (select id from u where k = 'owner'), 'created_by is stamped for service-role writes');

-- A signed-in user cannot forge the actor header
select tests.login((select id from u where k = 'owner'));
select set_config('request.headers', jsonb_build_object('x-bb-actor-id', (select id from u where k = 'painter'))::text, true);
update public.company_settings set phone = '[PHONE]';
select tests.logout();
select tests.assert_eq(
  (select actor_id from public.audit_log where table_name = 'public.company_settings' order by id desc limit 1),
  (select id from u where k = 'owner'), 'signed-in users cannot spoof the actor');

-- Append-only, even for owners and for postgres
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises($$update public.audit_log set action = 'insert'$$, 'owners cannot edit the audit log', '42501');
select tests.assert_raises($$delete from public.audit_log$$, 'owners cannot delete audit rows', '42501');
select tests.logout();
select tests.assert_raises($$update public.audit_log set user_agent = 'x'$$, 'audit rows cannot be updated at all', '42501');
select tests.assert_raises($$delete from public.audit_log$$, 'audit rows cannot be deleted at all', '42501');
select tests.assert_raises($$truncate public.audit_log$$, 'the audit log cannot be truncated', '42501');

-- Clients cannot write events, activity or the outbox directly
select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(
  format($q$insert into public.integration_outbox (org_id, domain, provider, operation) values (%L, 'sms_voice', 'outbox', 'sms.send')$q$, tests.org_id()),
  'clients cannot write to the outbox', '42501');
select tests.assert_raises(
  format($q$insert into public.activity (org_id, subject_type, subject_id, type, summary) values (%L, 'user', 'x', 'x', 'x')$q$, tests.org_id()),
  'clients cannot write activity directly', '42501');
select tests.logout();

-- Every simulated send emits an event that names who triggered it (ids only, no message text)
select tests.login_service((select id from u where k = 'owner'));
insert into public.integration_outbox (org_id, domain, provider, operation, recipient, rendered_body)
values (tests.org_id(), 'email', 'outbox', 'email.send', 'someone@test.brushybear.local', 'Hello');
select tests.logout();
select tests.assert_eq(
  (select count(*) from public.events where type = 'outbox_message.created'
     and actor_id = (select id from u where k = 'owner')), 1::bigint,
  'a simulated send emits outbox_message.created');
select tests.assert_eq(
  (select actor_id from public.events where type = 'outbox_message.created' order by id desc limit 1),
  (select id from u where k = 'owner'), 'the send event records who triggered it');
select tests.assert(
  (select payload::text not like '%someone@%' from public.events where type = 'outbox_message.created'
     order by id desc limit 1),
  'the send event does not copy the recipient');

rollback;
