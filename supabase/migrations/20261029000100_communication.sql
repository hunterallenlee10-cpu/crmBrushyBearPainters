-- Phase 8: Communication & growth (SPEC §5.7, §5.8, §8.11, §8.16, §8.18, §8.19,
-- §9, §11, §13.2, §14 `?ref=`).
--
-- Message templates (SMS / email, merge fields, draft until an owner approves),
-- workflows (system-defined in lib/domain/workflows/catalog.ts; the database
-- keeps the on/off switch) and workflow_runs (input, steps, result, error,
-- idempotency key per workflow and event, waiting steps resumed by the worker),
-- message threads (one conversation per lead / job / contact, unread state,
-- kept by triggers on messages), cases (warranty and service, SLA due), Bear
-- Champions (BEAR-XXXX codes) and referrals (website `?ref=` attribution by a
-- trigger on leads), review requests (click-through, review left), segments,
-- campaigns and their recipients, drips and enrollments, follow-up lists,
-- dispositions and call attempts, notification settings (company defaults and
-- per-person choices, applied by a trigger on notifications), messaging
-- settings (quiet hours, footers) and referral settings.
--
-- Consent: leads get SMS and email opt-out stamps (STOP / unsubscribe);
-- contacts get an email opt-out stamp. Messages record their thread, whether
-- they were transactional or marketing, and the workflow run or campaign
-- that sent them.
--
-- Purely additive: new tables, columns, indexes, policies and functions;
-- replaced functions keep their signatures. Safe on a database with Phases 0–7.
-- Existing messages are attached to threads by a one-time backfill.
--
-- Rollback: supabase/rollbacks/20261029000100_communication.down.sql

-- =============================================================================
-- 0. Permissions, numbering, helpers
-- =============================================================================

-- @permissions:begin
insert into public.permissions (key, resource, action, label, category, supports_scope, sort_order)
select v.key, split_part(v.key, ':', 1), split_part(v.key, ':', 2), v.label, v.category, v.scoped, v.ord
from (values
  ('cases:read', 'View warranty and service cases', 'core_records', true, 175),
  ('cases:manage', 'Open and work warranty and service cases', 'core_records', false, 176)
) as v(key, label, category, scoped, ord)
on conflict (key) do nothing;
-- @permissions:end

-- Cases are customer records: the office works all of them, estimators their
-- own, crew leads see the ones on their jobs, read-only roles see everything.
-- Crew leads can read customer messages on their own jobs (no sending).
insert into public.pack_permissions (org_id, pack_id, permission, scope)
select p.org_id, p.id, v.permission, v.scope
from public.permission_packs p
join (values
  ('core_records_all', 'cases:read', 'all'),
  ('core_records_all', 'cases:manage', 'all'),
  ('core_records_own', 'cases:read', 'own'),
  ('core_records_own', 'cases:manage', 'all'),
  ('read_everything', 'cases:read', 'all'),
  ('crew_lead', 'cases:read', 'own'),
  ('crew_lead', 'messages:read', 'own')
) as v(pack_key, permission, scope) on v.pack_key = p.key
where not exists (
  select 1 from public.pack_permissions x where x.pack_id = p.id and x.permission = v.permission
);

alter table app.number_sequences drop constraint number_sequences_kind_check;
alter table app.number_sequences add constraint number_sequences_kind_check
  check (kind in ('job', 'estimate', 'invoice', 'payment', 'work_order', 'change_order', 'paint_order', 'case'));

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
    when 'case' then 'CASE'
  end;
$$;

-- =============================================================================
-- 1. Consent columns, message bookkeeping
-- =============================================================================

-- STOP / UNSUBSCRIBE on a lead (no contact record yet). contacts.opted_out_at
-- already holds a STOP to texts; email unsubscribes get their own stamp.
alter table public.leads
  add column sms_opted_out_at timestamptz,
  add column email_opted_out_at timestamptz;
alter table public.contacts
  add column email_opted_out_at timestamptz;

-- Rain delays remember whether the person asked to text the customer (the
-- workflow reads it; SPEC §11.2 #9).
alter table public.rain_delays
  add column notify_customer boolean not null default true;

-- Attention items about a case (warranty request, SPEC §9).
alter table public.attention_items drop constraint attention_items_subject_type_check;
alter table public.attention_items add constraint attention_items_subject_type_check
  check (subject_type in ('lead', 'job', 'subcontractor', 'case'));

-- =============================================================================
-- 2. Message templates (SPEC §5.7, §11.3)
-- =============================================================================

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (app.is_key(key) and key is not null),
  channel text not null check (channel in ('sms', 'email')),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (length(description) <= 500),
  category text not null check (category in (
    'lead', 'walkthrough', 'estimate', 'sold_onboarding', 'schedule', 'daily_update', 'weather',
    'completion', 'billing', 'review_referral', 'warranty', 'internal', 'marketing')),
  subject text check (length(subject) <= 200),
  body text not null check (length(btrim(body)) between 1 and 5000),
  message_type text not null default 'transactional' check (message_type in ('transactional', 'marketing')),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, key, channel),
  check (channel <> 'email' or subject is not null),
  check ((status = 'approved') = (approved_at is not null))
);
create index message_templates_org_category_idx on public.message_templates (org_id, category, key);

-- =============================================================================
-- 3. Workflows and runs (SPEC §5.9, §11.1)
-- =============================================================================

-- The definitions (trigger, conditions, ordered actions) are system-defined in
-- lib/domain/workflows/catalog.ts; this row is the switch and its history.
create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (app.is_key(key) and key is not null),
  enabled boolean not null default true,
  is_system boolean not null default true,
  disabled_reason text check (length(disabled_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, key)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  workflow_key text not null check (app.is_key(workflow_key) and workflow_key is not null),
  event_id bigint references public.events (id) on delete set null,
  event_type text not null check (length(event_type) <= 80),
  -- One run per (workflow, event): a second try of the same event is a no-op.
  idempotency_key text not null unique check (length(idempotency_key) <= 300),
  subject_type text check (length(subject_type) <= 40),
  subject_id text check (length(subject_id) <= 80),
  status text not null default 'running' check (status in (
    'running', 'waiting', 'completed', 'skipped', 'failed', 'canceled', 'dry_run')),
  dry_run boolean not null default false,
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  next_step integer not null default 0 check (next_step >= 0),
  resume_at timestamptz,
  wait_reason text check (length(wait_reason) <= 300),
  locked_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  result text check (length(result) <= 1000),
  error text check (length(error) <= 1000),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'waiting' or resume_at is not null),
  check (dry_run = (status = 'dry_run'))
);
create index workflow_runs_waiting_idx on public.workflow_runs (resume_at) where status = 'waiting';
create index workflow_runs_workflow_idx on public.workflow_runs (org_id, workflow_key, created_at desc);
create index workflow_runs_subject_idx on public.workflow_runs (subject_type, subject_id, created_at desc);
create index workflow_runs_event_idx on public.workflow_runs (event_id);

-- =============================================================================
-- 4. Message threads (SPEC §5.7) and message columns
-- =============================================================================

