-- Guard rails for every future migration (SPEC §13.1, §5):
--   1. deny-by-default: RLS is enabled on every table in the app's schemas;
--   2. every business table has the audit trigger;
--   3. anon can read nothing in public.
begin;

select tests.assert_eq(
  (
    select coalesce(string_agg(n.nspname || '.' || c.relname, ', ' order by c.relname), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname in ('public', 'app')
      and not c.relrowsecurity
  ),
  '',
  'every table in public/app has row level security enabled'
);

-- Log/outbox tables, rate-limit counters and the global permission catalog are exempt from row auditing.
-- Phase 8: workflow runs and campaign recipients are send logs (their own record, like the outbox) and
-- message threads are summaries kept by triggers on the (audited) messages.
select tests.assert_eq(
  (
    select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = 'public'
      and c.relname not in ('audit_log', 'activity', 'events', 'integration_outbox', 'permissions', 'rate_limits',
                            'workflow_runs', 'campaign_recipients', 'message_threads')
      and not exists (
        select 1 from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = c.oid and p.proname = 'audit_row' and not t.tgisinternal
      )
  ),
  '',
  'every business table in public has the audit trigger'
);

select tests.assert_eq(
  (
    select coalesce(string_agg(table_name, ', ' order by table_name), '')
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT'
  ),
  '',
  'anon has no SELECT grant on any public table'
);

rollback;
