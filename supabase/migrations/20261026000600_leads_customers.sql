-- Phase 2: Leads & Customers (SPEC §5.1, §5.2, §5.7, §5.9, §6.1, §6.6, §14).
-- Additive. Reverse with supabase/rollbacks/20261026000600_leads_customers.down.sql.
--
-- Contents
--   1. Extensions + permission
--   2. Helpers (scope matching, picklist validation, territory lookup)
--   3. Tables: accounts, contacts, properties, property_secrets, leads,
--      lead_attachments, notes, comments, tasks, messages, notifications,
--      saved_views, lead_scoring_rules, intake_requests, rate_limits
--   4. Guards and side-effect triggers
--   5. Bookkeeping, audit and event triggers
--   6. Row level security
--   7. RPCs (search, lead stats, soft delete allowlist, open work)
--   8. Storage bucket for lead photos
--   9. Seed (scoring rules, access-code permission grant)

-- =============================================================================
-- 1. Extensions + permission
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- @permissions:begin
insert into public.permissions (key, resource, action, label, category, supports_scope, sort_order)
select v.key, split_part(v.key, ':', 1), split_part(v.key, ':', 2), v.label, v.category, v.scoped, v.ord
from (values
  ('properties:view_access_codes', 'See gate and lockbox codes', 'core_records', false, 125)
) as v(key, label, category, scoped, ord)
on conflict (key) do nothing;
-- @permissions:end

-- =============================================================================
-- 2. Helpers
-- =============================================================================

-- The effective user's home territory ("team" scope = same territory; DECISIONS 2026-10-26).
create or replace function app.my_territory_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.default_territory_id from public.profiles p where p.id = app.effective_user_id();
$$;

-- Does a record (owner, creator, territory) fall inside a scope for user p_me?
-- Pure and inlinable: policies pass the per-session values as (select …) init-plans.
create or replace function app.scope_match(
  p_scope text, p_owner uuid, p_creator uuid, p_territory uuid, p_me uuid, p_my_territory uuid
)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(case p_scope
    when 'all' then true
    when 'team' then p_owner = p_me or p_creator = p_me or p_territory = p_my_territory
    when 'own' then p_owner = p_me or p_creator = p_me
    else false
  end, false);
$$;

