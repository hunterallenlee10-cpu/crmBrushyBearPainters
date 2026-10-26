-- Phase 3: Jobs core (SPEC §5.3, §5.4 appointments, §6.2–6.5, §8.5, §8.9, §9).
--
-- jobs + job_financials (contract money, financials:read only) + job_holds +
-- job_team + stage_history + appointments (walkthroughs first) +
-- approval_requests + attention_items / attention_rules.
--
-- Stage changes: the `stage` column only changes inside
-- public.apply_job_stage_change(), which sets a transaction-local flag the jobs
-- guard checks. That function is callable only by the service role, from
-- lib/jobs/stage.ts advanceJobStage() after its permission checks. The
-- database still enforces the gate rules: without an owner override (with a
-- reason, by someone holding job_admin:override) a job only moves one stage
-- forward when that stage's gate passes, or to Closed Lost with a reason.
-- Blocking holds stop Ready to Schedule and later stages even with an override.
--
-- Row security spells out the scope rule inline (see 20261026001000 for why).

-- =============================================================================
-- 0. Helpers
-- =============================================================================

-- Trusted database functions set this flag (transaction-local) before they
-- touch protected job columns (milestones, hold counts, team list, subjects).
create or replace function app.system_update_on()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.system_update', true), '') = 'on';
$$;

create or replace function app.job_stage_order(p_stage text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'walkthrough_scheduled' then 1 when 'walkthrough_complete' then 2
    when 'estimate_sent' then 3 when 'sold' then 4 when 'onboarding' then 5
    when 'ready_to_schedule' then 6 when 'scheduled' then 7 when 'in_progress' then 8
    when 'final_walkthrough' then 9 when 'completed' then 10 when 'invoiced' then 11
    when 'paid_in_full' then 12 when 'closed_won' then 13 when 'closed_lost' then 14
  end;
$$;

-- Delete allowed for trusted code only (test cleanup, demo purge, cascades from
-- a trusted delete); edits refused for everyone.
create or replace function app.deny_write_allow_trusted_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and app.is_trusted() then
    return old;
  end if;
  raise exception 'This record cannot be changed.' using errcode = '42501';
end;
$$;

-- =============================================================================
-- 1. Tables
-- =============================================================================

-- The job (the opportunity). Money lives in job_financials.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_number text not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  account_id uuid not null references public.accounts (id) on delete restrict,
  property_id uuid references public.properties (id) on delete restrict,
  primary_contact_id uuid references public.contacts (id) on delete set null,
  lead_id uuid unique references public.leads (id) on delete set null,
  work_types text[] not null default '{}' check (cardinality(work_types) <= 6),
  stage text not null default 'walkthrough_scheduled' check (app.job_stage_order(stage) is not null),
  stage_entered_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'on_hold', 'won', 'lost')),
  lost_reason text,
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  priority_reason text check (length(priority_reason) <= 500),
  owner_id uuid references public.profiles (id),
  point_of_contact_id uuid references public.profiles (id),
  project_manager_id uuid references public.profiles (id),
  lead_source text,
  lead_sub_source text,
  territory_id uuid references public.territories (id),
  target_season smallint check (target_season between 2000 and 2100),
  promised_start_date date,
  actual_start_date date,
  estimated_duration_days smallint check (estimated_duration_days between 1 and 365),
  estimated_completion_date date,
  accepted_estimate_id uuid,
  health_score smallint check (health_score between 0 and 100),
  health_factors jsonb not null default '[]'::jsonb check (jsonb_typeof(health_factors) = 'array'),
  health_checked_at timestamptz,
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  is_priority_reschedule boolean not null default false,
  on_time_guarantee_status text not null default 'n/a' check (on_time_guarantee_status in (
    'n/a', 'met', 'missed_weather', 'missed_credit_pending', 'credit_applied', 'waived_by_owner')),
  active_hold_count integer not null default 0 check (active_hold_count >= 0),
  blocking_hold_count integer not null default 0 check (blocking_hold_count >= 0),
  team_user_ids uuid[] not null default '{}',
  -- Milestones (SPEC §6.3): stamped by stage changes; edited only in the Admin section.
  lead_created_at timestamptz,
  first_contact_at timestamptz,
  walkthrough_scheduled_at timestamptz,
  walkthrough_completed_at timestamptz,
  estimate_sent_at timestamptz,
  estimate_accepted_at timestamptz,
  contract_signed_at timestamptz,
  deposit_paid_at timestamptz,
  onboarding_started_at timestamptz,
  onboarding_completed_at timestamptz,
  ready_to_schedule_at timestamptz,
  scheduled_at timestamptz,
  work_completed_at timestamptz,
  final_walkthrough_at timestamptz,
  completed_at timestamptz,
  final_invoiced_at timestamptz,
  paid_in_full_at timestamptz,
  closed_at timestamptz,
  lost_at timestamptz,
  search_text text generated always as (lower(job_number || ' ' || name)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, job_number),
  constraint jobs_lost_needs_reason check (stage <> 'closed_lost' or lost_reason is not null)
);
create index jobs_org_created_id_idx on public.jobs (org_id, created_at desc nulls last, id)
  where deleted_at is null;
create index jobs_org_stage_created_id_idx on public.jobs (org_id, stage, created_at desc nulls last, id)
  include (owner_id, created_by, territory_id) where deleted_at is null;
create index jobs_account_idx on public.jobs (account_id);
create index jobs_property_idx on public.jobs (property_id);
create index jobs_contact_idx on public.jobs (primary_contact_id);
create index jobs_owner_idx on public.jobs (owner_id);
create index jobs_poc_idx on public.jobs (point_of_contact_id);
create index jobs_pm_idx on public.jobs (project_manager_id);
create index jobs_territory_idx on public.jobs (territory_id);
create index jobs_created_by_idx on public.jobs (created_by);
create index jobs_team_idx on public.jobs using gin (team_user_ids);
create index jobs_search_trgm_idx on public.jobs using gin (search_text extensions.gin_trgm_ops);
create index jobs_promised_start_idx on public.jobs (org_id, promised_start_date) where deleted_at is null;

alter table public.leads
  add constraint leads_converted_job_fk foreign key (converted_job_id) references public.jobs (id) on delete set null;
create index leads_converted_job_idx on public.leads (converted_job_id);

