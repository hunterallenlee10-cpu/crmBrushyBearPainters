-- Phase 1 · Platform
-- Permission engine, users/profiles, company settings, territories, picklists,
-- audit log, activity, domain events, integrations, View-as-user, soft delete.
-- Rollback: supabase/rollbacks/20261026000200_platform.down.sql
--
-- Conventions
--   * RLS on every table, deny by default.
--   * Helpers live in schema `app` (not exposed through the Data API).
--   * Policies wrap helper calls in (select …) so Postgres evaluates them once per statement.
--   * Writes are always denied while the real user is in View-as-user mode.

-- =============================================================================
-- 1. Permission catalog (global) and per-org packs / role templates
-- =============================================================================

create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+:[a-z_]+$'),
  resource text not null,
  action text not null,
  label text not null,
  category text not null check (category in (
    'core_records', 'sales', 'production', 'finance', 'data_reporting',
    'operational_control', 'hr_sensitive')),
  description text,
  supports_scope boolean not null default false,
  sort_order integer not null default 0,
  check (key = resource || ':' || action)
);
comment on table public.permissions is 'Catalog of every resource action (SPEC §4.2). Mirrors lib/permissions/catalog.ts.';

create table public.role_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text,
  is_system boolean not null default false,
  grants_all boolean not null default false,
  requires_mfa boolean not null default false,
  is_crew boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, key)
);
create index role_templates_org_idx on public.role_templates (org_id);

create table public.permission_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  category text not null check (category in (
    'core_records', 'sales', 'production', 'finance', 'data_reporting',
    'operational_control', 'hr_sensitive')),
  description text,
  is_system boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, key)
);
create index permission_packs_org_idx on public.permission_packs (org_id);

create table public.pack_permissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  pack_id uuid not null references public.permission_packs (id) on delete cascade,
  permission text not null references public.permissions (key) on update cascade,
  scope text not null default 'all' check (scope in ('own', 'team', 'all')),
  created_at timestamptz not null default now(),
  unique (pack_id, permission)
);
create index pack_permissions_pack_idx on public.pack_permissions (pack_id);
create index pack_permissions_perm_idx on public.pack_permissions (permission);

create table public.template_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  template_id uuid not null references public.role_templates (id) on delete cascade,
  pack_id uuid not null references public.permission_packs (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (template_id, pack_id)
);
create index template_packs_template_idx on public.template_packs (template_id);
create index template_packs_pack_idx on public.template_packs (pack_id);

-- =============================================================================
-- 2. Territories (SPEC §5.1)
-- =============================================================================

create or replace function app.all_zips_valid(p_zips text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(z ~ '^[0-9]{5}$'), true) from unnest(p_zips) z;
$$;

create table public.territories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  zip_codes text[] not null default '{}',
  is_service_area boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  -- Every ZIP is exactly five digits (normalized on input; SPEC §3.4).
  check (app.all_zips_valid(zip_codes))
);
create unique index territories_org_name_uidx on public.territories (org_id, lower(name)) where deleted_at is null;
create index territories_zip_gin on public.territories using gin (zip_codes);

-- =============================================================================
-- 3. Users / profiles (SPEC §5.1, §4.3)
-- =============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  org_id uuid not null references public.organizations (id) on delete restrict,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  phone text,
  title text,
  department text,
  avatar_path text,
  role_template_id uuid not null references public.role_templates (id),
  is_active boolean not null default true,
  deactivated_at timestamptz,
  deactivated_by uuid,
  signature text,
  default_territory_id uuid references public.territories (id),
  calendar_color text check (calendar_color is null or calendar_color ~ '^#[0-9A-Fa-f]{6}$'),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  invited_at timestamptz,
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, email)
);
create index profiles_org_idx on public.profiles (org_id);
create index profiles_template_idx on public.profiles (role_template_id);
create index profiles_territory_idx on public.profiles (default_territory_id);

-- Sensitive (HR) fields live apart from profiles so field-level access is a table policy.
create table public.profile_compensation (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  hourly_cost_cents bigint check (hourly_cost_cents is null or hourly_cost_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index profile_compensation_org_idx on public.profile_compensation (org_id);

create table public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  permission text not null references public.permissions (key) on update cascade,
  effect text not null check (effect in ('grant', 'revoke')),
  scope text not null default 'all' check (scope in ('own', 'team', 'all')),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (user_id, permission)
);
create index user_permission_overrides_user_idx on public.user_permission_overrides (user_id);
create index user_permission_overrides_org_idx on public.user_permission_overrides (org_id);

-- =============================================================================
-- 4. Company settings (SPEC §1.1, §8.19). One row per org.
-- =============================================================================

create table public.company_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  company_name text not null default 'Brushy Bear Painters',
  tagline text,
  logo_path text,
  website_url text,
  -- Placeholders stay until the owners provide real values (SPEC §1.1).
  phone text not null default '[PHONE]',
  email text not null default '[EMAIL]',
  hours_text text not null default '[HOURS]',
  lni_number text not null default '[LNI_NUMBER]',
  ubi_number text not null default '[UBI_NUMBER]',
  service_area_note text,
  business_hours jsonb not null default '{}'::jsonb check (jsonb_typeof(business_hours) = 'object'),
  text_back_sla_minutes integer not null default 10 check (text_back_sla_minutes between 1 and 240),
  estimate_sla_hours integer not null default 24 check (estimate_sla_hours between 1 and 168),
  estimate_sla_warn_hours integer not null default 20 check (estimate_sla_warn_hours between 1 and 168),
  on_time_guarantee_cents bigint not null default 25000 check (on_time_guarantee_cents >= 0),
  exterior_season_start text not null default '06-01' check (exterior_season_start ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  exterior_season_end text not null default '09-30' check (exterior_season_end ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  deposit_percent numeric(5, 2) not null default 30 check (deposit_percent between 0 and 100),
  estimate_expiry_days integer not null default 30 check (estimate_expiry_days between 1 and 365),
  auto_convert_on_walkthrough boolean not null default true,
  -- Tax rules start unset: confirm WA sales-tax treatment with an accountant (SPEC §7.4).
  tax_config jsonb not null default '{}'::jsonb check (jsonb_typeof(tax_config) = 'object'),
  review_link text,
  referral_reward_cents bigint check (referral_reward_cents is null or referral_reward_cents >= 0),
  rrp_firm_certification text,
  rrp_firm_cert_expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (estimate_sla_warn_hours <= estimate_sla_hours)
);

-- =============================================================================
-- 5. Picklists (admin-editable lookups; SPEC §5.9, §3.4)
-- =============================================================================

create table public.picklists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text,
  module text not null,
  parent_picklist_id uuid references public.picklists (id),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, key)
);
create index picklists_org_idx on public.picklists (org_id);