create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  subject_type text not null check (subject_type in ('lead', 'account', 'contact', 'job')),
  subject_id uuid not null,
  contact_id uuid references public.contacts (id) on delete set null,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_direction text check (last_direction in ('inbound', 'outbound')),
  last_channel text check (last_channel in ('sms', 'email', 'call', 'voicemail', 'portal')),
  last_preview text check (length(last_preview) <= 200),
  message_count integer not null default 0 check (message_count >= 0),
  inbound_count integer not null default 0 check (inbound_count >= 0),
  read_at timestamptz,
  read_by uuid references public.profiles (id) on delete set null,
  unread boolean generated always as (
    last_inbound_at is not null and (read_at is null or last_inbound_at > read_at)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, subject_type, subject_id)
);
create index message_threads_org_last_idx on public.message_threads (org_id, last_message_at desc nulls last);
create index message_threads_unread_idx on public.message_threads (org_id, last_inbound_at) where unread;
create index message_threads_contact_idx on public.message_threads (contact_id);

alter table public.messages
  add column thread_id uuid references public.message_threads (id),
  add column message_type text check (message_type in ('transactional', 'marketing')),
  add column workflow_run_id uuid references public.workflow_runs (id),
  add column provider_message_id text check (length(provider_message_id) <= 200);
create index messages_thread_idx on public.messages (thread_id, created_at desc);
create index messages_workflow_run_idx on public.messages (workflow_run_id) where workflow_run_id is not null;
-- An inbound provider message is recorded once (the stub route is idempotent).
create unique index messages_provider_message_idx on public.messages (org_id, provider_message_id)
  where provider_message_id is not null;

-- =============================================================================
-- 5. Cases: warranty and service (SPEC §5.7, §8.16, §9)
-- =============================================================================

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  case_number text not null,
  account_id uuid references public.accounts (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  type text not null default 'warranty' check (type in (
    'warranty', 'service', 'touch_up', 'complaint', 'question', 'other')),
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  status text not null default 'new' check (status in (
    'new', 'in_progress', 'scheduled', 'waiting_on_customer', 'resolved', 'closed')),
  source text not null default 'phone' check (source in (
    'phone', 'sms', 'email', 'portal', 'in_person', 'internal', 'website')),
  title text not null check (length(btrim(title)) between 3 and 200),
  description text check (length(description) <= 5000),
  owner_id uuid references public.profiles (id) on delete set null,
  sla_due_at timestamptz not null,
  first_response_at timestamptz,
  resolution text check (length(resolution) <= 5000),
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, case_number),
  check (account_id is not null or job_id is not null),
  check (status not in ('resolved', 'closed') or (resolution is not null and resolved_at is not null))
);
create index cases_org_status_idx on public.cases (org_id, status, sla_due_at);
create index cases_job_idx on public.cases (job_id);
create index cases_account_idx on public.cases (account_id);
create index cases_owner_idx on public.cases (owner_id);

-- A warranty visit is an appointment linked to its case.
alter table public.appointments
  add column case_id uuid references public.cases (id) on delete set null;
create index appointments_case_idx on public.appointments (case_id) where case_id is not null;

-- =============================================================================
-- 6. Referrals ("Bear Champions") and reviews (SPEC §5.8, §8.16, §14)
-- =============================================================================

create table public.referral_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  payable_when text not null default 'paid_in_full' check (payable_when in ('paid_in_full', 'sold')),
  code_prefix text not null default 'BEAR' check (code_prefix ~ '^[A-Z]{2,8}$'),
  program_note text check (length(program_note) <= 2000),
  terms text check (length(terms) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.referral_champions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  account_id uuid references public.accounts (id) on delete set null,
  code text not null check (code ~ '^[A-Z]{2,8}-[A-Z0-9]{4,8}$'),
  status text not null default 'active' check (status in ('active', 'paused', 'retired')),
  invited_at timestamptz,
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, code),
  unique (org_id, contact_id)
);
create index referral_champions_account_idx on public.referral_champions (account_id);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  champion_id uuid not null references public.referral_champions (id) on delete restrict,
  lead_id uuid references public.leads (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  referred_name text check (length(referred_name) <= 200),
  source text not null default 'ref_link' check (source in ('ref_link', 'manual')),
  -- What the reward was when the referral came in (Company Settings), cents.
  reward_cents bigint check (reward_cents >= 0),
  payable_at timestamptz,
  paid_at timestamptz,
  paid_by uuid,
  payout_method text check (payout_method in ('check', 'cash', 'gift_card', 'credit', 'zelle', 'other')),
  payout_reference text check (length(payout_reference) <= 200),
  ineligible_reason text check (length(ineligible_reason) <= 500),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (lead_id is not null or job_id is not null),
  check (paid_at is null or (payout_method is not null and ineligible_reason is null))
);
create unique index referrals_lead_idx on public.referrals (lead_id) where lead_id is not null;
create unique index referrals_job_idx on public.referrals (job_id) where job_id is not null;
create index referrals_champion_idx on public.referrals (champion_id, created_at desc);

create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  channel text check (channel in ('sms', 'email')),
  status text not null default 'sent' check (status in ('sent', 'skipped', 'clicked', 'reviewed')),
  skipped_reason text check (length(skipped_reason) <= 500),
  token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  message_id uuid references public.messages (id) on delete set null,
  sent_at timestamptz,
  clicked_at timestamptz,
  click_count integer not null default 0 check (click_count >= 0),
  review_left boolean not null default false,
  review_left_at timestamptz,
  rating smallint check (rating between 1 and 5),
  platform text not null default 'google' check (platform in ('google', 'facebook', 'yelp', 'nextdoor', 'other')),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (review_left = (review_left_at is not null))
);
-- One request per job (the workflow is idempotent; a manual resend reuses it).
create unique index review_requests_job_idx on public.review_requests (job_id);
create index review_requests_org_sent_idx on public.review_requests (org_id, sent_at desc);

-- =============================================================================
-- 7. Campaigns, segments, drips (SPEC §5.8, §8.11)
-- =============================================================================

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (length(description) <= 500),
  module text not null check (module in ('contacts', 'leads', 'jobs')),
  match text not null default 'all' check (match in ('all', 'any')),
  rules jsonb not null default '[]'::jsonb check (jsonb_typeof(rules) = 'array'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index segments_org_idx on public.segments (org_id, name) where archived_at is null;

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  channel text not null check (channel in ('sms', 'email')),
  status text not null default 'draft' check (status in (
    'draft', 'scheduled', 'sending', 'paused', 'sent', 'canceled')),
  segment_id uuid references public.segments (id) on delete set null,
  -- The audience as built (module, match, rules); copied from the segment when one is picked.
  audience jsonb not null default '{"module":"contacts","match":"all","rules":[]}'::jsonb
    check (jsonb_typeof(audience) = 'object'),
  template_id uuid references public.message_templates (id) on delete set null,
  subject text check (length(subject) <= 200),
  body text check (length(body) <= 5000),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_test_at timestamptz,
  canceled_reason text check (length(canceled_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (status <> 'scheduled' or scheduled_at is not null)
);
create index campaigns_org_status_idx on public.campaigns (org_id, status, scheduled_at);

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  subject_type text not null check (subject_type in ('contact', 'lead')),
  subject_id uuid not null,
  contact_id uuid references public.contacts (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  name text check (length(name) <= 200),
  address text check (length(address) <= 320),
  status text not null default 'pending' check (status in ('pending', 'excluded', 'sent', 'failed', 'deferred')),
  exclusion_reason text check (length(exclusion_reason) <= 300),
  deferred_until timestamptz,
  message_id uuid references public.messages (id) on delete set null,
  outbox_id uuid references public.integration_outbox (id) on delete set null,
  sent_at timestamptz,
  replied_at timestamptz,
  unsubscribed_at timestamptz,
  converted_at timestamptz,
  error text check (length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, subject_type, subject_id)
);
create index campaign_recipients_status_idx on public.campaign_recipients (campaign_id, status);
create index campaign_recipients_org_sent_idx on public.campaign_recipients (org_id, sent_at desc);
create index campaign_recipients_contact_idx on public.campaign_recipients (contact_id);
create index campaign_recipients_lead_idx on public.campaign_recipients (lead_id);

alter table public.messages
  add column campaign_id uuid references public.campaigns (id);
create index messages_campaign_idx on public.messages (campaign_id) where campaign_id is not null;

create table public.drips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text check (app.is_key(key)),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (length(description) <= 1000),
  -- Steps: [{ "delay_days": n } | { "on_date": "MM-DD" }, "channel", "template_key"] (validated in lib/domain/drips).
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  -- Exit conditions (keys from lib/domain/drips): replied, booked, converted, sold, lost, opted_out.
  exit_conditions text[] not null default '{replied,booked,converted,opted_out}',
  active boolean not null default true,
  is_system boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create unique index drips_org_key_idx on public.drips (org_id, key) where key is not null;

create table public.drip_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  drip_id uuid not null references public.drips (id) on delete cascade,
  subject_type text not null check (subject_type in ('lead', 'contact', 'job')),
  subject_id uuid not null,
  status text not null default 'active' check (status in ('active', 'completed', 'exited', 'canceled')),
  current_step integer not null default 0 check (current_step >= 0),
  next_run_at timestamptz,
  locked_at timestamptz,
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid,
  source text not null default 'manual' check (source in ('workflow', 'manual')),
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  steps_log jsonb not null default '[]'::jsonb check (jsonb_typeof(steps_log) = 'array'),
  last_step_at timestamptz,
  exit_reason text check (length(exit_reason) <= 300),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or next_run_at is not null),
  check ((status = 'active') = (ended_at is null))
);
create unique index drip_enrollments_active_idx on public.drip_enrollments (drip_id, subject_type, subject_id)
  where status = 'active';