-- Contract money, readable only with financials:read (crew roles never see it).
-- Until estimates exist (Phase 4) an owner sets a contract baseline in Admin.
create table public.job_financials (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete restrict,
  contract_baseline_cents bigint check (contract_baseline_cents between 0 and 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index job_financials_org_idx on public.job_financials (org_id);

-- Holds overlay the stage ("Onboarding · HOA Hold"); they never change it.
create table public.job_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  hold_type text not null,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  blocks_scheduling boolean not null default true,
  placed_by uuid,
  placed_at timestamptz not null default now(),
  released_by uuid,
  released_at timestamptz,
  release_note text check (length(release_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_holds_job_idx on public.job_holds (job_id);
create index job_holds_active_idx on public.job_holds (org_id, hold_type) where released_at is null;

-- Internal team on a job (SPEC §5.3).
create table public.job_team (
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('estimator', 'point_of_contact', 'project_manager', 'office', 'painter')),
  org_id uuid not null references public.organizations (id) on delete restrict,
  added_at timestamptz not null default now(),
  added_by uuid,
  primary key (job_id, user_id, role)
);
create index job_team_user_idx on public.job_team (user_id);

-- Every stage change, append-only.
create table public.stage_history (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  from_stage text check (from_stage is null or app.job_stage_order(from_stage) is not null),
  to_stage text not null check (app.job_stage_order(to_stage) is not null),
  changed_at timestamptz not null default clock_timestamp(),
  changed_by uuid,
  impersonated_by uuid,
  override boolean not null default false,
  reason text check (length(reason) <= 1000),
  gate jsonb not null default '{}'::jsonb check (jsonb_typeof(gate) = 'object'),
  approval_request_id uuid,
  check (not override or length(btrim(coalesce(reason, ''))) >= 10)
);
create index stage_history_job_idx on public.stage_history (job_id, seq desc);
create index stage_history_org_idx on public.stage_history (org_id, changed_at desc);

-- Appointments (SPEC §5.4). Walkthroughs first; production days arrive in Phase 6.
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid references public.jobs (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  type text not null check (type in (
    'walkthrough', 'color_consultation', 'interior_production', 'exterior_production', 'cabinet_shop',
    'deck_fence', 'pressure_washing', 'rot_repair', 'final_walkthrough', 'touch_up', 'warranty_visit',
    'paint_pickup')),
  title text check (length(title) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  assigned_user_ids uuid[] not null default '{}' check (cardinality(assigned_user_ids) <= 20),
  status text not null default 'scheduled' check (status in (
    'tentative', 'scheduled', 'confirmed', 'in_progress', 'completed', 'no_show', 'rescheduled', 'canceled')),
  result text check (result in ('measured', 'needs_second_visit', 'customer_no_show', 'not_a_fit')),
  location text check (length(location) <= 300),
  notes text check (length(notes) <= 2000),
  confirmed_at timestamptz,
  completed_at timestamptz,
  canceled_reason text check (length(canceled_reason) <= 500),
  external_calendar_event_id text check (length(external_calendar_event_id) <= 300),
  reminders jsonb not null default '{}'::jsonb check (jsonb_typeof(reminders) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  check (job_id is not null or lead_id is not null),
  check (ends_at > starts_at),
  check (result is null or status = 'completed'),
  check (type <> 'walkthrough' or status <> 'completed' or result is not null)
);
create index appointments_job_idx on public.appointments (job_id, starts_at);
create index appointments_lead_idx on public.appointments (lead_id, starts_at);
create index appointments_org_start_idx on public.appointments (org_id, starts_at) where deleted_at is null;
create index appointments_assigned_idx on public.appointments using gin (assigned_user_ids);

-- Owner approvals (SPEC §8.5 "Approvals"). Phase 3: stage overrides requested
-- by non-owners. Discounts, change orders and credits join in later phases.
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  type text not null check (type in ('stage_override')),
  job_id uuid not null references public.jobs (id) on delete cascade,
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'canceled')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);
create unique index approval_requests_one_pending_idx on public.approval_requests (job_id, type)
  where status = 'pending';
create index approval_requests_org_status_idx on public.approval_requests (org_id, status, requested_at desc);
create index approval_requests_requester_idx on public.approval_requests (requested_by);

-- Attention engine (SPEC §9): the worker upserts items; they auto-resolve.
create table public.attention_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  rule_key text not null check (rule_key ~ '^[a-z_]+$'),
  category text not null check (category in (
    'communication', 'tasks', 'scheduling', 'sales', 'approvals', 'financial', 'production', 'qa',
    'customer', 'documents')),
  priority text not null check (priority in ('critical', 'high', 'medium', 'low')),
  title text not null check (length(title) between 1 and 200),
  detail text check (length(detail) <= 1000),
  subject_type text not null check (subject_type in ('lead', 'job')),
  subject_id uuid not null,
  owner_id uuid references public.profiles (id) on delete set null,
  due_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'snoozed', 'resolved')),
  snoozed_until timestamptz,
  resolution text check (resolution in ('auto', 'manual')),
  resolution_note text check (length(resolution_note) <= 1000),
  resolved_at timestamptz,
  resolved_by uuid,
  condition_cleared_at timestamptz,
  dedupe_key text not null check (length(dedupe_key) <= 300),
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'resolved') = (resolved_at is not null)),
  check (status <> 'snoozed' or snoozed_until is not null)
);
create unique index attention_items_open_key_idx on public.attention_items (org_id, dedupe_key)
  where status <> 'resolved';
create index attention_items_key_idx on public.attention_items (org_id, dedupe_key, resolved_at desc);
create index attention_items_open_idx on public.attention_items (org_id, status, priority)
  where status <> 'resolved';
create index attention_items_owner_idx on public.attention_items (owner_id) where status <> 'resolved';
create index attention_items_subject_idx on public.attention_items (subject_type, subject_id);

-- Editable thresholds per rule (Admin → Attention Rules).
create table public.attention_rules (
  org_id uuid not null references public.organizations (id) on delete cascade,
  rule_key text not null check (rule_key ~ '^[a-z_]+$'),
  enabled boolean not null default true,
  thresholds jsonb not null default '{}'::jsonb check (jsonb_typeof(thresholds) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  primary key (org_id, rule_key)
);

-- Notes, comments, tasks and messages can belong to a job.
alter table public.notes drop constraint notes_subject_type_check,
  add constraint notes_subject_type_check check (subject_type in ('lead', 'account', 'contact', 'job'));
alter table public.comments drop constraint comments_subject_type_check,
  add constraint comments_subject_type_check check (subject_type in ('lead', 'account', 'contact', 'job'));
alter table public.tasks drop constraint tasks_subject_type_check,
  add constraint tasks_subject_type_check check (subject_type in ('lead', 'account', 'contact', 'job'));
alter table public.messages drop constraint messages_subject_type_check,
  add constraint messages_subject_type_check check (subject_type in ('lead', 'account', 'contact', 'job'));

-- =============================================================================
-- 2. Guards and bookkeeping
-- =============================================================================

-- Everyone who counts as "on" the job for own-scope visibility.
create or replace function app.job_team_ids(p_job uuid, p_owner uuid, p_poc uuid, p_pm uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct u order by u), '{}')
  from (
    select unnest(array[p_owner, p_poc, p_pm]) as u
    union
    select t.user_id from public.job_team t where t.job_id = p_job
  ) x
  where u is not null;
$$;

create or replace function app.jobs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := app.is_trusted() or app.system_update_on();
  v_stage_change boolean := coalesce(current_setting('app.stage_change', true), '') = 'on';
  v_wt text;
  v_old jsonb;
  v_new jsonb;
  v_milestones text[] := array[
    'lead_created_at', 'first_contact_at', 'walkthrough_scheduled_at', 'walkthrough_completed_at',
    'estimate_sent_at', 'estimate_accepted_at', 'contract_signed_at', 'deposit_paid_at',
    'onboarding_started_at', 'onboarding_completed_at', 'ready_to_schedule_at', 'scheduled_at',
    'actual_start_date', 'work_completed_at', 'final_walkthrough_at', 'completed_at',
    'final_invoiced_at', 'paid_in_full_at', 'closed_at', 'lost_at'];
  v_m text;
