-- Phase 4: Estimating (SPEC §5.5, §5.6, §6.2 gates 2–4, §6.4, §7, §8.5, §8.12, §8.19).
--
-- Catalog: price_books, catalog_items, paint_products, production_rates,
-- estimate_settings. Estimates: estimates → estimate_versions → estimate_options
-- → estimate_areas → estimate_line_items (lines also belong to change orders),
-- color_selections, change_orders, agreement_templates, proposal_tokens,
-- signatures. Records an accepted estimate produces, created now with their full
-- SPEC columns so later phases only add: documents (+ private Storage bucket),
-- invoices + invoice_lines, onboarding_requirements, paint_orders + lines,
-- work_orders (+ work_order_costs).
--
-- Prices are computed by the TypeScript engine (lib/domain/estimating). People
-- edit the inputs through row security; the computed columns (hours, gallons,
-- costs, prices, snapshots) are written only by trusted server code, and a sent
-- version is frozen. Sending, viewing, accepting and declining are
-- service-role-only functions called by lib/estimating/* after its checks.
--
-- Rollback: supabase/rollbacks/20261027000100_estimating.down.sql

-- =============================================================================
-- 0. Permissions, numbers, helpers
-- =============================================================================

-- @permissions:begin
insert into public.permissions (key, resource, action, label, category, supports_scope, sort_order)
select v.key, split_part(v.key, ':', 1), split_part(v.key, ':', 2), v.label, v.category, v.scoped, v.ord
from (values
  ('catalog:manage', 'Edit the price book, paint catalog and production rates', 'sales', false, 224),
  ('change_orders:draft', 'Start change orders from the field', 'production', false, 365)
) as v(key, label, category, scoped, ord)
on conflict (key) do nothing;
-- @permissions:end

-- Paint orders get PO-YYYY-NNNN numbers.
alter table app.number_sequences drop constraint number_sequences_kind_check;
alter table app.number_sequences add constraint number_sequences_kind_check
  check (kind in ('job', 'estimate', 'invoice', 'payment', 'work_order', 'change_order', 'paint_order'));

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
    when 'paint_order' then 'PO'
  end;
$$;

-- Keys used across the estimating tables.
create or replace function app.is_key(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or p ~ '^[a-z0-9][a-z0-9_]{0,59}$';
$$;

-- =============================================================================
-- 1. Catalog (SPEC §5.5, §7.2, §8.12)
-- =============================================================================

create table public.price_books (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (length(description) <= 1000),
  active boolean not null default true,
  is_default boolean not null default false,
  effective_from date,
  effective_to date,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check (not is_default or active)
);
create unique index price_books_one_default_idx on public.price_books (org_id)
  where is_default and deleted_at is null;
create unique index price_books_name_idx on public.price_books (org_id, lower(name)) where deleted_at is null;

create table public.paint_products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  brand text not null,
  line text check (length(line) <= 120),
  product text not null check (length(btrim(product)) between 1 and 160),
  use text not null default 'both' check (use in ('interior', 'exterior', 'both')),
  base text check (length(base) <= 80),
  sheens text[] not null default '{}' check (cardinality(sheens) <= 6),
  coverage_sqft_per_gal numeric(12, 2) not null check (coverage_sqft_per_gal > 0 and coverage_sqft_per_gal <= 2000),
  cost_per_gal_cents bigint not null check (cost_per_gal_cents between 0 and 10000000),
  price_per_gal_cents bigint check (price_per_gal_cents between 0 and 10000000),
  voc_g_per_l numeric(12, 2) check (voc_g_per_l between 0 and 1000),
  dry_time_hours numeric(12, 2) check (dry_time_hours between 0 and 1000),
  recoat_hours numeric(12, 2) check (recoat_hours between 0 and 1000),
  min_temp_f smallint check (min_temp_f between -20 and 120),
  containers text[] not null default '{gallon,five_gallon}'
    check (cardinality(containers) between 1 and 3 and containers <@ array['quart', 'gallon', 'five_gallon']),
  is_primer boolean not null default false,
  notes text check (length(notes) <= 1000),
  active boolean not null default true,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);
create index paint_products_org_idx on public.paint_products (org_id, brand, product) where deleted_at is null;

create table public.production_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  surface text not null check (app.is_key(surface) and surface is not null),
  method text not null check (method in ('brush_roll', 'spray', 'mixed')),
  condition text not null check (condition in ('good', 'fair', 'poor')),
  units_per_labor_hour numeric(12, 4) not null check (units_per_labor_hour > 0 and units_per_labor_hour <= 100000),
  prep_hours_per_unit numeric(12, 4) not null default 0 check (prep_hours_per_unit between 0 and 1000),
  notes text check (length(notes) <= 1000),
  active boolean not null default true,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, surface, method, condition)
);

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  price_book_id uuid not null references public.price_books (id) on delete cascade,
  item_type text not null check (item_type in ('labor', 'material', 'add_on', 'package', 'fee', 'discount')),
  family text not null check (family in (
    'interior_labor', 'exterior_labor', 'cabinets', 'deck_fence', 'add_ons', 'materials', 'fees', 'packages')),
  code text not null check (app.is_key(code) and code is not null),
  name text not null check (length(btrim(name)) between 1 and 160),
  customer_description text check (length(customer_description) <= 1000),
  unit text not null check (unit in ('sqft', 'lf', 'each', 'hour', 'room', 'door', 'drawer', 'gallon', 'lump', 'pair', 'step')),
  pricing_method text not null default 'flat' check (pricing_method in ('production_rate', 'flat')),
  -- Production-rate items: which production_rates rows price them.
  surface text check (app.is_key(surface)),
  work_type text,
  work_order_phase text check (work_order_phase in ('prep', 'repair', 'paint', 'cabinet_shop', 'stain', 'touch_up', 'warranty')),
  paint_sqft_per_unit numeric(12, 4) not null default 0 check (paint_sqft_per_unit between 0 and 10000),
  default_coats smallint not null default 2 check (default_coats between 1 and 3),
  default_product_id uuid references public.paint_products (id) on delete set null,
  default_method text not null default 'brush_roll' check (default_method in ('brush_roll', 'spray', 'mixed')),
  -- Flat items: price and cost per unit.
  unit_price_cents bigint check (unit_price_cents between 0 and 100000000),
  unit_cost_cents bigint check (unit_cost_cents between 0 and 100000000),
  labor_hours_per_unit numeric(12, 4) not null default 0 check (labor_hours_per_unit between 0 and 1000),
  taxable boolean not null default true,
  is_optional_default boolean not null default false,
  is_repair_allowance boolean not null default false,
  allowance_note text check (length(allowance_note) <= 500),
  active boolean not null default true,
  is_sample boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (price_book_id, code),
  check (pricing_method <> 'production_rate' or surface is not null),
  check (pricing_method <> 'flat' or unit_price_cents is not null)
);
create index catalog_items_book_idx on public.catalog_items (price_book_id, family, sort_order) where deleted_at is null;
create index catalog_items_org_idx on public.catalog_items (org_id);
create index catalog_items_product_idx on public.catalog_items (default_product_id);

-- Estimating knobs (one row per company). Deposit %, expiry days and tax config
-- stay in company_settings (single source); Estimate Setup edits both.
create table public.estimate_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  pricing jsonb not null default '{}'::jsonb check (jsonb_typeof(pricing) = 'object'),
  discount_limits jsonb not null default '{"roles": {}, "users": {}}'::jsonb check (jsonb_typeof(discount_limits) = 'object'),
  -- {"interior": {"items": [..], "status": "draft"|"approved"}, ...} (SPEC §7.6)
  whats_included jsonb not null default '{}'::jsonb check (jsonb_typeof(whats_included) = 'object'),
  -- [{"key", "title", "body", "enabled"}] worded from the website promises (SPEC §1.3)
  guarantees jsonb not null default '[]'::jsonb check (jsonb_typeof(guarantees) = 'array'),
  guarantees_status text not null default 'draft' check (guarantees_status in ('draft', 'approved')),
  lead_safe_disclosure text check (length(lead_safe_disclosure) <= 4000),
  is_sample boolean not null default true,
  calibrated_by uuid,
  calibrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- =============================================================================
-- 2. Estimates (SPEC §5.5, §7.1)
-- =============================================================================

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  estimate_number text not null,
  title text check (length(title) <= 200),
  status text not null default 'draft' check (status in ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired')),
  owner_id uuid references public.profiles (id),
  current_version_id uuid,
  accepted_version_id uuid,
  accepted_option_id uuid,
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  decline_reason text check (length(decline_reason) <= 1000),
  expires_at timestamptz,
  -- Recommended option's total when sent; the accepted total once accepted (lists, metrics).
  total_cents bigint check (total_cents between 0 and 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, estimate_number)
);
create index estimates_job_idx on public.estimates (job_id);
create index estimates_org_status_idx on public.estimates (org_id, status, sent_at desc) where deleted_at is null;
create index estimates_org_created_idx on public.estimates (org_id, created_at desc, id) where deleted_at is null;
create index estimates_owner_idx on public.estimates (owner_id);
create index estimates_expires_idx on public.estimates (expires_at) where status in ('sent', 'viewed');

alter table public.jobs
  add constraint jobs_accepted_estimate_fk foreign key (accepted_estimate_id)
  references public.estimates (id) on delete set null;
create index jobs_accepted_estimate_idx on public.jobs (accepted_estimate_id);

create table public.estimate_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  version_no integer not null check (version_no >= 1),
  status text not null default 'draft' check (status in (
    'draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'superseded')),
  discount_type text check (discount_type in ('amount', 'percent')),
  discount_value numeric(12, 2) check (discount_value >= 0 and discount_value <= 100000000),
  discount_reason text check (length(discount_reason) <= 500),
  deposit_percent numeric(5, 2) check (deposit_percent between 0 and 100),
  customer_notes text check (length(customer_notes) <= 4000),
  internal_notes text check (length(internal_notes) <= 4000),
  -- Written by the pricing engine (trusted code).
  settings_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(settings_snapshot) = 'object'),
  priced jsonb not null default '{}'::jsonb check (jsonb_typeof(priced) = 'object'),
  priced_at timestamptz,
  max_effective_discount_percent numeric(6, 2) not null default 0,
  -- Frozen customer-facing snapshot (set when sent).
  proposal jsonb check (proposal is null or jsonb_typeof(proposal) = 'object'),
  discount_approved_percent numeric(6, 2),
  discount_approved_by uuid,
  discount_approved_at timestamptz,
  sent_at timestamptz,
  sent_by uuid,
  sent_channels text[] not null default '{}',
  viewed_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  expires_at timestamptz,
  accepted_at timestamptz,
  accepted_option_id uuid,
  accepted_addon_ids uuid[] not null default '{}',
  accepted_totals jsonb check (accepted_totals is null or jsonb_typeof(accepted_totals) = 'object'),
  declined_at timestamptz,
  decline_reason text check (length(decline_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (estimate_id, version_no),
  check ((discount_type is null) = (discount_value is null)),
  check (status = 'draft' or proposal is not null)
);
create index estimate_versions_estimate_idx on public.estimate_versions (estimate_id, version_no desc);
create index estimate_versions_org_status_idx on public.estimate_versions (org_id, status);

alter table public.estimates
  add constraint estimates_current_version_fk foreign key (current_version_id)
    references public.estimate_versions (id) on delete set null,
  add constraint estimates_accepted_version_fk foreign key (accepted_version_id)
    references public.estimate_versions (id) on delete set null;
create index estimates_current_version_idx on public.estimates (current_version_id);
create index estimates_accepted_version_idx on public.estimates (accepted_version_id);

create table public.estimate_options (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (length(description) <= 1000),
  is_recommended boolean not null default false,
  sort_order integer not null default 0,
  -- Engine caches (trusted code).
  subtotal_cents bigint,
  total_cents bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index estimate_options_version_idx on public.estimate_options (version_id, sort_order);

create table public.estimate_areas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  option_id uuid not null references public.estimate_options (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  work_type text,
  measurements jsonb not null default '{}'::jsonb check (jsonb_typeof(measurements) = 'object'),
  notes text check (length(notes) <= 1000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index estimate_areas_option_idx on public.estimate_areas (option_id, sort_order);
create index estimate_areas_version_idx on public.estimate_areas (version_id);

create table public.change_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  change_order_number text not null,
  estimate_id uuid references public.estimates (id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 160),
  reason text check (length(reason) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'declined')),
  created_from_field boolean not null default false,
  field_notes text check (length(field_notes) <= 2000),
  bill_separately boolean not null default true,
  -- Engine caches and the frozen customer snapshot (trusted code).
  settings_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(settings_snapshot) = 'object'),
  priced jsonb not null default '{}'::jsonb check (jsonb_typeof(priced) = 'object'),
  priced_at timestamptz,
  proposal jsonb check (proposal is null or jsonb_typeof(proposal) = 'object'),
  subtotal_cents bigint,
  tax_cents bigint,
  total_cents bigint,
  sent_at timestamptz,
  sent_by uuid,
  viewed_at timestamptz,
  expires_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text check (length(decline_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, change_order_number),
  check (status = 'draft' or proposal is not null)
);
create index change_orders_job_idx on public.change_orders (job_id, created_at desc);
create index change_orders_org_status_idx on public.change_orders (org_id, status) where deleted_at is null;
create index change_orders_estimate_idx on public.change_orders (estimate_id);

-- Line items for estimate versions and change orders (same engine, same columns).
create table public.estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  version_id uuid references public.estimate_versions (id) on delete cascade,
  change_order_id uuid references public.change_orders (id) on delete cascade,
  option_id uuid references public.estimate_options (id) on delete cascade,
  area_id uuid references public.estimate_areas (id) on delete cascade,
  catalog_item_id uuid references public.catalog_items (id) on delete set null,
  kind text not null check (kind in ('production_rate', 'flat')),
  is_optional boolean not null default false,
  name text not null check (length(btrim(name)) between 1 and 160),
  customer_note text check (length(customer_note) <= 500),
  catalog_code text check (app.is_key(catalog_code)),
  surface text check (app.is_key(surface)),
  unit text not null check (unit in ('sqft', 'lf', 'each', 'hour', 'room', 'door', 'drawer', 'gallon', 'lump', 'pair', 'step')),
  work_type text,
  work_order_phase text check (work_order_phase in ('prep', 'repair', 'paint', 'cabinet_shop', 'stain', 'touch_up', 'warranty')),
  quantity numeric(12, 2) not null default 0 check (quantity between 0 and 10000000),
  sides smallint not null default 1 check (sides in (1, 2)),
  condition text not null default 'good' check (condition in ('good', 'fair', 'poor')),
  prep_level text not null default 'standard' check (prep_level in ('light', 'standard', 'heavy')),
  coats smallint not null default 2 check (coats between 1 and 3),
  primer text not null default 'none' check (primer in ('none', 'spot', 'full')),
  color_change text not null default 'same' check (color_change in ('same', 'light_to_dark', 'dark_to_light')),
  method text not null default 'brush_roll' check (method in ('brush_roll', 'spray', 'mixed')),
  access text not null default 'ladder' check (access in ('ladder', 'tall_ladder', 'staging', 'lift')),
  height text not null default 'one_story' check (height in ('one_story', 'two_story', 'three_plus')),
  sheen text,
  paint_product_id uuid references public.paint_products (id) on delete set null,
  primer_product_id uuid references public.paint_products (id) on delete set null,
  lead_safe boolean not null default false,
  taxable boolean not null default true,
  is_repair_allowance boolean not null default false,
  is_credit boolean not null default false,
  -- Flat items copy their price/cost from the catalog when added (editable on drafts).
  unit_price_cents bigint check (unit_price_cents between 0 and 100000000),
  unit_cost_cents bigint check (unit_cost_cents between 0 and 100000000),
  labor_hours_per_unit numeric(12, 4) check (labor_hours_per_unit between 0 and 1000),
  paint_sqft_per_unit numeric(12, 4) check (paint_sqft_per_unit between 0 and 10000),
  override_price_cents bigint check (override_price_cents between 0 and 100000000),
  override_reason text check (length(override_reason) <= 500),
  measurement jsonb not null default '{}'::jsonb check (jsonb_typeof(measurement) = 'object'),
  sort_order integer not null default 0,
  -- Engine results (trusted code only).
  labor_hours numeric(12, 2),
  prep_hours numeric(12, 2),
  gallons numeric(12, 2),
  primer_gallons numeric(12, 2),
  gallons_needed numeric(12, 2),
  primer_gallons_needed numeric(12, 2),
  containers jsonb,
  labor_cost_cents bigint,
  material_cost_cents bigint,
  sundries_cents bigint,
  cost_cents bigint,
  computed_price_cents bigint,
  price_cents bigint,
  priced_snapshot jsonb,
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check ((version_id is null) <> (change_order_id is null)),
  check (change_order_id is null or (option_id is null and area_id is null and not is_optional)),
  check (version_id is null or ((option_id is null) = is_optional)),
  check (is_credit = false or change_order_id is not null),
  check (override_price_cents is null or length(btrim(coalesce(override_reason, ''))) >= 3),
  check (kind <> 'flat' or unit_price_cents is not null)
);
create index estimate_line_items_version_idx on public.estimate_line_items (version_id, sort_order);
create index estimate_line_items_option_idx on public.estimate_line_items (option_id);
create index estimate_line_items_area_idx on public.estimate_line_items (area_id);
create index estimate_line_items_co_idx on public.estimate_line_items (change_order_id, sort_order);
create index estimate_line_items_catalog_idx on public.estimate_line_items (catalog_item_id);
create index estimate_line_items_product_idx on public.estimate_line_items (paint_product_id);
create index estimate_line_items_primer_idx on public.estimate_line_items (primer_product_id);

-- Colors per area/surface (the crew's color sheet; SPEC §5.5, §7.5 #4).
create table public.color_selections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  estimate_version_id uuid references public.estimate_versions (id) on delete set null,
  line_item_id uuid references public.estimate_line_items (id) on delete set null,
  change_order_id uuid references public.change_orders (id) on delete set null,
  area text not null check (length(btrim(area)) between 1 and 120),
  surface text not null check (length(btrim(surface)) between 1 and 160),
  brand text,
  color_name text check (length(color_name) <= 120),
  color_code text check (length(color_code) <= 40),
  sheen text,
  paint_product_id uuid references public.paint_products (id) on delete set null,
  finish_notes text check (length(finish_notes) <= 1000),
  status text not null default 'needed' check (status in ('needed', 'selected', 'confirmed')),
  customer_confirmed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  check (status = 'needed' or color_name is not null)
);
create index color_selections_job_idx on public.color_selections (job_id, sort_order) where deleted_at is null;
create index color_selections_version_idx on public.color_selections (estimate_version_id);
create index color_selections_line_idx on public.color_selections (line_item_id);
create index color_selections_co_idx on public.color_selections (change_order_id);
create index color_selections_product_idx on public.color_selections (paint_product_id);

-- BearSign agreement templates (SPEC §8.19). Drafts until an owner publishes.
create table public.agreement_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  doc_type text not null check (doc_type in (
    'proposal', 'contract', 'change_order', 'lead_safe_ack', 'warranty', 'invoice', 'receipt')),
  name text not null check (length(btrim(name)) between 1 and 120),
  body text not null check (length(body) between 1 and 50000),
  -- [{"key", "title", "body", "required", "when"}]: optional and conditional clauses.
  clauses jsonb not null default '[]'::jsonb check (jsonb_typeof(clauses) = 'array'),
  signer_roles text[] not null default '{customer}' check (cardinality(signer_roles) between 0 and 6),
  required_fields text[] not null default '{}' check (cardinality(required_fields) <= 40),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_default boolean not null default false,
  version integer not null default 1 check (version >= 1),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  approval_note text check (length(approval_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  check (status <> 'published' or approved_at is not null)
);
create unique index agreement_templates_default_idx on public.agreement_templates (org_id, doc_type)
  where is_default and deleted_at is null;
create index agreement_templates_org_idx on public.agreement_templates (org_id, doc_type) where deleted_at is null;

-- Proposal links (/p/<token>): only a SHA-256 of the token is stored.
create table public.proposal_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  estimate_version_id uuid references public.estimate_versions (id) on delete cascade,
  change_order_id uuid references public.change_orders (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (length(revoked_reason) <= 200),
  used_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((estimate_version_id is null) <> (change_order_id is null))
);
create index proposal_tokens_version_idx on public.proposal_tokens (estimate_version_id);
create index proposal_tokens_co_idx on public.proposal_tokens (change_order_id);
create index proposal_tokens_job_idx on public.proposal_tokens (job_id);

-- Customer signatures (typed name + drawn image + when/where). Append-only.
create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  estimate_version_id uuid references public.estimate_versions (id) on delete cascade,
  change_order_id uuid references public.change_orders (id) on delete cascade,
  token_id uuid references public.proposal_tokens (id) on delete set null,
  signer_name text not null check (length(btrim(signer_name)) between 2 and 120),
  signer_email text check (app.is_email(signer_email)),
  signature_png text not null check (signature_png ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$'
                                     and length(signature_png) <= 400000),
  signature_sha256 text not null check (signature_sha256 ~ '^[0-9a-f]{64}$'),
  consent_text text not null check (length(consent_text) between 10 and 2000),
  selection jsonb not null default '{}'::jsonb check (jsonb_typeof(selection) = 'object'),
  signed_at timestamptz not null default now(),
  ip inet,
  user_agent text check (length(user_agent) <= 500),
  document_id uuid,
  created_at timestamptz not null default now(),
  check ((estimate_version_id is null) <> (change_order_id is null))
);
create unique index signatures_version_idx on public.signatures (estimate_version_id) where estimate_version_id is not null;
create unique index signatures_co_idx on public.signatures (change_order_id) where change_order_id is not null;
create index signatures_job_idx on public.signatures (job_id);
create index signatures_token_idx on public.signatures (token_id);

-- =============================================================================
-- 3. Records an accepted estimate produces (later phases add to these)
-- =============================================================================

-- Documents (SPEC §8.5 #7, §8.13). Files live in the private "documents" bucket.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid references public.jobs (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete cascade,
  category text not null check (category in (
    'proposal', 'contract', 'change_order', 'invoice', 'receipt', 'color_sheet', 'hoa', 'lead_safe',
    'warranty', 'other')),
  title text not null check (length(btrim(title)) between 1 and 200),
  file_name text not null check (length(file_name) between 1 and 200),
  storage_bucket text not null default 'documents' check (storage_bucket = 'documents'),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-z/._-]{1,240}$'),
  mime_type text not null check (length(mime_type) <= 100),
  size_bytes bigint not null check (size_bytes between 0 and 52428800),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  source text not null default 'upload' check (source in ('generated', 'upload')),
  status text not null default 'active' check (status in ('active', 'awaiting_signature', 'signed', 'superseded')),
  related_type text check (related_type in ('estimate_version', 'change_order', 'invoice', 'signature')),
  related_id uuid,
  signature_id uuid references public.signatures (id) on delete set null,
  customer_visible boolean not null default false,
  notes text check (length(notes) <= 1000),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  check (job_id is not null or account_id is not null)
);
create index documents_job_idx on public.documents (job_id, created_at desc) where deleted_at is null;
create index documents_account_idx on public.documents (account_id);
create index documents_org_category_idx on public.documents (org_id, category, created_at desc) where deleted_at is null;
create index documents_related_idx on public.documents (related_type, related_id);
create index documents_signature_idx on public.documents (signature_id);

alter table public.signatures
  add constraint signatures_document_fk foreign key (document_id) references public.documents (id) on delete set null;
create index signatures_document_idx on public.signatures (document_id);

-- Invoices (SPEC §5.6). Phase 4 creates the deposit invoice; Phase 7 adds payments.
-- Totals always equal the lines (kept by trigger); balances come from the ledger.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  invoice_number text not null,
  invoice_type text not null check (invoice_type in ('deposit', 'progress', 'final', 'change_order', 'credit_memo')),
  status text not null default 'draft' check (status in (
    'draft', 'sent', 'viewed', 'partially_paid', 'paid', 'void', 'overdue')),
  issue_date date,
  due_date date,
  terms text check (length(terms) <= 500),
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  notes text check (length(notes) <= 2000),
  estimate_id uuid references public.estimates (id) on delete set null,
  estimate_version_id uuid references public.estimate_versions (id) on delete set null,
  change_order_id uuid references public.change_orders (id) on delete set null,
  sent_at timestamptz,
  viewed_at timestamptz,
  voided_at timestamptz,
  void_reason text check (length(void_reason) <= 500),
  accounting_sync_status text not null default 'not_connected'
    check (accounting_sync_status in ('not_connected', 'pending', 'synced', 'error')),
  external_id text check (length(external_id) <= 200),
  external_synced_at timestamptz,
  accounting_error text check (length(accounting_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, invoice_number),
  check (status <> 'void' or voided_at is not null),
  check (due_date is null or issue_date is null or due_date >= issue_date),
  check (total_cents = subtotal_cents + tax_cents)
);
create index invoices_job_idx on public.invoices (job_id, created_at);
create index invoices_org_status_idx on public.invoices (org_id, status, due_date);
create index invoices_account_idx on public.invoices (account_id);
create index invoices_estimate_idx on public.invoices (estimate_id);
create index invoices_version_idx on public.invoices (estimate_version_id);
create index invoices_co_idx on public.invoices (change_order_id);
-- One live deposit invoice per job (accepting twice can't bill twice).
create unique index invoices_one_deposit_idx on public.invoices (job_id)
  where invoice_type = 'deposit' and status <> 'void';

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  description text not null check (length(btrim(description)) between 1 and 500),
  quantity numeric(12, 2) not null default 1 check (quantity between -10000000 and 10000000),
  unit_price_cents bigint not null check (unit_price_cents between -100000000000 and 100000000000),
  amount_cents bigint not null default 0,
  taxable boolean not null default false,
  tax_cents bigint not null default 0,
  sort_order integer not null default 0,
  source_type text check (source_type in ('estimate', 'change_order', 'credit', 'manual')),
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, sort_order);

-- Onboarding requirements (SPEC §6.4), seeded on accept. Phase 5 runs the
-- auto-verify rules (rule keys stored here) and adds the clearing actions.
create table public.onboarding_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  key text not null check (app.is_key(key) and key is not null),
  group_key text not null check (group_key in (
    'contract', 'money', 'customer', 'colors', 'compliance', 'materials', 'crew', 'customer_prep', 'weather')),
  label text not null check (length(btrim(label)) between 1 and 200),
  required boolean not null default true,
  owner_role text check (owner_role in ('estimator', 'office', 'point_of_contact', 'project_manager')),
  status text not null default 'pending' check (status in ('verified', 'pending', 'missing', 'needs_review', 'not_required')),
  auto_verify_rule text check (app.is_key(auto_verify_rule)),
  verified_at timestamptz,
  verified_by uuid,
  verified_auto boolean not null default false,
  note text check (length(note) <= 1000),
  last_checked_at timestamptz,
  source_estimate_version_id uuid references public.estimate_versions (id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (job_id, key),
  check (status <> 'verified' or verified_at is not null)
);
create index onboarding_requirements_org_status_idx on public.onboarding_requirements (org_id, status);
create index onboarding_requirements_version_idx on public.onboarding_requirements (source_estimate_version_id);

-- Paint orders (SPEC §8.6 "Paint Orders"): drafted from the accepted estimate.
create table public.paint_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  po_number text not null,
  supplier text check (length(supplier) <= 120),
  status text not null default 'draft' check (status in (
    'draft', 'waiting_to_order', 'ordered', 'partially_received', 'picked_up', 'delivered', 'canceled')),
  estimate_version_id uuid references public.estimate_versions (id) on delete set null,
  change_order_id uuid references public.change_orders (id) on delete set null,
  fulfillment text check (fulfillment in ('pickup', 'delivery')),
  ordered_at timestamptz,
  expected_on date,
  received_at timestamptz,
  external_ref text check (length(external_ref) <= 120),
  notes text check (length(notes) <= 2000),
  total_cost_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, po_number)
);
create index paint_orders_job_idx on public.paint_orders (job_id);
create index paint_orders_org_status_idx on public.paint_orders (org_id, status) where deleted_at is null;
create index paint_orders_version_idx on public.paint_orders (estimate_version_id);
create index paint_orders_co_idx on public.paint_orders (change_order_id);

create table public.paint_order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  paint_order_id uuid not null references public.paint_orders (id) on delete cascade,
  paint_product_id uuid references public.paint_products (id) on delete set null,
  label text not null check (length(btrim(label)) between 1 and 200),
  color_name text check (length(color_name) <= 120),
  color_code text check (length(color_code) <= 40),
  sheen text,
  is_primer boolean not null default false,
  is_sundries boolean not null default false,
  gallons_needed numeric(12, 2) not null default 0 check (gallons_needed >= 0),
  gallons numeric(12, 2) not null default 0 check (gallons >= 0),
  containers jsonb check (containers is null or jsonb_typeof(containers) = 'object'),
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  cost_cents bigint not null default 0 check (cost_cents >= 0),
  received_gallons numeric(12, 2) not null default 0 check (received_gallons >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index paint_order_lines_order_idx on public.paint_order_lines (paint_order_id, sort_order);
create index paint_order_lines_product_idx on public.paint_order_lines (paint_product_id);

-- Work orders (SPEC §5.4), drafted by phase with budgeted hours. crew_id gets
-- its foreign key when crews arrive (Phase 6).
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  work_order_number text not null,
  crew_id uuid,
  phase text not null check (phase in ('prep', 'repair', 'paint', 'cabinet_shop', 'stain', 'touch_up', 'warranty')),
  title text not null check (length(btrim(title)) between 1 and 160),
  scope_summary text check (length(scope_summary) <= 4000),
  status text not null default 'new' check (status in (
    'new', 'scheduled', 'in_progress', 'pending_approval', 'completed', 'canceled')),
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  scheduled_start date,
  scheduled_end date,
  budgeted_hours numeric(12, 2) not null default 0 check (budgeted_hours >= 0),
  actual_hours numeric(12, 2) check (actual_hours >= 0),
  assigned_user_ids uuid[] not null default '{}' check (cardinality(assigned_user_ids) <= 30),
  checklist_instance_id uuid,
  estimate_version_id uuid references public.estimate_versions (id) on delete set null,
  change_order_id uuid references public.change_orders (id) on delete set null,
  notes text check (length(notes) <= 2000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, work_order_number),
  check (scheduled_end is null or scheduled_start is null or scheduled_end >= scheduled_start)
);
create index work_orders_job_idx on public.work_orders (job_id, phase) where deleted_at is null;
create index work_orders_org_status_idx on public.work_orders (org_id, status) where deleted_at is null;
create index work_orders_crew_idx on public.work_orders (crew_id);
create index work_orders_assigned_idx on public.work_orders using gin (assigned_user_ids);
create index work_orders_version_idx on public.work_orders (estimate_version_id);
create index work_orders_co_idx on public.work_orders (change_order_id);

-- Subcontractor PO amounts are money: separate, financials:read only (SPEC §4.2 masking).
create table public.work_order_costs (
  work_order_id uuid primary key references public.work_orders (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete restrict,
  sub_po_cents bigint check (sub_po_cents between 0 and 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index work_order_costs_org_idx on public.work_order_costs (org_id);

-- Contract money: the accepted estimate and signed change orders (written by
-- trusted code). contract_cents falls back to the Phase 3 baseline only when no
-- estimate has been accepted. Approved credits come off in the ledger (Phase 7).
alter table public.job_financials
  add column estimate_contract_cents bigint check (estimate_contract_cents between 0 and 100000000000),
  add column change_orders_cents bigint not null default 0
    check (change_orders_cents between -100000000000 and 100000000000),
  add column contract_cents bigint generated always as (
    case when estimate_contract_cents is null then contract_baseline_cents
         else estimate_contract_cents + change_orders_cents end) stored;

-- Discount approvals join the Approvals queue.
alter table public.approval_requests drop constraint approval_requests_type_check;
alter table public.approval_requests add constraint approval_requests_type_check
  check (type in ('stage_override', 'estimate_discount'));

-- =============================================================================
-- 4. Lookup helpers (definer: used by guards and row security)
-- =============================================================================

create or replace function app.estimate_job_id(p_estimate uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.job_id from public.estimates e where e.id = p_estimate;
$$;

create or replace function app.version_job_id(p_version uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.job_id from public.estimate_versions v join public.estimates e on e.id = v.estimate_id
  where v.id = p_version;
$$;

create or replace function app.change_order_job_id(p_co uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.job_id from public.change_orders c where c.id = p_co;
$$;

-- Can the current person edit the estimate content of this job?
create or replace function app.can_edit_estimates(p_job uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.can_write('estimates:create') and app.can_edit_subject('job', p_job);
$$;

-- Document categories that show money (crew roles never see them).
create or replace function app.is_money_document(p_category text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_category in ('proposal', 'contract', 'change_order', 'invoice', 'receipt');
$$;

-- Columns the pricing engine owns on line items (people never write them).
create or replace function app.line_engine_columns()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['labor_hours', 'prep_hours', 'gallons', 'primer_gallons', 'gallons_needed',
               'primer_gallons_needed', 'containers', 'labor_cost_cents', 'material_cost_cents',
               'sundries_cents', 'cost_cents', 'computed_price_cents', 'price_cents', 'priced_snapshot',
               'issues'];
$$;

-- =============================================================================
-- 5. Guards and bookkeeping
-- =============================================================================

-- Catalog rows: same-org links, picklist values; editing a seeded SAMPLE row
-- (any value, not just turning it on/off) clears its Sample flag.
create or replace function app.catalog_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := app.is_trusted();
  v_skip text[] := array['updated_at', 'updated_by', 'created_at', 'created_by', 'is_sample', 'active',
                         'sort_order', 'deleted_at', 'deleted_by', 'delete_reason'];
  v_new jsonb;
  v_old jsonb;
  v_s text;
  v_key text;
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'Catalog rows cannot move to another organization.' using errcode = '42501';
  end if;
  if tg_table_name = 'catalog_items' then
    if tg_op = 'INSERT' or new.price_book_id is distinct from old.price_book_id then
      perform app.check_same_org(new.org_id, 'price_books', new.price_book_id, 'Price book');
    end if;
    if tg_op = 'INSERT' or new.default_product_id is distinct from old.default_product_id then
      perform app.check_same_org(new.org_id, 'paint_products', new.default_product_id, 'Paint product');
    end if;
    if tg_op = 'INSERT' or new.work_type is distinct from old.work_type then
      perform app.check_picklist(new.org_id, 'work_type', new.work_type, 'Work type');
    end if;
  elsif tg_table_name = 'paint_products' then
    if tg_op = 'INSERT' or new.brand is distinct from old.brand then
      perform app.check_picklist(new.org_id, 'paint_brand', new.brand, 'Brand');
    end if;
    if tg_op = 'INSERT' or new.sheens is distinct from old.sheens then
      foreach v_s in array new.sheens loop
        perform app.check_picklist(new.org_id, 'sheen', v_s, 'Sheen');
      end loop;
    end if;
  end if;

  if not v_trusted then
    if tg_op = 'INSERT' then
      new.is_sample := false;
    else
      v_new := to_jsonb(new);
      v_old := to_jsonb(old);
      foreach v_key in array v_skip loop
        v_new := v_new - v_key;
        v_old := v_old - v_key;
      end loop;
      if v_new is distinct from v_old then
        new.is_sample := false;
      elsif new.is_sample and not old.is_sample then
        new.is_sample := false;   -- people can't mark their own numbers as sample
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function app.price_books_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'A price book cannot move to another organization.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Estimate Setup: saving the pricing knobs means an owner calibrated them.
create or replace function app.estimate_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'Settings cannot move to another organization.' using errcode = '42501';
  end if;
  if not app.is_trusted() then
    if tg_op = 'INSERT' then
      new.is_sample := false;
    elsif new.pricing is distinct from old.pricing or new.discount_limits is distinct from old.discount_limits then
      new.is_sample := false;
      new.calibrated_by := app.actor_id();
      new.calibrated_at := now();
    else
      new.is_sample := old.is_sample;
      new.calibrated_by := old.calibrated_by;
      new.calibrated_at := old.calibrated_at;
    end if;
  end if;
  return new;
end;
$$;

-- Estimates: numbered; lifecycle fields belong to the send/accept functions.
create or replace function app.estimates_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := app.is_trusted() or app.system_update_on();
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    new.estimate_number := app.next_number(new.org_id, 'estimate', now());
    if not v_trusted then
      new.status := 'draft';
      new.current_version_id := null;
      new.accepted_version_id := null;
      new.accepted_option_id := null;
      new.sent_at := null;
      new.viewed_at := null;
      new.accepted_at := null;
      new.declined_at := null;
      new.decline_reason := null;
      new.expires_at := null;
      new.total_cents := null;
      new.owner_id := coalesce(new.owner_id, app.effective_user_id());
    end if;
  else
    if new.org_id <> old.org_id or new.job_id <> old.job_id then
      raise exception 'An estimate cannot move to another job.' using errcode = '42501';
    end if;
    new.estimate_number := old.estimate_number;
    if not v_trusted then
      new.status := old.status;
      new.current_version_id := old.current_version_id;
      new.accepted_version_id := old.accepted_version_id;
      new.accepted_option_id := old.accepted_option_id;
      new.sent_at := old.sent_at;
      new.viewed_at := old.viewed_at;
      new.accepted_at := old.accepted_at;
      new.declined_at := old.declined_at;
      new.decline_reason := old.decline_reason;
      new.expires_at := old.expires_at;
      new.total_cents := old.total_cents;
    end if;
  end if;
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    perform app.check_same_org(new.org_id, 'profiles', new.owner_id, 'Estimator');
  end if;
  return new;
end;
$$;

-- Versions: drafts are edited; sent versions are frozen (start a new version).
create or replace function app.estimate_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := app.is_trusted() or app.system_update_on();
  v_estimate public.estimates%rowtype;
begin
  if tg_op = 'DELETE' then
    if not v_trusted then
      if old.status <> 'draft' then
        raise exception 'Only a draft version can be discarded.' using errcode = '23514';
      end if;
      if exists (select 1 from public.estimates e where e.id = old.estimate_id)
         and not exists (select 1 from public.estimate_versions v where v.estimate_id = old.estimate_id and v.id <> old.id) then
        raise exception 'An estimate needs at least one version.' using errcode = '23514';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select * into v_estimate from public.estimates where id = new.estimate_id;
    if v_estimate.id is null or v_estimate.org_id <> new.org_id then
      raise exception 'The estimate does not belong to this organization.' using errcode = '42501';
    end if;
    if not v_trusted then
      if v_estimate.status = 'accepted' then
        raise exception 'This estimate is accepted. Use a change order to change the scope.' using errcode = '23514';
      end if;
      new.version_no := coalesce((select max(v.version_no) from public.estimate_versions v
                                  where v.estimate_id = new.estimate_id), 0) + 1;
      new.status := 'draft';
      new.settings_snapshot := '{}'::jsonb;
      new.priced := '{}'::jsonb;
      new.priced_at := null;
      new.max_effective_discount_percent := 0;
      new.proposal := null;
      new.discount_approved_percent := null;
      new.discount_approved_by := null;
      new.discount_approved_at := null;
      new.sent_at := null;
      new.sent_by := null;
      new.sent_channels := '{}';
      new.viewed_at := null;
      new.view_count := 0;
      new.expires_at := null;
      new.accepted_at := null;
      new.accepted_option_id := null;
      new.accepted_addon_ids := '{}';
      new.accepted_totals := null;
      new.declined_at := null;
      new.decline_reason := null;
    end if;
    return new;
  end if;

  if new.org_id <> old.org_id or new.estimate_id <> old.estimate_id or new.version_no <> old.version_no then
    raise exception 'A version cannot move to another estimate.' using errcode = '42501';
  end if;
  if not v_trusted then
    if old.status <> 'draft' then
      raise exception 'This version was sent and can''t be edited. Start a new version instead.' using errcode = '23514';
    end if;
    new.status := old.status;
    new.settings_snapshot := old.settings_snapshot;
    new.priced := old.priced;
    new.priced_at := old.priced_at;
    new.max_effective_discount_percent := old.max_effective_discount_percent;
    new.proposal := old.proposal;
    new.discount_approved_percent := old.discount_approved_percent;
    new.discount_approved_by := old.discount_approved_by;
    new.discount_approved_at := old.discount_approved_at;
    new.sent_at := old.sent_at;
    new.sent_by := old.sent_by;
    new.sent_channels := old.sent_channels;
    new.viewed_at := old.viewed_at;
    new.view_count := old.view_count;
    new.expires_at := old.expires_at;
    new.accepted_at := old.accepted_at;
    new.accepted_option_id := old.accepted_option_id;
    new.accepted_addon_ids := old.accepted_addon_ids;
    new.accepted_totals := old.accepted_totals;
    new.declined_at := old.declined_at;
    new.decline_reason := old.decline_reason;
  end if;
  return new;
end;
$$;

-- The newest version becomes the estimate's current one.
create or replace function app.estimate_versions_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estimate uuid := coalesce(new.estimate_id, old.estimate_id);
begin
  perform set_config('app.system_update', 'on', true);
  update public.estimates e
     set current_version_id = (select v.id from public.estimate_versions v
                               where v.estimate_id = v_estimate order by v.version_no desc limit 1)
   where e.id = v_estimate
     and e.status <> 'accepted'
     and e.current_version_id is distinct from (select v.id from public.estimate_versions v
                                                where v.estimate_id = v_estimate order by v.version_no desc limit 1);
  perform set_config('app.system_update', 'off', true);
  return null;
end;
$$;

-- Options, areas and lines: only on drafts; links stay inside one version; the
-- engine's columns are written by trusted code only.
create or replace function app.estimate_content_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := app.is_trusted() or app.system_update_on();
  v_row record;
  v_version uuid;
  v_co uuid;
  v_status text;
  v_org uuid;
  v_col text;
  v_new jsonb;
  v_old jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  v_version := v_row.version_id;
  if tg_table_name = 'estimate_line_items' then
    v_co := v_row.change_order_id;
  end if;

  if v_version is not null then
    select v.status, v.org_id into v_status, v_org from public.estimate_versions v where v.id = v_version;
  else
    select c.status, c.org_id into v_status, v_org from public.change_orders c where c.id = v_co;
  end if;
  -- A cascade from deleting the version or change order itself.
  if tg_op = 'DELETE' and v_org is null then
    return old;
  end if;
  if v_org is null or v_org <> v_row.org_id then
    raise exception 'The estimate does not belong to this organization.' using errcode = '42501';
  end if;
  if not v_trusted and v_status <> 'draft' then
    raise exception 'This was sent and can''t be edited. Start a new version instead.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'Estimate content cannot move to another organization.' using errcode = '42501';
  end if;

  if tg_table_name = 'estimate_areas' then
    if not exists (select 1 from public.estimate_options o where o.id = new.option_id and o.version_id = new.version_id) then
      raise exception 'The area must belong to an option of the same version.' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' or new.work_type is distinct from old.work_type then
      perform app.check_picklist(new.org_id, 'work_type', new.work_type, 'Work type');
    end if;
  elsif tg_table_name = 'estimate_line_items' then
    if tg_op = 'UPDATE' and (new.version_id is distinct from old.version_id
                             or new.change_order_id is distinct from old.change_order_id) then
      raise exception 'A line cannot move to another estimate.' using errcode = '42501';
    end if;
    if new.option_id is not null and not exists (
         select 1 from public.estimate_options o where o.id = new.option_id and o.version_id = new.version_id) then
      raise exception 'The line must belong to an option of the same version.' using errcode = '23514';
    end if;
    if new.area_id is not null and not exists (
         select 1 from public.estimate_areas a where a.id = new.area_id and a.option_id = new.option_id) then
      raise exception 'The line''s area must belong to the same option.' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' or new.catalog_item_id is distinct from old.catalog_item_id then
      perform app.check_same_org(new.org_id, 'catalog_items', new.catalog_item_id, 'Catalog item');
    end if;
    if tg_op = 'INSERT' or new.paint_product_id is distinct from old.paint_product_id then
      perform app.check_same_org(new.org_id, 'paint_products', new.paint_product_id, 'Paint product');
    end if;
    if tg_op = 'INSERT' or new.primer_product_id is distinct from old.primer_product_id then
      perform app.check_same_org(new.org_id, 'paint_products', new.primer_product_id, 'Primer product');
    end if;
    if tg_op = 'INSERT' or new.sheen is distinct from old.sheen then
      perform app.check_picklist(new.org_id, 'sheen', new.sheen, 'Sheen');
    end if;
    if tg_op = 'INSERT' or new.work_type is distinct from old.work_type then
      perform app.check_picklist(new.org_id, 'work_type', new.work_type, 'Work type');
    end if;
    if not v_trusted then
      if tg_op = 'INSERT' then
        v_new := to_jsonb(new);
        foreach v_col in array app.line_engine_columns() loop
          v_new := jsonb_set(v_new, array[v_col], case when v_col = 'issues' then '[]'::jsonb else 'null'::jsonb end);
        end loop;
        new := jsonb_populate_record(new, v_new);
      else
        v_new := to_jsonb(new);
        v_old := to_jsonb(old);
        foreach v_col in array app.line_engine_columns() loop
          v_new := jsonb_set(v_new, array[v_col], coalesce(v_old -> v_col, 'null'::jsonb));
        end loop;
        new := jsonb_populate_record(new, v_new);
      end if;
    end if;
  elsif tg_table_name = 'estimate_options' then
    if not v_trusted then
      if tg_op = 'INSERT' then
        new.subtotal_cents := null;
        new.total_cents := null;
      else
        new.subtotal_cents := old.subtotal_cents;
        new.total_cents := old.total_cents;
      end if;
    end if;
    if tg_op = 'UPDATE' and new.version_id <> old.version_id then
      raise exception 'An option cannot move to another version.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Change orders: numbered; edited while draft; lifecycle owned by send/sign functions.
create or replace function app.change_orders_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := app.is_trusted() or app.system_update_on();
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    perform app.check_same_org(new.org_id, 'estimates', new.estimate_id, 'Estimate');
    new.change_order_number := app.next_number(new.org_id, 'change_order', now());
    if not v_trusted then
      new.status := 'draft';
      new.settings_snapshot := '{}'::jsonb;
      new.priced := '{}'::jsonb;
      new.priced_at := null;
      new.proposal := null;
      new.subtotal_cents := null;
      new.tax_cents := null;
      new.total_cents := null;
      new.sent_at := null;
      new.sent_by := null;
      new.viewed_at := null;
      new.expires_at := null;
      new.signed_at := null;
      new.declined_at := null;
      new.decline_reason := null;
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.job_id <> old.job_id then
    raise exception 'A change order cannot move to another job.' using errcode = '42501';
  end if;
  new.change_order_number := old.change_order_number;
  if not v_trusted then
    if old.status <> 'draft' then
      raise exception 'This change order was sent and can''t be edited.' using errcode = '23514';
    end if;
    new.status := old.status;
    new.settings_snapshot := old.settings_snapshot;
    new.priced := old.priced;
    new.priced_at := old.priced_at;
    new.proposal := old.proposal;
    new.subtotal_cents := old.subtotal_cents;
    new.tax_cents := old.tax_cents;
    new.total_cents := old.total_cents;
    new.sent_at := old.sent_at;
    new.sent_by := old.sent_by;
    new.viewed_at := old.viewed_at;
    new.expires_at := old.expires_at;
    new.signed_at := old.signed_at;
    new.declined_at := old.declined_at;
    new.decline_reason := old.decline_reason;
    new.created_from_field := old.created_from_field;
  end if;
  if new.estimate_id is distinct from old.estimate_id then
    perform app.check_same_org(new.org_id, 'estimates', new.estimate_id, 'Estimate');
  end if;
  return new;
end;
$$;

create or replace function app.color_selections_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.job_id <> old.job_id) then
    raise exception 'A color selection cannot move to another job.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
  end if;
  if tg_op = 'INSERT' or new.brand is distinct from old.brand then
    perform app.check_picklist(new.org_id, 'paint_brand', new.brand, 'Brand');
  end if;
  if tg_op = 'INSERT' or new.sheen is distinct from old.sheen then
    perform app.check_picklist(new.org_id, 'sheen', new.sheen, 'Sheen');
  end if;
  if tg_op = 'INSERT' or new.paint_product_id is distinct from old.paint_product_id then
    perform app.check_same_org(new.org_id, 'paint_products', new.paint_product_id, 'Paint product');
  end if;
  new.color_name := nullif(btrim(coalesce(new.color_name, '')), '');
  if new.color_name is null then
    new.status := 'needed';
    new.customer_confirmed_at := null;
  elsif new.status = 'needed' then
    new.status := 'selected';
  end if;
  if new.status = 'confirmed' then
    new.customer_confirmed_at := coalesce(new.customer_confirmed_at, now());
  else
    new.customer_confirmed_at := null;
  end if;
  return new;
end;
$$;

-- Agreement templates: drafts until an owner publishes; editing a published
-- template's wording sends it back to draft as a new version.
create or replace function app.agreement_templates_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_trusted() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.approved_by := null;
    new.approved_at := null;
    new.version := 1;
    return new;
  end if;
  if new.org_id <> old.org_id or new.doc_type <> old.doc_type then
    raise exception 'A template cannot change its document type.' using errcode = '42501';
  end if;
  new.version := old.version;
  if old.status = 'published' and (new.body <> old.body or new.clauses <> old.clauses) then
    new.status := 'draft';
    new.version := old.version + 1;
    new.approved_by := null;
    new.approved_at := null;
  elsif new.status = 'published' and old.status <> 'published' then
    if not app.can_write('settings:manage') then
      raise exception 'Only an owner can publish an agreement template.' using errcode = '42501';
    end if;
    new.approved_by := app.effective_user_id();
    new.approved_at := now();
  elsif new.status <> 'published' then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  return new;
end;
$$;

-- Signatures never change, except trusted code linking the signed PDF.
create or replace function app.signatures_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if app.is_trusted() then
      return old;
    end if;
    raise exception 'Signatures cannot be deleted.' using errcode = '42501';
  end if;
  if not app.is_trusted() or (to_jsonb(new) - 'document_id') <> (to_jsonb(old) - 'document_id') then
    raise exception 'Signatures cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app.documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    perform app.check_same_org(new.org_id, 'accounts', new.account_id, 'Account');
    if new.account_id is null and new.job_id is not null then
      select j.account_id into new.account_id from public.jobs j where j.id = new.job_id;
    end if;
    if not app.is_trusted() then
      new.source := 'upload';
      new.uploaded_by := app.effective_user_id();
      new.signature_id := null;
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.storage_path <> old.storage_path or new.job_id is distinct from old.job_id then
    raise exception 'A document''s file and job cannot change.' using errcode = '42501';
  end if;
  if not app.is_trusted() then
    new.source := old.source;
    new.signature_id := old.signature_id;
    new.sha256 := old.sha256;
    new.size_bytes := old.size_bytes;
    new.mime_type := old.mime_type;
  end if;
  return new;
end;
$$;

-- Invoices: numbered; totals always come from the lines.
create or replace function app.invoices_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := app.is_trusted() or app.system_update_on();
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    new.invoice_number := app.next_number(new.org_id, 'invoice', now());
    if new.account_id is null then
      select j.account_id into new.account_id from public.jobs j where j.id = new.job_id;
    end if;
    new.subtotal_cents := 0;
    new.tax_cents := 0;
    new.total_cents := 0;
    return new;
  end if;
  if new.org_id <> old.org_id or new.job_id <> old.job_id then
    raise exception 'An invoice cannot move to another job.' using errcode = '42501';
  end if;
  new.invoice_number := old.invoice_number;
  if not app.system_update_on() then
    new.subtotal_cents := old.subtotal_cents;
    new.tax_cents := old.tax_cents;
    new.total_cents := old.total_cents;
  end if;
  if new.status = 'void' and old.status <> 'void' then
    new.voided_at := coalesce(new.voided_at, now());
  end if;
  if not v_trusted and old.status = 'void' then
    raise exception 'A void invoice cannot be changed.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.invoice_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
begin
  select i.org_id, i.status into v_org, v_status
  from public.invoices i where i.id = coalesce(new.invoice_id, old.invoice_id);
  if tg_op = 'DELETE' and v_org is null then
    return old;   -- cascade from deleting the invoice
  end if;
  if v_org is null or v_org <> coalesce(new.org_id, old.org_id) then
    raise exception 'The invoice does not belong to this organization.' using errcode = '42501';
  end if;
  if not app.is_trusted() and v_status <> 'draft' then
    raise exception 'Only a draft invoice''s lines can change.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    raise exception 'A line cannot move to another invoice.' using errcode = '42501';
  end if;
  new.amount_cents := round(new.quantity * new.unit_price_cents)::bigint;
  return new;
end;
$$;

create or replace function app.invoice_lines_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  perform set_config('app.system_update', 'on', true);
  update public.invoices i set
    subtotal_cents = coalesce((select sum(l.amount_cents) from public.invoice_lines l where l.invoice_id = v_invoice), 0),
    tax_cents = coalesce((select sum(l.tax_cents) from public.invoice_lines l where l.invoice_id = v_invoice), 0),
    total_cents = coalesce((select sum(l.amount_cents + l.tax_cents) from public.invoice_lines l where l.invoice_id = v_invoice), 0)
  where i.id = v_invoice;
  perform set_config('app.system_update', 'off', true);
  return null;
end;
$$;

create or replace function app.onboarding_requirements_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
  elsif new.org_id <> old.org_id or new.job_id <> old.job_id or new.key <> old.key then
    raise exception 'An onboarding item cannot move to another job.' using errcode = '42501';
  end if;
  if new.status = 'verified' then
    if tg_op = 'INSERT' or old.status <> 'verified' then
      new.verified_at := coalesce(new.verified_at, now());
      new.verified_by := coalesce(new.verified_by, app.actor_id());
    end if;
  else
    new.verified_at := null;
    new.verified_by := null;
    new.verified_auto := false;
  end if;
  return new;
end;
$$;

create or replace function app.paint_orders_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    new.po_number := app.next_number(new.org_id, 'paint_order', now());
    if not app.system_update_on() then
      new.total_cost_cents := 0;
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.job_id <> old.job_id then
    raise exception 'A paint order cannot move to another job.' using errcode = '42501';
  end if;
  new.po_number := old.po_number;
  if not app.system_update_on() then
    new.total_cost_cents := old.total_cost_cents;
  end if;
  if new.status = 'ordered' and old.status <> 'ordered' then
    new.ordered_at := coalesce(new.ordered_at, now());
  end if;
  return new;
end;
$$;

create or replace function app.paint_order_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select o.org_id into v_org from public.paint_orders o where o.id = coalesce(new.paint_order_id, old.paint_order_id);
  if tg_op = 'DELETE' and v_org is null then
    return old;   -- cascade from deleting the paint order
  end if;
  if v_org is null or v_org <> coalesce(new.org_id, old.org_id) then
    raise exception 'The paint order does not belong to this organization.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.paint_order_id <> old.paint_order_id then
    raise exception 'A line cannot move to another paint order.' using errcode = '42501';
  end if;
  perform app.check_same_org(new.org_id, 'paint_products', new.paint_product_id, 'Paint product');
  return new;
end;
$$;

create or replace function app.paint_order_lines_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid := coalesce(new.paint_order_id, old.paint_order_id);
begin
  perform set_config('app.system_update', 'on', true);
  update public.paint_orders o
     set total_cost_cents = coalesce((select sum(l.cost_cents) from public.paint_order_lines l where l.paint_order_id = v_order), 0)
   where o.id = v_order;
  perform set_config('app.system_update', 'off', true);
  return null;
end;
$$;

create or replace function app.work_orders_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    new.work_order_number := app.next_number(new.org_id, 'work_order', now());
  else
    if new.org_id <> old.org_id or new.job_id <> old.job_id then
      raise exception 'A work order cannot move to another job.' using errcode = '42501';
    end if;
    new.work_order_number := old.work_order_number;
  end if;
  if (tg_op = 'INSERT' or new.assigned_user_ids is distinct from old.assigned_user_ids)
     and exists (select 1 from unnest(new.assigned_user_ids) u
                 where not exists (select 1 from public.profiles p where p.id = u and p.org_id = new.org_id)) then
    raise exception 'Everyone assigned must be on the team.' using errcode = '42501';
  end if;
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create or replace function app.work_order_costs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select w.org_id into v_org from public.work_orders w where w.id = new.work_order_id;
  if v_org is null or v_org <> new.org_id then
    raise exception 'The work order does not belong to this organization.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.work_order_id <> old.work_order_id then
    raise exception 'Costs cannot move to another work order.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- The accepted estimate and signed change orders are written by trusted code only.
create or replace function app.job_financials_contract_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_trusted() or app.system_update_on() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.estimate_contract_cents := null;
    new.change_orders_cents := 0;
  else
    new.estimate_contract_cents := old.estimate_contract_cents;
    new.change_orders_cents := old.change_orders_cents;
  end if;
  return new;
end;
$$;

-- Discount approvals are decided by people who can approve discounts.
create or replace function app.approval_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decider text := case when coalesce(new.type, old.type) = 'estimate_discount'
                         then 'estimates:approve_discount' else 'job_admin:override' end;
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    if not app.is_trusted() then
      new.requested_by := app.effective_user_id();
      new.requested_at := now();
      new.status := 'pending';
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := null;
    end if;
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'This request was already decided.' using errcode = '23514';
  end if;
  if new.org_id <> old.org_id or new.job_id <> old.job_id or new.type <> old.type
     or new.requested_by <> old.requested_by or new.reason <> old.reason or new.payload <> old.payload then
    raise exception 'Only the decision on a request can change.' using errcode = '23514';
  end if;
  if new.status in ('approved', 'rejected') then
    if not app.is_trusted() and not app.can_write(v_decider) then
      raise exception 'Only owners can approve or reject requests.' using errcode = '42501';
    end if;
  elsif new.status = 'canceled' then
    if not app.is_trusted() and old.requested_by <> app.effective_user_id() then
      raise exception 'Only the person who asked can cancel a request.' using errcode = '42501';
    end if;
  end if;
  if new.status <> 'pending' then
    new.decided_at := now();
    new.decided_by := coalesce(app.actor_id(), new.decided_by);
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 6. Triggers
-- =============================================================================

create trigger price_books_guard before insert or update on public.price_books
  for each row execute function app.price_books_guard();
create trigger paint_products_guard before insert or update on public.paint_products
  for each row execute function app.catalog_guard();
create trigger production_rates_guard before insert or update on public.production_rates
  for each row execute function app.catalog_guard();
create trigger catalog_items_guard before insert or update on public.catalog_items
  for each row execute function app.catalog_guard();
create trigger estimate_settings_guard before insert or update on public.estimate_settings
  for each row execute function app.estimate_settings_guard();
create trigger estimates_guard before insert or update on public.estimates
  for each row execute function app.estimates_guard();
create trigger estimate_versions_guard before insert or update or delete on public.estimate_versions
  for each row execute function app.estimate_versions_guard();
create trigger estimate_versions_after after insert or delete on public.estimate_versions
  for each row execute function app.estimate_versions_after();
create trigger estimate_options_guard before insert or update or delete on public.estimate_options
  for each row execute function app.estimate_content_guard();
create trigger estimate_areas_guard before insert or update or delete on public.estimate_areas
  for each row execute function app.estimate_content_guard();
create trigger estimate_line_items_guard before insert or update or delete on public.estimate_line_items
  for each row execute function app.estimate_content_guard();
create trigger change_orders_guard before insert or update on public.change_orders
  for each row execute function app.change_orders_guard();
create trigger color_selections_guard before insert or update on public.color_selections
  for each row execute function app.color_selections_guard();
create trigger agreement_templates_guard before insert or update on public.agreement_templates
  for each row execute function app.agreement_templates_guard();
create trigger signatures_guard before update or delete on public.signatures
  for each row execute function app.signatures_guard();
create trigger proposal_tokens_immutable before delete on public.proposal_tokens
  for each row execute function app.deny_write_allow_trusted_delete();
create trigger documents_guard before insert or update on public.documents
  for each row execute function app.documents_guard();
create trigger invoices_guard before insert or update on public.invoices
  for each row execute function app.invoices_guard();
create trigger invoice_lines_guard before insert or update or delete on public.invoice_lines
  for each row execute function app.invoice_lines_guard();
create trigger invoice_lines_after after insert or update or delete on public.invoice_lines
  for each row execute function app.invoice_lines_after();
create trigger onboarding_requirements_guard before insert or update on public.onboarding_requirements
  for each row execute function app.onboarding_requirements_guard();
create trigger paint_orders_guard before insert or update on public.paint_orders
  for each row execute function app.paint_orders_guard();
create trigger paint_order_lines_guard before insert or update or delete on public.paint_order_lines
  for each row execute function app.paint_order_lines_guard();
create trigger paint_order_lines_after after insert or update or delete on public.paint_order_lines
  for each row execute function app.paint_order_lines_after();
create trigger work_orders_guard before insert or update on public.work_orders
  for each row execute function app.work_orders_guard();
create trigger work_order_costs_guard before insert or update on public.work_order_costs
  for each row execute function app.work_order_costs_guard();
create trigger job_financials_contract_guard before insert or update on public.job_financials
  for each row execute function app.job_financials_contract_guard();

do $$
declare
  t text;
begin
  foreach t in array array[
    'price_books', 'paint_products', 'production_rates', 'catalog_items', 'estimate_settings', 'estimates',
    'estimate_versions', 'estimate_options', 'estimate_areas', 'estimate_line_items', 'change_orders',
    'color_selections', 'agreement_templates', 'documents', 'invoices', 'invoice_lines',
    'onboarding_requirements', 'paint_orders', 'paint_order_lines', 'work_orders', 'work_order_costs'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function app.stamp_actor()', t, t);
  end loop;
end
$$;

-- Audit (derived engine output, caches and the signature image stay out).
create trigger price_books_audit after insert or update or delete on public.price_books
  for each row execute function app.audit_row();
create trigger paint_products_audit after insert or update or delete on public.paint_products
  for each row execute function app.audit_row();
create trigger production_rates_audit after insert or update or delete on public.production_rates
  for each row execute function app.audit_row();
create trigger catalog_items_audit after insert or update or delete on public.catalog_items
  for each row execute function app.audit_row();
create trigger estimate_settings_audit after insert or update or delete on public.estimate_settings
  for each row execute function app.audit_row();
create trigger estimates_audit after insert or update or delete on public.estimates
  for each row execute function app.audit_row();
create trigger estimate_versions_audit after insert or update or delete on public.estimate_versions
  for each row execute function app.audit_row('settings_snapshot', 'priced', 'priced_at', 'proposal');
create trigger estimate_options_audit after insert or update or delete on public.estimate_options
  for each row execute function app.audit_row('subtotal_cents', 'total_cents');
create trigger estimate_areas_audit after insert or update or delete on public.estimate_areas
  for each row execute function app.audit_row();
create trigger estimate_line_items_audit after insert or update or delete on public.estimate_line_items
  for each row execute function app.audit_row('labor_hours', 'prep_hours', 'gallons', 'primer_gallons',
    'gallons_needed', 'primer_gallons_needed', 'containers', 'labor_cost_cents', 'material_cost_cents',
    'sundries_cents', 'cost_cents', 'computed_price_cents', 'price_cents', 'priced_snapshot', 'issues');
create trigger change_orders_audit after insert or update or delete on public.change_orders
  for each row execute function app.audit_row('settings_snapshot', 'priced', 'priced_at', 'proposal');
create trigger color_selections_audit after insert or update or delete on public.color_selections
  for each row execute function app.audit_row();
create trigger agreement_templates_audit after insert or update or delete on public.agreement_templates
  for each row execute function app.audit_row();
create trigger proposal_tokens_audit after insert or update or delete on public.proposal_tokens
  for each row execute function app.audit_row('view_count', 'last_viewed_at');
create trigger signatures_audit after insert or update or delete on public.signatures
  for each row execute function app.audit_row('signature_png');
create trigger documents_audit after insert or update or delete on public.documents
  for each row execute function app.audit_row();
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function app.audit_row();
create trigger invoice_lines_audit after insert or update or delete on public.invoice_lines
  for each row execute function app.audit_row();
create trigger onboarding_requirements_audit after insert or update or delete on public.onboarding_requirements
  for each row execute function app.audit_row('last_checked_at');
create trigger paint_orders_audit after insert or update or delete on public.paint_orders
  for each row execute function app.audit_row();
create trigger paint_order_lines_audit after insert or update or delete on public.paint_order_lines
  for each row execute function app.audit_row();
create trigger work_orders_audit after insert or update or delete on public.work_orders
  for each row execute function app.audit_row();
create trigger work_order_costs_audit after insert or update or delete on public.work_order_costs
  for each row execute function app.audit_row();

-- Domain events (the send/view/accept functions emit their own named events too).
create trigger price_books_event after insert or update or delete on public.price_books
  for each row execute function app.emit_change_event('price_book');
create trigger paint_products_event after insert or update or delete on public.paint_products
  for each row execute function app.emit_change_event('paint_product');
create trigger production_rates_event after insert or update or delete on public.production_rates
  for each row execute function app.emit_change_event('production_rate');
create trigger catalog_items_event after insert or update or delete on public.catalog_items
  for each row execute function app.emit_change_event('catalog_item');
create trigger estimate_settings_event after update on public.estimate_settings
  for each row execute function app.emit_change_event('estimate_settings');
create trigger estimates_event after insert or update or delete on public.estimates
  for each row execute function app.emit_change_event('estimate');
create trigger estimate_versions_event after insert or update or delete on public.estimate_versions
  for each row execute function app.emit_change_event('estimate_version', 'settings_snapshot', 'priced', 'priced_at', 'proposal');
create trigger estimate_options_event after insert or update or delete on public.estimate_options
  for each row execute function app.emit_change_event('estimate_option', 'subtotal_cents', 'total_cents');
create trigger estimate_areas_event after insert or update or delete on public.estimate_areas
  for each row execute function app.emit_change_event('estimate_area');
create trigger estimate_line_items_event after insert or update or delete on public.estimate_line_items
  for each row execute function app.emit_change_event('estimate_line', 'labor_hours', 'prep_hours', 'gallons',
    'primer_gallons', 'gallons_needed', 'primer_gallons_needed', 'containers', 'labor_cost_cents',
    'material_cost_cents', 'sundries_cents', 'cost_cents', 'computed_price_cents', 'price_cents',
    'priced_snapshot', 'issues');
create trigger change_orders_event after insert or update or delete on public.change_orders
  for each row execute function app.emit_change_event('change_order', 'settings_snapshot', 'priced', 'priced_at', 'proposal');
create trigger color_selections_event after insert or update or delete on public.color_selections
  for each row execute function app.emit_change_event('color_selection');
create trigger agreement_templates_event after insert or update or delete on public.agreement_templates
  for each row execute function app.emit_change_event('agreement_template');
create trigger documents_event after insert or update or delete on public.documents
  for each row execute function app.emit_change_event('document');
create trigger invoices_event after insert or update or delete on public.invoices
  for each row execute function app.emit_change_event('invoice');
create trigger onboarding_requirements_event after insert or update on public.onboarding_requirements
  for each row execute function app.emit_change_event('onboarding_requirement', 'last_checked_at');
create trigger paint_orders_event after insert or update or delete on public.paint_orders
  for each row execute function app.emit_change_event('paint_order');
create trigger work_orders_event after insert or update or delete on public.work_orders
  for each row execute function app.emit_change_event('work_order');

-- =============================================================================
-- 7. Row level security
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'price_books', 'paint_products', 'production_rates', 'catalog_items', 'estimate_settings', 'estimates',
    'estimate_versions', 'estimate_options', 'estimate_areas', 'estimate_line_items', 'change_orders',
    'color_selections', 'agreement_templates', 'proposal_tokens', 'signatures', 'documents', 'invoices',
    'invoice_lines', 'onboarding_requirements', 'paint_orders', 'paint_order_lines', 'work_orders',
    'work_order_costs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- Writes that only trusted code makes (send, accept, numbering, outputs).
revoke insert, update, delete on public.proposal_tokens, public.signatures from authenticated;
revoke insert, update, delete on public.invoices, public.invoice_lines from authenticated;
revoke insert, delete on public.onboarding_requirements from authenticated;
revoke delete on public.price_books, public.paint_products, public.catalog_items, public.estimates,
  public.change_orders, public.color_selections, public.agreement_templates, public.documents,
  public.paint_orders, public.work_orders, public.estimate_settings from authenticated;
revoke insert, delete on public.estimate_settings from authenticated;

-- Catalog: everyone who builds or reads estimates reads it; catalog:manage edits it.
create policy price_books_select on public.price_books for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and ((select app.has_perm('estimates:read')) or (select app.has_perm('catalog:manage'))));
create policy price_books_insert on public.price_books for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('catalog:manage')));
create policy price_books_update on public.price_books for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('catalog:manage')))
  with check (org_id = (select app.current_org_id()));

do $$
declare
  t text;
begin
  foreach t in array array['paint_products', 'catalog_items'] loop
    execute format($f$
      create policy %1$I_select on public.%1$I for select to authenticated
        using (org_id = (select app.current_org_id()) and deleted_at is null
               and ((select app.has_perm('estimates:read')) or (select app.has_perm('catalog:manage'))));
      create policy %1$I_insert on public.%1$I for insert to authenticated
        with check (org_id = (select app.current_org_id()) and (select app.can_write('catalog:manage')));
      create policy %1$I_update on public.%1$I for update to authenticated
        using (org_id = (select app.current_org_id()) and (select app.can_write('catalog:manage')))
        with check (org_id = (select app.current_org_id()));
    $f$, t);
  end loop;
end
$$;

create policy production_rates_select on public.production_rates for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.has_perm('estimates:read')) or (select app.has_perm('catalog:manage'))));
create policy production_rates_insert on public.production_rates for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('catalog:manage')));
create policy production_rates_update on public.production_rates for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('catalog:manage')))
  with check (org_id = (select app.current_org_id()));
create policy production_rates_delete on public.production_rates for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('catalog:manage')));

create policy estimate_settings_select on public.estimate_settings for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.has_perm('estimates:read')) or (select app.has_perm('catalog:manage'))
              or (select app.has_perm('settings:manage'))));
create policy estimate_settings_update on public.estimate_settings for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));

-- Estimates: visible with estimates:read on a job you can see; edited with
-- estimates:create on a job you can edit. Crew roles have neither.
create policy estimates_select on public.estimates for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and (select app.has_perm('estimates:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy estimates_insert on public.estimates for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null
              and app.can_edit_estimates(job_id));
create policy estimates_update on public.estimates for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and app.can_edit_estimates(job_id))
  with check (org_id = (select app.current_org_id()));

create policy estimate_versions_select on public.estimate_versions for select to authenticated
  using (org_id = (select app.current_org_id())
         and exists (select 1 from public.estimates e where e.id = estimate_id));
create policy estimate_versions_insert on public.estimate_versions for insert to authenticated
  with check (org_id = (select app.current_org_id()) and app.can_edit_estimates(app.estimate_job_id(estimate_id)));
create policy estimate_versions_update on public.estimate_versions for update to authenticated
  using (org_id = (select app.current_org_id()) and app.can_edit_estimates(app.estimate_job_id(estimate_id)))
  with check (org_id = (select app.current_org_id()));
create policy estimate_versions_delete on public.estimate_versions for delete to authenticated
  using (org_id = (select app.current_org_id()) and app.can_edit_estimates(app.estimate_job_id(estimate_id)));

do $$
declare
  t text;
begin
  foreach t in array array['estimate_options', 'estimate_areas'] loop
    execute format($f$
      create policy %1$I_select on public.%1$I for select to authenticated
        using (org_id = (select app.current_org_id())
               and exists (select 1 from public.estimate_versions v where v.id = version_id));
      create policy %1$I_insert on public.%1$I for insert to authenticated
        with check (org_id = (select app.current_org_id()) and app.can_edit_estimates(app.version_job_id(version_id)));
      create policy %1$I_update on public.%1$I for update to authenticated
        using (org_id = (select app.current_org_id()) and app.can_edit_estimates(app.version_job_id(version_id)))
        with check (org_id = (select app.current_org_id()));
      create policy %1$I_delete on public.%1$I for delete to authenticated
        using (org_id = (select app.current_org_id()) and app.can_edit_estimates(app.version_job_id(version_id)));
    $f$, t);
  end loop;
end
$$;

create policy estimate_line_items_select on public.estimate_line_items for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((version_id is not null and exists (select 1 from public.estimate_versions v where v.id = version_id))
              or (change_order_id is not null and exists (select 1 from public.change_orders c where c.id = change_order_id))));
create policy estimate_line_items_insert on public.estimate_line_items for insert to authenticated
  with check (org_id = (select app.current_org_id())
              and app.can_edit_estimates(coalesce(app.version_job_id(version_id), app.change_order_job_id(change_order_id))));
create policy estimate_line_items_update on public.estimate_line_items for update to authenticated
  using (org_id = (select app.current_org_id())
         and app.can_edit_estimates(coalesce(app.version_job_id(version_id), app.change_order_job_id(change_order_id))))
  with check (org_id = (select app.current_org_id()));
create policy estimate_line_items_delete on public.estimate_line_items for delete to authenticated
  using (org_id = (select app.current_org_id())
         and app.can_edit_estimates(coalesce(app.version_job_id(version_id), app.change_order_job_id(change_order_id))));

create policy change_orders_select on public.change_orders for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and (select app.has_perm('estimates:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy change_orders_insert on public.change_orders for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null and app.can_edit_estimates(job_id));
create policy change_orders_update on public.change_orders for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and app.can_edit_estimates(job_id))
  with check (org_id = (select app.current_org_id()));

-- The color sheet: everyone on the job sees it (crews paint from it).
create policy color_selections_select on public.color_selections for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy color_selections_insert on public.color_selections for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null and app.can_edit_estimates(job_id));
create policy color_selections_update on public.color_selections for update to authenticated
  using (org_id = (select app.current_org_id()) and app.can_edit_estimates(job_id))
  with check (org_id = (select app.current_org_id()));

create policy agreement_templates_select on public.agreement_templates for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and ((select app.has_perm('templates:manage')) or (select app.has_perm('estimates:read'))));
create policy agreement_templates_insert on public.agreement_templates for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('templates:manage')));
create policy agreement_templates_update on public.agreement_templates for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('templates:manage')))
  with check (org_id = (select app.current_org_id()));

create policy proposal_tokens_select on public.proposal_tokens for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('estimates:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));

create policy signatures_select on public.signatures for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('estimates:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));

-- Documents: money documents (proposals, contracts, invoices…) need financials
-- or estimate access; color sheets and HOA/lead-safe paperwork reach the crew.
create policy documents_select on public.documents for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.has_perm('documents:read'))
    and (not app.is_money_document(category)
         or (select app.has_perm('financials:read')) or (select app.has_perm('estimates:read')))
    and ((job_id is not null and exists (select 1 from public.jobs j where j.id = job_id))
         or (job_id is null and exists (select 1 from public.accounts a where a.id = account_id)))
  );
create policy documents_insert on public.documents for insert to authenticated
  with check (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('documents:manage'))
    and ((job_id is not null and app.can_edit_subject('job', job_id))
         or (job_id is null and app.can_edit_subject('account', account_id)))
  );
create policy documents_update on public.documents for update to authenticated
  using (
    org_id = (select app.current_org_id()) and (select app.can_write('documents:manage'))
    and ((job_id is not null and app.can_edit_subject('job', job_id))
         or (job_id is null and app.can_edit_subject('account', account_id)))
  )
  with check (org_id = (select app.current_org_id()));

create policy invoices_select on public.invoices for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('invoices:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (org_id = (select app.current_org_id())
         and exists (select 1 from public.invoices i where i.id = invoice_id));

create policy onboarding_requirements_select on public.onboarding_requirements for select to authenticated
  using (org_id = (select app.current_org_id()) and exists (select 1 from public.jobs j where j.id = job_id));
create policy onboarding_requirements_update on public.onboarding_requirements for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('jobs:update'))
         and app.can_edit_subject('job', job_id))
  with check (org_id = (select app.current_org_id()));

create policy paint_orders_select on public.paint_orders for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.has_perm('paint_orders:manage'))
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy paint_orders_insert on public.paint_orders for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('paint_orders:manage'))
              and exists (select 1 from public.jobs j where j.id = job_id));
create policy paint_orders_update on public.paint_orders for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('paint_orders:manage'))
         and exists (select 1 from public.jobs j where j.id = job_id))
  with check (org_id = (select app.current_org_id()));
create policy paint_order_lines_select on public.paint_order_lines for select to authenticated
  using (org_id = (select app.current_org_id())
         and exists (select 1 from public.paint_orders o where o.id = paint_order_id));
create policy paint_order_lines_insert on public.paint_order_lines for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('paint_orders:manage'))
              and exists (select 1 from public.paint_orders o where o.id = paint_order_id));
create policy paint_order_lines_update on public.paint_order_lines for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('paint_orders:manage'))
         and exists (select 1 from public.paint_orders o where o.id = paint_order_id))
  with check (org_id = (select app.current_org_id()));
create policy paint_order_lines_delete on public.paint_order_lines for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('paint_orders:manage'))
         and exists (select 1 from public.paint_orders o where o.id = paint_order_id));

create policy work_orders_select on public.work_orders for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.has_perm('work_orders:read'))
         and ((select app.effective_user_id()) = any(assigned_user_ids)
              or exists (select 1 from public.jobs j where j.id = job_id)));
create policy work_orders_insert on public.work_orders for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('work_orders:manage'))
              and exists (select 1 from public.jobs j where j.id = job_id));
create policy work_orders_update on public.work_orders for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('work_orders:manage'))
         and exists (select 1 from public.jobs j where j.id = job_id))
  with check (org_id = (select app.current_org_id()));

create policy work_order_costs_select on public.work_order_costs for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('financials:read'))
         and exists (select 1 from public.work_orders w where w.id = work_order_id));
create policy work_order_costs_insert on public.work_order_costs for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('work_orders:manage'))
              and (select app.has_perm('financials:read'))
              and exists (select 1 from public.work_orders w where w.id = work_order_id));
create policy work_order_costs_update on public.work_order_costs for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('work_orders:manage'))
         and (select app.has_perm('financials:read'))
         and exists (select 1 from public.work_orders w where w.id = work_order_id))
  with check (org_id = (select app.current_org_id()));

-- Approvals: people who approve discounts see and decide discount requests;
-- estimators ask for one when their discount is over their limit.
drop policy approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (requested_by = (select app.effective_user_id()) or (select app.has_perm('job_admin:override'))
         or (type = 'estimate_discount' and (select app.has_perm('estimates:approve_discount'))))
    and exists (select 1 from public.jobs j where j.id = job_id)
  );
drop policy approval_requests_insert on public.approval_requests;
create policy approval_requests_insert on public.approval_requests for insert to authenticated
  with check (
    org_id = (select app.current_org_id())
    and ((type = 'stage_override' and (select app.can_write('jobs:advance_stage')))
         or (type = 'estimate_discount' and (select app.can_write('estimates:create'))))
    and exists (select 1 from public.jobs j where j.id = job_id)
  );
drop policy approval_requests_update on public.approval_requests;
create policy approval_requests_update on public.approval_requests for update to authenticated
  using (
    org_id = (select app.current_org_id()) and not (select app.is_impersonating())
    and (requested_by = (select app.effective_user_id()) or (select app.has_perm('job_admin:override'))
         or (type = 'estimate_discount' and (select app.has_perm('estimates:approve_discount'))))
  )
  with check (org_id = (select app.current_org_id()));

grant execute on function app.estimate_job_id(uuid), app.version_job_id(uuid), app.change_order_job_id(uuid),
  app.can_edit_estimates(uuid), app.is_money_document(text), app.line_engine_columns(), app.is_key(text)
  to authenticated, service_role;

-- =============================================================================
-- 8. Stage gates 2–4 become real checks (must agree with lib/domain/jobs/gates.ts)
-- =============================================================================

create or replace function app.job_gate_passes(p_job uuid, p_from text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_from
    when 'walkthrough_scheduled' then exists (
      select 1 from public.appointments a
      where a.job_id = p_job and a.type = 'walkthrough' and a.status = 'completed'
        and a.result = 'measured' and a.deleted_at is null)
    -- An estimate version has been sent.
    when 'walkthrough_complete' then exists (
      select 1 from public.estimate_versions v join public.estimates e on e.id = v.estimate_id
      where e.job_id = p_job and e.deleted_at is null and v.sent_at is not null)
    -- The estimate is accepted and the customer signed it.
    when 'estimate_sent' then exists (
      select 1 from public.estimates e
      join public.signatures s on s.estimate_version_id = e.accepted_version_id
      where e.job_id = p_job and e.deleted_at is null and e.status = 'accepted')
    -- The deposit invoice exists (or the accepted estimate asks for no deposit).
    when 'sold' then exists (
      select 1 from public.invoices i
      where i.job_id = p_job and i.invoice_type = 'deposit' and i.status <> 'void')
      or exists (
      select 1 from public.estimates e join public.estimate_versions v on v.id = e.accepted_version_id
      where e.job_id = p_job and e.status = 'accepted'
        and coalesce((v.accepted_totals ->> 'depositCents')::bigint, 0) = 0)
    when 'paid_in_full' then true
    else false
  end;
$$;
revoke execute on function app.job_gate_passes(uuid, text) from public, anon, authenticated;
grant execute on function app.job_gate_passes(uuid, text) to service_role;

-- =============================================================================
-- 9. Send, view, accept, decline, expire (service role only; called from
--    lib/estimating after permission and pricing checks)
-- =============================================================================

create or replace function app.money_text(p_cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select '$' || to_char(coalesce(p_cents, 0) / 100.0, 'FM999,999,999,990.00');
$$;

-- Marks a draft version sent with its frozen proposal and a fresh link.
create or replace function public.mark_estimate_sent(
  p_version uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_proposal jsonb,
  p_total_cents bigint,
  p_channels text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.estimate_versions%rowtype;
  v_estimate public.estimates%rowtype;
  v_token uuid;
begin
  select * into v_version from public.estimate_versions where id = p_version for update;
  if not found then
    raise exception 'Estimate version not found.' using errcode = 'P0002';
  end if;
  select * into v_estimate from public.estimates where id = v_version.estimate_id for update;
  if v_estimate.deleted_at is not null then
    raise exception 'Estimate not found.' using errcode = 'P0002';
  end if;
  if v_estimate.status = 'accepted' then
    raise exception 'This estimate is already accepted. Use a change order instead.' using errcode = '23514';
  end if;
  if v_version.status <> 'draft' then
    raise exception 'This version was already sent. Start a new version to send changes.' using errcode = '23514';
  end if;
  if p_proposal is null or jsonb_typeof(p_proposal) <> 'object' then
    raise exception 'The proposal snapshot is missing.' using errcode = '22023';
  end if;
  if p_expires_at <= now() then
    raise exception 'The expiry date must be in the future.' using errcode = '22023';
  end if;

  perform set_config('app.system_update', 'on', true);
  -- Older sent versions are replaced; their links stop working.
  update public.proposal_tokens t set revoked_at = now(), revoked_reason = 'Replaced by a newer version'
  where t.revoked_at is null and t.estimate_version_id in (
    select v.id from public.estimate_versions v where v.estimate_id = v_estimate.id and v.id <> p_version);
  update public.estimate_versions v set status = 'superseded'
  where v.estimate_id = v_estimate.id and v.id <> p_version and v.status in ('sent', 'viewed', 'declined', 'expired');

  update public.estimate_versions set
    status = 'sent', proposal = p_proposal, sent_at = now(), sent_by = app.actor_id(),
    sent_channels = coalesce(p_channels, '{}'), expires_at = p_expires_at, viewed_at = null, view_count = 0,
    declined_at = null, decline_reason = null
  where id = p_version;

  insert into public.proposal_tokens (org_id, job_id, estimate_version_id, token_hash, expires_at, created_by)
  values (v_estimate.org_id, v_estimate.job_id, p_version, p_token_hash, p_expires_at, app.actor_id())
  returning id into v_token;

  update public.estimates set
    status = 'sent', current_version_id = p_version, sent_at = now(), viewed_at = null, expires_at = p_expires_at,
    declined_at = null, decline_reason = null, total_cents = p_total_cents
  where id = v_estimate.id;

  update public.jobs set estimate_sent_at = coalesce(estimate_sent_at, now()) where id = v_estimate.job_id;
  perform set_config('app.system_update', 'off', true);

  perform app.log_activity(v_estimate.org_id, 'job', v_estimate.job_id::text, 'estimate_sent',
    'Estimate ' || v_estimate.estimate_number || ' (version ' || v_version.version_no || ') sent'
      || case when cardinality(coalesce(p_channels, '{}')) > 0
              then ' by ' || array_to_string(p_channels, ' and ') else '' end,
    jsonb_build_object('estimate_id', v_estimate.id, 'version_id', p_version, 'channels', p_channels));
  perform app.emit_event(v_estimate.org_id, 'estimate.sent', 'estimate', v_estimate.id::text,
    jsonb_build_object('version_id', p_version, 'job_id', v_estimate.job_id, 'channels', p_channels,
                       'expires_at', p_expires_at));
  return v_token;
end;
$$;

-- Resolves a proposal link (no side effects): what it points to and whether it still works.
create or replace function public.resolve_proposal_token(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'token_id', t.id, 'org_id', t.org_id, 'job_id', t.job_id,
    'estimate_version_id', t.estimate_version_id, 'change_order_id', t.change_order_id,
    'expires_at', t.expires_at, 'revoked', t.revoked_at is not null, 'used_at', t.used_at,
    'expired', t.expires_at <= now())
  from public.proposal_tokens t where t.token_hash = p_token_hash;
$$;

-- Records that the customer opened the link (first view marks the estimate viewed).
create or replace function public.record_proposal_view(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.proposal_tokens%rowtype;
  v_first boolean;
  v_estimate public.estimates%rowtype;
  v_co public.change_orders%rowtype;
begin
  select * into v_token from public.proposal_tokens where token_hash = p_token_hash for update;
  if not found then
    raise exception 'This link isn''t valid.' using errcode = 'P0002';
  end if;
  v_first := v_token.first_viewed_at is null;
  update public.proposal_tokens set
    first_viewed_at = coalesce(first_viewed_at, now()), last_viewed_at = now(), view_count = view_count + 1
  where id = v_token.id;
  if v_token.revoked_at is not null or v_token.expires_at <= now() then
    return jsonb_build_object('first_view', false, 'active', false);
  end if;

  perform set_config('app.system_update', 'on', true);
  if v_token.estimate_version_id is not null then
    update public.estimate_versions set
      view_count = view_count + 1, viewed_at = coalesce(viewed_at, now()),
      status = case when status = 'sent' then 'viewed' else status end
    where id = v_token.estimate_version_id;
    select e.* into v_estimate from public.estimates e
      join public.estimate_versions v on v.estimate_id = e.id where v.id = v_token.estimate_version_id;
    if v_estimate.current_version_id = v_token.estimate_version_id then
      update public.estimates set viewed_at = coalesce(viewed_at, now()),
        status = case when status = 'sent' then 'viewed' else status end
      where id = v_estimate.id;
    end if;
  else
    update public.change_orders set viewed_at = coalesce(viewed_at, now()) where id = v_token.change_order_id;
    select * into v_co from public.change_orders where id = v_token.change_order_id;
  end if;
  perform set_config('app.system_update', 'off', true);

  if v_first then
    if v_token.estimate_version_id is not null then
      perform app.log_activity(v_token.org_id, 'job', v_token.job_id::text, 'estimate_viewed',
        'Customer opened estimate ' || v_estimate.estimate_number,
        jsonb_build_object('estimate_id', v_estimate.id, 'version_id', v_token.estimate_version_id));
      perform app.emit_event(v_token.org_id, 'estimate.viewed', 'estimate', v_estimate.id::text,
        jsonb_build_object('version_id', v_token.estimate_version_id, 'job_id', v_token.job_id),
        'estimate.viewed:' || v_token.id);
    else
      perform app.log_activity(v_token.org_id, 'job', v_token.job_id::text, 'change_order_viewed',
        'Customer opened change order ' || v_co.change_order_number,
        jsonb_build_object('change_order_id', v_co.id));
      perform app.emit_event(v_token.org_id, 'change_order.viewed', 'change_order', v_co.id::text,
        jsonb_build_object('job_id', v_token.job_id), 'change_order.viewed:' || v_token.id);
    end if;
  end if;
  return jsonb_build_object('first_view', v_first, 'active', true);
end;
$$;

-- Checks a token for signing and returns it locked.
create or replace function app.signable_token(p_token_hash text)
returns public.proposal_tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.proposal_tokens%rowtype;
begin
  select * into v_token from public.proposal_tokens where token_hash = p_token_hash for update;
  if not found then
    raise exception 'This link isn''t valid.' using errcode = 'P0002';
  end if;
  if v_token.revoked_at is not null then
    raise exception 'This link was replaced by a newer version. Use the latest link we sent.' using errcode = '23514';
  end if;
  if v_token.used_at is not null then
    raise exception 'This was already signed. Thank you!' using errcode = '23505';
  end if;
  if v_token.expires_at <= now() then
    raise exception 'This proposal has expired. Contact us and we''ll send a fresh one.' using errcode = '23514';
  end if;
  return v_token;
end;
$$;

-- Accept & sign (SPEC §7.5, §6.4, §10): one transaction. The TypeScript caller
-- prices the selection from the frozen snapshot (p_totals) and builds the
-- outputs (p_outputs: onboarding rows, paint order lines, work orders, color
-- rows) with lib/domain/estimating; the signed PDF and the stage moves follow.
create or replace function public.accept_estimate(
  p_token_hash text,
  p_option uuid,
  p_addons uuid[],
  p_signer_name text,
  p_signer_email text,
  p_signature_png text,
  p_signature_sha256 text,
  p_consent text,
  p_ip inet,
  p_user_agent text,
  p_totals jsonb,
  p_outputs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.proposal_tokens%rowtype;
  v_version public.estimate_versions%rowtype;
  v_estimate public.estimates%rowtype;
  v_job public.jobs%rowtype;
  v_signature uuid;
  v_invoice uuid;
  v_invoice_number text;
  v_paint_order uuid;
  v_total bigint := (p_totals ->> 'totalCents')::bigint;
  v_deposit bigint := coalesce((p_totals ->> 'depositCents')::bigint, 0);
  v_deposit_pct numeric := coalesce((p_totals ->> 'depositPercent')::numeric, 0);
  v_row jsonb;
  v_i integer := 0;
  v_addon_count integer;
begin
  v_token := app.signable_token(p_token_hash);
  if v_token.estimate_version_id is null then
    raise exception 'This link is for a change order.' using errcode = '22023';
  end if;
  select * into v_version from public.estimate_versions where id = v_token.estimate_version_id for update;
  select * into v_estimate from public.estimates where id = v_version.estimate_id for update;
  select * into v_job from public.jobs where id = v_estimate.job_id for update;
  if v_estimate.deleted_at is not null or v_job.deleted_at is not null then
    raise exception 'This proposal is no longer available.' using errcode = 'P0002';
  end if;
  if v_estimate.status = 'accepted' or v_version.status = 'accepted' then
    raise exception 'This was already signed. Thank you!' using errcode = '23505';
  end if;
  if v_version.status not in ('sent', 'viewed') or v_estimate.current_version_id <> v_version.id then
    raise exception 'This proposal can''t be accepted anymore. Contact us and we''ll send a fresh one.' using errcode = '23514';
  end if;
  if v_job.stage in ('closed_won', 'closed_lost') then
    raise exception 'This job is closed. Contact us and we''ll send a fresh proposal.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.estimate_options o where o.id = p_option and o.version_id = v_version.id) then
    raise exception 'Pick one of the options on the proposal.' using errcode = '22023';
  end if;
  select count(*) into v_addon_count from public.estimate_line_items l
  where l.version_id = v_version.id and l.is_optional and l.id = any(coalesce(p_addons, '{}'));
  if v_addon_count <> cardinality(coalesce(p_addons, '{}')) then
    raise exception 'One of the add-ons isn''t on this proposal.' using errcode = '22023';
  end if;
  if v_total is null or v_total < 0 then
    raise exception 'The total is missing.' using errcode = '22023';
  end if;

  -- Signature.
  insert into public.signatures (org_id, job_id, estimate_version_id, token_id, signer_name, signer_email,
                                 signature_png, signature_sha256, consent_text, selection, ip, user_agent)
  values (v_estimate.org_id, v_job.id, v_version.id, v_token.id, btrim(p_signer_name), nullif(btrim(coalesce(p_signer_email, '')), ''),
          p_signature_png, p_signature_sha256, p_consent,
          jsonb_build_object('option_id', p_option, 'addon_ids', to_jsonb(coalesce(p_addons, '{}')), 'totals', p_totals),
          p_ip, left(p_user_agent, 500))
  returning id into v_signature;

  perform set_config('app.system_update', 'on', true);
  update public.proposal_tokens set used_at = now() where id = v_token.id;
  update public.estimate_versions set
    status = 'accepted', accepted_at = now(), accepted_option_id = p_option,
    accepted_addon_ids = coalesce(p_addons, '{}'), accepted_totals = p_totals
  where id = v_version.id;
  update public.estimates set
    status = 'accepted', accepted_at = now(), accepted_version_id = v_version.id, accepted_option_id = p_option,
    total_cents = v_total
  where id = v_estimate.id;
  update public.jobs set
    accepted_estimate_id = v_estimate.id,
    estimate_accepted_at = coalesce(estimate_accepted_at, now()),
    contract_signed_at = coalesce(contract_signed_at, now())
  where id = v_job.id;

  insert into public.job_financials (job_id, org_id, estimate_contract_cents)
  values (v_job.id, v_job.org_id, v_total)
  on conflict (job_id) do update set estimate_contract_cents = excluded.estimate_contract_cents;

  -- Deposit invoice (status draft: Finance sends invoices; payments arrive in Phase 7).
  if v_deposit > 0 then
    insert into public.invoices (org_id, job_id, invoice_type, status, issue_date, estimate_id, estimate_version_id)
    values (v_job.org_id, v_job.id, 'deposit', 'draft', (now() at time zone 'America/Los_Angeles')::date,
            v_estimate.id, v_version.id)
    returning id, invoice_number into v_invoice, v_invoice_number;
    insert into public.invoice_lines (org_id, invoice_id, description, quantity, unit_price_cents, taxable, source_type, source_id)
    values (v_job.org_id, v_invoice,
            'Deposit (' || trim(to_char(v_deposit_pct, 'FM990.##')) || '% of estimate ' || v_estimate.estimate_number
              || ', ' || app.money_text(v_total) || ')',
            1, v_deposit, false, 'estimate', v_version.id);
    -- Deposit Hold until it's paid (SPEC §3.2; released when the deposit is recorded).
    if not exists (select 1 from public.job_holds h where h.job_id = v_job.id and h.hold_type = 'deposit'
                   and h.released_at is null) then
      insert into public.job_holds (org_id, job_id, hold_type, reason, blocks_scheduling)
      values (v_job.org_id, v_job.id, 'deposit', 'Waiting for the deposit (invoice ' || v_invoice_number || ').', true);
    end if;
  end if;
  perform set_config('app.system_update', 'on', true);

  -- Onboarding requirements (SPEC §6.4).
  for v_row in select * from jsonb_array_elements(coalesce(p_outputs -> 'onboarding', '[]'::jsonb)) loop
    insert into public.onboarding_requirements (org_id, job_id, key, group_key, label, required, owner_role,
                                                status, auto_verify_rule, sort_order, source_estimate_version_id)
    values (v_job.org_id, v_job.id, v_row ->> 'key', v_row ->> 'group', v_row ->> 'label',
            coalesce((v_row ->> 'required')::boolean, true), v_row ->> 'ownerRole',
            coalesce(v_row ->> 'status', 'pending'), v_row ->> 'autoVerifyRule',
            coalesce((v_row ->> 'sortOrder')::integer, 0), v_version.id)
    on conflict (job_id, key) do update set
      required = excluded.required, status = case when public.onboarding_requirements.status = 'verified'
                                                  then 'verified' else excluded.status end,
      source_estimate_version_id = excluded.source_estimate_version_id;
  end loop;

  -- Paint & materials order draft.
  if jsonb_array_length(coalesce(p_outputs -> 'paintOrder', '[]'::jsonb)) > 0 then
    insert into public.paint_orders (org_id, job_id, status, estimate_version_id)
    values (v_job.org_id, v_job.id, 'draft', v_version.id)
    returning id into v_paint_order;
    v_i := 0;
    for v_row in select * from jsonb_array_elements(p_outputs -> 'paintOrder') loop
      v_i := v_i + 1;
      insert into public.paint_order_lines (org_id, paint_order_id, paint_product_id, label, sheen, is_primer,
                                            is_sundries, gallons_needed, gallons, containers, unit_cost_cents,
                                            cost_cents, sort_order)
      values (v_job.org_id, v_paint_order, nullif(v_row ->> 'paintProductId', '')::uuid, v_row ->> 'label',
              v_row ->> 'sheen', coalesce((v_row ->> 'isPrimer')::boolean, false),
              coalesce((v_row ->> 'isSundries')::boolean, false),
              coalesce((v_row ->> 'gallonsNeeded')::numeric, 0), coalesce((v_row ->> 'gallons')::numeric, 0),
              case when jsonb_typeof(v_row -> 'containers') = 'object' then v_row -> 'containers' end,
              coalesce((v_row ->> 'unitCostCents')::bigint, 0), coalesce((v_row ->> 'costCents')::bigint, 0), v_i);
    end loop;
  end if;

  -- Work orders by phase with budgeted hours.
  for v_row in select * from jsonb_array_elements(coalesce(p_outputs -> 'workOrders', '[]'::jsonb)) loop
    insert into public.work_orders (org_id, job_id, phase, title, scope_summary, status, budgeted_hours,
                                    estimate_version_id)
    values (v_job.org_id, v_job.id, v_row ->> 'phase', v_row ->> 'title', v_row ->> 'scopeSummary', 'new',
            coalesce((v_row ->> 'budgetedHours')::numeric, 0), v_version.id);
  end loop;

  -- Color sheet rows to fill in.
  v_i := 0;
  for v_row in select * from jsonb_array_elements(coalesce(p_outputs -> 'colors', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.color_selections (org_id, job_id, estimate_version_id, line_item_id, area, surface,
                                         brand, sheen, paint_product_id, sort_order)
    values (v_job.org_id, v_job.id, v_version.id, nullif(v_row ->> 'lineId', '')::uuid, v_row ->> 'area',
            v_row ->> 'surface', v_row ->> 'brand', v_row ->> 'sheen', nullif(v_row ->> 'productId', '')::uuid, v_i * 10);
  end loop;
  perform set_config('app.system_update', 'off', true);

  perform app.log_activity(v_job.org_id, 'job', v_job.id::text, 'estimate_accepted',
    'Estimate ' || v_estimate.estimate_number || ' accepted and signed by ' || btrim(p_signer_name),
    jsonb_build_object('estimate_id', v_estimate.id, 'version_id', v_version.id, 'signature_id', v_signature,
                       'option_id', p_option, 'invoice_id', v_invoice));
  perform app.emit_event(v_job.org_id, 'estimate.accepted', 'estimate', v_estimate.id::text,
    jsonb_build_object('version_id', v_version.id, 'job_id', v_job.id, 'signature_id', v_signature,
                       'invoice_id', v_invoice, 'paint_order_id', v_paint_order),
    'estimate.accepted:' || v_version.id);
  return jsonb_build_object('estimate_id', v_estimate.id, 'version_id', v_version.id, 'job_id', v_job.id,
                            'signature_id', v_signature, 'invoice_id', v_invoice, 'paint_order_id', v_paint_order);
end;
$$;

create or replace function public.decline_proposal(p_token_hash text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.proposal_tokens%rowtype;
  v_version public.estimate_versions%rowtype;
  v_estimate public.estimates%rowtype;
  v_co public.change_orders%rowtype;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
begin
  v_token := app.signable_token(p_token_hash);
  perform set_config('app.system_update', 'on', true);
  update public.proposal_tokens set used_at = now() where id = v_token.id;
  if v_token.estimate_version_id is not null then
    select * into v_version from public.estimate_versions where id = v_token.estimate_version_id for update;
    select * into v_estimate from public.estimates where id = v_version.estimate_id for update;
    if v_version.status not in ('sent', 'viewed') then
      raise exception 'This proposal can''t be declined anymore.' using errcode = '23514';
    end if;
    update public.estimate_versions set status = 'declined', declined_at = now(), decline_reason = v_reason
    where id = v_version.id;
    update public.estimates set status = 'declined', declined_at = now(), decline_reason = v_reason
    where id = v_estimate.id and current_version_id = v_version.id;
    perform set_config('app.system_update', 'off', true);
    perform app.log_activity(v_estimate.org_id, 'job', v_estimate.job_id::text, 'estimate_declined',
      'Customer declined estimate ' || v_estimate.estimate_number || coalesce(': ' || v_reason, ''),
      jsonb_build_object('estimate_id', v_estimate.id, 'version_id', v_version.id));
    perform app.emit_event(v_estimate.org_id, 'estimate.declined', 'estimate', v_estimate.id::text,
      jsonb_build_object('version_id', v_version.id, 'job_id', v_estimate.job_id, 'reason', v_reason));
    return jsonb_build_object('kind', 'estimate', 'id', v_estimate.id, 'job_id', v_estimate.job_id);
  end if;
  select * into v_co from public.change_orders where id = v_token.change_order_id for update;
  if v_co.status <> 'sent' then
    raise exception 'This change order can''t be declined anymore.' using errcode = '23514';
  end if;
  update public.change_orders set status = 'declined', declined_at = now(), decline_reason = v_reason where id = v_co.id;
  perform set_config('app.system_update', 'off', true);
  perform app.log_activity(v_co.org_id, 'job', v_co.job_id::text, 'change_order_declined',
    'Customer declined change order ' || v_co.change_order_number || coalesce(': ' || v_reason, ''),
    jsonb_build_object('change_order_id', v_co.id));
  perform app.emit_event(v_co.org_id, 'change_order.declined', 'change_order', v_co.id::text,
    jsonb_build_object('job_id', v_co.job_id, 'reason', v_reason));
  return jsonb_build_object('kind', 'change_order', 'id', v_co.id, 'job_id', v_co.job_id);
end;
$$;

-- Worker: sent proposals past their expiry date become expired.
create or replace function public.expire_proposals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  perform set_config('app.system_update', 'on', true);
  for v_row in
    update public.estimate_versions v set status = 'expired'
    where v.status in ('sent', 'viewed') and v.expires_at <= now()
    returning v.id, v.estimate_id, v.org_id
  loop
    v_count := v_count + 1;
    update public.estimates e set status = 'expired'
    where e.id = v_row.estimate_id and e.current_version_id = v_row.id and e.status in ('sent', 'viewed');
    perform app.log_activity(v_row.org_id, 'job', (select e.job_id from public.estimates e where e.id = v_row.estimate_id)::text,
      'estimate_expired',
      'Estimate ' || (select e.estimate_number from public.estimates e where e.id = v_row.estimate_id) || ' expired',
      jsonb_build_object('estimate_id', v_row.estimate_id, 'version_id', v_row.id));
    perform app.emit_event(v_row.org_id, 'estimate.expired', 'estimate', v_row.estimate_id::text,
      jsonb_build_object('version_id', v_row.id), 'estimate.expired:' || v_row.id);
  end loop;
  perform set_config('app.system_update', 'off', true);
  return v_count;
end;
$$;

-- Records the engine's results on a draft version (trusted code only).
create or replace function public.store_version_pricing(
  p_version uuid,
  p_settings jsonb,
  p_priced jsonb,
  p_max_discount numeric,
  p_lines jsonb,
  p_options jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_row jsonb;
begin
  select status into v_status from public.estimate_versions where id = p_version for update;
  if v_status is null then
    raise exception 'Estimate version not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'This version was sent; its prices are frozen.' using errcode = '23514';
  end if;
  perform set_config('app.system_update', 'on', true);
  update public.estimate_versions set settings_snapshot = p_settings, priced = p_priced,
    max_effective_discount_percent = coalesce(p_max_discount, 0), priced_at = now()
  where id = p_version;
  for v_row in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update public.estimate_line_items l set
      labor_hours = (v_row ->> 'laborHours')::numeric, prep_hours = (v_row ->> 'prepHours')::numeric,
      gallons = (v_row ->> 'gallons')::numeric, primer_gallons = (v_row ->> 'primerGallons')::numeric,
      gallons_needed = (v_row ->> 'gallonsNeeded')::numeric,
      primer_gallons_needed = (v_row ->> 'primerGallonsNeeded')::numeric,
      containers = v_row -> 'containers',
      labor_cost_cents = (v_row ->> 'laborCostCents')::bigint,
      material_cost_cents = (v_row ->> 'materialCostCents')::bigint,
      sundries_cents = (v_row ->> 'sundriesCents')::bigint, cost_cents = (v_row ->> 'costCents')::bigint,
      computed_price_cents = (v_row ->> 'computedPriceCents')::bigint, price_cents = (v_row ->> 'priceCents')::bigint,
      priced_snapshot = v_row -> 'snapshot', issues = coalesce(v_row -> 'issues', '[]'::jsonb)
    where l.id = (v_row ->> 'id')::uuid and l.version_id = p_version;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) loop
    update public.estimate_options o set subtotal_cents = (v_row ->> 'subtotalCents')::bigint,
      total_cents = (v_row ->> 'totalCents')::bigint
    where o.id = (v_row ->> 'id')::uuid and o.version_id = p_version;
  end loop;
  perform set_config('app.system_update', 'off', true);
end;
$$;

-- Same for a draft change order.
create or replace function public.store_change_order_pricing(
  p_change_order uuid,
  p_settings jsonb,
  p_priced jsonb,
  p_subtotal bigint,
  p_tax bigint,
  p_total bigint,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_row jsonb;
begin
  select status into v_status from public.change_orders where id = p_change_order for update;
  if v_status is null then
    raise exception 'Change order not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'This change order was sent; its prices are frozen.' using errcode = '23514';
  end if;
  perform set_config('app.system_update', 'on', true);
  update public.change_orders set settings_snapshot = p_settings, priced = p_priced, priced_at = now(),
    subtotal_cents = p_subtotal, tax_cents = p_tax, total_cents = p_total
  where id = p_change_order;
  for v_row in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update public.estimate_line_items l set
      labor_hours = (v_row ->> 'laborHours')::numeric, prep_hours = (v_row ->> 'prepHours')::numeric,
      gallons = (v_row ->> 'gallons')::numeric, primer_gallons = (v_row ->> 'primerGallons')::numeric,
      gallons_needed = (v_row ->> 'gallonsNeeded')::numeric,
      primer_gallons_needed = (v_row ->> 'primerGallonsNeeded')::numeric,
      containers = v_row -> 'containers',
      labor_cost_cents = (v_row ->> 'laborCostCents')::bigint,
      material_cost_cents = (v_row ->> 'materialCostCents')::bigint,
      sundries_cents = (v_row ->> 'sundriesCents')::bigint, cost_cents = (v_row ->> 'costCents')::bigint,
      computed_price_cents = (v_row ->> 'computedPriceCents')::bigint, price_cents = (v_row ->> 'priceCents')::bigint,
      priced_snapshot = v_row -> 'snapshot', issues = coalesce(v_row -> 'issues', '[]'::jsonb)
    where l.id = (v_row ->> 'id')::uuid and l.change_order_id = p_change_order;
  end loop;
  perform set_config('app.system_update', 'off', true);
end;
$$;

-- An owner approved a discount: the version may go out at up to that percent.
create or replace function public.approve_version_discount(p_version uuid, p_percent numeric, p_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.system_update', 'on', true);
  update public.estimate_versions set discount_approved_percent = p_percent, discount_approved_by = p_by,
    discount_approved_at = now()
  where id = p_version and status = 'draft';
  if not found then
    raise exception 'This version was already sent or no longer exists.' using errcode = '23514';
  end if;
  perform set_config('app.system_update', 'off', true);
end;
$$;

-- Change orders: send and sign.
create or replace function public.mark_change_order_sent(
  p_change_order uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_proposal jsonb,
  p_channels text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co public.change_orders%rowtype;
  v_token uuid;
begin
  select * into v_co from public.change_orders where id = p_change_order for update;
  if not found or v_co.deleted_at is not null then
    raise exception 'Change order not found.' using errcode = 'P0002';
  end if;
  if v_co.status <> 'draft' then
    raise exception 'This change order was already sent.' using errcode = '23514';
  end if;
  if p_proposal is null then
    raise exception 'The change order snapshot is missing.' using errcode = '22023';
  end if;
  perform set_config('app.system_update', 'on', true);
  update public.change_orders set status = 'sent', proposal = p_proposal, sent_at = now(), sent_by = app.actor_id(),
    expires_at = p_expires_at
  where id = p_change_order;
  insert into public.proposal_tokens (org_id, job_id, change_order_id, token_hash, expires_at, created_by)
  values (v_co.org_id, v_co.job_id, p_change_order, p_token_hash, p_expires_at, app.actor_id())
  returning id into v_token;
  -- A change order waiting on the customer is an onboarding item.
  update public.onboarding_requirements set required = true, status = 'pending'
  where job_id = v_co.job_id and key = 'change_orders_resolved';
  perform set_config('app.system_update', 'off', true);
  perform app.log_activity(v_co.org_id, 'job', v_co.job_id::text, 'change_order_sent',
    'Change order ' || v_co.change_order_number || ' sent'
      || case when cardinality(coalesce(p_channels, '{}')) > 0 then ' by ' || array_to_string(p_channels, ' and ') else '' end,
    jsonb_build_object('change_order_id', v_co.id, 'channels', p_channels));
  perform app.emit_event(v_co.org_id, 'change_order.sent', 'change_order', v_co.id::text,
    jsonb_build_object('job_id', v_co.job_id, 'channels', p_channels));
  return v_token;
end;
$$;

create or replace function public.accept_change_order(
  p_token_hash text,
  p_signer_name text,
  p_signer_email text,
  p_signature_png text,
  p_signature_sha256 text,
  p_consent text,
  p_ip inet,
  p_user_agent text,
  p_outputs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.proposal_tokens%rowtype;
  v_co public.change_orders%rowtype;
  v_signature uuid;
  v_invoice uuid;
  v_row jsonb;
  v_i integer := 0;
begin
  v_token := app.signable_token(p_token_hash);
  if v_token.change_order_id is null then
    raise exception 'This link is for an estimate.' using errcode = '22023';
  end if;
  select * into v_co from public.change_orders where id = v_token.change_order_id for update;
  if v_co.status <> 'sent' then
    raise exception 'This change order can''t be signed anymore.' using errcode = '23514';
  end if;

  insert into public.signatures (org_id, job_id, change_order_id, token_id, signer_name, signer_email,
                                 signature_png, signature_sha256, consent_text, selection, ip, user_agent)
  values (v_co.org_id, v_co.job_id, v_co.id, v_token.id, btrim(p_signer_name), nullif(btrim(coalesce(p_signer_email, '')), ''),
          p_signature_png, p_signature_sha256, p_consent,
          jsonb_build_object('total_cents', v_co.total_cents), p_ip, left(p_user_agent, 500))
  returning id into v_signature;

  perform set_config('app.system_update', 'on', true);
  update public.proposal_tokens set used_at = now() where id = v_token.id;
  update public.change_orders set status = 'signed', signed_at = now() where id = v_co.id;

  -- Contract = accepted estimate + signed change orders.
  insert into public.job_financials (job_id, org_id, change_orders_cents)
  values (v_co.job_id, v_co.org_id, coalesce(v_co.total_cents, 0))
  on conflict (job_id) do update set change_orders_cents = (
    select coalesce(sum(c.total_cents), 0) from public.change_orders c
    where c.job_id = v_co.job_id and c.status = 'signed' and c.deleted_at is null);

  -- Optional change-order invoice (draft): positive → change order, negative → credit memo.
  if v_co.bill_separately and coalesce(v_co.total_cents, 0) <> 0 then
    insert into public.invoices (org_id, job_id, invoice_type, status, issue_date, change_order_id, estimate_id)
    values (v_co.org_id, v_co.job_id, case when v_co.total_cents > 0 then 'change_order' else 'credit_memo' end,
            'draft', (now() at time zone 'America/Los_Angeles')::date, v_co.id, v_co.estimate_id)
    returning id into v_invoice;
    insert into public.invoice_lines (org_id, invoice_id, description, quantity, unit_price_cents, taxable,
                                      tax_cents, source_type, source_id)
    values (v_co.org_id, v_invoice, 'Change order ' || v_co.change_order_number || ': ' || v_co.title, 1,
            coalesce(v_co.subtotal_cents, v_co.total_cents), false, coalesce(v_co.tax_cents, 0), 'change_order', v_co.id);
  end if;

  update public.onboarding_requirements r set status = 'verified', verified_auto = true
  where r.job_id = v_co.job_id and r.key = 'change_orders_resolved' and r.status <> 'verified'
    and not exists (select 1 from public.change_orders c where c.job_id = v_co.job_id and c.status = 'sent'
                    and c.deleted_at is null);

  for v_row in select * from jsonb_array_elements(coalesce(p_outputs -> 'colors', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.color_selections (org_id, job_id, change_order_id, line_item_id, area, surface, brand, sheen,
                                         paint_product_id, sort_order)
    values (v_co.org_id, v_co.job_id, v_co.id, nullif(v_row ->> 'lineId', '')::uuid, v_row ->> 'area',
            v_row ->> 'surface', v_row ->> 'brand', v_row ->> 'sheen', nullif(v_row ->> 'productId', '')::uuid,
            1000 + v_i * 10);
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_outputs -> 'workOrders', '[]'::jsonb)) loop
    insert into public.work_orders (org_id, job_id, phase, title, scope_summary, status, budgeted_hours, change_order_id)
    values (v_co.org_id, v_co.job_id, v_row ->> 'phase', v_row ->> 'title', v_row ->> 'scopeSummary', 'new',
            coalesce((v_row ->> 'budgetedHours')::numeric, 0), v_co.id);
  end loop;
  perform set_config('app.system_update', 'off', true);

  perform app.log_activity(v_co.org_id, 'job', v_co.job_id::text, 'change_order_signed',
    'Change order ' || v_co.change_order_number || ' signed by ' || btrim(p_signer_name),
    jsonb_build_object('change_order_id', v_co.id, 'signature_id', v_signature, 'invoice_id', v_invoice));
  perform app.emit_event(v_co.org_id, 'change_order.signed', 'change_order', v_co.id::text,
    jsonb_build_object('job_id', v_co.job_id, 'signature_id', v_signature, 'invoice_id', v_invoice),
    'change_order.signed:' || v_co.id);
  return jsonb_build_object('change_order_id', v_co.id, 'job_id', v_co.job_id, 'signature_id', v_signature,
                            'invoice_id', v_invoice);
end;
$$;

-- Links the signed PDF to its signature and clears the contract onboarding item.
create or replace function public.attach_signed_document(p_signature uuid, p_document uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sig public.signatures%rowtype;
begin
  select * into v_sig from public.signatures where id = p_signature for update;
  if not found then
    raise exception 'Signature not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.documents d where d.id = p_document and d.job_id = v_sig.job_id) then
    raise exception 'The document must belong to the same job.' using errcode = '23514';
  end if;
  update public.signatures set document_id = p_document where id = p_signature;
  if v_sig.estimate_version_id is not null then
    update public.onboarding_requirements set status = 'verified', verified_auto = true,
      note = 'Signed proposal and contract stored in Documents.', last_checked_at = now()
    where job_id = v_sig.job_id and key = 'signed_contract' and status <> 'verified';
  end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.mark_estimate_sent(uuid, text, timestamptz, jsonb, bigint, text[])',
    'public.resolve_proposal_token(text)',
    'public.record_proposal_view(text)',
    'public.accept_estimate(text, uuid, uuid[], text, text, text, text, text, inet, text, jsonb, jsonb)',
    'public.decline_proposal(text, text)',
    'public.expire_proposals()',
    'public.store_version_pricing(uuid, jsonb, jsonb, numeric, jsonb, jsonb)',
    'public.store_change_order_pricing(uuid, jsonb, jsonb, bigint, bigint, bigint, jsonb)',
    'public.approve_version_discount(uuid, numeric, uuid)',
    'public.mark_change_order_sent(uuid, text, timestamptz, jsonb, text[])',
    'public.accept_change_order(text, text, text, text, text, text, inet, text, jsonb)',
    'public.attach_signed_document(uuid, uuid)',
    'app.signable_token(text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;

-- =============================================================================
-- 10. RPCs for screens (run as the caller; row security decides what counts)
-- =============================================================================

-- New estimate with version 1 and "Option A".
create or replace function public.create_estimate(p_job uuid, p_title text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_estimate uuid;
  v_version uuid;
begin
  select j.org_id into v_org from public.jobs j where j.id = p_job;
  if v_org is null then
    raise exception 'That job isn''t available.' using errcode = 'P0002';
  end if;
  insert into public.estimates (org_id, job_id, title)
  values (v_org, p_job, nullif(btrim(coalesce(p_title, '')), ''))
  returning id into v_estimate;
  insert into public.estimate_versions (org_id, estimate_id, version_no)
  values (v_org, v_estimate, 1)
  returning id into v_version;
  insert into public.estimate_options (org_id, version_id, name, is_recommended, sort_order)
  values (v_org, v_version, 'Option A', true, 1);
  return v_estimate;
end;
$$;

-- New draft version copied from another (options, areas, lines, discount, notes).
create or replace function public.copy_estimate_version(p_version uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_src public.estimate_versions%rowtype;
  v_new uuid;
  v_map jsonb := '{}'::jsonb;
  v_opt record;
  v_area record;
  v_id uuid;
begin
  select * into v_src from public.estimate_versions where id = p_version;
  if not found then
    raise exception 'That version isn''t available.' using errcode = 'P0002';
  end if;
  insert into public.estimate_versions (org_id, estimate_id, version_no, discount_type, discount_value,
                                        discount_reason, deposit_percent, customer_notes, internal_notes)
  values (v_src.org_id, v_src.estimate_id,
          (select max(v.version_no) + 1 from public.estimate_versions v where v.estimate_id = v_src.estimate_id),
          v_src.discount_type, v_src.discount_value,
          v_src.discount_reason, v_src.deposit_percent, v_src.customer_notes, v_src.internal_notes)
  returning id into v_new;

  for v_opt in select * from public.estimate_options o where o.version_id = p_version order by o.sort_order, o.created_at loop
    insert into public.estimate_options (org_id, version_id, name, description, is_recommended, sort_order)
    values (v_opt.org_id, v_new, v_opt.name, v_opt.description, v_opt.is_recommended, v_opt.sort_order)
    returning id into v_id;
    v_map := v_map || jsonb_build_object(v_opt.id::text, v_id);
  end loop;
  for v_area in select * from public.estimate_areas a where a.version_id = p_version order by a.sort_order, a.created_at loop
    insert into public.estimate_areas (org_id, version_id, option_id, name, work_type, measurements, notes, sort_order)
    values (v_area.org_id, v_new, (v_map ->> v_area.option_id::text)::uuid, v_area.name, v_area.work_type,
            v_area.measurements, v_area.notes, v_area.sort_order)
    returning id into v_id;
    v_map := v_map || jsonb_build_object(v_area.id::text, v_id);
  end loop;

  insert into public.estimate_line_items (
    org_id, version_id, option_id, area_id, catalog_item_id, kind, is_optional, name, customer_note, catalog_code,
    surface, unit, work_type, work_order_phase, quantity, sides, condition, prep_level, coats, primer,
    color_change, method, access, height, sheen, paint_product_id, primer_product_id, lead_safe, taxable,
    is_repair_allowance, unit_price_cents, unit_cost_cents, labor_hours_per_unit, paint_sqft_per_unit,
    override_price_cents, override_reason, measurement, sort_order)
  select l.org_id, v_new, (v_map ->> l.option_id::text)::uuid, (v_map ->> l.area_id::text)::uuid, l.catalog_item_id,
         l.kind, l.is_optional, l.name, l.customer_note, l.catalog_code, l.surface, l.unit, l.work_type,
         l.work_order_phase, l.quantity, l.sides, l.condition, l.prep_level, l.coats, l.primer, l.color_change,
         l.method, l.access, l.height, l.sheen, l.paint_product_id, l.primer_product_id, l.lead_safe, l.taxable,
         l.is_repair_allowance, l.unit_price_cents, l.unit_cost_cents, l.labor_hours_per_unit,
         l.paint_sqft_per_unit, l.override_price_cents, l.override_reason, l.measurement, l.sort_order
  from public.estimate_line_items l
  where l.version_id = p_version;
  return v_new;
end;
$$;

create or replace function app.org_estimate_sla_hours()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.estimate_sla_hours from public.company_settings s where s.org_id = app.current_org_id()), 24);
$$;

-- Estimate metrics (SPEC §12.1): sent, 24h SLA, close rate (count and $), job value.
-- An estimate's value is its accepted total once accepted, else the recommended
-- option's total when it was last sent. Cohorts use the first time it was sent.
create or replace function public.estimate_stats(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with sla as (select app.org_estimate_sla_hours() as hours),
  sent as (
    select e.id, e.status, e.total_cents, e.accepted_at, e.expires_at, j.walkthrough_completed_at,
           min(v.sent_at) as first_sent_at
    from public.estimates e
    join public.jobs j on j.id = e.job_id
    join public.estimate_versions v on v.estimate_id = e.id and v.sent_at is not null
    group by e.id, j.walkthrough_completed_at
  ),
  cohort as (select * from sent where first_sent_at >= p_from and first_sent_at < p_to),
  won as (select * from public.estimates e where e.status = 'accepted' and e.accepted_at >= p_from and e.accepted_at < p_to)
  select jsonb_build_object(
    'sent', (select count(*) from cohort),
    'sent_value_cents', (select coalesce(sum(total_cents), 0) from cohort),
    'sla_hours', (select hours from sla),
    'sla_measured', (select count(*) from cohort where walkthrough_completed_at is not null),
    'sla_met', (select count(*) from cohort, sla
                where walkthrough_completed_at is not null
                  and first_sent_at <= walkthrough_completed_at + make_interval(hours => sla.hours)),
    'cohort_accepted', (select count(*) from cohort where status = 'accepted'),
    'cohort_accepted_value_cents', (select coalesce(sum(total_cents), 0) from cohort where status = 'accepted'),
    'accepted', (select count(*) from won),
    'accepted_value_cents', (select coalesce(sum(total_cents), 0) from won),
    'open', (select count(*) from public.estimates e where e.status in ('sent', 'viewed')),
    'open_value_cents', (select coalesce(sum(e.total_cents), 0) from public.estimates e where e.status in ('sent', 'viewed')),
    'expiring_soon', (select count(*) from public.estimates e where e.status in ('sent', 'viewed')
                        and e.expires_at < now() + interval '5 days'),
    'by_status', coalesce((select jsonb_object_agg(s.status, s.n) from (
       select e.status, count(*) n from public.estimates e group by e.status) s), '{}'::jsonb)
  );
$$;

-- Estimates list tabs.
create or replace function public.estimate_status_counts()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*),
    'open', count(*) filter (where status in ('sent', 'viewed')),
    'by_status', coalesce((select jsonb_object_agg(s.status, s.n) from (
       select e2.status, count(*) n from public.estimates e2 group by e2.status) s), '{}'::jsonb)
  )
  from public.estimates;
$$;

-- Jobs Dashboard reads the contract amount (accepted estimate + change orders,
-- or the baseline when no estimate is accepted).
create or replace function public.job_stats(p_from timestamptz, p_to timestamptz, p_prev_from timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with j as (
    select j.*, f.contract_cents as amount
    from public.jobs j left join public.job_financials f on f.job_id = j.id
  )
  select jsonb_build_object(
    'can_see_money', (select app.has_perm('financials:read')),
    'open_jobs', (select count(*) from j where stage not in ('closed_won', 'closed_lost')),
    'open_jobs_prev', (select count(*) from j where created_at < p_from
                         and (closed_at is null or closed_at >= p_from)),
    'pipeline_value_cents', (select sum(amount) from j where stage not in ('closed_won', 'closed_lost')),
    'in_progress', (select count(*) from j where stage = 'in_progress'),
    'on_hold', (select count(*) from j where status = 'on_hold'),
    'closed_won', (select count(*) from j where stage = 'closed_won' and closed_at >= p_from and closed_at < p_to),
    'closed_won_prev', (select count(*) from j where stage = 'closed_won' and closed_at >= p_prev_from and closed_at < p_from),
    'closed_lost', (select count(*) from j where stage = 'closed_lost' and closed_at >= p_from and closed_at < p_to),
    'sold_count', (select count(*) from j where estimate_accepted_at >= p_from and estimate_accepted_at < p_to),
    'sold_value_cents', (select sum(amount) from j where estimate_accepted_at >= p_from and estimate_accepted_at < p_to),
    'sold_value_prev_cents', (select sum(amount) from j where estimate_accepted_at >= p_prev_from and estimate_accepted_at < p_from),
    'closing_this_period', (select count(*) from j where stage not in ('closed_won', 'closed_lost')
                              and estimated_completion_date >= (p_from at time zone 'America/Los_Angeles')::date
                              and estimated_completion_date < (p_to at time zone 'America/Los_Angeles')::date),
    'by_stage', coalesce((select jsonb_agg(jsonb_build_object('stage', s.stage, 'jobs', s.n, 'value_cents', s.v)
                                           order by app.job_stage_order(s.stage))
                          from (select stage, count(*) n, sum(amount) v from j group by stage) s), '[]'::jsonb),
    'sold_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'jobs', d.n, 'value_cents', d.v) order by d.day)
                             from (select (estimate_accepted_at at time zone 'America/Los_Angeles')::date as day,
                                          count(*) n, sum(amount) v
                                   from j where estimate_accepted_at >= p_from and estimate_accepted_at < p_to
                                   group by 1) d), '[]'::jsonb)
  );
$$;

revoke execute on function public.create_estimate(uuid, text), public.copy_estimate_version(uuid),
  public.estimate_stats(timestamptz, timestamptz), public.estimate_status_counts() from public, anon;
grant execute on function public.create_estimate(uuid, text), public.copy_estimate_version(uuid),
  public.estimate_stats(timestamptz, timestamptz), public.estimate_status_counts() to authenticated, service_role;
grant execute on function app.org_estimate_sla_hours(), app.money_text(bigint) to authenticated, service_role;