create index drip_enrollments_due_idx on public.drip_enrollments (next_run_at) where status = 'active';
create index drip_enrollments_subject_idx on public.drip_enrollments (subject_type, subject_id);

-- =============================================================================
-- 8. Follow-up lists and dispositions (SPEC §11.4, §8.19)
-- =============================================================================

create table public.follow_up_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (app.is_key(key) and key is not null),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (length(description) <= 500),
  script text check (length(script) <= 5000),
  active boolean not null default true,
  sort_order integer not null default 0,
  -- After a disposition the record leaves this list for this many hours (unless a callback is set).
  cooldown_hours integer not null default 20 check (cooldown_hours between 0 and 8760),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, key)
);

create table public.follow_up_dispositions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (app.is_key(key) and key is not null),
  label text not null check (length(btrim(label)) between 1 and 80),
  disposition_group text not null check (disposition_group in ('positive', 'negative', 'callback', 'no_contact', 'won')),
  -- The lead disposition (picklist key) to set when the record is a lead.
  lead_disposition text check (app.is_key(lead_disposition)),
  requires_callback boolean not null default false,
  sets_do_not_contact boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, key)
);

create table public.follow_up_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  list_key text not null check (app.is_key(list_key) and list_key is not null),
  subject_type text not null check (subject_type in ('lead', 'job', 'account')),
  subject_id uuid not null,
  disposition_key text not null check (app.is_key(disposition_key) and disposition_key is not null),
  disposition_group text not null check (disposition_group in ('positive', 'negative', 'callback', 'no_contact', 'won')),
  channel text not null default 'call' check (channel in ('call', 'sms', 'email', 'none')),
  notes text check (length(notes) <= 2000),
  callback_at timestamptz,
  message_id uuid references public.messages (id) on delete set null,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index follow_up_attempts_subject_idx on public.follow_up_attempts (org_id, subject_type, subject_id, created_at desc);
create index follow_up_attempts_callback_idx on public.follow_up_attempts (org_id, callback_at) where callback_at is not null;
create index follow_up_attempts_list_idx on public.follow_up_attempts (org_id, list_key, created_at desc);

-- =============================================================================
-- 9. Notification settings (SPEC §8.18, §8.19) and messaging settings
-- =============================================================================

create table public.notification_settings (
  org_id uuid not null references public.organizations (id) on delete cascade,
  type text not null check (type ~ '^[a-z_]+$'),
  in_app boolean not null default true,
  email boolean not null default false,
  sms boolean not null default false,
  -- Locked: people can't turn the in-app notification off.
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  primary key (org_id, type)
);

create table public.notification_preferences (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type ~ '^[a-z_]+$'),
  in_app boolean not null default true,
  email boolean not null default false,
  sms boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, type)
);

create table public.messaging_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- Quiet hours (SPEC §11.1, §13.2): automated texts wait until the end time
  -- (Pacific) unless the customer texted us within customer_thread_hours.
  quiet_hours_enabled boolean not null default true,
  quiet_hours_start time not null default '20:00',
  quiet_hours_end time not null default '08:00',
  customer_thread_hours integer not null default 24 check (customer_thread_hours between 0 and 168),
  sms_opt_out_text text not null default 'Reply STOP to opt out.' check (length(sms_opt_out_text) between 5 and 120),
  -- Footer on marketing email; [MAILING_ADDRESS] stays a placeholder until an owner fills it in.
  email_footer text not null default 'Brushy Bear Painters · [MAILING_ADDRESS]' check (length(email_footer) <= 500),
  review_delay_days integer not null default 2 check (review_delay_days between 0 and 60),
  referral_invite_delay_days integer not null default 14 check (referral_invite_delay_days between 0 and 120),
  case_sla_business_days integer not null default 2 check (case_sla_business_days between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (quiet_hours_start <> quiet_hours_end)
);

-- =============================================================================
-- 10. Functions and guards
-- =============================================================================

-- Templates: key, channel and the system flag never change; edits put the
-- wording back to draft; only approve_template() approves.
create or replace function app.message_templates_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not app.is_trusted() then
      new.is_system := false;
      new.status := 'draft';
      new.approved_by := null;
      new.approved_at := null;
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.key <> old.key or new.channel <> old.channel
     or new.is_system <> old.is_system then
    raise exception 'A template''s key and channel never change.' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.template_approve', true), '') = 'on' then
    return new;
  end if;
  if new.body is distinct from old.body or new.subject is distinct from old.subject
     or new.message_type is distinct from old.message_type then
    new.status := 'draft';
    new.approved_by := null;
    new.approved_at := null;
  elsif new.status = 'approved' and old.status <> 'approved' then
    raise exception 'Only an owner can approve a template (Approve).' using errcode = '42501';
  elsif new.status <> old.status or new.approved_at is distinct from old.approved_at then
    -- Moving back to draft is fine; nothing else about approval is typed in.
    if new.status = 'draft' then
      new.approved_by := null;
      new.approved_at := null;
    else
      raise exception 'Approval details are set by Approve.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Owner approves a template's wording ("Draft – owner to approve", SPEC §11.3).