begin
  if tg_op = 'INSERT' then
    -- New jobs start at Walkthrough Scheduled with a fresh number.
    if not v_stage_change then
      new.stage := 'walkthrough_scheduled';
      new.lost_reason := null;
    end if;
    new.stage_entered_at := now();
    new.job_number := app.next_number(new.org_id, 'job', now());
    new.active_hold_count := 0;
    new.blocking_hold_count := 0;
    if not v_trusted then
      new.health_score := null;
      new.health_factors := '[]'::jsonb;
      new.health_checked_at := null;
      new.lead_id := null;
      v_new := to_jsonb(new);
      foreach v_m in array v_milestones loop
        if v_new ->> v_m is not null and not app.can_write('job_admin:override') then
          raise exception 'Milestone dates are set by the job''s stages (owners can edit them in Admin).'
            using errcode = '42501';
        end if;
      end loop;
      if new.owner_id is not null and new.owner_id <> app.effective_user_id() and not app.can_write('jobs:assign') then
        raise exception 'Only people who can assign jobs can create a job for someone else.' using errcode = '42501';
      end if;
    end if;
  else
    if new.org_id <> old.org_id then
      raise exception 'A job cannot move to another organization.' using errcode = '42501';
    end if;
    -- The stage changes only through Advance stage (public.apply_job_stage_change).
    if (new.stage is distinct from old.stage or new.stage_entered_at is distinct from old.stage_entered_at
        or new.lost_reason is distinct from old.lost_reason) and not v_stage_change then
      raise exception 'Job stages change only through Advance stage.' using errcode = '42501';
    end if;
    new.job_number := old.job_number;
    if not v_trusted then
      new.lead_id := old.lead_id;
      new.health_score := old.health_score;
      new.health_factors := old.health_factors;
      new.health_checked_at := old.health_checked_at;
      new.active_hold_count := old.active_hold_count;
      new.blocking_hold_count := old.blocking_hold_count;
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
      foreach v_m in array v_milestones loop
        if (v_new -> v_m) is distinct from (v_old -> v_m) and not app.can_write('job_admin:override') then
          raise exception 'Milestone dates are edited in the job''s Admin section by an owner.' using errcode = '42501';
        end if;
      end loop;
      if new.owner_id is distinct from old.owner_id and not app.can_write('jobs:assign') then
        raise exception 'Only people who can assign jobs can change the owner.' using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' or new.account_id is distinct from old.account_id then
    perform app.check_same_org(new.org_id, 'accounts', new.account_id, 'Account');
  end if;
  if new.property_id is not null and (tg_op = 'INSERT' or new.property_id is distinct from old.property_id
                                      or new.account_id is distinct from old.account_id) then
    if not exists (select 1 from public.properties p
                   where p.id = new.property_id and p.account_id = new.account_id and p.org_id = new.org_id) then
      raise exception 'The property must belong to the job''s account.' using errcode = '23514';
    end if;
  end if;
  if new.primary_contact_id is not null and (tg_op = 'INSERT' or new.primary_contact_id is distinct from old.primary_contact_id
                                             or new.account_id is distinct from old.account_id) then
    if not exists (select 1 from public.contacts c
                   where c.id = new.primary_contact_id and c.account_id = new.account_id and c.org_id = new.org_id) then
      raise exception 'The primary contact must be one of the account''s contacts.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    perform app.check_same_org(new.org_id, 'profiles', new.owner_id, 'Owner');
  end if;
  if tg_op = 'INSERT' or new.point_of_contact_id is distinct from old.point_of_contact_id then
    perform app.check_same_org(new.org_id, 'profiles', new.point_of_contact_id, 'Point of contact');
  end if;
  if tg_op = 'INSERT' or new.project_manager_id is distinct from old.project_manager_id then
    perform app.check_same_org(new.org_id, 'profiles', new.project_manager_id, 'Project manager');
  end if;
  if tg_op = 'INSERT' or new.territory_id is distinct from old.territory_id then
    perform app.check_same_org(new.org_id, 'territories', new.territory_id, 'Territory');
  end if;

  -- Picklist values (keys), no duplicate work types.
  if tg_op = 'INSERT' or new.work_types is distinct from old.work_types then
    if cardinality(new.work_types) <> (select count(distinct w) from unnest(new.work_types) w) then
      raise exception 'Each work type can only be listed once.' using errcode = '23514';
    end if;
    foreach v_wt in array new.work_types loop
      perform app.check_picklist(new.org_id, 'work_type', v_wt, 'Work type');
    end loop;
  end if;
  if tg_op = 'INSERT' or new.lead_source is distinct from old.lead_source then
    perform app.check_picklist(new.org_id, 'lead_source', new.lead_source, 'Lead source');
  end if;
  if tg_op = 'INSERT' or new.lead_sub_source is distinct from old.lead_sub_source then
    perform app.check_picklist(new.org_id, 'lead_sub_source', new.lead_sub_source, 'Lead sub-source');
  end if;
  if tg_op = 'INSERT' or new.lost_reason is distinct from old.lost_reason then
    perform app.check_picklist(new.org_id, 'lost_reason', new.lost_reason, 'Lost reason');
  end if;

  -- Territory follows the property unless set.
  if new.territory_id is null and new.property_id is not null then
    select p.territory_id into new.territory_id from public.properties p where p.id = new.property_id;
  end if;

  new.status := case
    when new.stage = 'closed_won' then 'won'
    when new.stage = 'closed_lost' then 'lost'
    when new.active_hold_count > 0 then 'on_hold'
    else 'open'
  end;
  new.team_user_ids := app.job_team_ids(new.id, new.owner_id, new.point_of_contact_id, new.project_manager_id);
  return new;
end;
$$;

-- First stage_history row and timeline entry for every new job.
create or replace function app.jobs_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stage_history (org_id, job_id, from_stage, to_stage, changed_by, impersonated_by, reason)
  values (new.org_id, new.id, null, new.stage, app.actor_id(), app.impersonator_id(),
          case when new.lead_id is not null then 'Converted from lead' else 'Job created' end);
  perform app.log_activity(new.org_id, 'job', new.id::text, 'job_created',
    case when new.lead_id is not null then 'Job created from a lead' else 'Job created' end,
    jsonb_build_object('job_number', new.job_number, 'lead_id', new.lead_id));
  return null;
end;
$$;

