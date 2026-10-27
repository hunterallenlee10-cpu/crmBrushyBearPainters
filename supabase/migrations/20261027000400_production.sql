-- Phase 6: Production (SPEC §5.4, §6.2 gates 6–10, §8.5 #3/#8/#9/#13, §8.6,
-- §8.8, §9, §1.3 promises, §15.1).
--
-- Resources: skills, subcontractors (+ compliance documents), crews, crew
-- members, crew skills, crew availability (time off and company blackouts).
-- Scheduling: work types with default durations, editable work rules,
-- schedule settings (production days, arrival window, recommendation
-- guardrails), schedule entries (drafts until "Publish changes"), rule-based
-- recommendations, weather forecast cache (empty while weather is
-- disconnected), rain delays (never money).
-- Field: daily logs (cleanup done + cleanup photo required), time entries,
-- punch items + customer sign-off, checklist templates / instances / items.
-- On-time guarantee: jobs.guarantee_start_date (the date the promise is
-- measured against) and on_time_credits (drafted for owner approval; Phase 7
-- puts approved credits on the final invoice).
-- Jobs get crew_id; crew members of the job's crews count as "on the job".
-- Gates 6–9 become real (must agree with lib/domain/jobs/gates.ts).
--
-- Purely additive: new tables and columns, replaced functions keep their
-- signatures. Safe on a database with Phases 0–5 applied (existing rows only
-- gain nullable/defaulted columns).
--
-- Rollback: supabase/rollbacks/20261027000400_production.down.sql

-- =============================================================================
-- 0. Helpers
-- =============================================================================

-- Today's date in Pacific time (production days, gates, compliance).
create or replace function app.production_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Los_Angeles')::date;
$$;

-- =============================================================================
-- 1. Resources
-- =============================================================================

-- Skills (SPEC §5.4). Seeded per company; admins add, rename or deactivate.
create table public.skills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (app.is_key(key) and key is not null),
  label text not null check (length(btrim(label)) between 1 and 80),
  description text check (length(description) <= 300),
  is_certification boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, key)
);

-- Subcontractor companies and their compliance (SPEC §5.4, §13.4).
create table public.subcontractors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  company_name text not null check (length(btrim(company_name)) between 1 and 160),
  contact_name text check (length(contact_name) <= 120),
  phone text check (length(phone) <= 40),
  email text check (app.is_email(email)),
  lni_registration text check (length(lni_registration) <= 40),
  lni_expires_on date,
  coi_carrier text check (length(coi_carrier) <= 120),
  coi_expires_on date,
  w9_on_file boolean not null default false,
  bond_on_file boolean not null default false,
  bond_expires_on date,
  rrp_certification text check (length(rrp_certification) <= 60),
  rrp_expires_on date,
  -- active | expiring (something expires within 30 days or has expired) |
  -- suspended (set by a person). Kept current by the guard and the worker.
  status text not null default 'active' check (status in ('active', 'expiring', 'suspended')),
  suspended_reason text check (length(suspended_reason) <= 500),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  check (status <> 'suspended' or suspended_reason is not null)
);
create index subcontractors_org_idx on public.subcontractors (org_id, company_name) where deleted_at is null;

-- Compliance paperwork (COI, L&I, W-9, bond, RRP) in the private documents bucket.
create table public.subcontractor_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  subcontractor_id uuid not null references public.subcontractors (id) on delete cascade,
  kind text not null check (kind in ('coi', 'lni', 'w9', 'bond', 'rrp', 'other')),
  title text not null check (length(btrim(title)) between 1 and 200),
  file_name text not null check (length(file_name) between 1 and 200),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/subcontractors/[0-9a-f-]{36}/[0-9a-z._-]{1,200}$'),
  mime_type text not null check (length(mime_type) <= 100),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  expires_on date,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);
create index subcontractor_documents_sub_idx on public.subcontractor_documents (subcontractor_id, created_at desc)
  where deleted_at is null;
create index subcontractor_documents_org_idx on public.subcontractor_documents (org_id);

create table public.crews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 80),
  crew_type text not null default 'employee' check (crew_type in ('employee', 'subcontractor')),
  subcontractor_id uuid references public.subcontractors (id) on delete restrict,
  lead_user_id uuid references public.profiles (id) on delete set null,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  home_territory_id uuid references public.territories (id) on delete set null,
  -- "Max 1 active job per crew per day unless split" (work rule; per-crew limit).
  max_jobs_per_day smallint not null default 1 check (max_jobs_per_day between 1 and 5),
  daily_capacity_hours numeric(5, 2) not null default 8 check (daily_capacity_hours between 1 and 24),
  active boolean not null default true,
  sort_order integer not null default 0,
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  check (crew_type <> 'subcontractor' or subcontractor_id is not null),
  check (crew_type <> 'employee' or subcontractor_id is null)
);
create unique index crews_org_name_idx on public.crews (org_id, lower(name)) where deleted_at is null;
create index crews_sub_idx on public.crews (subcontractor_id);
create index crews_lead_idx on public.crews (lead_user_id);
create index crews_territory_idx on public.crews (home_territory_id);

create table public.crew_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  crew_id uuid not null references public.crews (id) on delete cascade,
  -- A teammate with a login, or (for subcontractor workers) just a name.
  user_id uuid references public.profiles (id) on delete cascade,
  display_name text check (length(btrim(display_name)) between 1 and 120),
  role text not null default 'painter' check (role in ('lead', 'painter', 'helper')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (user_id is not null or display_name is not null)
);
create unique index crew_members_user_idx on public.crew_members (crew_id, user_id) where user_id is not null;
create index crew_members_user_lookup_idx on public.crew_members (user_id);

create table public.crew_skills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  crew_id uuid not null references public.crews (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  -- Certifications (RRP certified renovator) expire.
  expires_on date,
  note text check (length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (crew_id, skill_id)
);
create index crew_skills_skill_idx on public.crew_skills (skill_id);

-- Time off (a crew or one member) and company blackout dates (no crew, no member).
create table public.crew_availability (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  crew_id uuid references public.crews (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  kind text not null default 'time_off' check (kind in ('time_off', 'blackout')),
  starts_on date not null,
  ends_on date not null,
  reason text check (length(reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 366),
  check (kind <> 'blackout' or (crew_id is null and user_id is null)),
  check (kind <> 'time_off' or crew_id is not null or user_id is not null)
);
create index crew_availability_org_dates_idx on public.crew_availability (org_id, starts_on, ends_on) where deleted_at is null;
create index crew_availability_crew_idx on public.crew_availability (crew_id);
create index crew_availability_user_idx on public.crew_availability (user_id);

-- =============================================================================
-- 2. Scheduling configuration (SPEC §15.1)
-- =============================================================================

-- Scheduling work types with default durations (keys match appointments.type).
create table public.work_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key in (
    'walkthrough', 'color_consultation', 'interior_production', 'exterior_production', 'cabinet_shop',
    'deck_fence', 'pressure_washing', 'rot_repair', 'final_walkthrough', 'touch_up', 'warranty_visit',
    'paint_pickup')),
  label text not null check (length(btrim(label)) between 1 and 80),
  default_minutes integer not null check (default_minutes between 15 and 1440),
  assigned_role text not null check (assigned_role in ('estimator', 'crew', 'pm')),
  required_skill_key text check (app.is_key(required_skill_key)),
  is_production boolean not null default false,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, key)
);

-- Work rules the scheduler enforces (SPEC §15.1). Keys are fixed (each has
-- code in lib/domain/scheduling); owners edit wording, severity, parameters
-- and whether a rule is on.
create table public.work_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key in (
    'walkthrough_before_production', 'deposit_before_scheduling', 'hoa_before_exterior',
    'lead_safe_renovator', 'exterior_in_season', 'weather_forecast', 'max_jobs_per_crew_day',
    'spray_for_cabinets', 'high_access_two_story', 'crew_time_off', 'sub_compliance')),
  label text not null check (length(btrim(label)) between 1 and 120),
  description text check (length(description) <= 500),
  enabled boolean not null default true,
  severity text not null default 'block' check (severity in ('block', 'warn')),
  -- An owner may schedule past it with a reason (e.g. exterior out of season).
  owner_override boolean not null default false,
  requires_weather boolean not null default false,
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, key)
);