create or replace function public.approve_template(p_template uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not app.can_write('templates:manage') or not app.is_grants_all_user(app.effective_user_id()) then
    raise exception 'Only an owner can approve template wording.' using errcode = '42501';
  end if;
  select org_id into v_org from public.message_templates where id = p_template;
  if v_org is null or v_org <> app.current_org_id() then
    raise exception 'Template not found.' using errcode = 'P0002';
  end if;
  perform set_config('app.template_approve', 'on', true);
  update public.message_templates
     set status = 'approved', approved_by = app.effective_user_id(), approved_at = now()
   where id = p_template;
  perform set_config('app.template_approve', 'off', true);
end;
$$;
revoke execute on function public.approve_template(uuid) from public, anon;
grant execute on function public.approve_template(uuid) to authenticated;

-- Workflows: people only flip the switch (with a reason when turning off).
create or replace function app.workflows_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not app.is_trusted() then
    if new.org_id <> old.org_id or new.key <> old.key or new.is_system <> old.is_system then
      raise exception 'Only the switch of a workflow can change.' using errcode = '42501';
    end if;
    if new.enabled then
      new.disabled_reason := null;
    end if;
  end if;
  return new;
end;
$$;

-- Messages land in their thread (one per lead / job / account / contact).
create or replace function app.messages_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread uuid;
begin
  if new.thread_id is not null then
    if not exists (select 1 from public.message_threads t
                   where t.id = new.thread_id and t.org_id = new.org_id
                     and t.subject_type = new.subject_type and t.subject_id = new.subject_id) then
      raise exception 'That conversation belongs to another record.' using errcode = '42501';
    end if;
    return new;
  end if;
  insert into public.message_threads (org_id, subject_type, subject_id, contact_id)
  values (new.org_id, new.subject_type, new.subject_id, new.contact_id)
  on conflict (org_id, subject_type, subject_id) do update
    set contact_id = coalesce(public.message_threads.contact_id, excluded.contact_id)
  returning id into v_thread;
  new.thread_id := v_thread;
  return new;
end;
$$;

-- Thread summary after each message. A person's reply marks the thread read.
create or replace function app.messages_thread_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.message_threads t set
    last_message_at = greatest(coalesce(t.last_message_at, new.created_at), new.created_at),
    last_inbound_at = case when new.direction = 'inbound'
                           then greatest(coalesce(t.last_inbound_at, new.created_at), new.created_at)
                           else t.last_inbound_at end,
    last_outbound_at = case when new.direction = 'outbound'
                            then greatest(coalesce(t.last_outbound_at, new.created_at), new.created_at)
                            else t.last_outbound_at end,
    last_direction = new.direction,
    last_channel = new.channel,
    last_preview = left(regexp_replace(
      coalesce(nullif(new.email_subject, '') || ' · ', '') || coalesce(new.body, new.call_outcome, ''),
      '\s+', ' ', 'g'), 200),
    message_count = t.message_count + 1,
    inbound_count = t.inbound_count + case when new.direction = 'inbound' then 1 else 0 end,
    read_at = case when new.direction = 'outbound' and new.sent_by is not null then now() else t.read_at end,
    read_by = case when new.direction = 'outbound' and new.sent_by is not null then new.sent_by else t.read_by end,
    updated_at = now()
  where t.id = new.thread_id;
  return null;
end;
$$;

-- Mark a conversation read (or unread again) for everyone. Only people who can
-- reply may: a crew lead reading along shouldn't hide a message from the office.
create or replace function public.mark_thread_read(p_thread uuid, p_read boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.message_threads;
begin
  if not app.can_write('messages:send') or not app.has_perm('messages:read') then
    raise exception 'You can''t change this conversation.' using errcode = '42501';
  end if;
  select * into v_row from public.message_threads where id = p_thread;
  if v_row.id is null or v_row.org_id <> app.current_org_id()
     or not app.can_see_subject(v_row.subject_type, v_row.subject_id) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  update public.message_threads
     set read_at = case when p_read then now() else null end,
         read_by = case when p_read then app.effective_user_id() else null end,
         updated_at = now()
   where id = p_thread;
end;
$$;
revoke execute on function public.mark_thread_read(uuid, boolean) from public, anon;
grant execute on function public.mark_thread_read(uuid, boolean) to authenticated;

-- Cases: number, SLA fallback, resolution bookkeeping.
create or replace function app.cases_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.check_same_org(new.org_id, 'accounts', new.account_id, 'Account');
  perform app.check_same_org(new.org_id, 'contacts', new.contact_id, 'Contact');
  if new.job_id is not null then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    if new.account_id is null then
      select j.account_id into new.account_id from public.jobs j where j.id = new.job_id;
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.case_number := app.next_number(new.org_id, 'case', coalesce(new.created_at, now()));
    if new.sla_due_at is null then
      new.sla_due_at := now() + interval '2 days';
    end if;
  else
    if new.org_id <> old.org_id or new.case_number <> old.case_number then
      raise exception 'A case keeps its number.' using errcode = '42501';
    end if;
  end if;
  if new.status in ('resolved', 'closed') then
    if new.resolution is null or length(btrim(new.resolution)) < 3 then
      raise exception 'Write what was done before resolving the case.' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' or old.status not in ('resolved', 'closed') then
      new.resolved_at := now();
      new.resolved_by := app.actor_id();
    end if;
    if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
      new.closed_at := now();
    end if;
  else
    new.resolved_at := null;
    new.resolved_by := null;
    new.closed_at := null;
  end if;
  if tg_op = 'UPDATE' and new.first_response_at is null and old.status = 'new' and new.status <> 'new' then
    new.first_response_at := now();
  end if;
  return new;
end;
$$;

create or replace function app.cases_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform app.log_activity(new.org_id, 'job', new.job_id::text, 'case_opened',
      'Case ' || new.case_number || ' opened: ' || left(new.title, 160),
      jsonb_build_object('case_id', new.id, 'type', new.type));
  elsif new.status is distinct from old.status and new.status in ('resolved', 'closed') then
    perform app.log_activity(new.org_id, 'job', new.job_id::text, 'case_resolved',
      'Case ' || new.case_number || ' resolved: ' || left(coalesce(new.resolution, ''), 160),
      jsonb_build_object('case_id', new.id));
  end if;
  return null;
end;
$$;

-- Champion codes: generated (BEAR-XXXX, no look-alike characters), never changed.
create or replace function app.referral_champions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_try integer := 0;
begin
  perform app.check_same_org(new.org_id, 'contacts', new.contact_id, 'Contact');
  if tg_op = 'INSERT' then
    if new.account_id is null then
      select c.account_id into new.account_id from public.contacts c where c.id = new.contact_id;
    end if;
    if new.code is null or not app.is_trusted() then
      select coalesce(s.code_prefix, 'BEAR') into v_prefix from public.referral_settings s where s.org_id = new.org_id;
      v_prefix := coalesce(v_prefix, 'BEAR');
      loop
        v_try := v_try + 1;
        v_code := v_prefix || '-' || (
          select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
          from generate_series(1, 4));
        exit when not exists (select 1 from public.referral_champions c where c.org_id = new.org_id and c.code = v_code);
        if v_try > 50 then
          raise exception 'Could not make a unique code.' using errcode = '23505';
        end if;
      end loop;
      new.code := v_code;
    end if;
    new.code := upper(new.code);
  elsif new.code <> old.code or new.org_id <> old.org_id or new.contact_id <> old.contact_id then
    raise exception 'A champion keeps their code.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Referrals: the same company; payout fields only with referrals:manage (policy);
-- a referral can't be paid twice or un-paid.
create or replace function app.referrals_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.check_same_org(new.org_id, 'leads', new.lead_id, 'Lead');
  perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
  if not exists (select 1 from public.referral_champions c where c.id = new.champion_id and c.org_id = new.org_id) then
    raise exception 'Champion not found.' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' then
    if old.paid_at is not null and (new.paid_at is distinct from old.paid_at
        or new.reward_cents is distinct from old.reward_cents) then
      raise exception 'This referral reward is already paid.' using errcode = '42501';
    end if;
    if new.champion_id <> old.champion_id and old.paid_at is not null then
      raise exception 'A paid referral keeps its champion.' using errcode = '42501';
    end if;
    if new.paid_at is not null and old.paid_at is null then
      new.paid_by := app.actor_id();
    end if;
  end if;
  return new;
end;
$$;

-- Website `?ref=CODE` (SPEC §14): a new lead with a champion's code becomes a
-- referral; converting the lead carries the job over.
create or replace function app.leads_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_champion public.referral_champions;
  v_contact public.contacts;
  v_reward bigint;
  v_self boolean;
begin
  if tg_op = 'INSERT' then
    if new.referral_code is null or btrim(new.referral_code) = '' then
      return null;
    end if;
    select * into v_champion from public.referral_champions c
     where c.org_id = new.org_id and c.code = upper(btrim(new.referral_code)) and c.status = 'active';
    if v_champion.id is null then
      return null;
    end if;
    select * into v_contact from public.contacts where id = v_champion.contact_id;
    v_self := (new.email is not null and lower(new.email) = lower(v_contact.email))
           or (new.phone_digits is not null and new.phone_digits = v_contact.phone_digits)
           or (new.mobile is not null and new.mobile = v_contact.mobile);
    select s.referral_reward_cents into v_reward from public.company_settings s where s.org_id = new.org_id;
    insert into public.referrals (org_id, champion_id, lead_id, referred_name, source, reward_cents, ineligible_reason)
    values (new.org_id, v_champion.id, new.id, left(btrim(new.first_name || ' ' || coalesce(new.last_name, '')), 200),
            'ref_link', v_reward, case when v_self then 'The champion referred themselves.' end)
    on conflict do nothing;
    perform app.log_activity(new.org_id, 'lead', new.id::text, 'referral',
      'Referred by Bear Champion code ' || v_champion.code || '.',
      jsonb_build_object('champion_id', v_champion.id));
    return null;
  end if;
  if new.converted_job_id is not null and old.converted_job_id is distinct from new.converted_job_id then
    update public.referrals set job_id = new.converted_job_id, updated_at = now()
     where lead_id = new.id and job_id is null;
  end if;
  return null;
end;
$$;

-- Campaigns: content only while draft; sending / sent are set by the worker.
create or replace function app.campaigns_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.segment_id is not null and not exists (
    select 1 from public.segments s where s.id = new.segment_id and s.org_id = new.org_id) then
    raise exception 'Segment not found.' using errcode = '23503';
  end if;
  if new.template_id is not null and not exists (
    select 1 from public.message_templates t where t.id = new.template_id and t.org_id = new.org_id
      and t.channel = new.channel) then
    raise exception 'Pick a template for the same channel.' using errcode = '23514';
  end if;
  if app.is_trusted() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.started_at := null;
    new.finished_at := null;
    return new;
  end if;
  if new.org_id <> old.org_id or new.started_at is distinct from old.started_at
     or new.finished_at is distinct from old.finished_at then
    raise exception 'That part of a campaign is set when it sends.' using errcode = '42501';
  end if;
  if old.status not in ('draft') and (new.channel <> old.channel or new.audience <> old.audience
      or new.body is distinct from old.body or new.subject is distinct from old.subject
      or new.template_id is distinct from old.template_id or new.segment_id is distinct from old.segment_id) then
    raise exception 'Unschedule the campaign (back to draft) before changing it.' using errcode = '42501';
  end if;
  if new.status <> old.status and not (
       (old.status = 'draft' and new.status in ('scheduled', 'canceled'))
    or (old.status = 'scheduled' and new.status in ('draft', 'paused', 'canceled'))
    or (old.status = 'sending' and new.status in ('paused', 'canceled'))
    or (old.status = 'paused' and new.status in ('scheduled', 'canceled'))) then
    raise exception 'A campaign can''t go from % to %.', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app.drip_enrollments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.drips d where d.id = new.drip_id and d.org_id = new.org_id) then
    raise exception 'Drip not found.' using errcode = '23503';
  end if;
  if app.is_trusted() then
    return new;
  end if;
  -- People may only cancel an active enrollment.
  if tg_op = 'UPDATE' then
    if not (old.status = 'active' and new.status = 'canceled'
            and new.drip_id = old.drip_id and new.subject_id = old.subject_id
            and new.current_step = old.current_step) then
      raise exception 'People can only stop an enrollment.' using errcode = '42501';
    end if;
    new.ended_at := now();
    new.next_run_at := null;
    new.exit_reason := coalesce(new.exit_reason, 'Stopped by a person.');
  end if;
  return new;
end;
$$;

-- Notifications follow the company defaults and each person's choices
-- (SPEC §8.18): in-app real, email / text simulated through the outbox.
create or replace function app.notifications_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_default public.notification_settings;
  v_pref public.notification_preferences;
  v_in_app boolean;
  v_email boolean;
  v_sms boolean;
  v_profile public.profiles;
  v_body text;
begin
  select * into v_default from public.notification_settings where org_id = new.org_id and type = new.type;
  select * into v_pref from public.notification_preferences where user_id = new.user_id and type = new.type;
  v_in_app := coalesce(v_pref.in_app, v_default.in_app, true) or coalesce(v_default.locked, false);
  v_email := coalesce(v_pref.email, v_default.email, false);
  v_sms := coalesce(v_pref.sms, v_default.sms, false);
  if v_email or v_sms then
    select * into v_profile from public.profiles where id = new.user_id;
    v_body := new.title || coalesce(E'\n' || new.body, '') || coalesce(E'\n' || new.link, '');
    if v_email and v_profile.email is not null and v_profile.is_active then
      insert into public.integration_outbox (org_id, domain, provider, operation, recipient, subject,
        rendered_body, payload, related_type, related_id, status)
      values (new.org_id, 'email', 'outbox', 'send', v_profile.email, left(new.title, 200), v_body,
        jsonb_build_object('kind', 'notification', 'notification_type', new.type, 'user_id', new.user_id,
                           'message_type', 'transactional'),
        'notification', new.id::text, 'simulated');
    end if;
    if v_sms and v_profile.phone is not null and v_profile.phone ~ '^\+[1-9]\d{7,14}$' and v_profile.is_active then
      insert into public.integration_outbox (org_id, domain, provider, operation, recipient, subject,
        rendered_body, payload, related_type, related_id, status)
      values (new.org_id, 'sms_voice', 'outbox', 'sms.send', v_profile.phone, null, left(v_body, 600),
        jsonb_build_object('kind', 'notification', 'notification_type', new.type, 'user_id', new.user_id,
                           'message_type', 'transactional'),
        'notification', new.id::text, 'simulated');
    end if;
  end if;
  if not v_in_app then
    return null;
  end if;
  return new;
end;
$$;

-- Named domain events raised by server code for Phase 8 (per-job schedule
-- notices, stale leads, subcontractor paperwork, follow-up dispositions).
-- Service role only; a fixed list. Returns null when the idempotency key was seen.
create or replace function public.emit_domain_event(
  p_org uuid, p_type text, p_aggregate_type text, p_aggregate_id text,
  p_payload jsonb default '{}'::jsonb, p_idempotency_key text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_type not in ('job.schedule_published', 'lead.stale', 'subcontractor.compliance_expiring',
                    'follow_up.dispositioned', 'message.received', 'referral.payable',
                    'workflow.test') then
    raise exception 'Unknown domain event: %', p_type using errcode = '22023';
  end if;
  if p_org is null then
    raise exception 'The event needs an organization.' using errcode = '22023';
  end if;
  return app.emit_event(p_org, p_type, p_aggregate_type, p_aggregate_id, coalesce(p_payload, '{}'::jsonb),
                        p_idempotency_key);
end;
$$;
revoke execute on function public.emit_domain_event(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.emit_domain_event(uuid, text, text, text, jsonb, text) to service_role;

-- Per-job schedule notices go through the Phase 8 workflow, so production can
-- raise them too (same list as before plus job.schedule_published).
create or replace function public.emit_production_event(
  p_type text, p_aggregate_type text, p_aggregate_id text, p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_type not in ('schedule.published', 'job.started', 'job.on_time_evaluated', 'recommendation.executed',
                    'recommendation.undone', 'daily_log.customer_update', 'weather.risk_detected',
                    'job.schedule_published') then
    raise exception 'Unknown production event: %', p_type using errcode = '22023';
  end if;
  v_org := coalesce(nullif(p_payload ->> 'org_id', '')::uuid,
                    (select j.org_id from public.jobs j where j.id::text = p_aggregate_id));
  if v_org is null then
    raise exception 'The event needs an organization.' using errcode = '22023';
  end if;
  return app.emit_event(v_org, p_type, p_aggregate_type, p_aggregate_id, coalesce(p_payload, '{}'::jsonb) - 'org_id');
end;
$$;
revoke execute on function public.emit_production_event(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.emit_production_event(text, text, text, jsonb) to service_role;

-- Worker: claim workflow runs whose wait is over (SKIP LOCKED; runs stuck
-- "running" for 10 minutes are picked up again from their next step).
create or replace function public.claim_workflow_runs(p_limit integer default 100)
returns setof public.workflow_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.workflow_runs r
     set status = 'running', locked_at = now(), attempts = r.attempts + 1, updated_at = now()
   where r.id in (
     select x.id from public.workflow_runs x
      where (x.status = 'waiting' and x.resume_at <= now())
         or (x.status = 'running' and x.locked_at < now() - interval '10 minutes' and x.attempts < 5)
      order by x.resume_at nulls first
      limit greatest(1, least(p_limit, 500))
      for update skip locked)
  returning r.*;
end;
$$;
revoke execute on function public.claim_workflow_runs(integer) from public, anon, authenticated;
grant execute on function public.claim_workflow_runs(integer) to service_role;

create or replace function public.claim_drip_enrollments(p_limit integer default 100)
returns setof public.drip_enrollments
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.drip_enrollments e
     set locked_at = now(), updated_at = now()
   where e.id in (
     select x.id from public.drip_enrollments x
      where x.status = 'active' and x.next_run_at <= now()
        and (x.locked_at is null or x.locked_at < now() - interval '10 minutes')
      order by x.next_run_at
      limit greatest(1, least(p_limit, 500))
      for update skip locked)
  returning e.*;
end;
$$;
revoke execute on function public.claim_drip_enrollments(integer) from public, anon, authenticated;
grant execute on function public.claim_drip_enrollments(integer) to service_role;

-- Communication & growth numbers for the metrics registry (security invoker:
-- row security decides what each person counts).
create or replace function public.communication_stats(p_from timestamptz default now() - interval '90 days',
                                                      p_to timestamptz default now())
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'threads_unread', (select count(*) from public.message_threads t where t.unread),
    'threads_total', (select count(*) from public.message_threads t),
    'cases_open', (select count(*) from public.cases c where c.status not in ('resolved', 'closed')),
    'cases_overdue', (select count(*) from public.cases c where c.status not in ('resolved', 'closed') and c.sla_due_at < now()),
    'cases_warranty_open', (select count(*) from public.cases c where c.type = 'warranty' and c.status not in ('resolved', 'closed')),
    'cases_resolved_period', (select count(*) from public.cases c where c.resolved_at >= p_from and c.resolved_at < p_to),
    'cases_resolved_on_time_period', (select count(*) from public.cases c where c.resolved_at >= p_from and c.resolved_at < p_to and c.resolved_at <= c.sla_due_at),
    'campaigns_total', (select count(*) from public.campaigns c where c.status <> 'canceled'),
    'campaigns_active', (select count(*) from public.campaigns c where c.status in ('scheduled', 'sending', 'paused')),
    'campaign_sends', (select count(*) from public.campaign_recipients r where r.status = 'sent' and r.sent_at >= p_from and r.sent_at < p_to),
    'campaign_failed', (select count(*) from public.campaign_recipients r where r.status = 'failed' and r.updated_at >= p_from and r.updated_at < p_to),
    'campaign_replies', (select count(*) from public.campaign_recipients r where r.replied_at >= p_from and r.replied_at < p_to),
    'campaign_conversions', (select count(*) from public.campaign_recipients r where r.converted_at >= p_from and r.converted_at < p_to),
    'campaign_queue', (select count(*) from public.campaign_recipients r where r.status in ('pending', 'deferred')),
    'unsubscribes', (select count(*) from public.contacts c where c.email_opted_out_at >= p_from and c.email_opted_out_at < p_to)
                  + (select count(*) from public.leads l where l.email_opted_out_at >= p_from and l.email_opted_out_at < p_to),
    'sms_opt_outs', (select count(*) from public.contacts c where c.opted_out_at >= p_from and c.opted_out_at < p_to)
                  + (select count(*) from public.leads l where l.sms_opted_out_at >= p_from and l.sms_opted_out_at < p_to),
    'drip_active', (select count(*) from public.drip_enrollments e where e.status = 'active'),
    'reviews_requested', (select count(*) from public.review_requests r where r.sent_at >= p_from and r.sent_at < p_to),
    'reviews_clicked', (select count(*) from public.review_requests r where r.sent_at >= p_from and r.sent_at < p_to and r.clicked_at is not null),
    'reviews_left', (select count(*) from public.review_requests r where r.sent_at >= p_from and r.sent_at < p_to and r.review_left),
    'reviews_rating_sum', (select coalesce(sum(r.rating), 0) from public.review_requests r where r.sent_at >= p_from and r.sent_at < p_to and r.rating is not null),
    'reviews_rated', (select count(*) from public.review_requests r where r.sent_at >= p_from and r.sent_at < p_to and r.rating is not null),
    'champions_active', (select count(*) from public.referral_champions c where c.status = 'active'),
    'referrals_total', (select count(*) from public.referrals r where r.created_at >= p_from and r.created_at < p_to),
    'referrals_all', (select count(*) from public.referrals r),
    'referrals_sold', (select count(*) from public.referrals r join public.jobs j on j.id = r.job_id
                        where r.ineligible_reason is null and j.estimate_accepted_at is not null),
    'referrals_payable_cents', (select coalesce(sum(r.reward_cents), 0) from public.referrals r
                                where r.payable_at is not null and r.paid_at is null and r.ineligible_reason is null),
    'referrals_paid_cents', (select coalesce(sum(r.reward_cents), 0) from public.referrals r where r.paid_at is not null),
    'workflow_runs_period', (select count(*) from public.workflow_runs w where not w.dry_run and w.created_at >= p_from and w.created_at < p_to),
    'workflow_failed_period', (select count(*) from public.workflow_runs w where w.status = 'failed' and w.created_at >= p_from and w.created_at < p_to),
    'workflow_waiting', (select count(*) from public.workflow_runs w where w.status = 'waiting')
  );
$$;
revoke execute on function public.communication_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.communication_stats(timestamptz, timestamptz) to authenticated, service_role;

-- Run count and last run per workflow (Admin → Workflows list).
create or replace function public.workflow_stats()
returns table (workflow_key text, runs bigint, failed bigint, waiting bigint, last_run_at timestamptz, last_status text)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.workflow_key,
         count(*) filter (where not r.dry_run),
         count(*) filter (where r.status = 'failed'),
         count(*) filter (where r.status = 'waiting'),
         max(r.created_at) filter (where not r.dry_run),
         (array_agg(r.status order by r.created_at desc) filter (where not r.dry_run))[1]
  from public.workflow_runs r
  group by r.workflow_key;
$$;
revoke execute on function public.workflow_stats() from public, anon;
grant execute on function public.workflow_stats() to authenticated, service_role;

-- =============================================================================
-- 11. Triggers
-- =============================================================================

create trigger message_templates_guard before insert or update on public.message_templates
  for each row execute function app.message_templates_guard();
create trigger workflows_guard before update on public.workflows
  for each row execute function app.workflows_guard();
create trigger messages_thread before insert on public.messages
  for each row execute function app.messages_thread();
create trigger messages_thread_after after insert on public.messages
  for each row execute function app.messages_thread_after();
create trigger cases_guard before insert or update on public.cases
  for each row execute function app.cases_guard();
create trigger cases_activity after insert or update on public.cases
  for each row execute function app.cases_activity();
create trigger referral_champions_guard before insert or update on public.referral_champions
  for each row execute function app.referral_champions_guard();
create trigger referrals_guard before insert or update on public.referrals
  for each row execute function app.referrals_guard();
create trigger leads_referral after insert or update of converted_job_id on public.leads
  for each row execute function app.leads_referral();
create trigger campaigns_guard before insert or update on public.campaigns
  for each row execute function app.campaigns_guard();
create trigger drip_enrollments_guard before insert or update on public.drip_enrollments
  for each row execute function app.drip_enrollments_guard();
create trigger notifications_preferences before insert on public.notifications
  for each row execute function app.notifications_preferences();
create trigger follow_up_attempts_immutable before update or delete on public.follow_up_attempts
  for each row execute function app.deny_write_allow_trusted_delete();

do $$
declare
  t text;
begin
  foreach t in array array[
    'message_templates', 'workflows', 'workflow_runs', 'message_threads', 'cases', 'referral_settings',
    'referral_champions', 'referrals', 'review_requests', 'segments', 'campaigns', 'campaign_recipients',
    'drips', 'drip_enrollments', 'follow_up_lists', 'follow_up_dispositions', 'notification_settings',
    'notification_preferences', 'messaging_settings'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
  end loop;
  foreach t in array array[
    'message_templates', 'workflows', 'cases', 'referral_settings', 'referral_champions', 'referrals',
    'review_requests', 'segments', 'campaigns', 'drips', 'follow_up_lists', 'follow_up_dispositions',
    'notification_settings', 'messaging_settings'] loop
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function app.stamp_actor()', t, t);
  end loop;
end
$$;

-- Audit (message text, run steps and recipient lists stay out of the audit log:
-- they are their own record and would copy personal data around).
do $$
declare
  t text;
begin
  foreach t in array array[
    'workflows', 'cases', 'referral_settings', 'referral_champions', 'referrals', 'review_requests',
    'segments', 'campaigns', 'drips', 'drip_enrollments', 'follow_up_lists', 'follow_up_dispositions',
    'follow_up_attempts', 'notification_settings', 'notification_preferences', 'messaging_settings'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end
$$;
create trigger message_templates_audit after insert or update or delete on public.message_templates
  for each row execute function app.audit_row();

-- Domain events.
create trigger message_templates_event after insert or update on public.message_templates
  for each row execute function app.emit_change_event('message_template', 'body');
create trigger workflows_event after update on public.workflows
  for each row execute function app.emit_change_event('workflow');
create trigger cases_event after insert or update on public.cases
  for each row execute function app.emit_change_event('case', 'description', 'resolution');
create trigger referral_champions_event after insert or update on public.referral_champions
  for each row execute function app.emit_change_event('referral_champion');
create trigger referrals_event after insert or update on public.referrals
  for each row execute function app.emit_change_event('referral');
create trigger review_requests_event after insert or update on public.review_requests
  for each row execute function app.emit_change_event('review_request');
create trigger segments_event after insert or update on public.segments
  for each row execute function app.emit_change_event('segment', 'rules');
create trigger campaigns_event after insert or update on public.campaigns
  for each row execute function app.emit_change_event('campaign', 'body', 'audience');
create trigger drips_event after insert or update on public.drips
  for each row execute function app.emit_change_event('drip', 'steps');
create trigger drip_enrollments_event after insert or update on public.drip_enrollments
  for each row execute function app.emit_change_event('drip_enrollment', 'steps_log');
create trigger follow_up_lists_event after insert or update on public.follow_up_lists
  for each row execute function app.emit_change_event('follow_up_list', 'script');
create trigger follow_up_dispositions_event after insert or update on public.follow_up_dispositions
  for each row execute function app.emit_change_event('follow_up_disposition');
create trigger follow_up_attempts_event after insert on public.follow_up_attempts
  for each row execute function app.emit_change_event('follow_up_attempt', 'notes');
create trigger notification_settings_event after insert or update on public.notification_settings
  for each row execute function app.emit_change_event('notification_setting');
create trigger notification_preferences_event after insert or update on public.notification_preferences
  for each row execute function app.emit_change_event('notification_preference');
create trigger messaging_settings_event after insert or update on public.messaging_settings
  for each row execute function app.emit_change_event('messaging_settings');
create trigger referral_settings_event after insert or update on public.referral_settings
  for each row execute function app.emit_change_event('referral_settings');

-- =============================================================================
-- 12. Row level security
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'message_templates', 'workflows', 'workflow_runs', 'message_threads', 'cases', 'referral_settings',
    'referral_champions', 'referrals', 'review_requests', 'segments', 'campaigns', 'campaign_recipients',
    'drips', 'drip_enrollments', 'follow_up_lists', 'follow_up_dispositions', 'follow_up_attempts',
    'notification_settings', 'notification_preferences', 'messaging_settings'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- Written only by trusted code (the workflow engine, the worker, the inbound route).
revoke insert, update, delete on public.workflow_runs, public.message_threads, public.campaign_recipients,
  public.review_requests from authenticated;
revoke insert, delete on public.workflows, public.messaging_settings, public.referral_settings,
  public.notification_settings from authenticated;
revoke delete on public.message_templates, public.cases, public.referral_champions, public.referrals,
  public.segments, public.campaigns, public.drips, public.drip_enrollments, public.follow_up_lists,
  public.follow_up_dispositions from authenticated;
revoke update, delete on public.follow_up_attempts from authenticated;
-- Workflows: only the switch. Review requests: what the office learns about the review.
grant update (enabled, disabled_reason) on public.workflows to authenticated;
grant update (review_left, review_left_at, rating, platform, notes) on public.review_requests to authenticated;

-- Templates: everyone signed in reads them (composers), templates:manage edits.
create policy message_templates_select on public.message_templates for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy message_templates_insert on public.message_templates for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('templates:manage')));
create policy message_templates_update on public.message_templates for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('templates:manage')))
  with check (org_id = (select app.current_org_id()));

create policy workflows_select on public.workflows for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('workflows:manage')));
create policy workflows_update on public.workflows for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('workflows:manage')))
  with check (org_id = (select app.current_org_id()));