-- Human-readable job timeline for field changes (stage changes log their own).
create or replace function app.jobs_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.owner_id is distinct from old.owner_id then
    select p.full_name into v_name from public.profiles p where p.id = new.owner_id;
    perform app.log_activity(new.org_id, 'job', new.id::text, 'owner_changed',
      case when new.owner_id is null then 'Owner removed' else 'Owner set to ' || coalesce(v_name, 'a teammate') end,
      jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  if new.point_of_contact_id is distinct from old.point_of_contact_id then
    select p.full_name into v_name from public.profiles p where p.id = new.point_of_contact_id;
    perform app.log_activity(new.org_id, 'job', new.id::text, 'poc_changed',
      case when new.point_of_contact_id is null then 'Point of contact removed'
           else 'Point of contact set to ' || coalesce(v_name, 'a teammate') end,
      jsonb_build_object('from', old.point_of_contact_id, 'to', new.point_of_contact_id));
  end if;
  if new.project_manager_id is distinct from old.project_manager_id then
    select p.full_name into v_name from public.profiles p where p.id = new.project_manager_id;
    perform app.log_activity(new.org_id, 'job', new.id::text, 'pm_changed',
      case when new.project_manager_id is null then 'Project manager removed'
           else 'Project manager set to ' || coalesce(v_name, 'a teammate') end,
      jsonb_build_object('from', old.project_manager_id, 'to', new.project_manager_id));
  end if;
  if new.priority is distinct from old.priority then
    perform app.log_activity(new.org_id, 'job', new.id::text, 'priority_changed',
      'Priority changed to ' || initcap(new.priority),
      jsonb_build_object('from', old.priority, 'to', new.priority, 'reason', new.priority_reason));
  end if;
  if new.promised_start_date is distinct from old.promised_start_date then
    perform app.log_activity(new.org_id, 'job', new.id::text, 'promised_start_changed',
      case when new.promised_start_date is null then 'Promised start date cleared'
           else 'Promised start date set to ' || to_char(new.promised_start_date, 'Mon DD, YYYY') end,
      jsonb_build_object('from', old.promised_start_date, 'to', new.promised_start_date));
  end if;
  return null;
end;
$$;

create or replace function app.job_financials_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select j.org_id into v_org from public.jobs j where j.id = new.job_id;
  if v_org is null or v_org <> new.org_id then
    raise exception 'The job does not belong to this organization.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.job_id <> old.job_id then
    raise exception 'Financials cannot move to another job.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Holds: placing and releasing (released holds stay for history).
create or replace function app.job_holds_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    perform app.check_picklist(new.org_id, 'hold_type', new.hold_type, 'Hold type');
    if not app.is_trusted() then
      new.placed_by := app.actor_id();
      new.placed_at := now();
      new.released_at := null;
      new.released_by := null;
      new.release_note := null;
    end if;
    return new;
  end if;
  if old.released_at is not null then
    raise exception 'This hold is already released.' using errcode = '23514';
  end if;
  if new.job_id <> old.job_id or new.org_id <> old.org_id or new.hold_type <> old.hold_type
     or new.reason <> old.reason or new.blocks_scheduling <> old.blocks_scheduling
     or new.placed_by is distinct from old.placed_by or new.placed_at <> old.placed_at then
    raise exception 'A hold can only be released. Release it and place a new one instead.' using errcode = '23514';
  end if;
  if new.released_at is not null then
    new.released_at := now();
    new.released_by := coalesce(app.actor_id(), new.released_by);
  end if;
  return new;
end;
$$;

create or replace function app.job_holds_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  perform set_config('app.system_update', 'on', true);
  update public.jobs j set
    active_hold_count = (select count(*) from public.job_holds h where h.job_id = new.job_id and h.released_at is null),
    blocking_hold_count = (select count(*) from public.job_holds h
                           where h.job_id = new.job_id and h.released_at is null and h.blocks_scheduling)
  where j.id = new.job_id;
  perform set_config('app.system_update', 'off', true);

  select pv.label into v_label
  from public.picklist_values pv join public.picklists p on p.id = pv.picklist_id
  where p.org_id = new.org_id and p.key = 'hold_type' and pv.value = new.hold_type;

  if tg_op = 'INSERT' then
    perform app.log_activity(new.org_id, 'job', new.job_id::text, 'hold_added',
      coalesce(v_label, new.hold_type) || ' hold placed: ' || new.reason,
      jsonb_build_object('hold_id', new.id, 'hold_type', new.hold_type, 'blocks_scheduling', new.blocks_scheduling));
    perform app.emit_event(new.org_id, 'job.hold_added', 'job', new.job_id::text,
      jsonb_build_object('hold_id', new.id, 'hold_type', new.hold_type));
  elsif new.released_at is not null and old.released_at is null then
    perform app.log_activity(new.org_id, 'job', new.job_id::text, 'hold_released',
      coalesce(v_label, new.hold_type) || ' hold released' || coalesce(': ' || nullif(btrim(new.release_note), ''), ''),
      jsonb_build_object('hold_id', new.id, 'hold_type', new.hold_type));
    perform app.emit_event(new.org_id, 'job.hold_released', 'job', new.job_id::text,
      jsonb_build_object('hold_id', new.id, 'hold_type', new.hold_type));
  end if;
  return null;
end;
$$;

create or replace function app.job_team_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
  perform app.check_same_org(new.org_id, 'profiles', new.user_id, 'Team member');
  new.added_at := now();
  new.added_by := coalesce(app.actor_id(), new.added_by);
  return new;
end;
$$;

create or replace function app.job_team_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid := coalesce(new.job_id, old.job_id);
begin
  perform set_config('app.system_update', 'on', true);
  update public.jobs j
     set team_user_ids = app.job_team_ids(j.id, j.owner_id, j.point_of_contact_id, j.project_manager_id)
   where j.id = v_job;
  perform set_config('app.system_update', 'off', true);
  return null;
end;
$$;

-- Appointments: org-matching links, status stamps, lead walkthrough date.
create or replace function app.appointments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'An appointment cannot move to another organization.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' or new.job_id is distinct from old.job_id then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
  end if;
  if tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id then
    perform app.check_same_org(new.org_id, 'leads', new.lead_id, 'Lead');
  end if;
  if (tg_op = 'INSERT' or new.assigned_user_ids is distinct from old.assigned_user_ids)
     and exists (select 1 from unnest(new.assigned_user_ids) u
                 where not exists (select 1 from public.profiles p where p.id = u and p.org_id = new.org_id)) then
    raise exception 'Everyone assigned must be on the team.' using errcode = '42501';
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status <> 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
    new.result := null;
  end if;
  return new;
end;
$$;

create or replace function app.appointments_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := initcap(replace(new.type, '_', ' '));
  v_subject_type text := case when new.job_id is not null then 'job' else 'lead' end;
  v_subject_id uuid := coalesce(new.job_id, new.lead_id);
begin
  -- The lead keeps showing its latest booked walkthrough (Lead List / Detail).
  if new.lead_id is not null and new.type = 'walkthrough' then
    update public.leads l set walkthrough_at = (
      select a.starts_at from public.appointments a
      where a.lead_id = new.lead_id and a.type = 'walkthrough' and a.deleted_at is null
        and a.status not in ('canceled', 'rescheduled', 'no_show')
      order by a.starts_at desc limit 1)
    where l.id = new.lead_id;
  end if;

  if tg_op = 'INSERT' then
    -- A lead's walkthrough is already logged by the lead ("Walkthrough booked").
    if v_subject_type = 'lead' and new.type = 'walkthrough' then
      return null;
    end if;
    perform app.log_activity(new.org_id, v_subject_type, v_subject_id::text, 'appointment_booked',
      v_label || ' booked for ' || to_char(new.starts_at at time zone 'America/Los_Angeles', 'Mon DD, YYYY HH12:MI AM'),
      jsonb_build_object('appointment_id', new.id, 'type', new.type, 'starts_at', new.starts_at));
  elsif new.status is distinct from old.status then
    perform app.log_activity(new.org_id, v_subject_type, v_subject_id::text, 'appointment_' || new.status,
      v_label || ' ' || replace(new.status, '_', ' ')
        || coalesce(' (' || replace(new.result, '_', ' ') || ')', ''),
      jsonb_build_object('appointment_id', new.id, 'type', new.type, 'status', new.status, 'result', new.result));
    if new.status = 'completed' then
      perform app.emit_event(new.org_id, 'appointment.completed', 'appointment', new.id::text,
        jsonb_build_object('type', new.type, 'result', new.result, 'job_id', new.job_id, 'lead_id', new.lead_id));
    end if;
  end if;
  return null;
end;
$$;

-- Approval requests: requester stamped; only owners decide; requesters may cancel.
create or replace function app.approval_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    if not app.is_trusted() and not app.can_write('job_admin:override') then
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

-- Attention items: people assign, snooze and resolve (with a note); the worker does the rest.
create or replace function app.attention_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_trusted() then
    return new;
  end if;
  if old.status = 'resolved' then
    raise exception 'This item is already resolved.' using errcode = '23514';
  end if;
  if new.owner_id is distinct from old.owner_id then
    perform app.check_same_org(new.org_id, 'profiles', new.owner_id, 'Owner');
  end if;
  if new.status = 'snoozed' then
    if new.snoozed_until is null or new.snoozed_until <= now() then
      raise exception 'Pick a time in the future to snooze until.' using errcode = '23514';
    end if;
  elsif new.status <> 'snoozed' then
    new.snoozed_until := null;
  end if;
  if new.status = 'resolved' then
    if length(btrim(coalesce(new.resolution_note, ''))) < 3 then
      raise exception 'Add a short note saying how it was resolved.' using errcode = '23514';
    end if;
    new.resolution := 'manual';
    new.resolved_at := now();
    new.resolved_by := app.effective_user_id();
  end if;
  return new;
end;
$$;

-- Subjects: jobs join; trusted functions (lead conversion) may move notes/comments/tasks.
create or replace function app.subject_table(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'lead' then 'leads' when 'account' then 'accounts' when 'contact' then 'contacts' when 'job' then 'jobs'
  end;
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
    if new.org_id <> old.org_id then
      raise exception 'A note, comment or task cannot be moved to another organization.' using errcode = '42501';
    end if;
    if ((to_jsonb(new) ->> 'subject_id') is distinct from (to_jsonb(old) ->> 'subject_id')
        or (to_jsonb(new) ->> 'subject_type') is distinct from (to_jsonb(old) ->> 'subject_type')) then
      if not app.system_update_on() then
        raise exception 'A note, comment or task cannot be moved to another record.' using errcode = '42501';
      end if;
      perform app.check_same_org(v_org, app.subject_table(v_type), v_id, 'The record');
    end if;
    return new;
  end if;
  if v_type is not null then
    perform app.check_same_org(v_org, app.subject_table(v_type), v_id, 'The record');
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 3. Triggers
-- =============================================================================

create trigger jobs_guard before insert or update on public.jobs
  for each row execute function app.jobs_guard();
create trigger jobs_after_insert after insert on public.jobs
  for each row execute function app.jobs_after_insert();
create trigger jobs_activity after update on public.jobs
  for each row execute function app.jobs_activity();
create trigger job_financials_guard before insert or update on public.job_financials
  for each row execute function app.job_financials_guard();
create trigger job_holds_guard before insert or update on public.job_holds
  for each row execute function app.job_holds_guard();
create trigger job_holds_after after insert or update on public.job_holds
  for each row execute function app.job_holds_after();
create trigger job_team_guard before insert on public.job_team
  for each row execute function app.job_team_guard();
create trigger job_team_after after insert or delete on public.job_team
  for each row execute function app.job_team_after();
create trigger appointments_guard before insert or update on public.appointments
  for each row execute function app.appointments_guard();
create trigger appointments_after after insert or update on public.appointments
  for each row execute function app.appointments_after();
create trigger approval_requests_guard before insert or update on public.approval_requests
  for each row execute function app.approval_requests_guard();
create trigger attention_items_guard before update on public.attention_items
  for each row execute function app.attention_items_guard();
create trigger stage_history_immutable before update or delete on public.stage_history
  for each row execute function app.deny_write_allow_trusted_delete();

do $$
declare
  t text;
begin
  foreach t in array array['jobs', 'job_financials', 'appointments', 'attention_rules'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function app.stamp_actor()', t, t);
  end loop;
  foreach t in array array['job_holds', 'approval_requests', 'attention_items'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
  end loop;
end
$$;

-- Audit + events. Derived bookkeeping (health, team list, hold counts, search
-- text, attention last_seen) stays out of the audit log.
create trigger jobs_audit after insert or update or delete on public.jobs
  for each row execute function app.audit_row('search_text', 'team_user_ids', 'health_score', 'health_factors',
    'health_checked_at', 'active_hold_count', 'blocking_hold_count');
create trigger job_financials_audit after insert or update or delete on public.job_financials
  for each row execute function app.audit_row();
create trigger job_holds_audit after insert or update or delete on public.job_holds
  for each row execute function app.audit_row();
create trigger job_team_audit after insert or update or delete on public.job_team
  for each row execute function app.audit_row();
create trigger stage_history_audit after insert on public.stage_history
  for each row execute function app.audit_row();
create trigger appointments_audit after insert or update or delete on public.appointments
  for each row execute function app.audit_row();
create trigger approval_requests_audit after insert or update or delete on public.approval_requests
  for each row execute function app.audit_row();
create trigger attention_items_audit after insert or update or delete on public.attention_items
  for each row execute function app.audit_row('last_seen_at');
create trigger attention_rules_audit after insert or update or delete on public.attention_rules
  for each row execute function app.audit_row();

create trigger jobs_event after insert or update or delete on public.jobs
  for each row execute function app.emit_change_event('job', 'search_text', 'team_user_ids', 'health_score',
    'health_factors', 'health_checked_at', 'active_hold_count', 'blocking_hold_count');
create trigger job_financials_event after insert or update or delete on public.job_financials
  for each row execute function app.emit_change_event('job_financials');
create trigger job_team_event after insert or delete on public.job_team
  for each row execute function app.emit_change_event('job_team');
create trigger appointments_event after insert or update or delete on public.appointments
  for each row execute function app.emit_change_event('appointment');
create trigger approval_requests_event after insert or update on public.approval_requests
  for each row execute function app.emit_change_event('approval');
create trigger attention_items_event after insert or update on public.attention_items
  for each row execute function app.emit_change_event('attention_item', 'last_seen_at');
create trigger attention_rules_event after update on public.attention_rules
  for each row execute function app.emit_change_event('attention_rule');

-- =============================================================================
-- 4. Visibility helpers
-- =============================================================================

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
    when 'job' then exists (select 1 from public.jobs j where j.id = p_id)
    else false
  end;
$$;

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
    when 'job' then exists (
      select 1 from public.jobs j where j.id = p_id
        and (app.perm_scope('jobs:update') = 'all'
             or (app.perm_scope('jobs:update') in ('own', 'team')
                 and (app.effective_user_id() in (j.owner_id, j.created_by) or app.effective_user_id() = any(j.team_user_ids)))
             or (app.perm_scope('jobs:update') = 'team' and j.territory_id = app.my_territory_id())))
    else false
  end;
$$;

create or replace function app.can_read_activity(p_type text, p_id text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_type in ('lead', 'account', 'contact', 'job') then
    return app.can_see_subject(p_type, p_id::uuid);
  end if;
  return app.can_read_subject(p_type);
exception when invalid_text_representation then
  return false;
end;
$$;

-- =============================================================================
-- 5. Row level security
-- =============================================================================

alter table public.jobs enable row level security;
alter table public.job_financials enable row level security;
alter table public.job_holds enable row level security;
alter table public.job_team enable row level security;
alter table public.stage_history enable row level security;
alter table public.appointments enable row level security;
alter table public.approval_requests enable row level security;
alter table public.attention_items enable row level security;
alter table public.attention_rules enable row level security;

revoke delete on public.jobs, public.job_financials, public.job_holds, public.appointments,
  public.approval_requests, public.attention_items, public.attention_rules from authenticated;
revoke insert, update, delete on public.stage_history from authenticated;
revoke insert on public.attention_items, public.attention_rules from authenticated;
revoke update on public.job_team from authenticated;
-- People only assign, snooze and resolve attention items.
revoke update on public.attention_items from authenticated;
grant update (status, snoozed_until, owner_id, resolution_note) on public.attention_items to authenticated;

-- jobs: own = owner, creator, point of contact, project manager or on the job team;
-- team = own plus the territory; all = everything.
create policy jobs_select on public.jobs for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and (
      (select app.perm_scope('jobs:read')) = 'all'
      or ((select app.perm_scope('jobs:read')) in ('own', 'team')
          and ((select app.effective_user_id()) in (owner_id, created_by)
               or (select app.effective_user_id()) = any(team_user_ids)))
      or ((select app.perm_scope('jobs:read')) = 'team' and territory_id = (select app.my_territory_id()))
    )
  );
create policy jobs_insert on public.jobs for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('jobs:create')));
create policy jobs_update on public.jobs for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and (
      (select app.perm_scope('jobs:update')) = 'all'
      or ((select app.perm_scope('jobs:update')) in ('own', 'team')
          and ((select app.effective_user_id()) in (owner_id, created_by)
               or (select app.effective_user_id()) = any(team_user_ids)))
      or ((select app.perm_scope('jobs:update')) = 'team' and territory_id = (select app.my_territory_id()))
    )
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

create policy job_financials_select on public.job_financials for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('financials:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy job_financials_insert on public.job_financials for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('job_admin:override'))
              and exists (select 1 from public.jobs j where j.id = job_id));
create policy job_financials_update on public.job_financials for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('job_admin:override'))
         and exists (select 1 from public.jobs j where j.id = job_id))
  with check (org_id = (select app.current_org_id()));