create table public.picklist_values (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  picklist_id uuid not null references public.picklists (id) on delete cascade,
  value text not null check (value ~ '^[a-z0-9][a-z0-9_]*$'),
  label text not null check (length(btrim(label)) between 1 and 80),
  category text,
  parent_value_id uuid references public.picklist_values (id),
  sort_order integer not null default 0,
  active boolean not null default true,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (picklist_id, value)
);
create unique index picklist_values_label_uidx on public.picklist_values (picklist_id, lower(label));
create index picklist_values_org_idx on public.picklist_values (org_id);
create index picklist_values_parent_idx on public.picklist_values (parent_value_id);

-- =============================================================================
-- 6. Audit log (append-only), activity timeline, domain events
-- =============================================================================

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,
  table_name text not null,
  record_id text,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  impersonated_by uuid,
  before jsonb,
  after jsonb,
  changed_fields text[],
  ip inet,
  user_agent text,
  request_id text,
  at timestamptz not null default now()
);
create index audit_log_org_at_idx on public.audit_log (org_id, at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  type text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid,
  impersonated_by uuid,
  created_at timestamptz not null default now()
);
create index activity_subject_idx on public.activity (org_id, subject_type, subject_id, created_at desc);
create index activity_org_created_idx on public.activity (org_id, created_at desc);

create table public.events (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  type text not null check (type ~ '^[a-z_]+\.[a-z_]+$'),
  aggregate_type text not null,
  aggregate_id text,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid,
  impersonated_by uuid,
  idempotency_key text unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed', 'skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index events_pending_idx on public.events (available_at) where status = 'pending';
create index events_org_type_idx on public.events (org_id, type, created_at desc);

-- =============================================================================
-- 7. Integrations (SPEC §2.1)
-- =============================================================================

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  domain text not null check (domain in (
    'sms_voice', 'email', 'calendar', 'accounting', 'payments', 'esign',
    'geo', 'weather', 'photos', 'reviews', 'ai')),
  provider text not null,
  status text not null default 'not_connected' check (status in ('not_connected', 'connected', 'error', 'disabled')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  last_sync_at timestamptz,
  last_error text,
  connected_at timestamptz,
  connected_by uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, domain)
);

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  domain text not null,
  provider text not null,
  operation text not null,
  recipient text,
  subject text,
  rendered_body text,
  payload jsonb not null default '{}'::jsonb,
  related_type text,
  related_id text,
  status text not null default 'simulated' check (status in ('simulated', 'queued', 'sent', 'failed')),
  error text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index integration_outbox_org_created_idx on public.integration_outbox (org_id, created_at desc);
create index integration_outbox_related_idx on public.integration_outbox (related_type, related_id);

-- =============================================================================
-- 8. View-as-user sessions (private)
-- =============================================================================

create table app.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  auth_session_id uuid not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  ended_at timestamptz,
  check (actor_user_id <> target_user_id)
);
create index impersonation_sessions_lookup_idx
  on app.impersonation_sessions (actor_user_id, auth_session_id) where ended_at is null;
alter table app.impersonation_sessions enable row level security;
revoke all on app.impersonation_sessions from public, anon, authenticated;

-- =============================================================================
-- 9. Identity and permission helpers
-- =============================================================================

-- True for roles that bypass app checks (migrations, SQL tests as postgres,
-- service role, and statements run inside SECURITY DEFINER functions).
-- Uses the SET ROLE value and JWT role, not current_user: inside SECURITY DEFINER
-- functions and triggers current_user is the function owner, which would make
-- every caller look trusted.
create or replace function app.is_trusted()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('role', true), 'none'), session_user::text) not in ('authenticated', 'anon')
     and coalesce(auth.jwt() ->> 'role', '') not in ('authenticated', 'anon');
$$;

-- The real signed-in user's session is valid: active profile, and AAL2 when the
-- user's role requires MFA (SPEC §4.3). Enforced in the database, not just the UI.
create or replace function app.session_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_templates t on t.id = p.role_template_id
    where p.id = auth.uid()
      and p.is_active
      and (not t.requires_mfa or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
  );
$$;

create or replace function app.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.org_id from public.profiles p where p.id = auth.uid() and app.session_ok();
$$;

-- The user whose permissions apply: the View-as-user target when an active
-- session exists for this exact login session, otherwise the real user.
create or replace function app.effective_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select s.target_user_id
      from app.impersonation_sessions s
      where s.actor_user_id = auth.uid()
        and s.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.ended_at is null
        and s.expires_at > now()
      order by s.started_at desc
      limit 1
    ),
    auth.uid()
  );
