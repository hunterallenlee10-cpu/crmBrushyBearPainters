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

-- ---------------------------------------------------------------------------
-- Session helpers: act as a signed-in user exactly like PostgREST does
-- (SET ROLE authenticated + JWT claims). Call tests.logout() to return to postgres.
-- ---------------------------------------------------------------------------
create or replace function tests.login(
  p_user_id uuid,
  p_aal text default 'aal2',
  p_session_id uuid default '00000000-0000-0000-0000-00000000aaaa'
)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user_id, 'role', 'authenticated', 'aal', p_aal, 'session_id', p_session_id)::text, true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.login_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end;
$$;

create or replace function tests.login_service(p_actor_id uuid default null)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers',
    case when p_actor_id is null then '{}' else jsonb_build_object('x-bb-actor-id', p_actor_id)::text end, true);
  execute 'set local role service_role';
end;
$$;

create or replace function tests.logout()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '', true);
end;
$$;

create or replace function tests.org_id(p_slug text default 'brushy-bear')
returns uuid
language sql
stable
as $$
  select id from public.organizations where slug = p_slug;
$$;

-- Creates an auth user + profile on the given role template. Run as postgres.
create or replace function tests.make_user(
  p_email text,
  p_template_key text,
  p_org_id uuid default null,
  p_full_name text default null
)
returns uuid
language plpgsql
as $$
declare
  v_org uuid := coalesce(p_org_id, tests.org_id());
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, lower(p_email));
  insert into public.profiles (id, org_id, email, full_name, role_template_id)
  select v_id, v_org, lower(p_email), coalesce(p_full_name, split_part(p_email, '@', 1)), t.id
  from public.role_templates t where t.org_id = v_org and t.key = p_template_key;
  if not found then
    raise exception 'No template % in org %', p_template_key, v_org;
  end if;
  return v_id;
end;
$$;

-- Number of rows an UPDATE/DELETE statement touched (RLS silently filters rows).
create or replace function tests.rows_affected(p_sql text)
returns bigint
language plpgsql
as $$
declare
  v bigint;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