-- A picklist value key is valid for (org, picklist). Inactive values stay valid
-- for rows that already use them; only new choices are limited to active values.
create or replace function app.picklist_value_exists(p_org uuid, p_picklist text, p_value text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_value is null or exists (
    select 1 from public.picklist_values v
    join public.picklists l on l.id = v.picklist_id
    where l.org_id = p_org and l.key = p_picklist and v.value = p_value
  );
$$;

create or replace function app.check_picklist(p_org uuid, p_picklist text, p_value text, p_label text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not app.picklist_value_exists(p_org, p_picklist, p_value) then
    raise exception '% "%" is not one of the choices in Field Picklists.', p_label, p_value using errcode = '23514';
  end if;
end;
$$;

-- E.164 phone (+ and 8–15 digits) and lowercase email shapes, shared by checks.
create or replace function app.is_e164(p text)
returns boolean
language sql
immutable
parallel safe
as $$ select p is null or p ~ '^\+[1-9][0-9]{7,14}$' $$;

create or replace function app.is_email(p text)
returns boolean
language sql
immutable
parallel safe
as $$ select p is null or (p = lower(btrim(p)) and p ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(p) <= 254) $$;

-- =============================================================================
-- 3. Tables
-- =============================================================================

-- Households / customers ------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  account_type text not null default 'residential'
    check (account_type in ('residential', 'property_manager', 'hoa', 'commercial')),
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  status text not null default 'prospect'
    check (status in ('prospect', 'active_customer', 'past_customer', 'inactive')),
  owner_id uuid references public.profiles (id),
  territory_id uuid references public.territories (id),
  primary_contact_id uuid,
  is_referral_champion boolean not null default false,
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  notes text check (length(notes) <= 10000),
  search_text text generated always as (lower(display_name)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);
create index accounts_org_status_idx on public.accounts (org_id, status) where deleted_at is null;
create index accounts_owner_idx on public.accounts (owner_id);
create index accounts_territory_idx on public.accounts (territory_id);
create index accounts_created_idx on public.accounts (org_id, created_at desc);
create index accounts_search_trgm_idx on public.accounts using gin (search_text extensions.gin_trgm_ops);

-- People on an account --------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  account_id uuid not null references public.accounts (id) on delete restrict,
  first_name text not null check (length(btrim(first_name)) between 1 and 80),
  last_name text check (length(last_name) <= 80),
  role text not null default 'primary'
    check (role in ('primary', 'spouse_partner', 'property_manager', 'tenant', 'billing', 'other')),
  mobile text check (app.is_e164(mobile)),
  phone text check (app.is_e164(phone)),
  email text check (app.is_email(email)),
  preferred_channel text check (preferred_channel in ('sms', 'call', 'email')),
  sms_opt_in boolean not null default false,
  sms_opt_in_at timestamptz,
  sms_opt_in_source text check (length(sms_opt_in_source) <= 200),
  email_opt_in boolean not null default false,
  email_opt_in_at timestamptz,
  email_opt_in_source text check (length(email_opt_in_source) <= 200),
  opted_out_at timestamptz,
  do_not_contact boolean not null default false,
  language text not null default 'en' check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  notes text check (length(notes) <= 10000),
  search_text text generated always as (
    lower(btrim(first_name || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, '')))
  ) stored,
  phone_digits text generated always as (
    regexp_replace(coalesce(mobile, '') || ' ' || coalesce(phone, ''), '[^0-9 ]', '', 'g')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  -- Consent is recorded with when and where (SPEC §13.2).
  check (not sms_opt_in or sms_opt_in_at is not null),
  check (not email_opt_in or email_opt_in_at is not null)
);
create index contacts_account_idx on public.contacts (account_id);
create index contacts_org_email_idx on public.contacts (org_id, email) where deleted_at is null;
create index contacts_org_mobile_idx on public.contacts (org_id, mobile) where deleted_at is null;
create index contacts_org_phone_idx on public.contacts (org_id, phone) where deleted_at is null;
create index contacts_search_trgm_idx on public.contacts using gin (search_text extensions.gin_trgm_ops);
create index contacts_phone_trgm_idx on public.contacts using gin (phone_digits extensions.gin_trgm_ops);

alter table public.accounts
  add constraint accounts_primary_contact_fk foreign key (primary_contact_id)
  references public.contacts (id) on delete set null;

-- Homes and buildings ---------------------------------------------------------
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  account_id uuid not null references public.accounts (id) on delete restrict,
  is_primary boolean not null default false,
  street text check (length(street) <= 200),
  unit text check (length(unit) <= 40),
  city text check (length(city) <= 80),
  state text not null default 'WA' check (state ~ '^[A-Z]{2}$'),
  zip text check (zip ~ '^[0-9]{5}$'),
  lat numeric(9, 6) check (lat between -90 and 90),
  lng numeric(9, 6) check (lng between -180 and 180),
  territory_id uuid references public.territories (id),
  out_of_area boolean not null default false,
  year_built smallint check (year_built between 1700 and 2100),
  home_built text check (home_built in ('before_1978', '1978_or_later', 'not_sure')),
  -- Lead-safe prep needed: built before 1978, or not sure (SPEC §5.1, §13.3).
  lead_safe_required boolean generated always as (
    coalesce(year_built < 1978, home_built in ('before_1978', 'not_sure'), false)
  ) stored,
  property_type text,
  stories smallint check (stories between 1 and 3),
  approx_sqft integer check (approx_sqft between 100 and 100000),
  siding_type text,
  has_hoa boolean not null default false,
  hoa_name text check (length(hoa_name) <= 160),
  hoa_contact text check (length(hoa_contact) <= 200),
  hoa_color_approval_required boolean not null default false,
  access_notes text check (length(access_notes) <= 2000),
  pets text check (length(pets) <= 500),
  parking text check (length(parking) <= 500),
  alarm text check (length(alarm) <= 500),
  occupancy text check (occupancy in ('occupied', 'vacant', 'tenant_occupied')),
  water_power_access text check (length(water_power_access) <= 500),
  search_text text generated always as (
    lower(btrim(coalesce(street, '') || ' ' || coalesce(city, '') || ' ' || coalesce(zip, '')))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);
create index properties_account_idx on public.properties (account_id);
create index properties_territory_idx on public.properties (territory_id);
create index properties_search_trgm_idx on public.properties using gin (search_text extensions.gin_trgm_ops);
create unique index properties_one_primary_idx on public.properties (account_id)
  where is_primary and deleted_at is null;

-- Gate / lockbox codes, encrypted by the app (AES-256-GCM). Kept apart from
-- properties so reading them is its own permission (SPEC §5.1, §13.1).
create table public.property_secrets (
  property_id uuid primary key references public.properties (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete restrict,
  access_code_ciphertext text not null check (access_code_ciphertext ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- Leads -----------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  first_name text not null check (length(btrim(first_name)) between 1 and 80),
  last_name text check (length(last_name) <= 80),
  company text check (length(company) <= 160),
  mobile text check (app.is_e164(mobile)),
  phone text check (app.is_e164(phone)),
  email text check (app.is_email(email)),
  street text check (length(street) <= 200),
  unit text check (length(unit) <= 40),
  city text check (length(city) <= 80),
  state text not null default 'WA' check (state ~ '^[A-Z]{2}$'),
  zip text check (zip ~ '^[0-9]{5}$'),
  territory_id uuid references public.territories (id),
  out_of_area boolean not null default false,
  services text[] not null default '{}'
    check (services <@ array['interior', 'exterior', 'cabinets', 'deck_fence', 'other']::text[]),
  timeline text check (timeline in ('asap', '1_3_months', '3_plus_months', 'just_planning')),
  home_built text check (home_built in ('before_1978', '1978_or_later', 'not_sure')),
  year_built smallint check (year_built between 1700 and 2100),
  property_type text,
  stories smallint check (stories between 1 and 3),
  siding_type text,
  has_hoa boolean,
  customer_notes text check (length(customer_notes) <= 5000),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture', 'unqualified', 'converted', 'lost')),
  disposition text,
  lead_source text not null,
  lead_sub_source text,
  lead_set_by uuid references public.profiles (id),
  owner_id uuid references public.profiles (id),
  point_of_contact_id uuid references public.profiles (id),
  account_id uuid references public.accounts (id),
  contact_id uuid references public.contacts (id),
  property_id uuid references public.properties (id),
  score smallint check (score between 0 and 100),
  grade text check (grade in ('A', 'B', 'C', 'D', 'F')),
  temperature text check (temperature in ('hot', 'warm', 'cold')),
  score_factors jsonb not null default '[]'::jsonb check (jsonb_typeof(score_factors) = 'array'),
  scored_at timestamptz,
  intake_channel text not null default 'manual' check (intake_channel in ('manual', 'website', 'import', 'referral')),
  utm_source text check (length(utm_source) <= 200),
  utm_medium text check (length(utm_medium) <= 200),
  utm_campaign text check (length(utm_campaign) <= 200),
  utm_term text check (length(utm_term) <= 200),
  utm_content text check (length(utm_content) <= 200),
  landing_page text check (length(landing_page) <= 2000),
  page_path text check (length(page_path) <= 500),
  referrer text check (length(referrer) <= 2000),
  referral_code text check (length(referral_code) <= 40),
  first_contacted_at timestamptz,
  speed_to_lead_seconds integer check (speed_to_lead_seconds >= 0),
  last_activity_at timestamptz not null default now(),
  walkthrough_at timestamptz,
  nurture_until date,
  converted_job_id uuid,
  converted_at timestamptz,
  lost_reason text,
  search_text text generated always as (
    lower(btrim(
      first_name || ' ' || coalesce(last_name, '') || ' ' || coalesce(company, '') || ' ' ||
      coalesce(email, '') || ' ' || coalesce(street, '') || ' ' || coalesce(city, '') || ' ' || coalesce(zip, '')
    ))
  ) stored,
  phone_digits text generated always as (
    regexp_replace(coalesce(mobile, '') || ' ' || coalesce(phone, ''), '[^0-9 ]', '', 'g')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  -- At least one way to reach them (SPEC §8.4 wizard step 1).
  constraint leads_contact_method check (mobile is not null or phone is not null or email is not null),
  constraint leads_lost_needs_reason check (status <> 'lost' or lost_reason is not null)
);
create index leads_org_status_created_idx on public.leads (org_id, status, created_at desc) where deleted_at is null;
create index leads_org_created_idx on public.leads (org_id, created_at desc) where deleted_at is null;
create index leads_org_activity_idx on public.leads (org_id, last_activity_at) where deleted_at is null;
create index leads_owner_idx on public.leads (owner_id);
create index leads_territory_idx on public.leads (territory_id);
create index leads_source_idx on public.leads (org_id, lead_source);
create index leads_created_by_idx on public.leads (created_by);
create index leads_account_idx on public.leads (account_id);
create index leads_contact_idx on public.leads (contact_id);
create index leads_property_idx on public.leads (property_id);
create index leads_lead_set_by_idx on public.leads (lead_set_by);
create index leads_poc_idx on public.leads (point_of_contact_id);
create index leads_org_email_idx on public.leads (org_id, email) where deleted_at is null;
create index leads_org_mobile_idx on public.leads (org_id, mobile) where deleted_at is null;
create index leads_org_phone_idx on public.leads (org_id, phone) where deleted_at is null;
create index leads_search_trgm_idx on public.leads using gin (search_text extensions.gin_trgm_ops);
create index leads_phone_trgm_idx on public.leads using gin (phone_digits extensions.gin_trgm_ops);

-- Photos from the website form or uploaded by staff (private Storage bucket).
create table public.lead_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  lead_id uuid not null references public.leads (id) on delete restrict,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  file_name text not null check (length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 15728640),
  source text not null default 'staff' check (source in ('website', 'staff')),
  created_at timestamptz not null default now(),
  created_by uuid
);
create index lead_attachments_lead_idx on public.lead_attachments (lead_id);

-- Notes, internal comments and tasks attach to a record ("subject").
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  subject_type text not null check (subject_type in ('lead', 'account', 'contact')),
  subject_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 10000),
  pinned boolean not null default false,
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);
create index notes_subject_idx on public.notes (subject_type, subject_id, created_at desc);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  subject_type text not null check (subject_type in ('lead', 'account', 'contact')),
  subject_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 5000),
  category text not null default 'general' check (category in ('general', 'sales', 'production', 'office', 'finance')),
  mentions uuid[] not null default '{}' check (cardinality(mentions) <= 20),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);