create table public.schedule_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  -- ISO days of week crews work (1 = Monday … 7 = Sunday).
  production_days smallint[] not null default '{1,2,3,4,5}'
    check (cardinality(production_days) between 1 and 7 and production_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  day_start time not null default '08:00',
  arrival_window_minutes smallint not null default 30 check (arrival_window_minutes between 0 and 240),
  crew_day_hours numeric(4, 2) not null default 8 check (crew_day_hours between 1 and 16),
  recommendations_require_approval boolean not null default true,
  recommendations_auto_execute boolean not null default false,
  undo_window_minutes smallint not null default 15 check (undo_window_minutes between 1 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  -- Guardrail: nothing runs on its own while approval is required.
  check (not (recommendations_auto_execute and recommendations_require_approval))
);

-- =============================================================================
-- 3. Jobs, work orders, photos: new links
-- =============================================================================

alter table public.jobs
  add column crew_id uuid references public.crews (id) on delete set null,
  -- The start date the on-time guarantee measures (set when the schedule is
  -- published; moves only for weather or a customer request).
  add column guarantee_start_date date,
  add column priority_reschedule_at timestamptz;
create index jobs_crew_idx on public.jobs (crew_id);
create index jobs_priority_reschedule_idx on public.jobs (org_id) where is_priority_reschedule and deleted_at is null;

alter table public.work_orders
  add constraint work_orders_crew_fk foreign key (crew_id) references public.crews (id) on delete set null;

-- =============================================================================
-- 4. Schedule entries (Master Schedule bars; drafts until "Publish changes")
-- =============================================================================

create table public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  work_order_id uuid references public.work_orders (id) on delete set null,
  work_type text not null default 'interior_production' check (work_type in (
    'interior_production', 'exterior_production', 'cabinet_shop', 'deck_fence', 'pressure_washing',
    'rot_repair', 'touch_up')),
  -- draft: never published · published: customers and crews were told · canceled.
  status text not null default 'draft' check (status in ('draft', 'published', 'canceled')),
  -- What was published (written only by Publish).
  crew_id uuid references public.crews (id) on delete set null,
  starts_on date,
  ends_on date,
  published_at timestamptz,
  published_by uuid,
  -- The pending change (null = nothing pending).
  draft_action text check (draft_action in ('create', 'update', 'cancel')),
  draft_crew_id uuid references public.crews (id) on delete set null,
  draft_starts_on date,
  draft_ends_on date,
  -- Why the dates move: company (counts against the on-time promise), weather or customer request.
  draft_reason text check (draft_reason in ('company', 'weather', 'customer')),
  draft_note text check (length(draft_note) <= 500),
  drafted_by uuid,
  drafted_at timestamptz,
  -- "Unless split": the crew may run this job alongside another one that day.
  allow_split boolean not null default false,
  -- Owner override of a work rule (e.g. exterior out of season), with the reason.
  override_rules text[] not null default '{}',
  override_reason text check (length(override_reason) <= 500),
  override_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (starts_on is null or ends_on >= starts_on),
  check (draft_starts_on is null or draft_ends_on >= draft_starts_on),
  check (ends_on is null or ends_on - starts_on <= 120),
  check (draft_ends_on is null or draft_ends_on - draft_starts_on <= 120),
  check (status <> 'draft' or (published_at is null and draft_action = 'create')),
  check (status <> 'published' or (published_at is not null and crew_id is not null and starts_on is not null)),
  check (draft_action is null or draft_action = 'cancel'
         or (draft_crew_id is not null and draft_starts_on is not null and draft_ends_on is not null)),
  check (cardinality(override_rules) = 0 or override_reason is not null)
);
create index schedule_entries_job_idx on public.schedule_entries (job_id) where status <> 'canceled';
create index schedule_entries_org_dates_idx on public.schedule_entries (org_id, starts_on, ends_on) where status = 'published';
create index schedule_entries_org_draft_idx on public.schedule_entries (org_id, draft_starts_on) where draft_action is not null;
create index schedule_entries_crew_idx on public.schedule_entries (crew_id);
create index schedule_entries_draft_crew_idx on public.schedule_entries (draft_crew_id);
create index schedule_entries_wo_idx on public.schedule_entries (work_order_id);

-- Rule-based recommendations (SPEC §8.6): approval required, 15-minute undo.
create table public.schedule_recommendations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('schedule_job', 'assign_crew', 'weather_swap')),
  job_id uuid not null references public.jobs (id) on delete cascade,
  crew_id uuid references public.crews (id) on delete cascade,
  proposed_starts_on date,
  proposed_ends_on date,
  score smallint check (score between 0 and 100),
  title text not null check (length(title) between 1 and 200),
  detail text check (length(detail) <= 1000),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'undone', 'expired')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  executed_entry_id uuid references public.schedule_entries (id) on delete set null,
  -- What approving changed, so Undo can put it back.
  previous jsonb not null default '{}'::jsonb check (jsonb_typeof(previous) = 'object'),
  undo_until timestamptz,
  dedupe_key text not null check (length(dedupe_key) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposed_ends_on is null or proposed_ends_on >= proposed_starts_on)
);
create unique index schedule_recommendations_open_idx on public.schedule_recommendations (org_id, dedupe_key)
  where status = 'pending';
create index schedule_recommendations_job_idx on public.schedule_recommendations (job_id);
create index schedule_recommendations_org_status_idx on public.schedule_recommendations (org_id, status, created_at desc);

-- Forecast cache (WeatherProvider). Stays empty while weather is disconnected.
create table public.weather_forecasts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  territory_id uuid references public.territories (id) on delete cascade,
  provider text not null check (length(provider) <= 40),
  for_hour timestamptz not null,
  precip_probability smallint check (precip_probability between 0 and 100),
  temp_f numeric(5, 1),
  dew_point_f numeric(5, 1),
  short_forecast text check (length(short_forecast) <= 200),
  fetched_at timestamptz not null default now(),
  unique (org_id, territory_id, provider, for_hour)
);
create index weather_forecasts_hour_idx on public.weather_forecasts (org_id, for_hour);

-- Rain-day promise (SPEC §1.3): a marked rain delay never creates a charge
-- (no money here, and on_time_credits refuses a credit for a weather slip).
create table public.rain_delays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  delay_date date not null,
  schedule_entry_id uuid references public.schedule_entries (id) on delete set null,
  note text check (length(note) <= 500),
  marked_by uuid,
  customer_message_id uuid references public.messages (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (job_id, delay_date)
);
create index rain_delays_org_date_idx on public.rain_delays (org_id, delay_date);

-- On-Time Guarantee credits (SPEC §1.3, §10): drafted when a start slips for a
-- reason other than weather; an owner approves or waives; Phase 7 puts the
-- approved amount on the final invoice.
create table public.on_time_credits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null unique references public.jobs (id) on delete cascade,
  amount_cents bigint not null check (amount_cents between 1 and 10000000),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'waived', 'applied')),
  promised_date date not null,
  actual_start_date date,
  reason text not null check (length(reason) between 1 and 500),
  drafted_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 1000),
  invoice_id uuid references public.invoices (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check ((status = 'pending_approval') = (decided_at is null)),
  check (status <> 'waived' or decision_note is not null)
);
create index on_time_credits_org_status_idx on public.on_time_credits (org_id, status);

-- =============================================================================
-- 5. Field: checklists, daily logs, time, punch list
-- =============================================================================

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (app.is_key(key) and key is not null),
  name text not null check (length(btrim(name)) between 1 and 120),
  applies_to text not null check (applies_to in (
    'walkthrough', 'exterior', 'interior', 'cabinets', 'deck_fence', 'lead_safe', 'daily', 'final_walkthrough', 'other')),
  -- [{ key, label, required }]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 60),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, key)
);

