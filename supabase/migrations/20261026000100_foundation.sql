-- Phase 0 · Foundation
-- Organizations, shared helpers, and per-year human-friendly numbers (SPEC §5).
-- Rollback: supabase/rollbacks/20261026000100_foundation.down.sql

-- Private schema for helpers. Not exposed through the Data API (only `public` is).
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at. Attach to every user-facing table.';

-- ---------------------------------------------------------------------------
-- organizations (multi-tenant ready; SPEC §5 general rules)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  timezone text not null default 'America/Los_Angeles',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is
  'Tenants. Every business table carries org_id referencing this table.';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function app.set_updated_at();

-- Deny by default. Read policies arrive with profiles in Phase 1.
alter table public.organizations enable row level security;

-- ---------------------------------------------------------------------------
-- Per-year document numbers: BB-2026-0001, EST-2026-0001, INV-…, PMT-…, WO-…, CO-…
-- ---------------------------------------------------------------------------
create table app.number_sequences (
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('job', 'estimate', 'invoice', 'payment', 'work_order', 'change_order')),
  year integer not null check (year between 2000 and 2999),
  last_value integer not null default 0 check (last_value >= 0),
  primary key (org_id, kind, year)
);

comment on table app.number_sequences is
  'Counters behind app.next_number(). One row per org, kind and (org-local) year.';

alter table app.number_sequences enable row level security;
revoke all on app.number_sequences from public, anon, authenticated;

create or replace function app.number_prefix(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'job' then 'BB'
    when 'estimate' then 'EST'
    when 'invoice' then 'INV'
    when 'payment' then 'PMT'
    when 'work_order' then 'WO'
    when 'change_order' then 'CO'
  end;
$$;

-- Returns the next number for the org, e.g. 'BB-2026-0042'.
-- The year follows the org's local time zone (a job created 8 pm Dec 31 Pacific is that year's).
-- Concurrency-safe: the upsert takes a row lock, so two callers never get the same value.
create or replace function app.next_number(p_org_id uuid, p_kind text, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := app.number_prefix(p_kind);
  v_tz text;
  v_year integer;
  v_value integer;
begin
  if v_prefix is null then
    raise exception 'Unknown number kind: %', p_kind using errcode = '22023';
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = p_org_id;
  if v_tz is null then
    raise exception 'Unknown organization: %', p_org_id using errcode = '22023';
  end if;

  v_year := extract(year from (p_at at time zone v_tz))::integer;

  insert into app.number_sequences as s (org_id, kind, year, last_value)
  values (p_org_id, p_kind, v_year, 1)
  on conflict (org_id, kind, year)
    do update set last_value = s.last_value + 1
  returning s.last_value into v_value;

  -- Pad to 4 digits; never truncate (the 10,000th job is BB-2026-10000).
  return v_prefix || '-' || v_year || '-' || lpad(v_value::text, greatest(4, length(v_value::text)), '0');
end;
$$;

comment on function app.next_number(uuid, text, timestamptz) is
  'Next human-friendly number for an org (BB-YYYY-NNNN etc.). Called from SECURITY DEFINER insert triggers.';

-- Only trusted server code (service role) and definer triggers may mint numbers.
revoke all on function app.next_number(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function app.next_number(uuid, text, timestamptz) to service_role;