$$;

create or replace function app.is_impersonating()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.effective_user_id() is distinct from auth.uid();
$$;

-- Widest scope ('all' > 'team' > 'own') a user holds for a permission, or null.
-- Revoke overrides win; grant overrides add; grants_all templates hold everything.
create or replace function app.user_perm_scope(p_user_id uuid, p_permission text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with u as (
    select p.id, p.role_template_id, t.grants_all
    from public.profiles p
    join public.role_templates t on t.id = p.role_template_id and t.deleted_at is null
    where p.id = p_user_id and p.is_active
  ),
  ov as (
    select o.effect, o.scope
    from public.user_permission_overrides o
    join u on u.id = o.user_id
    where o.permission = p_permission
  ),
  granted as (
    select pp.scope
    from u
    join public.template_packs tp on tp.template_id = u.role_template_id
    join public.permission_packs pk on pk.id = tp.pack_id and pk.deleted_at is null
    join public.pack_permissions pp on pp.pack_id = pk.id and pp.permission = p_permission
    union all
    select 'all' from u
    where u.grants_all and exists (select 1 from public.permissions c where c.key = p_permission)
    union all
    select ov.scope from ov where ov.effect = 'grant'
  )
  select case
    when exists (select 1 from ov where ov.effect = 'revoke') then null
    else (
      select g.scope from granted g
      order by case g.scope when 'all' then 1 when 'team' then 2 else 3 end
      limit 1
    )
  end;
$$;

-- Scope for the effective user in the current session (null when the session is not valid).
create or replace function app.perm_scope(p_permission text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.session_ok() then app.user_perm_scope(app.effective_user_id(), p_permission) end;
$$;

create or replace function app.has_perm(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.perm_scope(p_permission) is not null;
$$;

-- Permission check for writes: never while viewing as another user.
create or replace function app.can_write(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_perm(p_permission) and not app.is_impersonating();
$$;

-- Permission check on the REAL user (used to start View-as-user).
create or replace function app.real_has_perm(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.session_ok() and app.user_perm_scope(auth.uid(), p_permission) is not null;
$$;

create or replace function app.is_grants_all_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    join public.role_templates t on t.id = p.role_template_id
    where p.id = p_user_id and t.grants_all
  );
$$;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.next_number(uuid, text, timestamptz) from authenticated;

-- =============================================================================
-- 10. Request context, audit, activity and event helpers
-- =============================================================================

create or replace function app.request_header(p_name text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := nullif(current_setting('request.headers', true), '')::jsonb;
  return nullif(btrim(v ->> lower(p_name)), '');
exception when others then
  return null;
end;
$$;

-- Who is acting. Service-role calls from our server pass the acting user in
-- x-bb-actor-id; that header is only trusted for the service role.
create or replace function app.actor_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_header text;
begin
  if auth.uid() is not null then
    return app.effective_user_id();
  end if;
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or app.is_trusted() then
    v_header := app.request_header('x-bb-actor-id');
    if v_header ~ '^[0-9a-fA-F-]{36}$' then
      return v_header::uuid;
    end if;
  end if;
  return null;
end;
$$;

create or replace function app.impersonator_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.is_impersonating() then auth.uid() end;
$$;

create or replace function app.client_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := coalesce(app.request_header('x-bb-client-ip'), split_part(app.request_header('x-forwarded-for'), ',', 1));
begin
  return nullif(btrim(v), '')::inet;
exception when others then
  return null;
end;
$$;

-- Generic AFTER trigger: one audit row per insert/update/delete (SPEC §5).
-- TG_ARGV lists columns to leave out of before/after (e.g. secrets).
create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_excl text[] := coalesce(tg_argv, '{}'::text[]);
  v_changed text[];
  v_row jsonb;
  v_org uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old) - v_excl; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new) - v_excl; end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key);
    -- Skip no-op updates (nothing but bookkeeping columns changed).
    if v_changed is null or v_changed <@ array['updated_at', 'updated_by']::text[] then
      return null;
    end if;
  end if;

  v_row := coalesce(v_new, v_old);
  v_org := case
    when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid
    else (v_row ->> 'org_id')::uuid
  end;

  insert into public.audit_log (
    org_id, table_name, record_id, action, actor_id, impersonated_by,
    before, after, changed_fields, ip, user_agent, request_id
  ) values (
    v_org, tg_table_schema || '.' || tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'profile_id'),
    lower(tg_op), app.actor_id(), app.impersonator_id(),
    v_old, v_new, v_changed, app.client_ip(),
    coalesce(app.request_header('x-bb-user-agent'), app.request_header('user-agent')),
    app.request_header('x-bb-request-id')
  );
  return null;
end;
$$;

-- Internal: append a domain event to the outbox (SPEC §11.1). Not callable by clients.
create or replace function app.emit_event(
  p_org_id uuid,
  p_type text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.events (org_id, type, aggregate_type, aggregate_id, payload, actor_id, impersonated_by, idempotency_key)
  values (p_org_id, p_type, p_aggregate_type, p_aggregate_id, coalesce(p_payload, '{}'::jsonb),
          app.actor_id(), app.impersonator_id(), p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function app.emit_event(uuid, text, text, text, jsonb, text) from public, authenticated;

-- Generic AFTER trigger: emits '<aggregate>.created|updated|deleted' with changed fields.
-- TG_ARGV[0] = aggregate type (e.g. 'user'); TG_ARGV[1..] = columns to leave out of the payload.
create or replace function app.emit_change_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agg text := tg_argv[0];
  v_excl text[] := coalesce(tg_argv[1:], '{}'::text[]);
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - v_excl end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - v_excl end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_verb text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n where n.value is distinct from (v_old -> n.key);
    if v_changed is null or v_changed <@ array['updated_at', 'updated_by']::text[] then
      return null;
    end if;
  end if;
  v_verb := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  perform app.emit_event(
    case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid else (v_row ->> 'org_id')::uuid end,
    v_agg || '.' || v_verb,
    v_agg,
    coalesce(v_row ->> 'id', v_row ->> 'profile_id'),
    jsonb_build_object('changed', to_jsonb(coalesce(v_changed, '{}'::text[])))
  );
  return null;
end;
$$;

-- Internal: human-readable timeline entry.
create or replace function app.log_activity(
  p_org_id uuid, p_subject_type text, p_subject_id text, p_type text, p_summary text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.activity (org_id, subject_type, subject_id, type, summary, payload, actor_id, impersonated_by)
  values (p_org_id, p_subject_type, p_subject_id, p_type, p_summary, coalesce(p_payload, '{}'::jsonb),
          app.actor_id(), app.impersonator_id())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function app.log_activity(uuid, text, text, text, text, jsonb) from public, authenticated;

-- Bookkeeping columns stamped server-side (clients cannot forge them).
create or replace function app.stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(app.actor_id(), new.created_by);
    new.updated_by := new.created_by;
  else
    new.created_by := old.created_by;
    new.updated_by := coalesce(app.actor_id(), new.updated_by);
  end if;
  return new;
end;
$$;

-- Which activity subjects a user may read (extended as modules arrive).
create or replace function app.can_read_subject(p_subject_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_subject_type
    when 'user' then app.has_perm('users:read')
    when 'role' then app.has_perm('roles:manage')
    when 'settings' then app.has_perm('settings:manage')
    when 'picklist' then app.has_perm('picklists:manage')
    when 'territory' then app.has_perm('settings:manage')
    when 'integration' then app.has_perm('integrations:read')
    else app.has_perm(p_subject_type || 's:read')
  end;
$$;

-- =============================================================================
-- 11. Guards (business invariants enforced in the database)
-- =============================================================================

-- Profiles: who may change what, and at least one active owner per org.
create or replace function app.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  v_new_grants_all boolean;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.org_id <> old.org_id then
      raise exception 'A user cannot be moved to another organization.' using errcode = '42501';
    end if;

    if not app.is_trusted() then
      v_admin := app.can_write('users:manage');
      if not v_admin then
        if old.id <> auth.uid() then
          raise exception 'You can only edit your own profile.' using errcode = '42501';
        end if;
        if new.email is distinct from old.email
           or new.role_template_id is distinct from old.role_template_id
           or new.is_active is distinct from old.is_active
           or new.department is distinct from old.department
           or new.default_territory_id is distinct from old.default_territory_id
           or new.invited_at is distinct from old.invited_at
           or new.invited_by is distinct from old.invited_by
           or new.deactivated_at is distinct from old.deactivated_at
           or new.deactivated_by is distinct from old.deactivated_by then
          raise exception 'Only an admin can change role, status, email, department or territory.' using errcode = '42501';
        end if;
      else
        if new.id = auth.uid() and new.is_active is distinct from old.is_active then
          raise exception 'You cannot deactivate yourself.' using errcode = '42501';
        end if;
      end if;

      -- Assigning an owner-level template requires an owner.
      if new.role_template_id is distinct from old.role_template_id then
        select t.grants_all into v_new_grants_all from public.role_templates t where t.id = new.role_template_id;
        if v_new_grants_all and not app.is_grants_all_user(auth.uid()) then
          raise exception 'Only an owner can assign the Owner role.' using errcode = '42501';
        end if;
      end if;
    end if;

    -- Keep deactivation bookkeeping consistent.
    if new.is_active and not old.is_active then
      new.deactivated_at := null;
      new.deactivated_by := null;
    elsif not new.is_active and old.is_active then
      new.deactivated_at := coalesce(new.deactivated_at, now());
      new.deactivated_by := coalesce(new.deactivated_by, app.actor_id());
    end if;
  end if;

  -- The template must belong to the same org.
  if not exists (
    select 1 from public.role_templates t
    where t.id = new.role_template_id and t.org_id = new.org_id and t.deleted_at is null
  ) then
    raise exception 'Role template does not exist in this organization.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function app.ensure_active_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := coalesce(new.org_id, old.org_id);
begin
  if not exists (
    select 1 from public.profiles p
    join public.role_templates t on t.id = p.role_template_id and t.grants_all
    where p.org_id = v_org and p.is_active
  ) and exists (select 1 from public.profiles p where p.org_id = v_org) then
    raise exception 'At least one active owner is required.' using errcode = '23514';
  end if;
  return null;
end;
$$;

-- Role templates: owner (grants_all) cannot be edited or have its packs changed;
-- system templates keep their key and flags.
create or replace function app.role_templates_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_trusted() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.grants_all or new.is_system then
      raise exception 'Custom templates cannot be system or owner-level.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.grants_all then
    raise exception 'The Owner template is locked.' using errcode = '42501';
  end if;
  if new.key <> old.key or new.is_system <> old.is_system or new.grants_all <> old.grants_all
     or new.org_id <> old.org_id then
    raise exception 'Template key and system flags cannot change.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app.template_packs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template uuid := coalesce(new.template_id, old.template_id);
  v_pack uuid := coalesce(new.pack_id, old.pack_id);
  v_org uuid := coalesce(new.org_id, old.org_id);
begin
  if not exists (select 1 from public.role_templates t where t.id = v_template and t.org_id = v_org)
     or not exists (select 1 from public.permission_packs p where p.id = v_pack and p.org_id = v_org) then
    raise exception 'Template and pack must belong to the same organization.' using errcode = '42501';
  end if;
  if not app.is_trusted()
     and exists (select 1 from public.role_templates t where t.id = v_template and t.grants_all) then
    raise exception 'The Owner template is locked.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- System packs keep their permission lists; custom packs are editable.
create or replace function app.pack_permissions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pack uuid := coalesce(new.pack_id, old.pack_id);
  v_org uuid := coalesce(new.org_id, old.org_id);
begin
  if not exists (select 1 from public.permission_packs p where p.id = v_pack and p.org_id = v_org) then
    raise exception 'Pack must belong to the same organization.' using errcode = '42501';
  end if;
  if not app.is_trusted()
     and exists (select 1 from public.permission_packs p where p.id = v_pack and p.is_system) then
    raise exception 'System packs are read-only. Create a custom pack instead.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function app.permission_packs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_trusted() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.is_system then
    raise exception 'Custom packs cannot be system packs.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (old.is_system or new.is_system or new.key <> old.key or new.org_id <> old.org_id) then
    raise exception 'System packs are read-only.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app.overrides_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.org_id = new.org_id) then
    raise exception 'User does not belong to this organization.' using errcode = '42501';
  end if;
  if app.is_grants_all_user(new.user_id) then
    raise exception 'Owners already have every permission; overrides do not apply.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Picklist values: stable keys; system values are deactivated, never deleted.
create or replace function app.picklist_values_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system and not app.is_trusted() then
      raise exception 'Built-in values can be turned off but not deleted.' using errcode = '42501';
    end if;
    return old;
  end if;
  if not exists (select 1 from public.picklists p where p.id = new.picklist_id and p.org_id = new.org_id) then
    raise exception 'Picklist does not belong to this organization.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and not app.is_trusted() then
    if new.value <> old.value or new.picklist_id <> old.picklist_id or new.is_system <> old.is_system then
      raise exception 'A value''s key cannot change once created. Add a new value instead.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' and new.is_system and not app.is_trusted() then
    raise exception 'Custom values cannot be marked built-in.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Territories: a ZIP can belong to only one active territory per org.
create or replace function app.territories_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflict text;
begin
  new.zip_codes := array(select distinct btrim(z) from unnest(new.zip_codes) z order by 1);
  if new.deleted_at is null then
    select t.name into v_conflict
    from public.territories t
    where t.org_id = new.org_id and t.id <> new.id and t.deleted_at is null
      and t.zip_codes && new.zip_codes
    limit 1;
    if v_conflict is not null then
      raise exception 'One or more ZIP codes already belong to %.', v_conflict using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

create or replace function app.territory_for_zip(p_org_id uuid, p_zip text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.territories t
  where t.org_id = p_org_id and t.active and t.deleted_at is null and t.is_service_area
    and substring(btrim(p_zip) from 1 for 5) = any (t.zip_codes)
  limit 1;
$$;

-- Org-matching for child rows (row's org must match its parent's org).
create or replace function app.same_org_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.profile_id and p.org_id = new.org_id) then
    raise exception 'Profile does not belong to this organization.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Integration connections: provider must be one of the domain's known providers,
-- and nothing can be marked connected in this build (SPEC §2.1: connect NOTHING).
create or replace function app.integration_connections_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'connected' and (tg_op = 'INSERT' or old.status <> 'connected') then
    raise exception 'Connecting real providers is turned off in this build.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Audit log is append-only for everyone.
create or replace function app.deny_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only.', tg_table_name using errcode = '42501';
end;
$$;

-- =============================================================================
-- 12. Triggers
-- =============================================================================

-- updated_at + actor stamps
do $$
declare
  t text;
begin
  foreach t in array array[
    'role_templates', 'permission_packs', 'territories', 'profiles', 'profile_compensation',
    'company_settings', 'picklists', 'picklist_values', 'integration_connections'
  ] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function app.stamp_actor()', t, t);
  end loop;
end
$$;

-- audit (every business table)
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'role_templates', 'permission_packs', 'pack_permissions', 'template_packs',
    'territories', 'profiles', 'profile_compensation', 'user_permission_overrides',
    'company_settings', 'picklists', 'picklist_values', 'integration_connections'
  ] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end
$$;

-- domain events
create trigger organizations_event after insert or update or delete on public.organizations
  for each row execute function app.emit_change_event('organization');
create trigger role_templates_event after insert or update or delete on public.role_templates
  for each row execute function app.emit_change_event('role_template');
create trigger permission_packs_event after insert or update or delete on public.permission_packs
  for each row execute function app.emit_change_event('permission_pack');
create trigger pack_permissions_event after insert or update or delete on public.pack_permissions
  for each row execute function app.emit_change_event('pack_permission');
create trigger template_packs_event after insert or update or delete on public.template_packs
  for each row execute function app.emit_change_event('template_pack');
create trigger territories_event after insert or update or delete on public.territories
  for each row execute function app.emit_change_event('territory');
create trigger profiles_event after insert or update or delete on public.profiles
  for each row execute function app.emit_change_event('user');
create trigger profile_compensation_event after insert or update or delete on public.profile_compensation
  for each row execute function app.emit_change_event('user_compensation', 'hourly_cost_cents');
create trigger user_permission_overrides_event after insert or update or delete on public.user_permission_overrides
  for each row execute function app.emit_change_event('user_permission');
create trigger company_settings_event after insert or update or delete on public.company_settings
  for each row execute function app.emit_change_event('settings');
create trigger picklists_event after insert or update or delete on public.picklists
  for each row execute function app.emit_change_event('picklist');
create trigger picklist_values_event after insert or update or delete on public.picklist_values
  for each row execute function app.emit_change_event('picklist_value');
create trigger integration_connections_event after insert or update or delete on public.integration_connections
  for each row execute function app.emit_change_event('integration');

-- guards
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function app.profiles_guard();
create constraint trigger profiles_active_owner after update or delete on public.profiles
  deferrable initially deferred
  for each row execute function app.ensure_active_owner();
create trigger role_templates_guard before insert or update on public.role_templates
  for each row execute function app.role_templates_guard();
create trigger template_packs_guard before insert or update or delete on public.template_packs
  for each row execute function app.template_packs_guard();
create trigger pack_permissions_guard before insert or update or delete on public.pack_permissions
  for each row execute function app.pack_permissions_guard();
create trigger permission_packs_guard before insert or update on public.permission_packs
  for each row execute function app.permission_packs_guard();
create trigger user_permission_overrides_guard before insert or update on public.user_permission_overrides
  for each row execute function app.overrides_guard();
create trigger picklist_values_guard before insert or update or delete on public.picklist_values
  for each row execute function app.picklist_values_guard();
create trigger territories_guard before insert or update on public.territories
  for each row execute function app.territories_guard();
create trigger profile_compensation_org before insert or update on public.profile_compensation
  for each row execute function app.same_org_profile();
create trigger integration_connections_guard before insert or update on public.integration_connections
  for each row execute function app.integration_connections_guard();
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app.deny_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.deny_change();

-- =============================================================================
-- 13. Row level security
-- =============================================================================

alter table public.permissions enable row level security;
alter table public.role_templates enable row level security;
alter table public.permission_packs enable row level security;
alter table public.pack_permissions enable row level security;
alter table public.template_packs enable row level security;
alter table public.territories enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_compensation enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.company_settings enable row level security;
alter table public.picklists enable row level security;
alter table public.picklist_values enable row level security;
alter table public.audit_log enable row level security;
alter table public.activity enable row level security;
alter table public.events enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_outbox enable row level security;

-- Tables that only trusted code writes.
revoke insert, update, delete, truncate on public.audit_log, public.activity, public.events,
  public.integration_outbox, public.permissions from anon, authenticated;
revoke all on public.events from anon, authenticated;
-- Nothing in the app is readable without signing in (now and for future tables).
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- organizations
create policy organizations_select on public.organizations for select to authenticated
  using (id = (select app.current_org_id()));
create policy organizations_update on public.organizations for update to authenticated
  using (id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (id = (select app.current_org_id()));

-- permissions catalog: readable by any valid session
create policy permissions_select on public.permissions for select to authenticated
  using ((select app.session_ok()));

-- role templates & packs: names readable by members; edits need roles:manage
create policy role_templates_select on public.role_templates for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null);
create policy role_templates_insert on public.role_templates for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('roles:manage')));
create policy role_templates_update on public.role_templates for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('roles:manage')))
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