create table public.checklist_instances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  template_id uuid references public.checklist_templates (id) on delete set null,
  template_key text check (app.is_key(template_key)),
  job_id uuid not null references public.jobs (id) on delete cascade,
  work_order_id uuid references public.work_orders (id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'open' check (status in ('open', 'complete')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index checklist_instances_job_idx on public.checklist_instances (job_id);
create index checklist_instances_wo_idx on public.checklist_instances (work_order_id);
create index checklist_instances_template_idx on public.checklist_instances (template_id);
create unique index checklist_instances_one_per_wo_idx on public.checklist_instances (work_order_id, template_key)
  where work_order_id is not null;

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  instance_id uuid not null references public.checklist_instances (id) on delete cascade,
  key text not null check (app.is_key(key) and key is not null),
  label text not null check (length(btrim(label)) between 1 and 200),
  required boolean not null default true,
  done boolean not null default false,
  done_by uuid,
  done_at timestamptz,
  note text check (length(note) <= 500),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (instance_id, key)
);

alter table public.work_orders
  add constraint work_orders_checklist_fk foreign key (checklist_instance_id)
    references public.checklist_instances (id) on delete set null;
create index work_orders_checklist_idx on public.work_orders (checklist_instance_id);

-- Daily log (SPEC §1.3 "a photo update every day", "a clean house every
-- evening"). The id may be the offline queue's client id (idempotent upload).
create table public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  work_order_id uuid references public.work_orders (id) on delete set null,
  schedule_entry_id uuid references public.schedule_entries (id) on delete set null,
  log_date date not null,
  author_id uuid references public.profiles (id),
  finished_today text not null check (length(btrim(finished_today)) between 1 and 4000),
  next_up text check (length(next_up) <= 4000),
  issues text check (length(issues) <= 4000),
  weather_observed text check (length(weather_observed) <= 200),
  cleanup_done boolean not null check (cleanup_done),
  cleanup_photo_id uuid not null,
  customer_update_status text not null default 'draft' check (customer_update_status in (
    'draft', 'queued', 'sent', 'simulated', 'skipped')),
  customer_update_note text check (length(customer_update_note) <= 500),
  customer_message_id uuid references public.messages (id) on delete set null,
  sent_at timestamptz,
  source text not null default 'online' check (source in ('online', 'offline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  check (log_date between date '2020-01-01' and date '2100-01-01')
);
create index daily_logs_job_date_idx on public.daily_logs (job_id, log_date desc) where deleted_at is null;
create index daily_logs_org_date_idx on public.daily_logs (org_id, log_date) where deleted_at is null;
create index daily_logs_author_idx on public.daily_logs (author_id);
create index daily_logs_wo_idx on public.daily_logs (work_order_id);
create index daily_logs_entry_idx on public.daily_logs (schedule_entry_id);
create index daily_logs_message_idx on public.daily_logs (customer_message_id);
create index daily_logs_cleanup_photo_idx on public.daily_logs (cleanup_photo_id);

alter table public.job_photos
  add column daily_log_id uuid references public.daily_logs (id) on delete set null,
  add column work_order_id uuid references public.work_orders (id) on delete set null;
create index job_photos_daily_log_idx on public.job_photos (daily_log_id);
create index job_photos_work_order_idx on public.job_photos (work_order_id);
alter table public.daily_logs
  add constraint daily_logs_cleanup_photo_fk foreign key (cleanup_photo_id) references public.job_photos (id);

-- Hours (SPEC §5.4): from the daily log (per crew member) or clocked; job costing reads these.
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  work_order_id uuid references public.work_orders (id) on delete set null,
  daily_log_id uuid references public.daily_logs (id) on delete cascade,
  user_id uuid references public.profiles (id),
  member_name text check (length(btrim(member_name)) between 1 and 120),
  entry_date date not null,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  started_at timestamptz,
  ended_at timestamptz,
  entry_type text not null default 'production' check (entry_type in ('production', 'travel', 'shop')),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  check (user_id is not null or member_name is not null),
  check (ended_at is null or started_at is null or ended_at > started_at),
  check ((approved_by is null) = (approved_at is null))
);
create index time_entries_job_idx on public.time_entries (job_id, entry_date) where deleted_at is null;
create index time_entries_user_idx on public.time_entries (user_id, entry_date);
create index time_entries_log_idx on public.time_entries (daily_log_id);
create index time_entries_wo_idx on public.time_entries (work_order_id);
create index time_entries_org_date_idx on public.time_entries (org_id, entry_date) where deleted_at is null;

create table public.punch_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  area text not null check (length(btrim(area)) between 1 and 120),
  description text not null check (length(btrim(description)) between 1 and 1000),
  photo_id uuid references public.job_photos (id) on delete set null,
  assigned_to uuid references public.profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'fixed', 'customer_waived')),
  fixed_photo_id uuid references public.job_photos (id) on delete set null,
  fixed_at timestamptz,
  fixed_by uuid,
  waived_note text check (length(waived_note) <= 500),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  check (status <> 'customer_waived' or waived_note is not null)
);
create index punch_items_job_idx on public.punch_items (job_id, area) where deleted_at is null;
create index punch_items_open_idx on public.punch_items (org_id) where status = 'open' and deleted_at is null;
create index punch_items_photo_idx on public.punch_items (photo_id);
create index punch_items_fixed_photo_idx on public.punch_items (fixed_photo_id);
create index punch_items_assigned_idx on public.punch_items (assigned_to);

-- The customer's sign-off at the final walkthrough, captured on the crew's device.
create table public.punch_signoffs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  signer_name text not null check (length(btrim(signer_name)) between 2 and 120),
  signature_png text not null check (signature_png ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$'
                                     and length(signature_png) <= 400000),
  signature_sha256 text not null check (signature_sha256 ~ '^[0-9a-f]{64}$'),
  statement text not null check (length(statement) between 10 and 1000),
  open_items integer not null default 0 check (open_items >= 0),
  note text check (length(note) <= 1000),
  signed_at timestamptz not null default now(),
  ip inet,
  user_agent text check (length(user_agent) <= 500),
  captured_by uuid,
  created_at timestamptz not null default now()
);
create index punch_signoffs_job_idx on public.punch_signoffs (job_id, signed_at desc);

-- =============================================================================
-- 6. Guards and bookkeeping
-- =============================================================================

-- People whose crew works the job (the job's crew, and crews on its live
-- schedule entries) count as "on the job" for own-scope visibility.
create or replace function app.job_crew_user_ids(p_job uuid, p_crew uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
  from public.crew_members m
  join public.crews c on c.id = m.crew_id
  where m.user_id is not null and m.active and c.deleted_at is null
    and (m.crew_id = p_crew
         or m.crew_id in (select coalesce(s.draft_crew_id, s.crew_id) from public.schedule_entries s
                          where s.job_id = p_job and s.status <> 'canceled')
         or m.crew_id in (select s.crew_id from public.schedule_entries s
                          where s.job_id = p_job and s.status = 'published'));
$$;

create or replace function app.crew_lead_ids(p_job uuid, p_crew uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct c.lead_user_id), '{}')
  from public.crews c
  where c.lead_user_id is not null and c.deleted_at is null
    and (c.id = p_crew
         or c.id in (select coalesce(s.draft_crew_id, s.crew_id) from public.schedule_entries s
                     where s.job_id = p_job and s.status <> 'canceled'));
$$;

-- Runs after app.jobs_guard (trigger names sort that way): crew assignment,
-- on-time fields and the crew part of the team list.
create or replace function app.jobs_production_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := app.is_trusted() or app.system_update_on();
begin
  if tg_op = 'INSERT' then
    if not v_trusted then
      new.guarantee_start_date := null;
      new.is_priority_reschedule := false;
      new.priority_reschedule_at := null;
      new.on_time_guarantee_status := 'n/a';
      if new.crew_id is not null and not app.can_write('schedule:manage') then
        raise exception 'Only people who manage the schedule can assign a crew.' using errcode = '42501';
      end if;
    end if;
  else
    if not v_trusted then
      if new.crew_id is distinct from old.crew_id and not app.can_write('schedule:manage') then
        raise exception 'Only people who manage the schedule can assign a crew.' using errcode = '42501';
      end if;
      if new.guarantee_start_date is distinct from old.guarantee_start_date then
        raise exception 'The on-time guarantee date is set when the schedule is published.' using errcode = '42501';
      end if;
      if (new.is_priority_reschedule is distinct from old.is_priority_reschedule
          or new.priority_reschedule_at is distinct from old.priority_reschedule_at)
         and not app.can_write('schedule:manage') then
        raise exception 'Rain delays set the priority reschedule flag.' using errcode = '42501';
      end if;
      if new.on_time_guarantee_status is distinct from old.on_time_guarantee_status
         and not app.can_write('job_admin:override') then
        raise exception 'Only owners can change the on-time guarantee status.' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.crew_id is not null and (tg_op = 'INSERT' or new.crew_id is distinct from old.crew_id) then
    perform app.check_same_org(new.org_id, 'crews', new.crew_id, 'Crew');
  end if;
  if new.is_priority_reschedule and (tg_op = 'INSERT' or not old.is_priority_reschedule) then
    new.priority_reschedule_at := coalesce(new.priority_reschedule_at, now());
  elsif not new.is_priority_reschedule then
    new.priority_reschedule_at := null;
  end if;
  new.team_user_ids := array(
    select distinct u from unnest(new.team_user_ids || app.job_crew_user_ids(new.id, new.crew_id)
                                  || app.crew_lead_ids(new.id, new.crew_id)) u
    where u is not null);
  return new;
end;
$$;

-- Re-derives team lists after a crew's people or a job's schedule change.
create or replace function app.refresh_job_teams(p_jobs uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_jobs is null or cardinality(p_jobs) = 0 then
    return;
  end if;
  perform set_config('app.system_update', 'on', true);
  update public.jobs j
     set team_user_ids = app.job_team_ids(j.id, j.owner_id, j.point_of_contact_id, j.project_manager_id)
   where j.id = any(p_jobs);
  perform set_config('app.system_update', 'off', true);
end;
$$;

create or replace function app.jobs_for_crew(p_crew uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select j.id as x from public.jobs j where j.crew_id = p_crew and j.deleted_at is null
    union
    select s.job_id from public.schedule_entries s
    where s.status <> 'canceled' and (s.crew_id = p_crew or s.draft_crew_id = p_crew)
  ) t;
$$;

create or replace function app.crew_people_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refresh_job_teams(app.jobs_for_crew(coalesce(new.crew_id, old.crew_id)));
  if tg_op = 'UPDATE' and new.crew_id is distinct from old.crew_id then
    perform app.refresh_job_teams(app.jobs_for_crew(old.crew_id));
  end if;
  return null;
end;
$$;

create or replace function app.crews_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.lead_user_id is distinct from old.lead_user_id
                           or new.deleted_at is distinct from old.deleted_at) then
    perform app.refresh_job_teams(app.jobs_for_crew(new.id));
  end if;
  return null;
end;
$$;