create policy workflow_runs_select on public.workflow_runs for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('workflows:manage')));

-- Threads follow the messages they hold.
create policy message_threads_select on public.message_threads for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('messages:read'))
         and app.can_see_subject(subject_type, subject_id));

-- Cases: cases:read (own = owner, creator, or a job you're on); cases:manage writes.
create policy cases_select on public.cases for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('cases:read'))
         and ((select app.perm_scope('cases:read')) = 'all'
              or owner_id = (select app.effective_user_id()) or created_by = (select app.effective_user_id())
              or (job_id is not null and app.job_in_scope((select app.perm_scope('cases:read')), job_id))));
create policy cases_insert on public.cases for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('cases:manage'))
              and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = account_id)));
create policy cases_update on public.cases for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('cases:manage'))
         and ((select app.perm_scope('cases:read')) = 'all'
              or owner_id = (select app.effective_user_id()) or created_by = (select app.effective_user_id())
              or (job_id is not null and app.job_in_scope((select app.perm_scope('cases:read')), job_id))))
  with check (org_id = (select app.current_org_id()));

-- Referrals: referrals:manage.
create policy referral_settings_select on public.referral_settings for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy referral_settings_update on public.referral_settings for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('referrals:manage')))
  with check (org_id = (select app.current_org_id()));