create index comments_subject_idx on public.comments (subject_type, subject_id, created_at desc);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  subject_type text check (subject_type in ('lead', 'account', 'contact')),
  subject_id uuid,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (length(description) <= 5000),
  due_at timestamptz,
  assignee_id uuid not null references public.profiles (id),
  status text not null default 'open' check (status in ('open', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  completed_at timestamptz,
  completed_by uuid,
  created_by_workflow text check (length(created_by_workflow) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  check ((subject_type is null) = (subject_id is null)),
  check ((status = 'done') = (completed_at is not null))
);
create index tasks_subject_idx on public.tasks (subject_type, subject_id);
create index tasks_assignee_open_idx on public.tasks (assignee_id, due_at) where status = 'open' and deleted_at is null;

-- Customer communication log. Sends go through adapters → integration_outbox
-- (simulated in this build); calls are logged by people (SPEC §5.7).
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  channel text not null check (channel in ('sms', 'email', 'call', 'voicemail', 'portal')),
  direction text not null check (direction in ('outbound', 'inbound')),
  subject_type text not null check (subject_type in ('lead', 'account', 'contact')),
  subject_id uuid not null,
  contact_id uuid references public.contacts (id),
  to_address text check (length(to_address) <= 320),
  from_address text check (length(from_address) <= 320),
  email_subject text check (length(email_subject) <= 300),
  body text check (length(body) <= 20000),
  call_outcome text,
  call_duration_seconds integer check (call_duration_seconds between 0 and 86400),
  status text not null check (status in ('simulated', 'queued', 'sent', 'delivered', 'failed', 'received', 'logged')),
  simulated boolean not null default true,
  outbox_id uuid references public.integration_outbox (id),
  sent_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (channel <> 'call' or status = 'logged')
);
create index messages_subject_idx on public.messages (subject_type, subject_id, created_at desc);
create index messages_contact_idx on public.messages (contact_id);
create index messages_outbox_idx on public.messages (outbox_id);
create index messages_sent_by_idx on public.messages (sent_by);

-- In-app notifications (bell). Written by trusted code; users only mark them read.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type ~ '^[a-z_]+$'),
  title text not null check (length(title) between 1 and 200),
  body text check (length(body) <= 1000),
  link text check (link ~ '^/'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Saved list views (filters, columns, sort), personal or shared (SPEC §5.9).
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  module text not null check (module in ('leads', 'accounts', 'contacts')),
  name text not null check (length(btrim(name)) between 1 and 80),
  shared boolean not null default false,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (user_id, module, name)
);
create index saved_views_org_module_idx on public.saved_views (org_id, module);

-- Lead score weights (SPEC §6.6), editable in Admin → Lead Scoring.
create table public.lead_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  factor text not null check (factor ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (length(btrim(label)) between 1 and 120),
  points smallint not null check (points between -100 and 100),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, factor)
);