-- Subcontractor status follows the paperwork (suspended is a person's call).
create or replace function app.subcontractor_status(p public.subcontractors, p_today date)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p.status = 'suspended' then 'suspended'
    when least(p.lni_expires_on, p.coi_expires_on, p.bond_expires_on, p.rrp_expires_on) <= p_today + 30
      or p.lni_expires_on is null or p.coi_expires_on is null or not p.w9_on_file then 'expiring'
    else 'active'
  end;
$$;

create or replace function app.subcontractors_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'A subcontractor cannot move to another organization.' using errcode = '42501';
  end if;
  if new.status <> 'suspended' then
    new.suspended_reason := null;
  end if;
  new.status := app.subcontractor_status(new, app.production_today());
  return new;
end;
$$;

create or replace function app.subcontractor_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'subcontractors', new.subcontractor_id, 'Subcontractor');
    if new.storage_path not like new.org_id::text || '/subcontractors/' || new.subcontractor_id::text || '/%' then
      raise exception 'That file isn''t stored with this subcontractor.' using errcode = '42501';
    end if;
    if not app.is_trusted() then
      new.uploaded_by := app.effective_user_id();
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.subcontractor_id <> old.subcontractor_id or new.storage_path <> old.storage_path
     or new.size_bytes <> old.size_bytes or new.mime_type <> old.mime_type then
    raise exception 'A stored file cannot change.' using errcode = '42501';
  end if;
  new.uploaded_by := old.uploaded_by;
  return new;
end;
$$;

create or replace function app.crews_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'A crew cannot move to another organization.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' or new.subcontractor_id is distinct from old.subcontractor_id then
    perform app.check_same_org(new.org_id, 'subcontractors', new.subcontractor_id, 'Subcontractor');
  end if;
  if tg_op = 'INSERT' or new.lead_user_id is distinct from old.lead_user_id then
    perform app.check_same_org(new.org_id, 'profiles', new.lead_user_id, 'Crew lead');
  end if;
  if tg_op = 'INSERT' or new.home_territory_id is distinct from old.home_territory_id then
    perform app.check_same_org(new.org_id, 'territories', new.home_territory_id, 'Home territory');
  end if;
  return new;
end;
$$;

-- Children of a crew (members, skills, time off) stay in the crew's company.
create or replace function app.crew_child_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  if tg_op = 'UPDATE' and (v_new ->> 'org_id') <> (v_old ->> 'org_id') then
    raise exception 'This record cannot move to another organization.' using errcode = '42501';
  end if;
  if (v_new ->> 'crew_id') is not null and (tg_op = 'INSERT' or (v_new ->> 'crew_id') is distinct from (v_old ->> 'crew_id')) then
    perform app.check_same_org(new.org_id, 'crews', (v_new ->> 'crew_id')::uuid, 'Crew');
  end if;
  if (v_new ->> 'user_id') is not null and (tg_op = 'INSERT' or (v_new ->> 'user_id') is distinct from (v_old ->> 'user_id')) then
    perform app.check_same_org(new.org_id, 'profiles', (v_new ->> 'user_id')::uuid, 'Teammate');
  end if;
  if (v_new ->> 'skill_id') is not null and (tg_op = 'INSERT' or (v_new ->> 'skill_id') is distinct from (v_old ->> 'skill_id')) then
    perform app.check_same_org(new.org_id, 'skills', (v_new ->> 'skill_id')::uuid, 'Skill');
  end if;
  return new;
end;
$$;

-- Schedule entries: people edit the draft; only Publish (trusted) writes what was published.
create or replace function app.schedule_entries_guard()
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
    if not v_trusted then
      new.status := 'draft';
      new.crew_id := null;
      new.starts_on := null;
      new.ends_on := null;
      new.published_at := null;
      new.published_by := null;
      new.draft_action := 'create';
    end if;
  else
    if new.org_id <> old.org_id or new.job_id <> old.job_id then
      raise exception 'A schedule entry cannot move to another job.' using errcode = '42501';
    end if;
    if not v_trusted and (new.status is distinct from old.status or new.crew_id is distinct from old.crew_id
        or new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on
        or new.published_at is distinct from old.published_at or new.published_by is distinct from old.published_by) then
      raise exception 'Published dates change only through Publish changes.' using errcode = '42501';
    end if;
    if not v_trusted and old.status = 'canceled' then
      raise exception 'This schedule entry was canceled.' using errcode = '42501';
    end if;
    if not v_trusted and old.status = 'draft' and new.draft_action is distinct from 'create' then
      raise exception 'An unpublished entry stays a draft until it''s published.' using errcode = '42501';
    end if;
  end if;
  if new.draft_action is not null and not v_trusted then
    new.drafted_by := app.effective_user_id();
    new.drafted_at := now();
  end if;
  if new.draft_action is null then
    new.draft_crew_id := null;
    new.draft_starts_on := null;
    new.draft_ends_on := null;
    new.draft_reason := null;
    new.draft_note := null;
  end if;
  if cardinality(new.override_rules) > 0 and (tg_op = 'INSERT' or new.override_rules is distinct from old.override_rules) then
    if not v_trusted and not app.can_write('job_admin:override') then
      raise exception 'Only owners can schedule past a work rule.' using errcode = '42501';
    end if;
    new.override_by := coalesce(app.effective_user_id(), new.override_by);
  end if;
  if new.work_order_id is not null and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id) then
    if not exists (select 1 from public.work_orders w where w.id = new.work_order_id and w.job_id = new.job_id) then
      raise exception 'The work order must belong to this job.' using errcode = '23514';
    end if;
  end if;
  if new.draft_crew_id is not null and (tg_op = 'INSERT' or new.draft_crew_id is distinct from old.draft_crew_id) then
    perform app.check_same_org(new.org_id, 'crews', new.draft_crew_id, 'Crew');
  end if;
  if new.crew_id is not null and (tg_op = 'INSERT' or new.crew_id is distinct from old.crew_id) then
    perform app.check_same_org(new.org_id, 'crews', new.crew_id, 'Crew');
  end if;
  return new;
end;
$$;

create or replace function app.schedule_entries_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.crew_id is distinct from old.crew_id or new.draft_crew_id is distinct from old.draft_crew_id
     or new.status is distinct from old.status then
    perform app.refresh_job_teams(array[new.job_id]);
  end if;
  return null;
end;
$$;

create or replace function app.schedule_recommendations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_trusted() or app.system_update_on() then
    return new;
  end if;
  -- People only decide (the server executes and records what changed).
  if new.kind <> old.kind or new.job_id <> old.job_id or new.crew_id is distinct from old.crew_id
     or new.proposed_starts_on is distinct from old.proposed_starts_on or new.score is distinct from old.score
     or new.previous <> old.previous or new.executed_entry_id is distinct from old.executed_entry_id
     or new.undo_until is distinct from old.undo_until then
    raise exception 'Recommendations are changed by approving or rejecting them.' using errcode = '42501';
  end if;
  if old.status <> 'pending' or new.status not in ('pending', 'rejected') then
    raise exception 'Approve a recommendation from the Recommendations screen.' using errcode = '42501';
  end if;
  if new.status = 'rejected' then
    new.decided_by := app.effective_user_id();
    new.decided_at := now();
  end if;
  return new;
end;
$$;

-- Rain delays: never money; the job goes to the top of the scheduling tray.
create or replace function app.rain_delays_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    if not app.is_trusted() then
      new.marked_by := app.effective_user_id();
    end if;
    if new.schedule_entry_id is not null
       and not exists (select 1 from public.schedule_entries s where s.id = new.schedule_entry_id and s.job_id = new.job_id) then
      raise exception 'The schedule entry must belong to this job.' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.job_id <> old.job_id or new.delay_date <> old.delay_date then
    raise exception 'A rain delay cannot move.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app.rain_delays_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.system_update', 'on', true);
  update public.jobs set is_priority_reschedule = true
   where id = new.job_id and not is_priority_reschedule;
  perform set_config('app.system_update', 'off', true);
  perform app.log_activity(new.org_id, 'job', new.job_id::text, 'rain_delay',
    'Rain delay marked for ' || to_char(new.delay_date, 'Mon DD, YYYY') || '. First on the schedule when it clears; no cost to the customer.',
    jsonb_build_object('rain_delay_id', new.id, 'date', new.delay_date));
  perform app.emit_event(new.org_id, 'job.rain_delay', 'job', new.job_id::text,
    jsonb_build_object('rain_delay_id', new.id, 'date', new.delay_date));
  return null;
end;
$$;

-- On-time credits: drafted by trusted code only, never for a weather slip.
create or replace function app.on_time_credits_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not (app.is_trusted() or app.system_update_on()) then
      raise exception 'On-time credits are drafted by the system.' using errcode = '42501';
    end if;
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    if exists (select 1 from public.rain_delays d
               where d.job_id = new.job_id and d.delay_date >= new.promised_date
                 and d.delay_date <= coalesce(new.actual_start_date, app.production_today())) then
      raise exception 'A rain delay covers this start date. Weather delays never cost the customer anything.'
        using errcode = '23514';
    end if;
    new.status := 'pending_approval';
    new.decided_by := null;
    new.decided_at := null;
    return new;
  end if;
  if new.org_id <> old.org_id or new.job_id <> old.job_id or new.promised_date <> old.promised_date then
    raise exception 'An on-time credit cannot move.' using errcode = '42501';
  end if;
  if not (app.is_trusted() or app.system_update_on()) then
    if new.amount_cents <> old.amount_cents or new.invoice_id is distinct from old.invoice_id then
      raise exception 'The credit amount comes from Company Settings.' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if old.status <> 'pending_approval' or new.status not in ('approved', 'waived') then
        raise exception 'An owner approves or waives a pending credit.' using errcode = '42501';
      end if;
      new.decided_by := app.effective_user_id();
      new.decided_at := now();
    end if;
  end if;
  return new;