create policy referral_champions_select on public.referral_champions for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('referrals:manage')));
create policy referral_champions_insert on public.referral_champions for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('referrals:manage'))
              and exists (select 1 from public.contacts c where c.id = contact_id));
create policy referral_champions_update on public.referral_champions for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('referrals:manage')))
  with check (org_id = (select app.current_org_id()));
create policy referrals_select on public.referrals for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('referrals:manage')));
create policy referrals_insert on public.referrals for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('referrals:manage')));
create policy referrals_update on public.referrals for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('referrals:manage')))
  with check (org_id = (select app.current_org_id()));

create policy review_requests_select on public.review_requests for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('reviews:manage')));
create policy review_requests_update on public.review_requests for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('reviews:manage')))
  with check (org_id = (select app.current_org_id()));

-- Campaigns, segments, drips: campaigns:manage.
create policy segments_select on public.segments for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('campaigns:manage')));
create policy segments_insert on public.segments for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('campaigns:manage')));
create policy segments_update on public.segments for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('campaigns:manage')))
  with check (org_id = (select app.current_org_id()));
create policy campaigns_select on public.campaigns for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('campaigns:manage')));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('campaigns:manage')));
create policy campaigns_update on public.campaigns for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('campaigns:manage')))
  with check (org_id = (select app.current_org_id()));