create policy permission_packs_select on public.permission_packs for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null);
create policy permission_packs_insert on public.permission_packs for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('roles:manage')));
create policy permission_packs_update on public.permission_packs for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('roles:manage')))
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

create policy pack_permissions_select on public.pack_permissions for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy pack_permissions_insert on public.pack_permissions for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('roles:manage')));
create policy pack_permissions_update on public.pack_permissions for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('roles:manage')))
  with check (org_id = (select app.current_org_id()));
create policy pack_permissions_delete on public.pack_permissions for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('roles:manage')));

create policy template_packs_select on public.template_packs for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy template_packs_insert on public.template_packs for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('roles:manage')));
create policy template_packs_delete on public.template_packs for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('roles:manage')));

-- territories
create policy territories_select on public.territories for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null);
create policy territories_insert on public.territories for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')));
create policy territories_update on public.territories for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

-- profiles: every member sees the team directory; a user always sees themself
-- (so an owner who still needs MFA can load their own profile).
create policy profiles_select on public.profiles for select to authenticated
  using (org_id = (select app.current_org_id()) or id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (
    org_id = (select app.current_org_id())
    and not (select app.is_impersonating())
    and (id = (select auth.uid()) or (select app.can_write('users:manage')))
  )
  with check (org_id = (select app.current_org_id()));
-- Inserts happen through the invite flow (service role, after a users:manage check).

-- compensation (HR & sensitive)
create policy profile_compensation_select on public.profile_compensation for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('hr:read')));
create policy profile_compensation_insert on public.profile_compensation for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('hr:manage')));
create policy profile_compensation_update on public.profile_compensation for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('hr:manage')))
  with check (org_id = (select app.current_org_id()));

