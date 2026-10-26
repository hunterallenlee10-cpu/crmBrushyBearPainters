-- Assertion helpers for SQL tests (no pgTAP dependency, so the same files run on
-- plain Postgres and on the Supabase stack). Loaded by scripts/test-db.sh.

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is distinct from true then
    raise exception 'FAIL: %', p_message;
  end if;
  raise notice 'ok - %', p_message;
end;
$$;

create or replace function tests.assert_eq(p_actual anyelement, p_expected anyelement, p_message text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % (expected %, got %)', p_message, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_message;
end;
$$;

-- Runs p_sql and passes only if it raises. Optionally checks the SQLSTATE.
create or replace function tests.assert_raises(p_sql text, p_message text, p_sqlstate text default null)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_sqlstate is not null and sqlstate <> p_sqlstate then
      raise exception 'FAIL: % (expected SQLSTATE %, got %: %)', p_message, p_sqlstate, sqlstate, sqlerrm;
    end if;
    raise notice 'ok - %', p_message;
    return;
  end;
  raise exception 'FAIL: % (statement did not raise)', p_message;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