create policy campaign_recipients_select on public.campaign_recipients for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('campaigns:manage')));
create policy drips_select on public.drips for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('campaigns:manage')));
create policy drips_insert on public.drips for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('campaigns:manage')));
create policy drips_update on public.drips for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('campaigns:manage')))
  with check (org_id = (select app.current_org_id()));
create policy drip_enrollments_select on public.drip_enrollments for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('campaigns:manage')));
create policy drip_enrollments_insert on public.drip_enrollments for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('campaigns:manage')));
create policy drip_enrollments_update on public.drip_enrollments for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('campaigns:manage')))
  with check (org_id = (select app.current_org_id()));

-- Follow-up lists: everyone who works leads or jobs reads them; settings:manage edits.
create policy follow_up_lists_select on public.follow_up_lists for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy follow_up_lists_update on public.follow_up_lists for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));
create policy follow_up_dispositions_select on public.follow_up_dispositions for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy follow_up_dispositions_insert on public.follow_up_dispositions for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')));
create policy follow_up_dispositions_update on public.follow_up_dispositions for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));
create policy follow_up_attempts_select on public.follow_up_attempts for select to authenticated
  using (org_id = (select app.current_org_id())
         and app.can_see_subject(subject_type, subject_id));
create policy follow_up_attempts_insert on public.follow_up_attempts for insert to authenticated
  with check (org_id = (select app.current_org_id())
              and ((select app.can_write('leads:update')) or (select app.can_write('jobs:update'))
                   or (select app.can_write('messages:send')))
              and app.can_see_subject(subject_type, subject_id)
              and actor_id = (select app.effective_user_id()));