-- per-user permission overrides
create policy overrides_select on public.user_permission_overrides for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.has_perm('roles:manage')) or user_id = (select app.effective_user_id())));
create policy overrides_insert on public.user_permission_overrides for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('roles:manage')));
create policy overrides_update on public.user_permission_overrides for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('roles:manage')))
  with check (org_id = (select app.current_org_id()));
create policy overrides_delete on public.user_permission_overrides for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('roles:manage')));

-- company settings: readable by members (phone/hours feed templates); edits need settings:manage
create policy company_settings_select on public.company_settings for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy company_settings_update on public.company_settings for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));

-- picklists
create policy picklists_select on public.picklists for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy picklists_update on public.picklists for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('picklists:manage')))
  with check (org_id = (select app.current_org_id()));
create policy picklist_values_select on public.picklist_values for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy picklist_values_insert on public.picklist_values for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('picklists:manage')));
create policy picklist_values_update on public.picklist_values for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('picklists:manage')))
  with check (org_id = (select app.current_org_id()));

-- audit log: read-only, audit:read
create policy audit_log_select on public.audit_log for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('audit:read')));

-- activity: readable when the subject is readable
create policy activity_select on public.activity for select to authenticated
  using (org_id = (select app.current_org_id()) and app.can_read_subject(subject_type));