create policy job_holds_select on public.job_holds for select to authenticated
  using (org_id = (select app.current_org_id()) and exists (select 1 from public.jobs j where j.id = job_id));
create policy job_holds_insert on public.job_holds for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('jobs:update'))
              and app.can_edit_subject('job', job_id));
create policy job_holds_update on public.job_holds for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('jobs:update'))
         and app.can_edit_subject('job', job_id))
  with check (org_id = (select app.current_org_id()));

create policy job_team_select on public.job_team for select to authenticated
  using (org_id = (select app.current_org_id()) and exists (select 1 from public.jobs j where j.id = job_id));
create policy job_team_insert on public.job_team for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('jobs:assign'))
              and app.can_edit_subject('job', job_id));
create policy job_team_delete on public.job_team for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('jobs:assign'))
         and app.can_edit_subject('job', job_id));

create policy stage_history_select on public.stage_history for select to authenticated
  using (org_id = (select app.current_org_id()) and exists (select 1 from public.jobs j where j.id = job_id));

create policy appointments_select on public.appointments for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.has_perm('appointments:read'))
    and ((select app.effective_user_id()) = any(assigned_user_ids)
         or (job_id is not null and app.can_see_subject('job', job_id))
         or (job_id is null and lead_id is not null and app.can_see_subject('lead', lead_id)))
  );