-- Notification defaults: everyone reads; settings:manage edits. Preferences: your own.
create policy notification_settings_select on public.notification_settings for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy notification_settings_update on public.notification_settings for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));
create policy notification_preferences_select on public.notification_preferences for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select app.effective_user_id()));
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid())
              and not (select app.is_impersonating()));
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid())
         and not (select app.is_impersonating()))
  with check (user_id = (select auth.uid()));
create policy notification_preferences_delete on public.notification_preferences for delete to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid())
         and not (select app.is_impersonating()));

create policy messaging_settings_select on public.messaging_settings for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy messaging_settings_update on public.messaging_settings for update to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.can_write('templates:manage')) or (select app.can_write('settings:manage'))))
  with check (org_id = (select app.current_org_id()));

grant select, insert, update, delete on public.message_templates, public.workflows, public.workflow_runs,
  public.message_threads, public.cases, public.referral_settings, public.referral_champions, public.referrals,
  public.review_requests, public.segments, public.campaigns, public.campaign_recipients, public.drips,
  public.drip_enrollments, public.follow_up_lists, public.follow_up_dispositions, public.follow_up_attempts,
  public.notification_settings, public.notification_preferences, public.messaging_settings to service_role;

-- =============================================================================
-- 13. Backfill: existing messages get their thread (one-time, additive)
-- =============================================================================

insert into public.message_threads (org_id, subject_type, subject_id, contact_id)
select distinct on (m.org_id, m.subject_type, m.subject_id) m.org_id, m.subject_type, m.subject_id, m.contact_id
from public.messages m
order by m.org_id, m.subject_type, m.subject_id, m.created_at desc
on conflict (org_id, subject_type, subject_id) do nothing;

alter table public.messages disable trigger messages_immutable;
alter table public.messages disable trigger messages_audit;
update public.messages m set thread_id = t.id
from public.message_threads t
where m.thread_id is null and t.org_id = m.org_id and t.subject_type = m.subject_type and t.subject_id = m.subject_id;
alter table public.messages enable trigger messages_audit;
alter table public.messages enable trigger messages_immutable;

update public.message_threads t set
  last_message_at = s.last_at,
  last_inbound_at = s.last_in,
  last_outbound_at = s.last_out,
  message_count = s.n,
  inbound_count = s.n_in,
  -- Existing inbound messages count as read: nobody had an inbox before.
  read_at = s.last_at
from (
  select m.thread_id, max(m.created_at) as last_at,
         max(m.created_at) filter (where m.direction = 'inbound') as last_in,
         max(m.created_at) filter (where m.direction = 'outbound') as last_out,
         count(*) as n, count(*) filter (where m.direction = 'inbound') as n_in
  from public.messages m where m.thread_id is not null group by m.thread_id
) s
where s.thread_id = t.id;

update public.message_threads t set
  last_direction = m.direction, last_channel = m.channel,
  last_preview = left(regexp_replace(coalesce(nullif(m.email_subject, '') || ' · ', '') || coalesce(m.body, m.call_outcome, ''), '\s+', ' ', 'g'), 200)
from (
  select distinct on (x.thread_id) x.thread_id, x.direction, x.channel, x.email_subject, x.body, x.call_outcome
  from public.messages x where x.thread_id is not null order by x.thread_id, x.created_at desc
) m
where m.thread_id = t.id and t.last_preview is null;