-- integrations
create policy integration_connections_select on public.integration_connections for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('integrations:read')));
create policy integration_connections_update on public.integration_connections for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('integrations:manage')))
  with check (org_id = (select app.current_org_id()));
create policy integration_outbox_select on public.integration_outbox for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('integrations:read')));

-- =============================================================================
-- 14. RPCs (public; each checks permissions itself)
-- =============================================================================

-- Everything the app shell needs about the current session, in one call.
create or replace function public.my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_eff uuid;
  v_ok boolean;
  v_user jsonb;
  v_eff_user jsonb;
  v_perms jsonb;
  v_imp jsonb;
  v_requires_mfa boolean;
begin
  if v_uid is null then
    return null;
  end if;

  select jsonb_build_object(
           'id', p.id, 'email', p.email, 'full_name', p.full_name, 'title', p.title,
           'department', p.department, 'org_id', p.org_id, 'is_active', p.is_active,
           'role', jsonb_build_object('id', t.id, 'key', t.key, 'name', t.name,
                                      'requires_mfa', t.requires_mfa, 'is_crew', t.is_crew,
                                      'grants_all', t.grants_all)),
         t.requires_mfa
    into v_user, v_requires_mfa
  from public.profiles p
  join public.role_templates t on t.id = p.role_template_id
  where p.id = v_uid;

  if v_user is null then
    return jsonb_build_object('user', null);
  end if;

  v_ok := app.session_ok();
  v_eff := app.effective_user_id();

  if v_eff <> v_uid then
    select jsonb_build_object(
             'id', p.id, 'email', p.email, 'full_name', p.full_name, 'title', p.title,
             'department', p.department, 'org_id', p.org_id, 'is_active', p.is_active,
             'role', jsonb_build_object('id', t.id, 'key', t.key, 'name', t.name,
                                        'requires_mfa', t.requires_mfa, 'is_crew', t.is_crew,
                                        'grants_all', t.grants_all))
      into v_eff_user
    from public.profiles p
    join public.role_templates t on t.id = p.role_template_id
    where p.id = v_eff;

    select jsonb_build_object('id', s.id, 'target_user_id', s.target_user_id,
                              'started_at', s.started_at, 'expires_at', s.expires_at)
      into v_imp
    from app.impersonation_sessions s
    where s.actor_user_id = v_uid
      and s.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and s.ended_at is null and s.expires_at > now()
    order by s.started_at desc
    limit 1;
  end if;

  if v_ok then
    select coalesce(jsonb_object_agg(c.key, s.scope), '{}'::jsonb) into v_perms
    from public.permissions c
    cross join lateral (select app.user_perm_scope(v_eff, c.key) as scope) s
    where s.scope is not null;
  else
    v_perms := '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'user', v_user,
    'effective_user', coalesce(v_eff_user, v_user),
    'impersonation', v_imp,
    'session_ok', v_ok,
    'mfa', jsonb_build_object('required', v_requires_mfa, 'aal', coalesce(auth.jwt() ->> 'aal', 'aal1')),
    'permissions', v_perms
  );