-- Website intake bookkeeping (service role only; no client policies).
create table public.intake_requests (
  org_id uuid not null references public.organizations (id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  lead_id uuid not null references public.leads (id) on delete cascade,
  outcome text not null check (outcome in ('created', 'duplicate')),
  created_at timestamptz not null default now(),
  primary key (org_id, idempotency_key)
);
create index intake_requests_created_idx on public.intake_requests (created_at);

create table public.rate_limits (
  bucket text not null check (length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- =============================================================================
-- 4. Guards and side effects
-- =============================================================================

-- Child rows must belong to the same org as the records they point at.
create or replace function app.check_same_org(p_org uuid, p_table text, p_id uuid, p_label text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if p_id is null then return; end if;
  execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', p_table)
    into v_ok using p_id, p_org;
  if not v_ok then
    raise exception '% does not belong to this organization.', p_label using errcode = '42501';
  end if;
end;
$$;

-- Leads: picklists, territory from ZIP, org-matching references, assignment rights,
-- status bookkeeping.
create or replace function app.leads_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'A lead cannot move to another organization.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' or new.lead_source is distinct from old.lead_source then
    perform app.check_picklist(new.org_id, 'lead_source', new.lead_source, 'Lead source');
  end if;
  if tg_op = 'INSERT' or new.lead_sub_source is distinct from old.lead_sub_source then
    perform app.check_picklist(new.org_id, 'lead_sub_source', new.lead_sub_source, 'Sub-source');
  end if;
  if tg_op = 'INSERT' or new.disposition is distinct from old.disposition then
    perform app.check_picklist(new.org_id, 'lead_disposition', new.disposition, 'Disposition');
  end if;
  if tg_op = 'INSERT' or new.property_type is distinct from old.property_type then
    perform app.check_picklist(new.org_id, 'property_type', new.property_type, 'Property type');
  end if;
  if tg_op = 'INSERT' or new.siding_type is distinct from old.siding_type then
    perform app.check_picklist(new.org_id, 'siding_type', new.siding_type, 'Siding type');
  end if;
  if tg_op = 'INSERT' or new.lost_reason is distinct from old.lost_reason then
    perform app.check_picklist(new.org_id, 'lost_reason', new.lost_reason, 'Lost reason');
  end if;

  if tg_op = 'INSERT' or new.zip is distinct from old.zip then
    new.territory_id := case when new.zip is null then null else app.territory_for_zip(new.org_id, new.zip) end;
    new.out_of_area := new.zip is not null and new.territory_id is null;
  end if;

  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    perform app.check_same_org(new.org_id, 'profiles', new.owner_id, 'Owner');
  end if;
  if tg_op = 'INSERT' or new.point_of_contact_id is distinct from old.point_of_contact_id then
    perform app.check_same_org(new.org_id, 'profiles', new.point_of_contact_id, 'Point of contact');
  end if;
  if tg_op = 'INSERT' or new.lead_set_by is distinct from old.lead_set_by then
    perform app.check_same_org(new.org_id, 'profiles', new.lead_set_by, 'Lead set by');
  end if;
  if tg_op = 'INSERT' or new.account_id is distinct from old.account_id then
    perform app.check_same_org(new.org_id, 'accounts', new.account_id, 'Account');
  end if;
  if tg_op = 'INSERT' or new.contact_id is distinct from old.contact_id then
    perform app.check_same_org(new.org_id, 'contacts', new.contact_id, 'Contact');
  end if;
  if tg_op = 'INSERT' or new.property_id is distinct from old.property_id then
    perform app.check_same_org(new.org_id, 'properties', new.property_id, 'Property');
  end if;

  -- Assigning someone else's lead needs leads:assign (SPEC §8.4: Office Manager+).
  if not app.is_trusted() then
    if tg_op = 'INSERT' and new.owner_id is not null and new.owner_id <> app.effective_user_id()
       and not app.can_write('leads:assign') then
      raise exception 'Only people who can assign leads can create a lead for someone else.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id and not app.can_write('leads:assign') then
      raise exception 'Only people who can assign leads can change the owner.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.converted_job_id is distinct from old.converted_job_id
                             or new.converted_at is distinct from old.converted_at) then
      raise exception 'Leads are converted with Convert to Job.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.status = 'converted' and old.status <> 'converted' then
      raise exception 'Leads are converted with Convert to Job.' using errcode = '42501';
    end if;
  end if;

  -- First human contact is recorded once and never moves (speed-to-lead KPI).
  if tg_op = 'UPDATE' and old.first_contacted_at is not null then
    new.first_contacted_at := old.first_contacted_at;
    new.speed_to_lead_seconds := old.speed_to_lead_seconds;
  end if;

  return new;
end;
$$;

-- Accounts / contacts / properties: org-matching references and picklists.
create or replace function app.accounts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'An account cannot move to another organization.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    perform app.check_same_org(new.org_id, 'profiles', new.owner_id, 'Owner');
  end if;
  if tg_op = 'INSERT' or new.primary_contact_id is distinct from old.primary_contact_id then
    if new.primary_contact_id is not null and not exists (
      select 1 from public.contacts c where c.id = new.primary_contact_id and c.account_id = new.id
    ) then
      raise exception 'The primary contact must be one of this account''s contacts.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function app.contacts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'A contact cannot move to another organization.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' or new.account_id is distinct from old.account_id then
    perform app.check_same_org(new.org_id, 'accounts', new.account_id, 'Account');
  end if;
  -- Opting out or Do Not Contact clears marketing consent (SPEC §13.2).
  if new.do_not_contact or new.opted_out_at is not null then
    new.sms_opt_in := false;
    new.email_opt_in := false;
  end if;
  if new.sms_opt_in and new.sms_opt_in_at is null then new.sms_opt_in_at := now(); end if;
  if new.email_opt_in and new.email_opt_in_at is null then new.email_opt_in_at := now(); end if;
  return new;
end;
$$;

create or replace function app.properties_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'A property cannot move to another organization.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' or new.account_id is distinct from old.account_id then
    perform app.check_same_org(new.org_id, 'accounts', new.account_id, 'Account');
  end if;
  if tg_op = 'INSERT' or new.property_type is distinct from old.property_type then
    perform app.check_picklist(new.org_id, 'property_type', new.property_type, 'Property type');
  end if;
  if tg_op = 'INSERT' or new.siding_type is distinct from old.siding_type then
    perform app.check_picklist(new.org_id, 'siding_type', new.siding_type, 'Siding type');
  end if;
  if tg_op = 'INSERT' or new.zip is distinct from old.zip then
    new.territory_id := case when new.zip is null then null else app.territory_for_zip(new.org_id, new.zip) end;
    new.out_of_area := new.zip is not null and new.territory_id is null;
  end if;
  return new;
end;
$$;

-- The account's territory follows its primary (or only) property, so "team"
-- scope works for customers too.
create or replace function app.properties_sync_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.accounts a
  set territory_id = new.territory_id
  where a.id = new.account_id
    and a.territory_id is distinct from new.territory_id
    and (new.is_primary or not exists (
      select 1 from public.properties p
      where p.account_id = new.account_id and p.id <> new.id and p.deleted_at is null
    ));
  return null;
end;
$$;

create or replace function app.property_secrets_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.properties p where p.id = new.property_id and p.org_id = new.org_id) then
    raise exception 'Property does not belong to this organization.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Attachments, notes, comments, tasks, messages: the subject must exist in the org.
create or replace function app.subject_table(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type when 'lead' then 'leads' when 'account' then 'accounts' when 'contact' then 'contacts' end;
$$;

create or replace function app.subject_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := new.org_id;
  v_type text;
  v_id uuid;
begin
  if tg_table_name = 'lead_attachments' then
    v_type := 'lead';
    v_id := new.lead_id;
  else
    v_type := to_jsonb(new) ->> 'subject_type';
    v_id := (to_jsonb(new) ->> 'subject_id')::uuid;
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id
       or (to_jsonb(new) ->> 'subject_id') is distinct from (to_jsonb(old) ->> 'subject_id')
       or (to_jsonb(new) ->> 'subject_type') is distinct from (to_jsonb(old) ->> 'subject_type') then
      raise exception 'A note, comment or task cannot be moved to another record.' using errcode = '42501';
    end if;
    return new;
  end if;
  if v_type is not null then
    perform app.check_same_org(v_org, app.subject_table(v_type), v_id, 'The record');
  end if;
  return new;
end;
$$;

-- Comments: only the author edits; mentions must be org members; mentions notify.
create or replace function app.comments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(new.mentions) m(id)
    where not exists (select 1 from public.profiles p where p.id = m.id and p.org_id = new.org_id)
  ) then
    raise exception 'You can only mention people in your company.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create or replace function app.comments_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author text;
  v_link text := case new.subject_type
    when 'lead' then '/leads/' || new.subject_id
    when 'account' then '/accounts/' || new.subject_id
    when 'contact' then '/contacts/' || new.subject_id
  end;
begin
  select p.full_name into v_author from public.profiles p where p.id = new.created_by;
  insert into public.notifications (org_id, user_id, type, title, body, link)
  select new.org_id, m.id, 'mention',
         coalesce(v_author, 'Someone') || ' mentioned you',
         left(new.body, 200), v_link
  from (
    select distinct unnest(new.mentions) as id
    except
    select unnest(case when tg_op = 'UPDATE' then old.mentions else '{}'::uuid[] end)
  ) m
  where m.id is distinct from new.created_by;
  return null;
end;
$$;

-- Tasks: assignee in org; completion bookkeeping.
create or replace function app.tasks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    perform app.check_same_org(new.org_id, 'profiles', new.assignee_id, 'Assignee');
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(app.actor_id(), new.completed_by);
  elsif new.status = 'open' then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

-- Messages: the contact (if any) belongs to the org; call outcomes are dispositions.
create or replace function app.messages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.check_same_org(new.org_id, 'contacts', new.contact_id, 'Contact');
  perform app.check_picklist(new.org_id, 'lead_disposition', new.call_outcome, 'Call outcome');
  if not app.is_trusted() then
    new.sent_by := app.effective_user_id();
    new.simulated := true;
    if new.channel <> 'call' and new.outbox_id is null then
      raise exception 'Texts and emails are sent through the integrations outbox.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Any note, comment, task, message or photo on a lead counts as lead activity.
create or replace function app.touch_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
begin
  if tg_table_name = 'lead_attachments' then
    v_lead := new.lead_id;
  elsif (to_jsonb(new) ->> 'subject_type') = 'lead' then
    v_lead := (to_jsonb(new) ->> 'subject_id')::uuid;
  end if;
  if v_lead is not null then
    update public.leads set last_activity_at = now() where id = v_lead and last_activity_at < now();
  end if;
  return null;
end;
$$;

-- Human-readable lead timeline (SPEC §5: activity is separate from the audit log).
create or replace function app.leads_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status_label text;
  v_old_label text;
  v_owner text;
begin
  if tg_op = 'INSERT' then
    perform app.log_activity(new.org_id, 'lead', new.id::text, 'lead_created',
      case new.intake_channel
        when 'website' then 'Lead came in from the website'
        when 'import' then 'Lead imported'
        when 'referral' then 'Lead came in from a referral link'
        else 'Lead created'
      end,
      jsonb_build_object('source', new.lead_source, 'sub_source', new.lead_sub_source));
    return null;
  end if;

  if new.status is distinct from old.status then
    v_status_label := initcap(replace(new.status, '_', ' '));
    v_old_label := initcap(replace(old.status, '_', ' '));
    perform app.log_activity(new.org_id, 'lead', new.id::text, 'status_changed',
      'Status changed from ' || v_old_label || ' to ' || v_status_label,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.owner_id is distinct from old.owner_id then
    select p.full_name into v_owner from public.profiles p where p.id = new.owner_id;
    perform app.log_activity(new.org_id, 'lead', new.id::text, 'owner_changed',
      case when new.owner_id is null then 'Owner removed' else 'Assigned to ' || coalesce(v_owner, 'a teammate') end,
      jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  if new.walkthrough_at is distinct from old.walkthrough_at and new.walkthrough_at is not null then
    perform app.log_activity(new.org_id, 'lead', new.id::text, 'walkthrough_booked',
      'Walkthrough booked', jsonb_build_object('at', new.walkthrough_at));
  end if;
  if new.first_contacted_at is not null and old.first_contacted_at is null then
    perform app.log_activity(new.org_id, 'lead', new.id::text, 'first_contact',
      'First contact', jsonb_build_object('speed_to_lead_seconds', new.speed_to_lead_seconds));
  end if;
  return null;
end;
$$;

-- created_by for append-only tables (no updated_* columns).
create or replace function app.stamp_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := coalesce(app.actor_id(), new.created_by);
  return new;
end;
$$;

create or replace function app.deny_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'This record cannot be changed.' using errcode = '42501';
end;
$$;

-- Fixed-window rate limiter for public endpoints (service role only).
create or replace function app.consume_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  -- Opportunistic cleanup of old windows.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;
revoke execute on function app.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function app.consume_rate_limit(text, integer, integer) to service_role;

-- =============================================================================
-- 5. Triggers
-- =============================================================================

create trigger leads_guard before insert or update on public.leads
  for each row execute function app.leads_guard();
create trigger accounts_guard before insert or update on public.accounts
  for each row execute function app.accounts_guard();
create trigger contacts_guard before insert or update on public.contacts
  for each row execute function app.contacts_guard();
create trigger properties_guard before insert or update on public.properties
  for each row execute function app.properties_guard();
create trigger properties_sync_account after insert or update of territory_id, is_primary on public.properties
  for each row execute function app.properties_sync_account();
create trigger property_secrets_guard before insert or update on public.property_secrets
  for each row execute function app.property_secrets_guard();
create trigger comments_guard before insert or update on public.comments
  for each row execute function app.comments_guard();
create trigger comments_notify after insert or update of mentions on public.comments
  for each row execute function app.comments_notify();
create trigger tasks_guard before insert or update on public.tasks
  for each row execute function app.tasks_guard();
create trigger messages_guard before insert on public.messages
  for each row execute function app.messages_guard();
create trigger messages_immutable before update or delete on public.messages
  for each row execute function app.deny_write();
create trigger lead_attachments_immutable before update on public.lead_attachments
  for each row execute function app.deny_write();
create trigger leads_activity after insert or update on public.leads
  for each row execute function app.leads_activity();

do $$
declare
  t text;
begin
  foreach t in array array['lead_attachments', 'notes', 'comments', 'tasks', 'messages'] loop
    execute format('create trigger %I_subject_guard before insert or update on public.%I for each row execute function app.subject_guard()', t, t);
    execute format('create trigger %I_touch_lead after insert on public.%I for each row execute function app.touch_lead_activity()', t, t);
  end loop;

  foreach t in array array[
    'accounts', 'contacts', 'properties', 'property_secrets', 'leads', 'notes', 'comments',
    'tasks', 'saved_views', 'lead_scoring_rules'
  ] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function app.stamp_actor()', t, t);
  end loop;

end
$$;

create trigger lead_attachments_stamp_creator before insert on public.lead_attachments
  for each row execute function app.stamp_creator();

-- Audit: every business table. last_activity_at is bookkeeping (touched by any
-- note/message) and the access-code ciphertext never enters the audit log.
create trigger accounts_audit after insert or update or delete on public.accounts
  for each row execute function app.audit_row('search_text');
create trigger contacts_audit after insert or update or delete on public.contacts
  for each row execute function app.audit_row('search_text', 'phone_digits');
create trigger properties_audit after insert or update or delete on public.properties
  for each row execute function app.audit_row('search_text');
create trigger property_secrets_audit after insert or update or delete on public.property_secrets
  for each row execute function app.audit_row('access_code_ciphertext');
create trigger leads_audit after insert or update or delete on public.leads
  for each row execute function app.audit_row('search_text', 'phone_digits', 'last_activity_at');
create trigger lead_attachments_audit after insert or update or delete on public.lead_attachments
  for each row execute function app.audit_row();
create trigger notes_audit after insert or update or delete on public.notes
  for each row execute function app.audit_row();
create trigger comments_audit after insert or update or delete on public.comments
  for each row execute function app.audit_row();
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function app.audit_row();
create trigger saved_views_audit after insert or update or delete on public.saved_views
  for each row execute function app.audit_row();
create trigger lead_scoring_rules_audit after insert or update or delete on public.lead_scoring_rules
  for each row execute function app.audit_row();
-- Messages are themselves the record of what was said; the audit row keeps who/when/where
-- but not the text (SPEC §13: keep personal data to a minimum).
create trigger messages_audit after insert or update or delete on public.messages
  for each row execute function app.audit_row('body', 'email_subject', 'to_address', 'from_address');
-- Notifications are side effects of audited changes. (rate_limits holds only counters and
-- is exempt, like the log tables; see supabase/tests/000_rls_everywhere.test.sql.)
create trigger notifications_audit after insert or update or delete on public.notifications
  for each row execute function app.audit_row('body');
create trigger intake_requests_audit after insert or update or delete on public.intake_requests
  for each row execute function app.audit_row();

-- Domain events (ids and changed field names only).
create trigger accounts_event after insert or update or delete on public.accounts
  for each row execute function app.emit_change_event('account', 'search_text');
create trigger contacts_event after insert or update or delete on public.contacts
  for each row execute function app.emit_change_event('contact', 'search_text', 'phone_digits');
create trigger properties_event after insert or update or delete on public.properties
  for each row execute function app.emit_change_event('property', 'search_text');
create trigger property_secrets_event after insert or update or delete on public.property_secrets
  for each row execute function app.emit_change_event('property_access_code', 'access_code_ciphertext');
create trigger leads_event after insert or update or delete on public.leads
  for each row execute function app.emit_change_event('lead', 'search_text', 'phone_digits', 'last_activity_at');
create trigger lead_attachments_event after insert or update or delete on public.lead_attachments
  for each row execute function app.emit_change_event('lead_attachment');
create trigger notes_event after insert or update or delete on public.notes
  for each row execute function app.emit_change_event('note');
create trigger comments_event after insert or update or delete on public.comments
  for each row execute function app.emit_change_event('comment');
create trigger tasks_event after insert or update or delete on public.tasks
  for each row execute function app.emit_change_event('task');
create trigger messages_event after insert on public.messages
  for each row execute function app.emit_change_event('message');
create trigger saved_views_event after insert or update or delete on public.saved_views
  for each row execute function app.emit_change_event('saved_view');
create trigger lead_scoring_rules_event after insert or update or delete on public.lead_scoring_rules
  for each row execute function app.emit_change_event('lead_scoring_rule');

-- =============================================================================
-- 6. Row level security
-- =============================================================================

alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.properties enable row level security;
alter table public.property_secrets enable row level security;
alter table public.leads enable row level security;
alter table public.lead_attachments enable row level security;
alter table public.notes enable row level security;
alter table public.comments enable row level security;
alter table public.tasks enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.saved_views enable row level security;
alter table public.lead_scoring_rules enable row level security;
alter table public.intake_requests enable row level security;
alter table public.rate_limits enable row level security;

revoke all on public.intake_requests, public.rate_limits from anon, authenticated;
-- Notifications: written by trusted code; users may only mark their own read.
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
-- Messages and attachments are append-only for clients.
revoke update, delete on public.messages, public.lead_attachments from authenticated;
revoke delete on public.accounts, public.contacts, public.properties, public.leads,
  public.notes, public.comments, public.tasks from authenticated;

-- leads ---------------------------------------------------------------------------
create policy leads_select on public.leads for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and app.scope_match((select app.perm_scope('leads:read')), owner_id, created_by, territory_id,
                        (select app.effective_user_id()), (select app.my_territory_id()))
  );
create policy leads_insert on public.leads for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('leads:create')));
create policy leads_update on public.leads for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and app.scope_match((select app.perm_scope('leads:update')), owner_id, created_by, territory_id,
                        (select app.effective_user_id()), (select app.my_territory_id()))
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

-- accounts --------------------------------------------------------------------------
create policy accounts_select on public.accounts for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and app.scope_match((select app.perm_scope('accounts:read')), owner_id, created_by, territory_id,
                        (select app.effective_user_id()), (select app.my_territory_id()))
  );