end;
$$;

create or replace function app.on_time_credits_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.log_activity(new.org_id, 'job', new.job_id::text, 'on_time_credit_drafted',
      'On-Time Guarantee credit of ' || app.money_text(new.amount_cents) || ' drafted for owner approval',
      jsonb_build_object('credit_id', new.id));
  elsif new.status is distinct from old.status then
    perform set_config('app.system_update', 'on', true);
    update public.jobs set on_time_guarantee_status = case new.status
        when 'waived' then 'waived_by_owner' when 'applied' then 'credit_applied' else on_time_guarantee_status end
     where id = new.job_id and new.status in ('waived', 'applied');
    perform set_config('app.system_update', 'off', true);
    perform app.log_activity(new.org_id, 'job', new.job_id::text, 'on_time_credit_' || new.status,
      'On-Time Guarantee credit ' || replace(new.status, '_', ' ')
        || coalesce(': ' || new.decision_note, ''),
      jsonb_build_object('credit_id', new.id, 'status', new.status));
  end if;
  return null;
end;
$$;

-- Daily logs: stamped author, photo on the same job, customer-update fields by trusted code.
create or replace function app.daily_logs_guard()
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
    if not v_trusted then
      new.author_id := app.effective_user_id();
      new.customer_update_status := 'draft';
      new.customer_message_id := null;
      new.sent_at := null;
    end if;
  else
    if new.org_id <> old.org_id or new.job_id <> old.job_id then
      raise exception 'A daily log cannot move to another job.' using errcode = '42501';
    end if;
    if not v_trusted then
      new.author_id := old.author_id;
      new.source := old.source;
      if new.customer_update_status is distinct from old.customer_update_status
         or new.customer_message_id is distinct from old.customer_message_id or new.sent_at is distinct from old.sent_at then
        raise exception 'The customer update is sent by the system.' using errcode = '42501';
      end if;
      if new.log_date <> old.log_date then
        raise exception 'A daily log''s date cannot change.' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' or new.cleanup_photo_id is distinct from old.cleanup_photo_id then
    if not exists (select 1 from public.job_photos p where p.id = new.cleanup_photo_id and p.job_id = new.job_id) then
      raise exception 'The cleanup photo must be one of this job''s photos.' using errcode = '23514';
    end if;
  end if;
  if new.work_order_id is not null and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id)
     and not exists (select 1 from public.work_orders w where w.id = new.work_order_id and w.job_id = new.job_id) then
    raise exception 'The work order must belong to this job.' using errcode = '23514';
  end if;
  if new.schedule_entry_id is not null and (tg_op = 'INSERT' or new.schedule_entry_id is distinct from old.schedule_entry_id)
     and not exists (select 1 from public.schedule_entries s where s.id = new.schedule_entry_id and s.job_id = new.job_id) then
    raise exception 'The schedule entry must belong to this job.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.daily_logs_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.log_activity(new.org_id, 'job', new.job_id::text, 'daily_log',
      'Daily log for ' || to_char(new.log_date, 'Mon DD, YYYY') || ': ' || left(new.finished_today, 160),
      jsonb_build_object('daily_log_id', new.id, 'date', new.log_date));
    perform app.emit_event(new.org_id, 'daily_log.submitted', 'daily_log', new.id::text,
      jsonb_build_object('job_id', new.job_id, 'date', new.log_date));
  end if;
  return null;
end;
$$;

create or replace function app.time_entries_guard()
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
    if not v_trusted then
      new.approved_by := null;
      new.approved_at := null;
    end if;
  else
    if new.org_id <> old.org_id or new.job_id <> old.job_id then
      raise exception 'Hours cannot move to another job.' using errcode = '42501';
    end if;
    if not v_trusted then
      if (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
        if not app.can_write('time_entries:approve') then
          raise exception 'Only people who approve hours can approve them.' using errcode = '42501';
        end if;
        if new.approved_at is not null then
          new.approved_by := app.effective_user_id();
          new.approved_at := now();
        end if;
      elsif old.approved_at is not null and not app.can_write('time_entries:approve') then
        raise exception 'Approved hours can only be changed by someone who approves hours.' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.user_id is not null and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    perform app.check_same_org(new.org_id, 'profiles', new.user_id, 'Teammate');
  end if;
  if new.daily_log_id is not null and (tg_op = 'INSERT' or new.daily_log_id is distinct from old.daily_log_id)
     and not exists (select 1 from public.daily_logs d where d.id = new.daily_log_id and d.job_id = new.job_id) then
    raise exception 'The daily log must belong to this job.' using errcode = '23514';
  end if;
  if new.work_order_id is not null and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id)
     and not exists (select 1 from public.work_orders w where w.id = new.work_order_id and w.job_id = new.job_id) then
    raise exception 'The work order must belong to this job.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.punch_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
  elsif new.org_id <> old.org_id or new.job_id <> old.job_id then
    raise exception 'A punch item cannot move to another job.' using errcode = '42501';
  end if;
  if new.photo_id is not null and (tg_op = 'INSERT' or new.photo_id is distinct from old.photo_id)
     and not exists (select 1 from public.job_photos p where p.id = new.photo_id and p.job_id = new.job_id) then
    raise exception 'The photo must be one of this job''s photos.' using errcode = '23514';
  end if;
  if new.fixed_photo_id is not null and (tg_op = 'INSERT' or new.fixed_photo_id is distinct from old.fixed_photo_id)
     and not exists (select 1 from public.job_photos p where p.id = new.fixed_photo_id and p.job_id = new.job_id) then
    raise exception 'The photo must be one of this job''s photos.' using errcode = '23514';
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform app.check_same_org(new.org_id, 'profiles', new.assigned_to, 'Assignee');
  end if;
  if new.status = 'fixed' then
    if tg_op = 'INSERT' or old.status <> 'fixed' then
      new.fixed_at := now();
      new.fixed_by := app.effective_user_id();
    end if;
  else
    new.fixed_at := null;
    new.fixed_by := null;
  end if;
  if new.status <> 'customer_waived' then
    new.waived_note := null;
  end if;
  return new;
end;
$$;

create or replace function app.punch_items_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.log_activity(new.org_id, 'job', new.job_id::text, 'punch_item_added',
      'Punch item added · ' || new.area || ': ' || left(new.description, 120), jsonb_build_object('punch_item_id', new.id));
  elsif new.status is distinct from old.status then
    perform app.log_activity(new.org_id, 'job', new.job_id::text, 'punch_item_' || new.status,
      'Punch item ' || replace(new.status, '_', ' ') || ' · ' || new.area || ': ' || left(new.description, 120),
      jsonb_build_object('punch_item_id', new.id, 'status', new.status));
  end if;
  return null;
end;
$$;

create or replace function app.punch_signoffs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
  if not app.is_trusted() then
    new.captured_by := app.effective_user_id();
    new.signed_at := now();
  end if;
  new.open_items := (select count(*) from public.punch_items p
                     where p.job_id = new.job_id and p.status = 'open' and p.deleted_at is null);
  return new;
end;
$$;

create or replace function app.punch_signoffs_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.log_activity(new.org_id, 'job', new.job_id::text, 'customer_signoff',
    new.signer_name || ' signed off on the final walkthrough'
      || case when new.open_items > 0 then ' (' || new.open_items || ' open item' || case when new.open_items = 1 then '' else 's' end || ' accepted as is)' else '' end,
    jsonb_build_object('signoff_id', new.id, 'open_items', new.open_items));
  perform app.emit_event(new.org_id, 'job.customer_signed_off', 'job', new.job_id::text,
    jsonb_build_object('signoff_id', new.id));
  return null;
end;
$$;

-- Checklists.
create or replace function app.checklist_instances_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
  elsif new.org_id <> old.org_id or new.job_id <> old.job_id then
    raise exception 'A checklist cannot move to another job.' using errcode = '42501';
  end if;
  if new.work_order_id is not null and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id)
     and not exists (select 1 from public.work_orders w where w.id = new.work_order_id and w.job_id = new.job_id) then
    raise exception 'The work order must belong to this job.' using errcode = '23514';
  end if;
  if new.status = 'complete' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create or replace function app.checklist_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select i.org_id into v_org from public.checklist_instances i where i.id = new.instance_id;
  if v_org is null or v_org <> new.org_id then
    raise exception 'The checklist does not belong to this organization.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.instance_id <> old.instance_id or new.key <> old.key then
      raise exception 'A checklist item cannot move.' using errcode = '42501';
    end if;
    if not (app.is_trusted() or app.system_update_on()) then
      new.label := old.label;
      new.required := old.required;
    end if;
  end if;
  if new.done then
    if tg_op = 'INSERT' or not old.done then
      new.done_at := now();
      new.done_by := app.effective_user_id();
    end if;
  else
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end;
$$;

create or replace function app.checklist_items_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance uuid := new.instance_id;
begin
  perform set_config('app.system_update', 'on', true);
  update public.checklist_instances i set status = case
      when exists (select 1 from public.checklist_items x where x.instance_id = v_instance and x.required and not x.done)
      then 'open' else 'complete' end
   where i.id = v_instance;
  perform set_config('app.system_update', 'off', true);
  return null;
end;
$$;