create policy appointments_insert on public.appointments for insert to authenticated
  with check (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('appointments:manage'))
    and ((job_id is not null and app.can_see_subject('job', job_id))
         or (job_id is null and lead_id is not null and app.can_see_subject('lead', lead_id)))
  );
create policy appointments_update on public.appointments for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('appointments:manage'))
    and ((select app.effective_user_id()) = any(assigned_user_ids)
         or (job_id is not null and app.can_see_subject('job', job_id))
         or (job_id is null and lead_id is not null and app.can_see_subject('lead', lead_id)))
  )
  with check (org_id = (select app.current_org_id()));

create policy approval_requests_select on public.approval_requests for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (requested_by = (select app.effective_user_id()) or (select app.has_perm('job_admin:override')))
    and exists (select 1 from public.jobs j where j.id = job_id)
  );
create policy approval_requests_insert on public.approval_requests for insert to authenticated
  with check (
    org_id = (select app.current_org_id()) and (select app.can_write('jobs:advance_stage'))
    and exists (select 1 from public.jobs j where j.id = job_id)
  );
create policy approval_requests_update on public.approval_requests for update to authenticated
  using (
    org_id = (select app.current_org_id()) and not (select app.is_impersonating())
    and (requested_by = (select app.effective_user_id()) or (select app.has_perm('job_admin:override')))
  )
  with check (org_id = (select app.current_org_id()));

create policy attention_items_select on public.attention_items for select to authenticated
  using (
    org_id = (select app.current_org_id()) and (select app.has_perm('attention:read'))
    and ((select app.perm_scope('attention:read')) = 'all'
         or owner_id = (select app.effective_user_id())
         or app.can_see_subject(subject_type, subject_id))
  );
create policy attention_items_update on public.attention_items for update to authenticated
  using (
    org_id = (select app.current_org_id()) and not (select app.is_impersonating())
    and (select app.has_perm('attention:read'))
    and ((select app.perm_scope('attention:read')) = 'all'
         or owner_id = (select app.effective_user_id())
         or app.can_see_subject(subject_type, subject_id))
  )
  with check (org_id = (select app.current_org_id()));

create policy attention_rules_select on public.attention_rules for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy attention_rules_update on public.attention_rules for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));

grant execute on function app.job_stage_order(text), app.system_update_on() to authenticated, service_role;

-- =============================================================================
-- 6. Stage engine (database side of advanceJobStage)
-- =============================================================================

-- Gates whose data exists in this build. Later phases extend this alongside
-- lib/domain/jobs/gates.ts (the two must agree; both are tested).
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
    when 'paid_in_full' then true
    else false
  end;
$$;

create or replace function public.apply_job_stage_change(
  p_job uuid,
  p_from text,
  p_to text,
  p_override boolean default false,
  p_reason text default null,
  p_lost_reason text default null,
  p_gate jsonb default '{}'::jsonb,
  p_approval_request uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_actor uuid := app.actor_id();
  v_from_order integer;
  v_to_order integer;
  v_needs_override boolean;
  v_history uuid;
  v_to_label text;
  v_from_label text;
begin
  select * into v_job from public.jobs where id = p_job for update;
  if not found or v_job.deleted_at is not null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if v_job.stage <> p_from then
    raise exception 'This job moved to another stage meanwhile. Reload and try again.' using errcode = '40001';
  end if;
  v_from_order := app.job_stage_order(v_job.stage);
  v_to_order := app.job_stage_order(p_to);
  if v_to_order is null then
    raise exception 'Unknown stage: %', p_to using errcode = '22023';
  end if;
  if p_to = v_job.stage then
    raise exception 'The job is already in that stage.' using errcode = '22023';
  end if;

  if p_to = 'closed_lost' then
    if p_lost_reason is null then
      raise exception 'Pick a lost reason to close the job as lost.' using errcode = '23514';
    end if;
    perform app.check_picklist(v_job.org_id, 'lost_reason', p_lost_reason, 'Lost reason');
    v_needs_override := v_job.stage = 'closed_won';
  elsif v_job.stage in ('closed_won', 'closed_lost') then
    v_needs_override := true;   -- reopening
  elsif v_to_order <> v_from_order + 1 then
    v_needs_override := true;   -- skipping ahead or going back
  else
    v_needs_override := not app.job_gate_passes(p_job, v_job.stage);
  end if;

  if v_needs_override and not coalesce(p_override, false) then
    raise exception 'The gate for this stage has not passed. An owner can override it with a reason.' using errcode = '42501';
  end if;
  if coalesce(p_override, false) then
    if length(btrim(coalesce(p_reason, ''))) < 10 then
      raise exception 'An override needs a reason (at least 10 characters).' using errcode = '23514';
    end if;
    if v_actor is null or app.user_perm_scope(v_actor, 'job_admin:override') is null then
      raise exception 'Only owners can override a stage gate.' using errcode = '42501';
    end if;
  elsif v_actor is not null and app.user_perm_scope(v_actor, 'jobs:advance_stage') is null then
    raise exception 'You do not have permission to advance job stages.' using errcode = '42501';
  end if;

  -- Blocking holds stop Ready to Schedule and later stages, even with an override.
  if p_to not in ('closed_won', 'closed_lost') and v_to_order >= app.job_stage_order('ready_to_schedule')
     and v_job.blocking_hold_count > 0 then
    raise exception 'Release the blocking hold first. Holds stop scheduling even with an override.' using errcode = '23514';
  end if;

  perform set_config('app.stage_change', 'on', true);
  perform set_config('app.system_update', 'on', true);
  update public.jobs set
    stage = p_to,
    stage_entered_at = now(),
    lost_reason = case when p_to = 'closed_lost' then p_lost_reason else null end,
    walkthrough_scheduled_at = case when p_to = 'walkthrough_scheduled' then coalesce(walkthrough_scheduled_at, now()) else walkthrough_scheduled_at end,
    walkthrough_completed_at = case when p_to = 'walkthrough_complete' then coalesce(walkthrough_completed_at, now()) else walkthrough_completed_at end,
    estimate_sent_at = case when p_to = 'estimate_sent' then coalesce(estimate_sent_at, now()) else estimate_sent_at end,
    estimate_accepted_at = case when p_to = 'sold' then coalesce(estimate_accepted_at, now()) else estimate_accepted_at end,
    onboarding_started_at = case when p_to = 'onboarding' then coalesce(onboarding_started_at, now()) else onboarding_started_at end,
    onboarding_completed_at = case when p_to = 'ready_to_schedule' then coalesce(onboarding_completed_at, now()) else onboarding_completed_at end,
    ready_to_schedule_at = case when p_to = 'ready_to_schedule' then coalesce(ready_to_schedule_at, now()) else ready_to_schedule_at end,
    scheduled_at = case when p_to = 'scheduled' then coalesce(scheduled_at, now()) else scheduled_at end,
    actual_start_date = case when p_to = 'in_progress' then coalesce(actual_start_date, (now() at time zone 'America/Los_Angeles')::date) else actual_start_date end,
    work_completed_at = case when p_to = 'final_walkthrough' then coalesce(work_completed_at, now()) else work_completed_at end,
    final_walkthrough_at = case when p_to = 'completed' then coalesce(final_walkthrough_at, now()) else final_walkthrough_at end,
    completed_at = case when p_to = 'completed' then coalesce(completed_at, now()) else completed_at end,
    final_invoiced_at = case when p_to = 'invoiced' then coalesce(final_invoiced_at, now()) else final_invoiced_at end,
    paid_in_full_at = case when p_to = 'paid_in_full' then coalesce(paid_in_full_at, now()) else paid_in_full_at end,
    closed_at = case when p_to in ('closed_won', 'closed_lost') then now() else null end,
    lost_at = case when p_to = 'closed_lost' then now() else null end
  where id = p_job;
  perform set_config('app.stage_change', 'off', true);
  perform set_config('app.system_update', 'off', true);

  insert into public.stage_history (org_id, job_id, from_stage, to_stage, changed_by, impersonated_by,
                                    override, reason, gate, approval_request_id)
  values (v_job.org_id, p_job, v_job.stage, p_to, v_actor, app.impersonator_id(),
          coalesce(p_override, false), nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_gate, '{}'::jsonb),
          p_approval_request)
  returning id into v_history;

  v_from_label := initcap(replace(v_job.stage, '_', ' '));
  v_to_label := initcap(replace(p_to, '_', ' '));
  perform app.log_activity(v_job.org_id, 'job', p_job::text, 'stage_changed',
    'Stage moved from ' || v_from_label || ' to ' || v_to_label
      || case when coalesce(p_override, false) then ' (owner override: ' || btrim(p_reason) || ')'
              when p_to = 'closed_lost' then ' (' || replace(p_lost_reason, '_', ' ') || ')'
              else '' end,
    jsonb_build_object('from', v_job.stage, 'to', p_to, 'override', coalesce(p_override, false),
                       'history_id', v_history));
  perform app.emit_event(v_job.org_id, 'job.stage_changed', 'job', p_job::text,
    jsonb_build_object('from', v_job.stage, 'to', p_to, 'override', coalesce(p_override, false),
                       'history_id', v_history, 'lost_reason', p_lost_reason));
  return v_history;