create policy accounts_insert on public.accounts for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('accounts:create')));
create policy accounts_update on public.accounts for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and app.scope_match((select app.perm_scope('accounts:update')), owner_id, created_by, territory_id,
                        (select app.effective_user_id()), (select app.my_territory_id()))
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

-- contacts and properties follow their account ---------------------------------------
create policy contacts_select on public.contacts for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and exists (
      select 1 from public.accounts a where a.id = account_id
        and app.scope_match((select app.perm_scope('contacts:read')), a.owner_id, a.created_by, a.territory_id,
                            (select app.effective_user_id()), (select app.my_territory_id()))
    )
  );
create policy contacts_insert on public.contacts for insert to authenticated
  with check (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('contacts:create'))
    and exists (select 1 from public.accounts a where a.id = account_id)
  );
create policy contacts_update on public.contacts for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and exists (
      select 1 from public.accounts a where a.id = account_id
        and app.scope_match((select app.perm_scope('contacts:update')), a.owner_id, a.created_by, a.territory_id,
                            (select app.effective_user_id()), (select app.my_territory_id()))
    )
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

create policy properties_select on public.properties for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and exists (select 1 from public.accounts a where a.id = account_id)
  );
create policy properties_insert on public.properties for insert to authenticated
  with check (
    org_id = (select app.current_org_id()) and deleted_at is null
    and ((select app.can_write('accounts:create')) or (select app.can_write('accounts:update')))
    and exists (select 1 from public.accounts a where a.id = account_id)
  );