-- Photos may hang off a daily log or a work order of the same job.
create or replace function app.job_photos_links_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.daily_log_id is not null and (tg_op = 'INSERT' or new.daily_log_id is distinct from old.daily_log_id)
     and not exists (select 1 from public.daily_logs d where d.id = new.daily_log_id and d.job_id = new.job_id) then
    raise exception 'The daily log must belong to this job.' using errcode = '23514';
  end if;
  if new.work_order_id is not null and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id)
     and not exists (select 1 from public.work_orders w where w.id = new.work_order_id and w.job_id = new.job_id) then
    raise exception 'The work order must belong to this job.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Generic: rows that stay in one company and reference this company's records.
create or replace function app.org_config_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(new) ->> 'org_id' <> to_jsonb(old) ->> 'org_id' then
    raise exception 'This setting cannot move to another organization.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and tg_table_name in ('work_rules', 'work_types', 'skills', 'checklist_templates')
     and to_jsonb(new) ->> 'key' <> to_jsonb(old) ->> 'key' then
    raise exception 'The key of a setting never changes.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 7. Triggers
-- =============================================================================

create trigger jobs_production_guard before insert or update on public.jobs
  for each row execute function app.jobs_production_guard();

create trigger subcontractors_guard before insert or update on public.subcontractors
  for each row execute function app.subcontractors_guard();
create trigger subcontractor_documents_guard before insert or update on public.subcontractor_documents
  for each row execute function app.subcontractor_documents_guard();
create trigger crews_guard before insert or update on public.crews
  for each row execute function app.crews_guard();
create trigger crews_after after update on public.crews
  for each row execute function app.crews_after();
create trigger crew_members_guard before insert or update on public.crew_members
  for each row execute function app.crew_child_guard();
create trigger crew_members_after after insert or update or delete on public.crew_members
  for each row execute function app.crew_people_after();
create trigger crew_skills_guard before insert or update on public.crew_skills
  for each row execute function app.crew_child_guard();
create trigger crew_availability_guard before insert or update on public.crew_availability
  for each row execute function app.crew_child_guard();
create trigger schedule_entries_guard before insert or update on public.schedule_entries
  for each row execute function app.schedule_entries_guard();
create trigger schedule_entries_after after insert or update on public.schedule_entries
  for each row execute function app.schedule_entries_after();
create trigger schedule_recommendations_guard before update on public.schedule_recommendations
  for each row execute function app.schedule_recommendations_guard();
create trigger rain_delays_guard before insert or update on public.rain_delays
  for each row execute function app.rain_delays_guard();
create trigger rain_delays_after after insert on public.rain_delays
  for each row execute function app.rain_delays_after();
create trigger on_time_credits_guard before insert or update on public.on_time_credits
  for each row execute function app.on_time_credits_guard();
create trigger on_time_credits_after after insert or update on public.on_time_credits
  for each row execute function app.on_time_credits_after();
create trigger daily_logs_guard before insert or update on public.daily_logs
  for each row execute function app.daily_logs_guard();
create trigger daily_logs_after after insert on public.daily_logs
  for each row execute function app.daily_logs_after();
create trigger time_entries_guard before insert or update on public.time_entries
  for each row execute function app.time_entries_guard();
create trigger punch_items_guard before insert or update on public.punch_items
  for each row execute function app.punch_items_guard();
create trigger punch_items_after after insert or update on public.punch_items
  for each row execute function app.punch_items_after();
create trigger punch_signoffs_guard before insert on public.punch_signoffs
  for each row execute function app.punch_signoffs_guard();
create trigger punch_signoffs_after after insert on public.punch_signoffs
  for each row execute function app.punch_signoffs_after();
create trigger punch_signoffs_immutable before update or delete on public.punch_signoffs
  for each row execute function app.deny_write_allow_trusted_delete();
create trigger checklist_instances_guard before insert or update on public.checklist_instances
  for each row execute function app.checklist_instances_guard();
create trigger checklist_items_guard before insert or update on public.checklist_items
  for each row execute function app.checklist_items_guard();
create trigger checklist_items_after after insert or update on public.checklist_items
  for each row execute function app.checklist_items_after();
create trigger job_photos_links_guard before insert or update on public.job_photos
  for each row execute function app.job_photos_links_guard();
create trigger skills_guard before update on public.skills
  for each row execute function app.org_config_guard();
create trigger work_types_guard before update on public.work_types
  for each row execute function app.org_config_guard();
create trigger work_rules_guard before update on public.work_rules
  for each row execute function app.org_config_guard();
create trigger checklist_templates_guard before update on public.checklist_templates
  for each row execute function app.org_config_guard();
create trigger schedule_settings_guard before update on public.schedule_settings
  for each row execute function app.org_config_guard();

do $$
declare
  t text;
begin
  foreach t in array array[
    'skills', 'subcontractors', 'subcontractor_documents', 'crews', 'crew_members', 'crew_skills',
    'crew_availability', 'work_types', 'work_rules', 'schedule_settings', 'schedule_entries',
    'schedule_recommendations', 'rain_delays', 'on_time_credits', 'checklist_templates',
    'checklist_instances', 'checklist_items', 'daily_logs', 'time_entries', 'punch_items'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
    if t <> 'schedule_recommendations' then
      execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function app.stamp_actor()', t, t);
    end if;
  end loop;
end
$$;

-- Audit.
do $$
declare
  t text;
begin
  foreach t in array array[
    'skills', 'subcontractors', 'subcontractor_documents', 'crews', 'crew_members', 'crew_skills',
    'crew_availability', 'work_types', 'work_rules', 'schedule_settings', 'schedule_entries',
    'schedule_recommendations', 'rain_delays', 'on_time_credits', 'checklist_templates',
    'checklist_instances', 'checklist_items', 'daily_logs', 'time_entries', 'punch_items'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end
$$;
create trigger punch_signoffs_audit after insert or update or delete on public.punch_signoffs
  for each row execute function app.audit_row('signature_png');
create trigger weather_forecasts_audit after insert or update or delete on public.weather_forecasts
  for each row execute function app.audit_row();

-- Domain events.
create trigger skills_event after insert or update on public.skills
  for each row execute function app.emit_change_event('skill');
create trigger subcontractors_event after insert or update or delete on public.subcontractors
  for each row execute function app.emit_change_event('subcontractor');
create trigger subcontractor_documents_event after insert or update on public.subcontractor_documents
  for each row execute function app.emit_change_event('subcontractor_document');
create trigger crews_event after insert or update or delete on public.crews
  for each row execute function app.emit_change_event('crew');
create trigger crew_members_event after insert or update or delete on public.crew_members
  for each row execute function app.emit_change_event('crew_member');
create trigger crew_skills_event after insert or update or delete on public.crew_skills
  for each row execute function app.emit_change_event('crew_skill');
create trigger crew_availability_event after insert or update or delete on public.crew_availability
  for each row execute function app.emit_change_event('crew_availability');
create trigger work_types_event after insert or update on public.work_types
  for each row execute function app.emit_change_event('work_type');
create trigger work_rules_event after insert or update on public.work_rules
  for each row execute function app.emit_change_event('work_rule');
create trigger schedule_settings_event after update on public.schedule_settings
  for each row execute function app.emit_change_event('schedule_settings');
create trigger schedule_entries_event after insert or update or delete on public.schedule_entries
  for each row execute function app.emit_change_event('schedule_entry');
create trigger schedule_recommendations_event after insert or update on public.schedule_recommendations
  for each row execute function app.emit_change_event('schedule_recommendation', 'reasons', 'previous');
create trigger on_time_credits_event after insert or update on public.on_time_credits
  for each row execute function app.emit_change_event('on_time_credit');
create trigger checklist_templates_event after insert or update on public.checklist_templates
  for each row execute function app.emit_change_event('checklist_template');
create trigger checklist_items_event after update on public.checklist_items
  for each row execute function app.emit_change_event('checklist_item');
create trigger daily_logs_event after update or delete on public.daily_logs
  for each row execute function app.emit_change_event('daily_log');
create trigger time_entries_event after insert or update or delete on public.time_entries
  for each row execute function app.emit_change_event('time_entry');
create trigger punch_items_event after insert or update or delete on public.punch_items
  for each row execute function app.emit_change_event('punch_item');

-- =============================================================================
-- 8. Row level security
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'skills', 'subcontractors', 'subcontractor_documents', 'crews', 'crew_members', 'crew_skills',
    'crew_availability', 'work_types', 'work_rules', 'schedule_settings', 'schedule_entries',
    'schedule_recommendations', 'weather_forecasts', 'rain_delays', 'on_time_credits',
    'checklist_templates', 'checklist_instances', 'checklist_items', 'daily_logs', 'time_entries',
    'punch_items', 'punch_signoffs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- Written only by trusted code (Publish, the worker, the sign-off capture route).
revoke insert, update, delete on public.weather_forecasts, public.on_time_credits from authenticated;
grant update (status, decision_note) on public.on_time_credits to authenticated;
revoke insert, delete on public.schedule_recommendations, public.schedule_settings, public.work_types,
  public.work_rules from authenticated;
revoke delete on public.skills, public.subcontractors, public.subcontractor_documents, public.crews,
  public.crew_availability, public.schedule_entries, public.rain_delays, public.checklist_templates,
  public.checklist_instances, public.daily_logs, public.time_entries, public.punch_items from authenticated;
revoke update, delete on public.punch_signoffs from authenticated;

-- Configuration: anyone who reads the schedule reads it; Schedule Admin (settings:manage) edits it.
create policy skills_select on public.skills for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy skills_insert on public.skills for insert to authenticated
  with check (org_id = (select app.current_org_id())
              and ((select app.can_write('settings:manage')) or (select app.can_write('crews:manage'))));
create policy skills_update on public.skills for update to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.can_write('settings:manage')) or (select app.can_write('crews:manage'))))
  with check (org_id = (select app.current_org_id()));