end;
$$;

revoke execute on function public.apply_job_stage_change(uuid, text, text, boolean, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_job_stage_change(uuid, text, text, boolean, text, text, jsonb, uuid)
  to service_role;
revoke execute on function app.job_gate_passes(uuid, text) from public, anon, authenticated;
grant execute on function app.job_gate_passes(uuid, text) to service_role;

-- =============================================================================
-- 7. Convert lead → job (SPEC §6.1). Atomic; reuses a matching contact,
--    account and property instead of creating duplicates.
-- =============================================================================

create or replace function public.convert_lead_to_job(p_lead uuid, p_work_types text[] default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_account uuid;
  v_contact uuid;
  v_property uuid;
  v_job uuid;
  v_work_types text[];
  v_labels text;
  v_name text;
  v_number text;
  v_walkthrough_at timestamptz;
begin
  select * into v_lead from public.leads where id = p_lead for update;
  if not found or v_lead.deleted_at is not null then
    raise exception 'Lead not found.' using errcode = 'P0002';
  end if;
  if v_lead.converted_job_id is not null or v_lead.status = 'converted' then
    raise exception 'This lead is already a job.' using errcode = '23505';
  end if;
  if v_lead.status in ('lost', 'unqualified') then
    raise exception 'Reopen the lead before converting it.' using errcode = '23514';
  end if;

  -- Contact: the lead's own, else the same mobile/email in this company.
  v_contact := v_lead.contact_id;
  if v_contact is null then
    select c.id into v_contact from public.contacts c
    where c.org_id = v_lead.org_id and c.deleted_at is null
      and ((v_lead.mobile is not null and (c.mobile = v_lead.mobile or c.phone = v_lead.mobile))
           or (v_lead.phone is not null and (c.mobile = v_lead.phone or c.phone = v_lead.phone))
           or (v_lead.email is not null and c.email = v_lead.email))
    order by (v_lead.mobile is not null and c.mobile = v_lead.mobile) desc, c.created_at
    limit 1;
  end if;

  -- Account: the lead's, the contact's, else a new household.
  v_account := v_lead.account_id;
  if v_account is null and v_contact is not null then
    select c.account_id into v_account from public.contacts c where c.id = v_contact;
  end if;
  if v_account is null then
    insert into public.accounts (org_id, account_type, display_name, owner_id, territory_id)
    values (v_lead.org_id,
            case when v_lead.company is not null then 'commercial' else 'residential' end,
            coalesce(nullif(btrim(v_lead.company), ''),
                     coalesce(nullif(btrim(v_lead.last_name), ''), btrim(v_lead.first_name)) || ' Residence'),
            v_lead.owner_id, v_lead.territory_id)
    returning id into v_account;
  end if;

  if v_contact is null then
    insert into public.contacts (org_id, account_id, first_name, last_name, mobile, phone, email)
    values (v_lead.org_id, v_account, v_lead.first_name, v_lead.last_name, v_lead.mobile, v_lead.phone, v_lead.email)
    returning id into v_contact;
  end if;
  update public.accounts set primary_contact_id = v_contact
  where id = v_account and primary_contact_id is null;

  -- Property: the lead's, the same street + ZIP on the account, else a new one.
  v_property := v_lead.property_id;
  if v_property is null and v_lead.street is not null then
    select p.id into v_property from public.properties p
    where p.account_id = v_account and p.deleted_at is null
      and lower(btrim(p.street)) = lower(btrim(v_lead.street))
      and p.zip is not distinct from v_lead.zip
    order by p.is_primary desc, p.created_at
    limit 1;
    if v_property is null then
      insert into public.properties (org_id, account_id, is_primary, street, unit, city, state, zip,
                                     year_built, home_built, property_type, stories, siding_type, has_hoa)
      values (v_lead.org_id, v_account,
              not exists (select 1 from public.properties p where p.account_id = v_account
                          and p.is_primary and p.deleted_at is null),
              v_lead.street, v_lead.unit, v_lead.city, v_lead.state, v_lead.zip, v_lead.year_built,
              v_lead.home_built, v_lead.property_type, v_lead.stories, v_lead.siding_type,
              coalesce(v_lead.has_hoa, false))
      returning id into v_property;
    end if;
  end if;

  -- Work types from the lead's services ("other" → add-on only), unless given.
  v_work_types := coalesce(p_work_types, array(
    select distinct case s when 'other' then 'add_on_only' else s end
    from unnest(v_lead.services) s));
  select string_agg(pv.label, ', ' order by pv.sort_order) into v_labels
  from public.picklist_values pv join public.picklists pl on pl.id = pv.picklist_id
  where pl.org_id = v_lead.org_id and pl.key = 'work_type' and pv.value = any(v_work_types);
  v_name := left(concat_ws(' – ',
    coalesce(nullif(btrim(v_lead.last_name), ''), btrim(v_lead.first_name)),
    nullif(btrim(coalesce(v_lead.city, '')), ''),
    v_labels), 200);

  select min(a.created_at) into v_walkthrough_at
  from public.appointments a where a.lead_id = p_lead and a.type = 'walkthrough' and a.deleted_at is null;

  insert into public.jobs (org_id, name, account_id, property_id, primary_contact_id, lead_id, work_types,
                           owner_id, point_of_contact_id, lead_source, lead_sub_source, territory_id,
                           lead_created_at, first_contact_at, walkthrough_scheduled_at)
  values (v_lead.org_id, v_name, v_account, v_property, v_contact, p_lead, v_work_types,
          v_lead.owner_id, v_lead.point_of_contact_id, v_lead.lead_source, v_lead.lead_sub_source,
          v_lead.territory_id, v_lead.created_at, v_lead.first_contacted_at, coalesce(v_walkthrough_at, now()))
  returning id, job_number into v_job, v_number;

  -- Move the walkthrough and the team's notes, comments and tasks over.
  perform set_config('app.system_update', 'on', true);
  update public.appointments set job_id = v_job where lead_id = p_lead and job_id is null;
  update public.notes set subject_type = 'job', subject_id = v_job where subject_type = 'lead' and subject_id = p_lead;
  update public.comments set subject_type = 'job', subject_id = v_job where subject_type = 'lead' and subject_id = p_lead;
  update public.tasks set subject_type = 'job', subject_id = v_job where subject_type = 'lead' and subject_id = p_lead;
  perform set_config('app.system_update', 'off', true);

  update public.leads set status = 'converted', converted_job_id = v_job, converted_at = now(),
                          account_id = v_account, contact_id = v_contact, property_id = v_property
  where id = p_lead;

  perform app.log_activity(v_lead.org_id, 'lead', p_lead::text, 'converted',
    'Converted to job ' || v_number, jsonb_build_object('job_id', v_job, 'job_number', v_number));
  perform app.emit_event(v_lead.org_id, 'lead.converted', 'lead', p_lead::text,
    jsonb_build_object('job_id', v_job, 'account_id', v_account, 'contact_id', v_contact, 'property_id', v_property));
  return v_job;
end;
$$;

revoke execute on function public.convert_lead_to_job(uuid, text[]) from public, anon, authenticated;
grant execute on function public.convert_lead_to_job(uuid, text[]) to service_role;

-- =============================================================================
-- 8. RPCs for screens (run as the caller; row security decides what counts)
-- =============================================================================

-- Job List tabs.
create or replace function public.job_status_counts()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'active', count(*) filter (where stage not in ('closed_won', 'closed_lost')),
    'mine', count(*) filter (where (select app.effective_user_id()) = any(team_user_ids)
                             and stage not in ('closed_won', 'closed_lost')),
    'total', count(*),
    'on_hold', count(*) filter (where status = 'on_hold'),
    'by_stage', coalesce((select jsonb_object_agg(s.stage, s.n) from (
       select j2.stage, count(*) n from public.jobs j2 group by j2.stage) s), '{}'::jsonb)
  )
  from public.jobs;
$$;

-- Jobs Dashboard. Money is null for people without financials:read (row
-- security hides job_financials), so they see counts only.
create or replace function public.job_stats(p_from timestamptz, p_to timestamptz, p_prev_from timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with j as (
    select j.*, f.contract_baseline_cents as amount
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

-- Attention Center KPIs and the nav badge.
create or replace function public.attention_summary()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'open', count(*) filter (where status in ('pending', 'in_progress')),
    'now', count(*) filter (where status = 'pending' and priority in ('critical', 'high')),
    'overdue', count(*) filter (where status in ('pending', 'in_progress') and due_at < now()),
    'awaiting_response', count(*) filter (where status in ('pending', 'in_progress') and category = 'communication'),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'snoozed', count(*) filter (where status = 'snoozed'),
    'mine', count(*) filter (where status in ('pending', 'in_progress') and owner_id = (select app.effective_user_id()))
  )
  from public.attention_items
  where status <> 'resolved';
$$;

revoke execute on function public.job_status_counts(), public.job_stats(timestamptz, timestamptz, timestamptz),
  public.attention_summary() from public, anon;
grant execute on function public.job_status_counts(), public.job_stats(timestamptz, timestamptz, timestamptz),
  public.attention_summary() to authenticated;

-- Universal search: jobs join.
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
  job_hits as (
    select 'job'::text, j.id, j.name,
           concat_ws(' · ', j.job_number, initcap(replace(j.stage, '_', ' '))),
           '/jobs/' || j.id,
           greatest(extensions.similarity(j.search_text, q.term),
                    case when j.job_number ilike '%' || q.term || '%' then 0.95 else 0 end)::real
    from public.jobs j, q
    where p_scope in ('all', 'jobs') and length(q.term) >= 2 and j.search_text like '%' || q.term || '%'
    order by 6 desc, j.created_at desc
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
    union all select * from job_hits
    union all select * from account_hits
    union all select * from contact_hits
    union all select * from property_hits
  ) r
  order by r.rank desc
  limit (select lim * 2 from q);
$$;

-- =============================================================================
-- 9. Soft delete, deleted records, open work: jobs join
-- =============================================================================

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
    when 'jobs' then 'jobs:delete'
  end;
$$;

create or replace function app.record_in_edit_scope(p_table text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_table
    when 'leads' then exists (
      select 1 from public.leads r
      where r.id = p_id and r.org_id = app.current_org_id() and r.deleted_at is null
        and app.scope_match(app.perm_scope('leads:update'), r.owner_id, r.created_by, r.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'accounts' then exists (
      select 1 from public.accounts r
      where r.id = p_id and r.org_id = app.current_org_id() and r.deleted_at is null
        and app.scope_match(app.perm_scope('accounts:update'), r.owner_id, r.created_by, r.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'contacts' then exists (
      select 1 from public.contacts r join public.accounts a on a.id = r.account_id
      where r.id = p_id and r.org_id = app.current_org_id() and r.deleted_at is null
        and app.scope_match(app.perm_scope('contacts:update'), a.owner_id, a.created_by, a.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'properties' then exists (
      select 1 from public.properties r join public.accounts a on a.id = r.account_id
      where r.id = p_id and r.org_id = app.current_org_id() and r.deleted_at is null
        and app.scope_match(app.perm_scope('accounts:update'), a.owner_id, a.created_by, a.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'jobs' then exists (
      select 1 from public.jobs r
      where r.id = p_id and r.org_id = app.current_org_id() and r.deleted_at is null
        and (app.perm_scope('jobs:update') = 'all'
             or (app.perm_scope('jobs:update') in ('own', 'team')
                 and (app.effective_user_id() in (r.owner_id, r.created_by) or app.effective_user_id() = any(r.team_user_ids)))
             or (app.perm_scope('jobs:update') = 'team' and r.territory_id = app.my_territory_id())))
    else true
  end;
$$;
revoke all on function app.record_in_edit_scope(text, uuid) from public, anon, authenticated;

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
      union all
      select 'jobs', jb.id, jb.job_number || ' · ' || jb.name, jb.deleted_at, jb.deleted_by, jb.delete_reason
      from public.jobs jb where jb.org_id = v_org and jb.deleted_at is not null
    ) d
    left join public.profiles p on p.id = d.deleted_by
    order by d.deleted_at desc;
end;
$$;

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
    'jobs', nullif((select count(*) from public.jobs j
                    where j.org_id = v_org and j.deleted_at is null and j.stage not in ('closed_won', 'closed_lost')
                      and p_user_id in (j.owner_id, j.point_of_contact_id, j.project_manager_id)), 0),
    'tasks', nullif((select count(*) from public.tasks t
                     where t.org_id = v_org and t.assignee_id = p_user_id and t.deleted_at is null and t.status = 'open'), 0)
  ));
end;
$$;

-- =============================================================================
-- 10. Data: existing booked walkthroughs become appointments; defaults per org
-- =============================================================================

insert into public.appointments (org_id, lead_id, type, starts_at, ends_at, status, created_at)
select l.org_id, l.id, 'walkthrough', l.walkthrough_at, l.walkthrough_at + interval '60 minutes', 'scheduled', l.updated_at
from public.leads l
where l.walkthrough_at is not null and l.deleted_at is null;

-- Attention rule defaults (SPEC §9). Thresholds are editable in Admin.
create or replace function app.seed_jobs_defaults(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.attention_rules (org_id, rule_key, thresholds) values
    (p_org, 'untouched_lead', '{}'::jsonb),
    (p_org, 'aging_lead', '{"medium_days": 3, "high_days": 7, "stale_days": 14}'::jsonb),
    (p_org, 'walkthrough_unconfirmed', '{"cutoff_hour": 17}'::jsonb),
    (p_org, 'estimate_sla', '{}'::jsonb),
    (p_org, 'approval_pending', '{"hours": 2}'::jsonb),
    (p_org, 'sold_no_deposit', '{"days": 3}'::jsonb),
    (p_org, 'onboarding_stalled', '{"days": 7}'::jsonb),
    (p_org, 'ready_not_scheduled', '{"days": 5}'::jsonb),
    (p_org, 'start_date_missed', '{}'::jsonb)
  on conflict (org_id, rule_key) do nothing;
$$;
revoke execute on function app.seed_jobs_defaults(uuid) from public, anon, authenticated;

select app.seed_jobs_defaults(id) from public.organizations;