create policy properties_update on public.properties for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and exists (
      select 1 from public.accounts a where a.id = account_id
        and app.scope_match((select app.perm_scope('accounts:update')), a.owner_id, a.created_by, a.territory_id,
                            (select app.effective_user_id()), (select app.my_territory_id()))
    )
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

-- Access codes: a separate permission (narrowed to assigned crews on scheduled days in Phase 6).
create policy property_secrets_select on public.property_secrets for select to authenticated
  using (
    org_id = (select app.current_org_id()) and (select app.has_perm('properties:view_access_codes'))
    and exists (select 1 from public.properties p where p.id = property_id)
  );
create policy property_secrets_insert on public.property_secrets for insert to authenticated
  with check (
    org_id = (select app.current_org_id()) and (select app.can_write('properties:view_access_codes'))
    and exists (select 1 from public.properties p where p.id = property_id)
  );
create policy property_secrets_update on public.property_secrets for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('properties:view_access_codes')))
  with check (org_id = (select app.current_org_id()));
create policy property_secrets_delete on public.property_secrets for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('properties:view_access_codes')));

-- Records hanging off a subject are visible when the subject is (as the caller).
create or replace function app.can_see_subject(p_type text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_type
    when 'lead' then exists (select 1 from public.leads l where l.id = p_id)
    when 'account' then exists (select 1 from public.accounts a where a.id = p_id)
    when 'contact' then exists (select 1 from public.contacts c where c.id = p_id)
    else false
  end;
$$;

-- Writing on a subject needs update rights on it (as the caller).
create or replace function app.can_edit_subject(p_type text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_type
    when 'lead' then exists (
      select 1 from public.leads l where l.id = p_id
        and app.scope_match(app.perm_scope('leads:update'), l.owner_id, l.created_by, l.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'account' then exists (
      select 1 from public.accounts a where a.id = p_id
        and app.scope_match(app.perm_scope('accounts:update'), a.owner_id, a.created_by, a.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'contact' then exists (
      select 1 from public.contacts c join public.accounts a on a.id = c.account_id where c.id = p_id
        and app.scope_match(app.perm_scope('contacts:update'), a.owner_id, a.created_by, a.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    else false
  end;
$$;

create policy lead_attachments_select on public.lead_attachments for select to authenticated
  using (org_id = (select app.current_org_id()) and app.can_see_subject('lead', lead_id));
create policy lead_attachments_insert on public.lead_attachments for insert to authenticated
  with check (org_id = (select app.current_org_id()) and not (select app.is_impersonating())
              and app.can_edit_subject('lead', lead_id));

create policy notes_select on public.notes for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.has_perm('notes:read'))
         and app.can_see_subject(subject_type, subject_id));
create policy notes_insert on public.notes for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('notes:write'))
              and app.can_see_subject(subject_type, subject_id));
create policy notes_update on public.notes for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('notes:write'))
         and created_by = (select auth.uid()))
  with check (org_id = (select app.current_org_id()));

create policy comments_select on public.comments for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.has_perm('notes:read'))
         and app.can_see_subject(subject_type, subject_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('notes:write'))
              and app.can_see_subject(subject_type, subject_id));