create policy work_types_select on public.work_types for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy work_types_update on public.work_types for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));
create policy work_rules_select on public.work_rules for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy work_rules_update on public.work_rules for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));
create policy schedule_settings_select on public.schedule_settings for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy schedule_settings_update on public.schedule_settings for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));
create policy checklist_templates_select on public.checklist_templates for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy checklist_templates_insert on public.checklist_templates for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')));
create policy checklist_templates_update on public.checklist_templates for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));

-- Resources: crews:read or schedule:read sees crews; crews:manage edits them.
create policy subcontractors_select on public.subcontractors for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and ((select app.has_perm('crews:read')) or (select app.has_perm('schedule:read'))));
create policy subcontractors_insert on public.subcontractors for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('crews:manage')));
create policy subcontractors_update on public.subcontractors for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('crews:manage')))
  with check (org_id = (select app.current_org_id()));
-- Compliance paperwork: people who manage crews (it carries tax and insurance details).
create policy subcontractor_documents_select on public.subcontractor_documents for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.has_perm('crews:manage')));
create policy subcontractor_documents_insert on public.subcontractor_documents for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('crews:manage')));
create policy subcontractor_documents_update on public.subcontractor_documents for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('crews:manage')))
  with check (org_id = (select app.current_org_id()));

create policy crews_select on public.crews for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and ((select app.has_perm('crews:read')) or (select app.has_perm('schedule:read'))));
create policy crews_insert on public.crews for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('crews:manage')));
create policy crews_update on public.crews for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('crews:manage')))
  with check (org_id = (select app.current_org_id()));
create policy crew_members_select on public.crew_members for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.has_perm('crews:read')) or (select app.has_perm('schedule:read'))));
create policy crew_members_insert on public.crew_members for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('crews:manage')));
create policy crew_members_update on public.crew_members for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('crews:manage')))
  with check (org_id = (select app.current_org_id()));
create policy crew_members_delete on public.crew_members for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('crews:manage')));
create policy crew_skills_select on public.crew_skills for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.has_perm('crews:read')) or (select app.has_perm('schedule:read'))));
create policy crew_skills_insert on public.crew_skills for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('crews:manage')));
create policy crew_skills_update on public.crew_skills for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('crews:manage')))
  with check (org_id = (select app.current_org_id()));
create policy crew_skills_delete on public.crew_skills for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('crews:manage')));
create policy crew_availability_select on public.crew_availability for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and ((select app.has_perm('crews:read')) or (select app.has_perm('schedule:read'))));
create policy crew_availability_insert on public.crew_availability for insert to authenticated
  with check (org_id = (select app.current_org_id())
              and ((select app.can_write('crews:manage')) or (select app.can_write('schedule:manage'))));
create policy crew_availability_update on public.crew_availability for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and ((select app.can_write('crews:manage')) or (select app.can_write('schedule:manage'))))
  with check (org_id = (select app.current_org_id()));

-- Schedule: everyone with schedule:read sees the bars (job names follow job
-- row security on their own); schedule:manage drafts changes.
create policy schedule_entries_select on public.schedule_entries for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('schedule:read')));
create policy schedule_entries_insert on public.schedule_entries for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('schedule:manage'))
              and exists (select 1 from public.jobs j where j.id = job_id));
create policy schedule_entries_update on public.schedule_entries for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('schedule:manage')))
  with check (org_id = (select app.current_org_id()));
create policy schedule_recommendations_select on public.schedule_recommendations for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('schedule:manage')));
create policy schedule_recommendations_update on public.schedule_recommendations for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('schedule:manage')))
  with check (org_id = (select app.current_org_id()));
create policy weather_forecasts_select on public.weather_forecasts for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('schedule:read')));

-- Rain delays: schedulers, or a crew lead on the job.
create policy rain_delays_select on public.rain_delays for select to authenticated
  using (org_id = (select app.current_org_id()) and exists (select 1 from public.jobs j where j.id = job_id));
create policy rain_delays_insert on public.rain_delays for insert to authenticated
  with check (org_id = (select app.current_org_id())
              and ((select app.can_write('schedule:manage'))
                   or ((select app.can_write('daily_logs:create'))
                       and app.job_in_scope((select app.perm_scope('daily_logs:read')), job_id))));
create policy rain_delays_update on public.rain_delays for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('schedule:manage')))
  with check (org_id = (select app.current_org_id()));

-- On-time credits are money: financials:read to see, credits:approve to decide.
create policy on_time_credits_select on public.on_time_credits for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('financials:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy on_time_credits_update on public.on_time_credits for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('credits:approve')))
  with check (org_id = (select app.current_org_id()));

-- Checklists follow the job; the crew and the office tick items.
create policy checklist_instances_select on public.checklist_instances for select to authenticated
  using (org_id = (select app.current_org_id()) and exists (select 1 from public.jobs j where j.id = job_id));
create policy checklist_instances_insert on public.checklist_instances for insert to authenticated
  with check (org_id = (select app.current_org_id())
              and ((select app.can_write('work_orders:manage')) or app.can_edit_subject('job', job_id)));
create policy checklist_instances_update on public.checklist_instances for update to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.can_write('work_orders:manage')) or app.can_edit_subject('job', job_id)))
  with check (org_id = (select app.current_org_id()));
create policy checklist_items_select on public.checklist_items for select to authenticated
  using (org_id = (select app.current_org_id())
         and exists (select 1 from public.checklist_instances i where i.id = instance_id));
create policy checklist_items_insert on public.checklist_items for insert to authenticated
  with check (org_id = (select app.current_org_id())
              and exists (select 1 from public.checklist_instances i
                          where i.id = instance_id
                            and ((select app.can_write('work_orders:manage')) or app.can_edit_subject('job', i.job_id))));
create policy checklist_items_update on public.checklist_items for update to authenticated
  using (org_id = (select app.current_org_id())
         and exists (select 1 from public.checklist_instances i
                     where i.id = instance_id
                       and ((select app.can_write('work_orders:manage'))
                            or (select app.can_write('daily_logs:create'))
                            or app.can_edit_subject('job', i.job_id))))
  with check (org_id = (select app.current_org_id()));

-- Daily logs: daily_logs:read at its scope; crew leads (daily_logs:create) post on jobs they're on.
create policy daily_logs_select on public.daily_logs for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.has_perm('daily_logs:read'))
         and app.job_in_scope((select app.perm_scope('daily_logs:read')), job_id));
create policy daily_logs_insert on public.daily_logs for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null
              and (select app.can_write('daily_logs:create'))
              and exists (select 1 from public.jobs j where j.id = job_id));
create policy daily_logs_update on public.daily_logs for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('daily_logs:create'))
         and (author_id = (select app.effective_user_id()) or (select app.can_write('schedule:manage'))))
  with check (org_id = (select app.current_org_id()));

-- Hours: your own, the log you wrote, or everyone's for people who approve hours.
create policy time_entries_select on public.time_entries for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and (user_id = (select app.effective_user_id())
              or (select app.has_perm('time_entries:approve'))
              or (select app.has_perm('job_costing:read'))
              or ((select app.has_perm('daily_logs:read'))
                  and app.job_in_scope((select app.perm_scope('daily_logs:read')), job_id))));
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null
              and (select app.can_write('time_entries:create'))
              and exists (select 1 from public.jobs j where j.id = job_id)
              and (user_id = (select app.effective_user_id())
                   or (select app.can_write('daily_logs:create'))
                   or (select app.can_write('time_entries:approve'))));
create policy time_entries_update on public.time_entries for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and ((user_id = (select app.effective_user_id()) and (select app.can_write('time_entries:create')))
              or (select app.can_write('time_entries:approve'))))
  with check (org_id = (select app.current_org_id()));

-- Punch list: everyone on the job sees it; punch_list:manage edits it.
create policy punch_items_select on public.punch_items for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy punch_items_insert on public.punch_items for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null
              and (select app.can_write('punch_list:manage'))
              and exists (select 1 from public.jobs j where j.id = job_id));
create policy punch_items_update on public.punch_items for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and (select app.can_write('punch_list:manage'))
         and exists (select 1 from public.jobs j where j.id = job_id))
  with check (org_id = (select app.current_org_id()));
create policy punch_signoffs_select on public.punch_signoffs for select to authenticated
  using (org_id = (select app.current_org_id()) and exists (select 1 from public.jobs j where j.id = job_id));
create policy punch_signoffs_insert on public.punch_signoffs for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('punch_list:manage'))
              and exists (select 1 from public.jobs j where j.id = job_id));

