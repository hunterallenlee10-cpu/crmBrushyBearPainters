-- Guard rail for every future migration: deny-by-default means RLS is enabled
-- on every table in the app's schemas (SPEC §13.1).
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

rollback;