create policy comments_update on public.comments for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('notes:write'))
         and created_by = (select auth.uid()))
  with check (org_id = (select app.current_org_id()));

-- Tasks: own scope = assigned to me or created by me.
create policy tasks_select on public.tasks for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and app.scope_match((select app.perm_scope('tasks:read')), assignee_id, created_by, null,
                        (select app.effective_user_id()), null)
    and (subject_id is null or app.can_see_subject(subject_type, subject_id))
  );
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('tasks:manage'))
    and (subject_id is null or app.can_see_subject(subject_type, subject_id))
  );
create policy tasks_update on public.tasks for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('tasks:manage'))
    and app.scope_match((select app.perm_scope('tasks:manage')), assignee_id, created_by, null,
                        (select app.effective_user_id()), null)
  )
  with check (org_id = (select app.current_org_id()));

create policy messages_select on public.messages for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('messages:read'))
         and app.can_see_subject(subject_type, subject_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('messages:send'))
              and app.can_see_subject(subject_type, subject_id));

create policy notifications_select on public.notifications for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()) and not (select app.is_impersonating()))
  with check (user_id = (select auth.uid()));

create policy saved_views_select on public.saved_views for select to authenticated
  using (org_id = (select app.current_org_id()) and (user_id = (select app.effective_user_id()) or shared));
create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()) and not (select app.is_impersonating()));
create policy saved_views_update on public.saved_views for update to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()) and not (select app.is_impersonating()))
  with check (user_id = (select auth.uid()));
create policy saved_views_delete on public.saved_views for delete to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()) and not (select app.is_impersonating()));

create policy lead_scoring_rules_select on public.lead_scoring_rules for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy lead_scoring_rules_update on public.lead_scoring_rules for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));

-- Activity: record-level for leads/accounts/contacts (replaces the Phase 1 type-level policy).
create or replace function app.can_read_activity(p_type text, p_id text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_type in ('lead', 'account', 'contact') then
    return app.can_see_subject(p_type, p_id::uuid);
  end if;
  return app.can_read_subject(p_type);
exception when invalid_text_representation then
  return false;
end;
$$;

drop policy activity_select on public.activity;
create policy activity_select on public.activity for select to authenticated
  using (org_id = (select app.current_org_id()) and app.can_read_activity(subject_type, subject_id));

grant execute on function app.my_territory_id(), app.scope_match(text, uuid, uuid, uuid, uuid, uuid),
  app.can_see_subject(text, uuid), app.can_edit_subject(text, uuid), app.can_read_activity(text, text),
  app.picklist_value_exists(uuid, text, text), app.is_e164(text), app.is_email(text)
  to authenticated, service_role;

-- =============================================================================
-- 7. RPCs
-- =============================================================================

-- Universal search (SPEC §8.1). Runs as the caller, so RLS limits the results.
create or replace function public.search_records(p_query text, p_scope text default 'all', p_limit integer default 8)
returns table (kind text, id uuid, title text, subtitle text, href text, rank real)
language sql
stable
set search_path = ''
as $$
  with q as (
    select lower(btrim(p_query)) as term,
           nullif(regexp_replace(p_query, '[^0-9]', '', 'g'), '') as digits,
           least(greatest(coalesce(p_limit, 8), 1), 25) as lim
  ),
  lead_hits as (
    select 'lead'::text as kind, l.id,
           btrim(l.first_name || ' ' || coalesce(l.last_name, '')) as title,
           concat_ws(' · ', initcap(replace(l.status, '_', ' ')), l.city, coalesce(l.mobile, l.phone, l.email)) as subtitle,
           '/leads/' || l.id as href,
           greatest(extensions.similarity(l.search_text, q.term),
                    case when q.digits is not null and length(q.digits) >= 4 and l.phone_digits like '%' || q.digits || '%' then 0.9 else 0 end)::real as rank
    from public.leads l, q
    where p_scope in ('all', 'leads') and length(q.term) >= 2
      and (l.search_text like '%' || q.term || '%'
           or (q.digits is not null and length(q.digits) >= 4 and l.phone_digits like '%' || q.digits || '%'))
    order by rank desc, l.last_activity_at desc
    limit (select lim from q)
  ),
  account_hits as (
    select 'account'::text, a.id, a.display_name,
           concat_ws(' · ', initcap(replace(a.status, '_', ' ')), initcap(replace(a.account_type, '_', ' '))),
           '/accounts/' || a.id,
           extensions.similarity(a.search_text, q.term)::real
    from public.accounts a, q
    where p_scope in ('all', 'accounts') and length(q.term) >= 2 and a.search_text like '%' || q.term || '%'
    order by 6 desc
    limit (select lim from q)
  ),
  contact_hits as (
    select 'contact'::text, c.id, btrim(c.first_name || ' ' || coalesce(c.last_name, '')),
           concat_ws(' · ', coalesce(c.mobile, c.phone), c.email),
           '/contacts/' || c.id,
           greatest(extensions.similarity(c.search_text, q.term),
                    case when q.digits is not null and length(q.digits) >= 4 and c.phone_digits like '%' || q.digits || '%' then 0.9 else 0 end)::real
    from public.contacts c, q
    where p_scope in ('all', 'contacts') and length(q.term) >= 2
      and (c.search_text like '%' || q.term || '%'
           or (q.digits is not null and length(q.digits) >= 4 and c.phone_digits like '%' || q.digits || '%'))
    order by 6 desc
    limit (select lim from q)
  ),
  property_hits as (
    select 'account'::text, a.id, a.display_name,
           concat_ws(', ', p.street, p.city),
           '/accounts/' || a.id,
           (extensions.similarity(p.search_text, q.term) * 0.9)::real
    from public.properties p join public.accounts a on a.id = p.account_id, q
    where p_scope in ('all', 'accounts') and length(q.term) >= 3 and p.search_text like '%' || q.term || '%'
    order by 6 desc
    limit (select lim from q)
  )
  select * from (
    select * from lead_hits
    union all select * from account_hits
    union all select * from contact_hits
    union all select * from property_hits
  ) r
  order by r.rank desc
  limit (select lim * 2 from q);
$$;

-- Lead dashboard numbers, aggregated in Postgres over every lead the caller can
-- see (SPEC §8: never computed from a paginated list).
create or replace function public.lead_stats(p_now timestamptz default now())
returns jsonb
language sql
stable
set search_path = ''
as $$
  with l as (
    select l.*, coalesce(t.name, case when l.out_of_area then 'Outside service area' else 'Unknown' end) as city_name
    from public.leads l
    left join public.territories t on t.id = l.territory_id
  ),
  open_l as (
    select * from l where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')
  )
  select jsonb_build_object(
    'total', (select count(*) from l),
    'open', (select count(*) from open_l),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from l group by status) s), '{}'::jsonb),
    'reached_contacted', (select count(*) from l where first_contacted_at is not null or status in ('contacted', 'walkthrough_scheduled', 'converted')),
    'reached_walkthrough', (select count(*) from l where walkthrough_at is not null or status in ('walkthrough_scheduled', 'converted')),
    'converted', (select count(*) from l where status = 'converted'),
    'unassigned', (select count(*) from open_l where owner_id is null),
    'hot', (select count(*) from open_l where temperature = 'hot'),
    'stale', (select count(*) from open_l where last_activity_at < p_now - interval '14 days'),
    'new_last_7_days', (select count(*) from l where created_at >= p_now - interval '7 days'),
    'aging', jsonb_build_object(
      '0_3', (select count(*) from open_l where created_at >= p_now - interval '3 days'),
      '4_7', (select count(*) from open_l where created_at < p_now - interval '3 days' and created_at >= p_now - interval '7 days'),
      '8_14', (select count(*) from open_l where created_at < p_now - interval '7 days' and created_at >= p_now - interval '14 days'),
      '15_30', (select count(*) from open_l where created_at < p_now - interval '14 days' and created_at >= p_now - interval '30 days'),
      '30_plus', (select count(*) from open_l where created_at < p_now - interval '30 days')
    ),
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('source', lead_source, 'leads', n, 'converted', c) order by n desc)
      from (select lead_source, count(*) n, count(*) filter (where status = 'converted') c
            from l group by lead_source order by count(*) desc limit 8) s), '[]'::jsonb),
    'by_city', coalesce((
      select jsonb_agg(jsonb_build_object('city', city_name, 'leads', n) order by n desc)
      from (select city_name, count(*) n from l group by city_name order by count(*) desc limit 10) c), '[]'::jsonb),
    'speed_to_lead_median_seconds', (
      select percentile_cont(0.5) within group (order by speed_to_lead_seconds)
      from l where speed_to_lead_seconds is not null and created_at >= p_now - interval '90 days')
  );