-- =============================================================================
-- 9. Stage gates 6–9 are real (must agree with lib/domain/jobs/gates.ts)
-- =============================================================================

-- Live paint orders that aren't picked up or delivered yet.
create or replace function app.job_materials_ready(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.paint_orders o
                     where o.job_id = p_job and o.deleted_at is null
                       and o.status not in ('picked_up', 'delivered', 'canceled'));
$$;

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
    -- Every required onboarding item is cleared and no hold blocks scheduling.
    when 'onboarding' then app.onboarding_cleared(p_job)
      and not exists (select 1 from public.job_holds h
                      where h.job_id = p_job and h.released_at is null and h.blocks_scheduling)
    -- Production dates are published on the Master Schedule.
    when 'ready_to_schedule' then exists (
      select 1 from public.schedule_entries s where s.job_id = p_job and s.status = 'published')
    -- Paint and materials are picked up or delivered, and the first published day has arrived (Pacific).
    when 'scheduled' then app.job_materials_ready(p_job)
      and exists (select 1 from public.schedule_entries s
                  where s.job_id = p_job and s.status = 'published' and s.starts_on <= app.production_today())
    -- Every live work order is complete (and there is at least one).
    when 'in_progress' then exists (
      select 1 from public.work_orders w where w.job_id = p_job and w.deleted_at is null and w.status <> 'canceled')
      and not exists (
      select 1 from public.work_orders w where w.job_id = p_job and w.deleted_at is null
        and w.status not in ('completed', 'canceled'))
    -- The customer signed off, or the final walkthrough is done and no punch item is open.
    when 'final_walkthrough' then exists (select 1 from public.punch_signoffs p where p.job_id = p_job)
      or (exists (select 1 from public.appointments a
                  where a.job_id = p_job and a.type = 'final_walkthrough' and a.status = 'completed'
                    and a.deleted_at is null)
          and not exists (select 1 from public.punch_items p
                          where p.job_id = p_job and p.status = 'open' and p.deleted_at is null))
    when 'paid_in_full' then true
    else false
  end;
$$;
revoke execute on function app.job_gate_passes(uuid, text) from public, anon, authenticated;
grant execute on function app.job_gate_passes(uuid, text) to service_role;
-- Callable by people (production_stats() runs as the caller); it only answers yes/no.
revoke execute on function app.job_materials_ready(uuid) from public, anon;
grant execute on function app.job_materials_ready(uuid) to authenticated, service_role;

-- =============================================================================
-- 10. Production numbers (metrics registry source; caller's row security)
-- =============================================================================

create or replace function public.production_stats()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := app.production_today();
  v_now_local timestamp := now() at time zone 'America/Los_Angeles';
  v_days smallint[];
  v_crew_hours numeric;
  v_cutoff integer;
  v_money boolean := app.has_perm('financials:read');
  v_out jsonb;
begin
  select coalesce(s.production_days, '{1,2,3,4,5}'), coalesce(s.crew_day_hours, 8)
    into v_days, v_crew_hours
  from public.schedule_settings s where s.org_id = app.current_org_id();
  v_days := coalesce(v_days, '{1,2,3,4,5}');
  v_crew_hours := coalesce(v_crew_hours, 8);
  select coalesce((r.thresholds ->> 'cutoff_hour')::integer, 19) into v_cutoff
  from public.attention_rules r where r.org_id = app.current_org_id() and r.rule_key = 'missed_daily_update';
  v_cutoff := coalesce(v_cutoff, 19);

  with jobs as (
    select j.* from public.jobs j where j.deleted_at is null
  ),
  published as (
    select s.* from public.schedule_entries s join jobs j on j.id = s.job_id where s.status = 'published'
  ),
  live as (
    select s.job_id from public.schedule_entries s join jobs j on j.id = s.job_id
    where s.status = 'published' or s.draft_action = 'create'
  ),
  first_start as (
    select job_id, min(starts_on) as starts_on from published group by job_id
  ),
  -- Production days already due (before today, or today after the cutoff) in the last 30 days.
  due_days as (
    select distinct p.job_id, d::date as day
    from published p
    cross join lateral generate_series(greatest(p.starts_on, v_today - 30), least(p.ends_on, v_today), interval '1 day') d
    where extract(isodow from d)::smallint = any(v_days)
      and (d::date < v_today or extract(hour from v_now_local) >= v_cutoff)
      and not exists (select 1 from public.rain_delays r where r.job_id = p.job_id and r.delay_date = d::date)
  ),
  logged as (
    select distinct l.job_id, l.log_date from public.daily_logs l where l.log_date >= v_today - 30
  ),
  started as (
    select j.id, j.guarantee_start_date, j.actual_start_date, j.on_time_guarantee_status from jobs j
    where j.guarantee_start_date is not null and j.actual_start_date is not null
      and j.actual_start_date >= v_today - 90
  ),
  done_jobs as (
    select j.id from jobs j where j.completed_at >= now() - interval '90 days'
  ),
  at_risk as (
    select j.id from jobs j join first_start f on f.job_id = j.id
    where j.stage = 'scheduled' and f.starts_on <= v_today + 7
      and (j.crew_id is null or j.blocking_hold_count > 0 or not app.job_materials_ready(j.id)
           or f.starts_on < v_today)
  ),
  backlog_wo as (
    select w.budgeted_hours from public.work_orders w join jobs j on j.id = w.job_id
    where w.deleted_at is null and w.status not in ('completed', 'canceled')
      and j.stage in ('ready_to_schedule', 'scheduled', 'in_progress')
  )
  select jsonb_build_object(
    'ready_to_schedule', (select count(*) from jobs where stage = 'ready_to_schedule'),
    'scheduled', (select count(*) from jobs where stage = 'scheduled'),
    'in_progress', (select count(*) from jobs where stage = 'in_progress'),
    'final_walkthrough', (select count(*) from jobs where stage = 'final_walkthrough'),
    'unscheduled', (select count(*) from jobs j where j.stage = 'ready_to_schedule'
                    and not exists (select 1 from live l where l.job_id = j.id)),
    'priority_reschedule', (select count(*) from jobs where is_priority_reschedule
                            and stage not in ('closed_won', 'closed_lost')),
    'at_risk', (select count(*) from at_risk),
    'completed_this_week', (select count(*) from jobs
                            where (completed_at at time zone 'America/Los_Angeles')::date >= date_trunc('week', v_today)::date),
    'starts_this_week', (select count(*) from first_start f join jobs j on j.id = f.job_id
                         where j.stage = 'scheduled' and f.starts_on between v_today and v_today + 6),
    'crews_active', (select count(*) from public.crews c where c.active and c.deleted_at is null),
    'scheduled_revenue_next_30_cents', case when v_money then (
        select coalesce(sum(f2.contract_cents), 0) from first_start f
        join public.job_financials f2 on f2.job_id = f.job_id
        where f.starts_on between v_today and v_today + 30) else null end,
    'daily_update_due', (select count(*) from due_days),
    'daily_update_logged', (select count(*) from due_days d join logged l on l.job_id = d.job_id and l.log_date = d.day),
    'on_time_met', (select count(*) from started where actual_start_date <= guarantee_start_date),
    'on_time_missed', (select count(*) from started where actual_start_date > guarantee_start_date
                       and on_time_guarantee_status not in ('missed_weather')),
    'on_time_weather', (select count(*) from started where actual_start_date > guarantee_start_date
                        and on_time_guarantee_status = 'missed_weather'),
    'rain_delay_days', (select count(*) from public.rain_delays r join jobs j on j.id = r.job_id
                        where r.delay_date >= v_today - 90),
    'completed_jobs_90', (select count(*) from done_jobs),
    'punch_items_90', (select count(*) from public.punch_items p join done_jobs d on d.id = p.job_id
                       where p.deleted_at is null),
    'labor_budgeted_hours_90', (select coalesce(sum(w.budgeted_hours), 0) from public.work_orders w
                                join done_jobs d on d.id = w.job_id
                                where w.deleted_at is null and w.status <> 'canceled'),
    'labor_actual_hours_90', (select coalesce(sum(t.hours), 0) from public.time_entries t
                              join done_jobs d on d.id = t.job_id where t.deleted_at is null),
    'backlog_hours', (select coalesce(sum(budgeted_hours), 0) from backlog_wo),
    'crew_day_hours', v_crew_hours,
    'can_see_money', v_money
  ) into v_out;
  return v_out;
end;
$$;
revoke execute on function public.production_stats() from public, anon;
grant execute on function public.production_stats() to authenticated, service_role;

-- =============================================================================
-- 11. Grants
-- =============================================================================

grant execute on function app.production_today() to authenticated, service_role;
revoke execute on function app.refresh_job_teams(uuid[]) from public, anon, authenticated;
revoke execute on function app.jobs_for_crew(uuid) from public, anon, authenticated;
revoke execute on function app.job_crew_user_ids(uuid, uuid) from public, anon, authenticated;
revoke execute on function app.crew_lead_ids(uuid, uuid) from public, anon, authenticated;
grant execute on function app.job_crew_user_ids(uuid, uuid), app.crew_lead_ids(uuid, uuid)
  to authenticated, service_role;
grant execute on function app.subcontractor_status(public.subcontractors, date) to authenticated, service_role;