end;
$$;

-- Start View-as-user (owners only; read-only; one hour; scoped to this login session).
create or replace function public.start_view_as(p_target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_org uuid := app.current_org_id();
  v_id uuid;
  v_target_name text;
begin
  if v_uid is null or v_org is null or not app.real_has_perm('users:view_as') then
    raise exception 'Only owners can view as another user.' using errcode = '42501';
  end if;
  if v_session is null then
    raise exception 'Missing login session.' using errcode = '42501';
  end if;
  if p_target_user_id = v_uid then
    raise exception 'You are already viewing as yourself.' using errcode = '22023';
  end if;
  select p.full_name into v_target_name from public.profiles p
  where p.id = p_target_user_id and p.org_id = v_org and p.is_active;
  if v_target_name is null then
    raise exception 'That user is not an active member of your organization.' using errcode = '22023';
  end if;

  update app.impersonation_sessions set ended_at = now()
  where actor_user_id = v_uid and auth_session_id = v_session and ended_at is null;

  insert into app.impersonation_sessions (org_id, actor_user_id, target_user_id, auth_session_id)
  values (v_org, v_uid, p_target_user_id, v_session)
  returning id into v_id;

  insert into public.audit_log (org_id, table_name, record_id, action, actor_id, after, ip, user_agent, request_id)
  values (v_org, 'app.impersonation_sessions', v_id::text, 'insert', v_uid,
          jsonb_build_object('target_user_id', p_target_user_id, 'event', 'view_as_started'),
          app.client_ip(), coalesce(app.request_header('x-bb-user-agent'), app.request_header('user-agent')),
          app.request_header('x-bb-request-id'));
  perform app.emit_event(v_org, 'user.view_as_started', 'user', p_target_user_id::text,
                         jsonb_build_object('session_id', v_id));
  perform app.log_activity(v_org, 'user', p_target_user_id::text, 'view_as_started',
                           'Owner started viewing as ' || v_target_name);
  return v_id;
end;
$$;

create or replace function public.stop_view_as()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  r record;
begin
  for r in
    update app.impersonation_sessions set ended_at = now()
    where actor_user_id = v_uid and auth_session_id = v_session and ended_at is null
    returning id, org_id, target_user_id
  loop
    insert into public.audit_log (org_id, table_name, record_id, action, actor_id, after, ip, user_agent, request_id)
    values (r.org_id, 'app.impersonation_sessions', r.id::text, 'update', v_uid,
            jsonb_build_object('target_user_id', r.target_user_id, 'event', 'view_as_ended'),
            app.client_ip(), coalesce(app.request_header('x-bb-user-agent'), app.request_header('user-agent')),
            app.request_header('x-bb-request-id'));
    perform app.emit_event(r.org_id, 'user.view_as_ended', 'user', r.target_user_id::text,
                           jsonb_build_object('session_id', r.id));
  end loop;
end;
$$;

-- Connected-integration count for the top-bar pill (visible to every member).
create or replace function public.integration_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'connected', count(*) filter (where c.status = 'connected'),
    'total', count(*)
  )
  from public.integration_connections c
  where c.org_id = app.current_org_id();