$$;

-- Status tab counts for the lead list (one query instead of one per tab).
create or replace function public.lead_status_counts()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'active', count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')),
    'total', count(*),
    'new', count(*) filter (where status = 'new'),
    'contacted', count(*) filter (where status = 'contacted'),
    'walkthrough_scheduled', count(*) filter (where status = 'walkthrough_scheduled'),
    'nurture', count(*) filter (where status = 'nurture'),
    'mine', count(*) filter (where owner_id = app.effective_user_id()
                             and status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture'))
  )
  from public.leads;
$$;

revoke execute on function public.search_records(text, text, integer), public.lead_stats(timestamptz),
  public.lead_status_counts() from public, anon;
grant execute on function public.search_records(text, text, integer), public.lead_stats(timestamptz),
  public.lead_status_counts() to authenticated;

-- Soft delete: leads, accounts, contacts and properties join the allowlist.
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
    when 'leads' then 'leads:delete'
    when 'accounts' then 'accounts:delete'
    when 'contacts' then 'contacts:delete'
    when 'properties' then 'accounts:delete'
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
      union all
      select 'leads', l.id, btrim(l.first_name || ' ' || coalesce(l.last_name, '')), l.deleted_at, l.deleted_by, l.delete_reason
      from public.leads l where l.org_id = v_org and l.deleted_at is not null
      union all
      select 'accounts', a.id, a.display_name, a.deleted_at, a.deleted_by, a.delete_reason
      from public.accounts a where a.org_id = v_org and a.deleted_at is not null
      union all
      select 'contacts', c.id, btrim(c.first_name || ' ' || coalesce(c.last_name, '')), c.deleted_at, c.deleted_by, c.delete_reason
      from public.contacts c where c.org_id = v_org and c.deleted_at is not null
      union all
      select 'properties', pr.id, coalesce(nullif(concat_ws(', ', pr.street, pr.city), ''), 'Property'), pr.deleted_at, pr.deleted_by, pr.delete_reason
      from public.properties pr where pr.org_id = v_org and pr.deleted_at is not null
    ) d
    left join public.profiles p on p.id = d.deleted_by
    order by d.deleted_at desc;
end;
$$;

-- Open work to hand over before deactivating someone.
create or replace function public.open_work_counts(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
begin
  if v_org is null or not app.has_perm('users:read') then
    raise exception 'You do not have permission to view this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and org_id = v_org) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'leads', nullif((select count(*) from public.leads l
                     where l.org_id = v_org and l.owner_id = p_user_id and l.deleted_at is null
                       and l.status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')), 0),
    'tasks', nullif((select count(*) from public.tasks t
                     where t.org_id = v_org and t.assignee_id = p_user_id and t.deleted_at is null and t.status = 'open'), 0)
  ));
end;
$$;

-- =============================================================================
-- 8. Storage bucket for lead photos (private; served through signed URLs only)
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('lead-attachments', 'lead-attachments', false, 15728640,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
    on conflict (id) do nothing;
  end if;
end
$$;

-- =============================================================================
-- 9. Seed
-- =============================================================================

create or replace function app.seed_leads_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- SPEC §6.6 starting weights (owners can change them in Admin → Lead Scoring).
  insert into public.lead_scoring_rules (org_id, factor, label, points, sort_order)
  values
    (p_org, 'in_service_area', 'In our service area', 10, 10),
    (p_org, 'out_of_area', 'Outside our service area', -20, 20),
    (p_org, 'has_mobile', 'Has a mobile number', 5, 30),
    (p_org, 'has_email', 'Has an email address', 3, 40),
    (p_org, 'full_address', 'Full street address', 5, 50),
    (p_org, 'timeline_asap', 'Timeline: as soon as possible', 15, 60),
    (p_org, 'timeline_1_3_months', 'Timeline: 1–3 months', 8, 70),
    (p_org, 'timeline_just_planning', 'Timeline: just planning', -10, 80),
    (p_org, 'exterior_or_multiple', 'Exterior or more than one service', 5, 90),
    (p_org, 'cabinets', 'Cabinets', 5, 100),
    (p_org, 'uploaded_photos', 'Sent photos', 5, 110),
    (p_org, 'referral_or_past_customer', 'Referral or past customer', 15, 120),
    (p_org, 'responded_to_text', 'Replied to a text', 10, 130),
    (p_org, 'no_response_3_attempts', 'No response after 3 attempts', -15, 140)
  on conflict (org_id, factor) do nothing;

  -- Office managers (everyone's core records) may see gate codes; crews get it in Phase 6.
  insert into public.pack_permissions (org_id, pack_id, permission, scope)
  select p_org, pk.id, 'properties:view_access_codes', 'all'
  from public.permission_packs pk
  where pk.org_id = p_org and pk.key = 'core_records_all'
  on conflict do nothing;
end;
$$;
revoke execute on function app.seed_leads_defaults(uuid) from public, anon, authenticated;

select app.seed_leads_defaults(id) from public.organizations;