$$;

-- Soft delete / restore for the modules that support it (SPEC §5, Deleted Records).
create or replace function app.soft_delete_permission(p_table text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'territories' then 'settings:manage'
    when 'role_templates' then 'roles:manage'
    when 'permission_packs' then 'roles:manage'
  end;
$$;

create or replace function public.soft_delete_record(p_table text, p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perm text := app.soft_delete_permission(p_table);
  v_org uuid := app.current_org_id();
  v_count integer;
begin
  if v_perm is null then
    raise exception 'Records in % cannot be deleted here.', p_table using errcode = '22023';
  end if;
  if v_org is null or not app.can_write(v_perm) then
    raise exception 'You do not have permission to delete this record.' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  if p_table = 'role_templates' then
    if exists (select 1 from public.role_templates where id = p_id and is_system) then
      raise exception 'Built-in templates cannot be deleted.' using errcode = '42501';
    end if;
    if exists (select 1 from public.profiles where role_template_id = p_id) then
      raise exception 'Move the users on this template to another template first.' using errcode = '23503';
    end if;
  elsif p_table = 'permission_packs' and exists (select 1 from public.permission_packs where id = p_id and is_system) then
    raise exception 'Built-in packs cannot be deleted.' using errcode = '42501';
  end if;

  execute format(
    'update public.%I set deleted_at = now(), deleted_by = $1, delete_reason = $2 where id = $3 and org_id = $4 and deleted_at is null',
    p_table)
  using app.actor_id(), btrim(p_reason), p_id, v_org;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Record not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.restore_record(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
  v_count integer;
begin
  if app.soft_delete_permission(p_table) is null then
    raise exception 'Records in % cannot be restored here.', p_table using errcode = '22023';
  end if;
  if v_org is null or not app.can_write('records:restore') then
    raise exception 'You do not have permission to restore records.' using errcode = '42501';
  end if;
  execute format(
    'update public.%I set deleted_at = null, deleted_by = null, delete_reason = null where id = $1 and org_id = $2 and deleted_at is not null',
    p_table)
  using p_id, v_org;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Deleted record not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.list_deleted_records()
returns table (
  table_name text, record_id uuid, label text, deleted_at timestamptz,
  deleted_by uuid, deleted_by_name text, delete_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := app.current_org_id();
begin
  if v_org is null or not app.has_perm('records:restore') then
    raise exception 'You do not have permission to view deleted records.' using errcode = '42501';
  end if;
  return query
    select d.table_name, d.record_id, d.label, d.deleted_at, d.deleted_by, p.full_name, d.delete_reason
    from (
      select 'territories'::text as table_name, t.id as record_id, t.name as label, t.deleted_at, t.deleted_by, t.delete_reason
      from public.territories t where t.org_id = v_org and t.deleted_at is not null
      union all
      select 'role_templates', r.id, r.name, r.deleted_at, r.deleted_by, r.delete_reason
      from public.role_templates r where r.org_id = v_org and r.deleted_at is not null
      union all
      select 'permission_packs', k.id, k.name, k.deleted_at, k.deleted_by, k.delete_reason
      from public.permission_packs k where k.org_id = v_org and k.deleted_at is not null
    ) d
    left join public.profiles p on p.id = d.deleted_by
    order by d.deleted_at desc;
end;
$$;

-- Reorder a picklist's values in one statement.
create or replace function public.reorder_picklist_values(p_picklist_id uuid, p_value_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
begin
  if v_org is null or not app.can_write('picklists:manage') then
    raise exception 'You do not have permission to edit picklists.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.picklists where id = p_picklist_id and org_id = v_org) then
    raise exception 'Picklist not found.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.picklist_values where picklist_id = p_picklist_id)
     <> coalesce(array_length(p_value_ids, 1), 0)
     or exists (
       select 1 from unnest(p_value_ids) v(id)
       where not exists (select 1 from public.picklist_values pv where pv.id = v.id and pv.picklist_id = p_picklist_id)
     ) then
    raise exception 'The new order must list every value of this picklist exactly once.' using errcode = '22023';
  end if;
  update public.picklist_values pv
  set sort_order = o.ord * 10
  from unnest(p_value_ids) with ordinality as o(id, ord)
  where pv.id = o.id and pv.picklist_id = p_picklist_id and pv.sort_order <> o.ord * 10;
end;
$$;

-- Counts of open work to reassign before deactivating a user (grows with each module).
create or replace function public.open_work_counts(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.current_org_id() is null or not app.has_perm('users:manage') then
    raise exception 'You do not have permission to manage users.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and org_id = app.current_org_id()) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  return '{}'::jsonb;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_access(), public.start_view_as(uuid), public.stop_view_as(),
  public.integration_summary(), public.soft_delete_record(text, uuid, text), public.restore_record(text, uuid),
  public.list_deleted_records(), public.reorder_picklist_values(uuid, uuid[]), public.open_work_counts(uuid)
  to authenticated;
