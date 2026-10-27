-- Phase 9 · Analytics & home (SPEC §8.2, §8.3, §8.14, §8.15, §12).
--
-- Additive and safe on a database that already has Phases 0–8 (production
-- starts empty). Adds:
--   1. marketing_spend (Admin → Marketing Spend) and revenue_goals (Admin →
--      Revenue Goals): owner-entered numbers for cost per lead / CAC and the
--      Revenue Forecast goal line;
--   2. export_log: every "Download CSV" (charts, KPI tables, reports,
--      scheduled deliveries), written only through log_export();
--   3. reports, report_run_stats, report_schedules, dashboards,
--      analytics_favorites: the Analytics hub's saved things;
--   4. report_* views (security_invoker, so row security applies) that the
--      report builder reads, with money columns only for people allowed to
--      see them;
--   5. server-side aggregates for the metrics registry: analytics_stats()
--      (every SPEC §12.1 KPI with work type / city / owner / source filters),
--      analytics_monthly(), season_backlog(), my_numbers(),
--      workspace_summary(), daily_brief();
--   6. helpers for the worker (user_permission_scopes) and exports (log_export).
--
-- Every function runs as the caller (row security applies) unless it says
-- otherwise. Rollback: supabase/rollbacks/20261030000100_analytics.down.sql

-- =============================================================================
-- 0. Small helpers
-- =============================================================================

-- A uuid from text, or null when it isn't one (filters come from the URL).
create or replace function app.try_uuid(p text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;

-- Direct costs of one job, the same sum finance_stats() uses for gross margin:
-- labor (hours × hourly cost), paint orders, subcontractor POs, expenses.
-- Runs as the caller: without job_costing:read the cost tables read empty.
create or replace function app.job_direct_cost_cents(p_job uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select (
      coalesce((select sum(round(t.hours * coalesce(c.hourly_cost_cents, 0)))
                from public.time_entries t left join public.profile_compensation c on c.profile_id = t.user_id
                where t.job_id = p_job and t.deleted_at is null), 0)
    + coalesce((select sum(o.total_cost_cents) from public.paint_orders o
                where o.job_id = p_job and o.deleted_at is null and o.status <> 'canceled'), 0)
    + coalesce((select sum(wc.sub_po_cents) from public.work_order_costs wc
                join public.work_orders w on w.id = wc.work_order_id
                where w.job_id = p_job and w.deleted_at is null and w.status <> 'canceled'), 0)
    + coalesce((select sum(e.amount_cents) from public.job_expenses e
                where e.job_id = p_job and e.deleted_at is null), 0)
  )::bigint;
$$;

-- Lead services use the four main work types plus "other" (add-ons).
create or replace function app.work_type_service(p_work_type text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_work_type
    when 'interior' then 'interior' when 'exterior' then 'exterior' when 'cabinets' then 'cabinets'
    when 'deck_fence' then 'deck_fence' when 'add_on_only' then 'other' end;
$$;

-- Production days (ISO weekday numbers from Schedule Admin) in [p_from, p_to].
create or replace function app.production_days_between(p_from date, p_to date, p_days smallint[])
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_from is null or p_to is null or p_to < p_from then 0 else (
    select count(*)::integer from generate_series(p_from, p_to, interval '1 day') d
    where extract(isodow from d)::smallint = any(coalesce(p_days, '{1,2,3,4,5}'::smallint[]))) end;
$$;

-- =============================================================================
-- 1. Marketing spend and revenue goals (owner-entered numbers)
-- =============================================================================

create table public.marketing_spend (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  lead_source text not null check (length(lead_source) between 1 and 80),
  amount_cents bigint not null check (amount_cents between 0 and 100000000000),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, month, lead_source)
);
create index marketing_spend_org_month_idx on public.marketing_spend (org_id, month);

create table public.revenue_goals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  goal_cents bigint not null check (goal_cents between 0 and 100000000000),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, month)
);

create or replace function app.marketing_spend_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.check_picklist(new.org_id, 'lead_source', new.lead_source, 'Lead source');
  return new;
end;
$$;
create trigger marketing_spend_guard before insert or update on public.marketing_spend
  for each row execute function app.marketing_spend_guard();

-- =============================================================================
-- 2. Export log (SPEC §8 "Download CSV … permission-gated, logged"; Phase 10
--    adds the Export Controls screen on top)
-- =============================================================================

create table public.export_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  impersonated_by uuid,
  kind text not null check (kind in ('chart', 'kpi_table', 'report', 'report_schedule')),
  dataset text not null check (length(dataset) between 1 and 120),
  title text not null check (length(title) between 1 and 200),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  row_count integer not null default 0 check (row_count >= 0),
  format text not null default 'csv' check (format in ('csv')),
  created_at timestamptz not null default now()
);
create index export_log_org_created_idx on public.export_log (org_id, created_at desc);
create index export_log_user_idx on public.export_log (user_id, created_at desc);

-- The only way to write the log: the person must hold data:export and not be
-- viewing as someone else. Returns the log id.
create or replace function public.log_export(
  p_kind text, p_dataset text, p_title text, p_row_count integer, p_filters jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid := app.current_org_id();
begin
  if v_org is null then
    raise exception 'Sign in to export.' using errcode = '42501';
  end if;
  if app.is_impersonating() then
    raise exception 'Exports are off while viewing as another user.' using errcode = '42501';
  end if;
  if not app.has_perm('data:export') then
    raise exception 'Your role can''t export data. Ask an owner for export access.' using errcode = '42501';
  end if;
  insert into public.export_log (org_id, user_id, kind, dataset, title, filters, row_count)
  values (v_org, auth.uid(), p_kind, left(p_dataset, 120), left(coalesce(nullif(btrim(p_title), ''), p_dataset), 200),
          case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end,
          greatest(coalesce(p_row_count, 0), 0))
  returning id into v_id;
  perform app.emit_event(v_org, 'export.created', 'export', v_id::text,
    jsonb_build_object('kind', p_kind, 'dataset', p_dataset, 'rows', p_row_count));
  return v_id;
end;
$$;

-- =============================================================================
-- 3. Reports, schedules, dashboards, favorites (SPEC §8.14)
-- =============================================================================

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (length(description) <= 500),
  category text not null default 'custom' check (category in ('sales', 'marketing', 'production', 'finance', 'custom')),
  module text not null check (module in ('leads', 'jobs', 'estimates', 'invoices')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  is_template boolean not null default false,
  template_key text check (length(template_key) <= 60),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (not is_template or template_key is not null),
  unique (org_id, template_key)
);
create index reports_org_idx on public.reports (org_id, is_template, name);
create index reports_owner_idx on public.reports (owner_id);

-- Last run per report: a summary kept by note_report_run(), not audited
-- (the reports themselves are).
create table public.report_run_stats (
  report_id uuid primary key references public.reports (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  last_run_at timestamptz not null default now(),
  last_run_by uuid references public.profiles (id) on delete set null,
  run_count integer not null default 1 check (run_count >= 0)
);

create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  report_id uuid not null references public.reports (id) on delete cascade,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  -- ISO weekday (1 = Monday) for weekly; day of month (1–28) for monthly.
  weekday smallint check (weekday between 1 and 7),
  month_day smallint check (month_day between 1 and 28),
  -- Pacific hour of day the delivery goes out.
  hour smallint not null default 7 check (hour between 0 and 23),
  recipient_ids uuid[] not null default '{}' check (cardinality(recipient_ids) between 1 and 20),
  active boolean not null default true,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  last_status text check (last_status in ('sent', 'skipped', 'failed')),
  last_note text check (length(last_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (frequency <> 'weekly' or weekday is not null),
  check (frequency <> 'monthly' or month_day is not null)
);
create index report_schedules_due_idx on public.report_schedules (next_run_at) where active;
create index report_schedules_report_idx on public.report_schedules (report_id);

create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (length(description) <= 500),
  widgets text[] not null default '{}' check (cardinality(widgets) <= 30),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index dashboards_org_idx on public.dashboards (org_id, name);

create table public.analytics_favorites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_type text not null check (item_type in ('dashboard', 'report')),
  item_key text not null check (length(item_key) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (user_id, item_type, item_key)
);

-- Report schedule recipients are active people in the same company.
create or replace function app.report_schedules_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(new.recipient_ids) r(id)
    where not exists (select 1 from public.profiles p where p.id = r.id and p.org_id = new.org_id and p.is_active)
  ) then
    raise exception 'Recipients must be active people in your company.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.reports x where x.id = new.report_id and x.org_id = new.org_id) then
    raise exception 'Pick one of your company''s reports.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger report_schedules_guard before insert or update on public.report_schedules
  for each row execute function app.report_schedules_guard();

-- Templates are seeded configuration: nobody edits or deletes them.
create or replace function app.reports_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.is_template then
    raise exception 'Report templates are seeded configuration.' using errcode = '42501';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.is_template then
    raise exception 'Report templates can''t be changed. Save a copy instead.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.is_template then
    raise exception 'Report templates are seeded configuration.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger reports_guard before insert or update or delete on public.reports
  for each row execute function app.reports_guard();

-- Records that someone ran a report (list "last run"). Any viewer of the report.
create or replace function public.note_report_run(p_report uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
begin
  if v_org is null or not app.has_perm('reports:read') then
    return;
  end if;
  if not exists (
    select 1 from public.reports r where r.id = p_report and r.org_id = v_org
      and (r.is_template or r.shared or r.owner_id = app.effective_user_id())
  ) then
    return;
  end if;
  insert into public.report_run_stats (report_id, org_id, last_run_at, last_run_by, run_count)
  values (p_report, v_org, now(), app.effective_user_id(), 1)
  on conflict (report_id) do update
    set last_run_at = excluded.last_run_at, last_run_by = excluded.last_run_by,
        run_count = public.report_run_stats.run_count + 1;
end;
$$;

-- Updated-at / actor stamps, audit and domain events.
do $$
declare
  t text;
begin
  foreach t in array array['marketing_spend', 'revenue_goals', 'reports', 'report_schedules', 'dashboards',
                           'analytics_favorites'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function app.stamp_actor()', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end
$$;
create trigger marketing_spend_event after insert or update or delete on public.marketing_spend
  for each row execute function app.emit_change_event('marketing_spend');
create trigger revenue_goals_event after insert or update or delete on public.revenue_goals
  for each row execute function app.emit_change_event('revenue_goal');
create trigger reports_event after insert or update or delete on public.reports
  for each row execute function app.emit_change_event('report', 'config');
create trigger report_schedules_event after insert or update or delete on public.report_schedules
  for each row execute function app.emit_change_event('report_schedule');
create trigger dashboards_event after insert or update or delete on public.dashboards
  for each row execute function app.emit_change_event('dashboard');
create trigger analytics_favorites_event after insert or delete on public.analytics_favorites
  for each row execute function app.emit_change_event('analytics_favorite');

-- =============================================================================
-- 4. Row level security
-- =============================================================================

alter table public.marketing_spend enable row level security;
alter table public.revenue_goals enable row level security;
alter table public.export_log enable row level security;
alter table public.reports enable row level security;
alter table public.report_run_stats enable row level security;
alter table public.report_schedules enable row level security;
alter table public.dashboards enable row level security;
alter table public.analytics_favorites enable row level security;

-- Logs are written only by their functions (and the worker).
revoke insert, update, delete on public.export_log, public.report_run_stats from authenticated;

-- Marketing spend: analytics readers see it (cost per lead), settings:manage edits.
create policy marketing_spend_select on public.marketing_spend for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.has_perm('analytics:read')) or (select app.has_perm('settings:manage'))));
create policy marketing_spend_insert on public.marketing_spend for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')));
create policy marketing_spend_update on public.marketing_spend for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));
create policy marketing_spend_delete on public.marketing_spend for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')));

-- Revenue goals: money targets, so people who see money (or set up the company).
create policy revenue_goals_select on public.revenue_goals for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.has_perm('financials:read')) or (select app.has_perm('settings:manage'))));
create policy revenue_goals_insert on public.revenue_goals for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')));
create policy revenue_goals_update on public.revenue_goals for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
  with check (org_id = (select app.current_org_id()));
create policy revenue_goals_delete on public.revenue_goals for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')));

-- Export log: your own exports; people who read the audit log see everyone's.
create policy export_log_select on public.export_log for select to authenticated
  using (org_id = (select app.current_org_id())
         and (user_id = (select auth.uid()) or (select app.has_perm('audit:read'))));

-- Reports: templates and shared reports for every report reader; your own always.
create policy reports_select on public.reports for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('reports:read'))
         and (is_template or shared or owner_id = (select app.effective_user_id())));
create policy reports_insert on public.reports for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('reports:build'))
              and owner_id = (select auth.uid()) and not is_template);
create policy reports_update on public.reports for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('reports:build'))
         and owner_id = (select auth.uid()) and not is_template)
  with check (org_id = (select app.current_org_id()) and owner_id = (select auth.uid()));
create policy reports_delete on public.reports for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('reports:build'))
         and owner_id = (select auth.uid()) and not is_template);

create policy report_run_stats_select on public.report_run_stats for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('reports:read')));

-- Schedules: the person who set them up; owners see and manage all of them.
create policy report_schedules_select on public.report_schedules for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('reports:build'))
         and (created_by = (select app.effective_user_id()) or (select app.is_grants_all_user(app.effective_user_id()))));
create policy report_schedules_insert on public.report_schedules for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('reports:build')));
create policy report_schedules_update on public.report_schedules for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('reports:build'))
         and (created_by = (select auth.uid()) or (select app.is_grants_all_user(auth.uid()))))
  with check (org_id = (select app.current_org_id()));
create policy report_schedules_delete on public.report_schedules for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('reports:build'))
         and (created_by = (select auth.uid()) or (select app.is_grants_all_user(auth.uid()))));

-- Custom dashboards: analytics readers see shared ones and their own.
create policy dashboards_select on public.dashboards for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('analytics:read'))
         and (shared or owner_id = (select app.effective_user_id())));
create policy dashboards_insert on public.dashboards for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('reports:build'))
              and owner_id = (select auth.uid()));
create policy dashboards_update on public.dashboards for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('reports:build'))
         and owner_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and owner_id = (select auth.uid()));
create policy dashboards_delete on public.dashboards for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('reports:build'))
         and owner_id = (select auth.uid()));

-- Favorites: your own.
create policy analytics_favorites_select on public.analytics_favorites for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select app.effective_user_id()));
create policy analytics_favorites_insert on public.analytics_favorites for insert to authenticated
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid())
              and not (select app.is_impersonating()) and (select app.has_perm('analytics:read')));
create policy analytics_favorites_delete on public.analytics_favorites for delete to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid())
         and not (select app.is_impersonating()));

grant select, insert, update, delete on public.marketing_spend, public.revenue_goals, public.export_log,
  public.reports, public.report_run_stats, public.report_schedules, public.dashboards,
  public.analytics_favorites to service_role;

-- =============================================================================
-- 5. Report views (the report builder's modules). security_invoker: each
--    person sees exactly the rows their role may read; money and cost columns
--    are null without financials:read / job_costing:read.
-- =============================================================================

create or replace view public.report_leads with (security_invoker = true) as
select
  l.id, l.org_id,
  btrim(l.first_name || ' ' || coalesce(l.last_name, '')) as name,
  l.status, l.lead_source, l.lead_sub_source, l.services, l.city,
  coalesce(t.name, case when l.out_of_area then 'Outside service area' else 'Unknown' end) as territory,
  l.territory_id, l.owner_id, o.full_name as owner_name, l.grade, l.score, l.temperature,
  l.created_at, l.first_contacted_at, l.speed_to_lead_seconds,
  round(l.speed_to_lead_seconds / 60.0, 1) as speed_to_lead_minutes,
  l.walkthrough_at, l.converted_at, l.converted_job_id, l.last_activity_at
from public.leads l
left join public.territories t on t.id = l.territory_id
left join public.profiles o on o.id = l.owner_id
where l.deleted_at is null;

create or replace view public.report_jobs with (security_invoker = true) as
with flags as (
  select app.has_perm('financials:read') as money, app.has_perm('job_costing:read') as costs,
         app.production_today() as today
)
select
  j.id, j.org_id, j.job_number, j.name, j.stage, j.status, j.work_types,
  j.work_types[1] as primary_work_type,
  coalesce(t.name, 'Unknown') as territory, j.territory_id,
  j.owner_id, o.full_name as owner_name, j.point_of_contact_id, poc.full_name as point_of_contact_name,
  j.lead_source, j.created_at, coalesce(j.lead_created_at, j.created_at) as lead_created_at,
  j.walkthrough_completed_at, j.estimate_sent_at, j.estimate_accepted_at as sold_at, j.deposit_paid_at,
  j.promised_start_date, j.guarantee_start_date, j.actual_start_date, j.completed_at, j.paid_in_full_at,
  j.closed_at, j.on_time_guarantee_status,
  case when f.money then fin.contract_cents end as contract_cents,
  case when f.money then led.balance_cents end as balance_cents,
  case when f.costs and j.completed_at is not null then app.job_direct_cost_cents(j.id) end as cost_cents,
  case when f.costs and j.completed_at is not null and fin.contract_cents is not null
       then fin.contract_cents - app.job_direct_cost_cents(j.id) end as margin_cents,
  case when f.costs and j.completed_at is not null and coalesce(fin.contract_cents, 0) > 0
       then round(((fin.contract_cents - app.job_direct_cost_cents(j.id))::numeric / fin.contract_cents) * 100, 1) end
    as margin_percent,
  (j.actual_start_date is not null and j.guarantee_start_date is not null
   and j.actual_start_date > j.guarantee_start_date
   and coalesce(j.on_time_guarantee_status, '') <> 'missed_weather') as started_late,
  case when j.estimate_accepted_at is not null
       then round((extract(epoch from (j.estimate_accepted_at - coalesce(j.lead_created_at, j.created_at))) / 86400.0)::numeric, 1)
  end as sales_velocity_days,
  case when j.paid_in_full_at is not null and j.completed_at is not null
       then round((extract(epoch from (j.paid_in_full_at - j.completed_at)) / 86400.0)::numeric, 1)
  end as days_completed_to_paid,
  -- Production days in the last 30 (before today) on a published entry with no daily log; rain days don't count.
  coalesce((
    select count(distinct d::date)::integer
    from public.schedule_entries s
    cross join lateral generate_series(greatest(s.starts_on, f.today - 30), least(s.ends_on, f.today - 1), interval '1 day') d
    where s.job_id = j.id and s.status = 'published'
      and extract(isodow from d)::smallint = any(coalesce(
        (select ss.production_days from public.schedule_settings ss where ss.org_id = j.org_id), '{1,2,3,4,5}'::smallint[]))
      and not exists (select 1 from public.rain_delays r where r.job_id = j.id and r.delay_date = d::date)
      and not exists (select 1 from public.daily_logs l where l.job_id = j.id and l.log_date = d::date and l.deleted_at is null)
  ), 0) as missed_daily_logs
from public.jobs j
cross join flags f
left join public.territories t on t.id = j.territory_id
left join public.profiles o on o.id = j.owner_id
left join public.profiles poc on poc.id = j.point_of_contact_id
left join public.job_financials fin on fin.job_id = j.id
left join public.job_ledger led on led.job_id = j.id
where j.deleted_at is null;

create or replace view public.report_estimates with (security_invoker = true) as
with sla as (select app.org_estimate_sla_hours() as hours)
select
  e.id, e.org_id, e.estimate_number, e.title, e.status, e.owner_id, o.full_name as owner_name,
  e.job_id, j.job_number, j.name as job_name, j.work_types, j.lead_source,
  coalesce(t.name, 'Unknown') as territory, j.territory_id,
  fs.first_sent_at, e.accepted_at, e.declined_at, e.expires_at, e.total_cents,
  j.walkthrough_completed_at,
  case when fs.first_sent_at is not null and j.walkthrough_completed_at is not null
       then round((extract(epoch from (fs.first_sent_at - j.walkthrough_completed_at)) / 3600.0)::numeric, 1) end
    as hours_to_send,
  sla.hours as sla_hours,
  case when fs.first_sent_at is not null and j.walkthrough_completed_at is not null
       then fs.first_sent_at <= j.walkthrough_completed_at + make_interval(hours => sla.hours) end as sla_met,
  e.created_at
from public.estimates e
cross join sla
join public.jobs j on j.id = e.job_id
left join public.territories t on t.id = j.territory_id
left join public.profiles o on o.id = e.owner_id
left join lateral (
  select min(v.sent_at) as first_sent_at from public.estimate_versions v where v.estimate_id = e.id and v.sent_at is not null
) fs on true
where e.deleted_at is null and j.deleted_at is null;

create or replace view public.report_invoices with (security_invoker = true) as
select
  i.id, i.org_id, i.invoice_number, i.invoice_type, i.display_status as status, i.issue_date, i.due_date,
  i.total_cents, i.collected_cents, i.balance_cents, i.issued, i.days_past_due,
  case
    when not i.issued or i.balance_cents = 0 then 'Not owed'
    when i.days_past_due = 0 then 'Current'
    when i.days_past_due <= 30 then '1–30 days'
    when i.days_past_due <= 60 then '31–60 days'
    when i.days_past_due <= 90 then '61–90 days'
    else '90+ days'
  end as aging_bucket,
  i.job_id, i.job_number, i.job_name, i.account_name, j.owner_id, o.full_name as owner_name, j.work_types,
  coalesce(t.name, 'Unknown') as territory, j.territory_id, j.lead_source, i.created_at
from public.invoice_ledger i
join public.jobs j on j.id = i.job_id
left join public.territories t on t.id = j.territory_id
left join public.profiles o on o.id = j.owner_id;

grant select on public.report_leads, public.report_jobs, public.report_estimates, public.report_invoices
  to authenticated, service_role;

-- =============================================================================
-- 6. analytics_stats(): every SPEC §12.1 KPI, aggregated in Postgres with the
--    caller's row security. Period [p_from, p_to). Filters (all optional):
--    work_type (picklist key), territory_id (city), owner_id, source.
--    Money is null without financials:read; costs without job_costing:read.
-- =============================================================================

create or replace function public.analytics_stats(
  p_from timestamptz, p_to timestamptz, p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
  v_wt text := nullif(btrim(coalesce(p_filters ->> 'work_type', '')), '');
  v_svc text := app.work_type_service(nullif(btrim(coalesce(p_filters ->> 'work_type', '')), ''));
  v_terr uuid := app.try_uuid(p_filters ->> 'territory_id');
  v_owner uuid := app.try_uuid(p_filters ->> 'owner_id');
  v_src text := nullif(btrim(coalesce(p_filters ->> 'source', '')), '');
  v_money boolean := app.has_perm('financials:read');
  v_costs boolean := app.has_perm('job_costing:read');
  v_from_day date := (p_from at time zone 'America/Los_Angeles')::date;
  v_to_day date := ((p_to at time zone 'America/Los_Angeles') - interval '1 microsecond')::date;
  v_today date := app.production_today();
  v_now_local timestamp := now() at time zone 'America/Los_Angeles';
  v_days smallint[];
  v_crew_hours numeric;
  v_cutoff integer;
  v_sla integer := app.org_estimate_sla_hours();
  v_out jsonb;
begin
  select coalesce(s.production_days, '{1,2,3,4,5}'), coalesce(s.crew_day_hours, 8) into v_days, v_crew_hours
  from public.schedule_settings s where s.org_id = v_org;
  v_days := coalesce(v_days, '{1,2,3,4,5}');
  v_crew_hours := coalesce(v_crew_hours, 8);
  select coalesce((r.thresholds ->> 'cutoff_hour')::integer, 19) into v_cutoff
  from public.attention_rules r where r.org_id = v_org and r.rule_key = 'missed_daily_update';
  v_cutoff := coalesce(v_cutoff, 19);

  with
  -- Jobs matching every filter; the estimate set skips the owner filter (estimates use their own owner).
  fj as (
    select j.*, fin.contract_cents as contract
    from public.jobs j left join public.job_financials fin on fin.job_id = j.id
    where j.deleted_at is null and j.org_id = v_org
      and (v_wt is null or j.work_types @> array[v_wt])
      and (v_terr is null or j.territory_id = v_terr)
      and (v_owner is null or j.owner_id = v_owner)
      and (v_src is null or j.lead_source = v_src)
  ),
  fj_any_owner as (
    select j.* from public.jobs j
    where j.deleted_at is null and j.org_id = v_org
      and (v_wt is null or j.work_types @> array[v_wt])
      and (v_terr is null or j.territory_id = v_terr)
      and (v_src is null or j.lead_source = v_src)
  ),
  fl as (
    select l.* from public.leads l
    left join public.jobs cj on cj.id = l.converted_job_id
    where l.deleted_at is null and l.org_id = v_org
      and (v_wt is null or (v_svc is not null and l.services @> array[v_svc]) or coalesce(cj.work_types @> array[v_wt], false))
      and (v_terr is null or l.territory_id = v_terr)
      and (v_owner is null or l.owner_id = v_owner)
      and (v_src is null or l.lead_source = v_src)
  ),
  leads_p as (select * from fl where created_at >= p_from and created_at < p_to),
  walk as (
    select a.* from public.appointments a
    left join fj_any_owner j on j.id = a.job_id
    left join fl l on l.id = a.lead_id
    where a.deleted_at is null and a.type = 'walkthrough' and a.starts_at >= p_from and a.starts_at < p_to
      and a.starts_at < now() and a.status in ('completed', 'no_show')
      and (j.id is not null or l.id is not null)
      and (v_owner is null or v_owner = any(a.assigned_user_ids) or coalesce(j.owner_id = v_owner, false)
           or coalesce(l.owner_id = v_owner, false))
  ),
  est as (
    select e.id, e.status, e.total_cents, e.accepted_at, e.owner_id, j.walkthrough_completed_at,
           (select min(v.sent_at) from public.estimate_versions v where v.estimate_id = e.id and v.sent_at is not null) as first_sent_at
    from public.estimates e join fj_any_owner j on j.id = e.job_id
    where e.deleted_at is null and (v_owner is null or e.owner_id = v_owner)
  ),
  cohort as (select * from est where first_sent_at >= p_from and first_sent_at < p_to),
  won as (select * from est where status = 'accepted' and accepted_at >= p_from and accepted_at < p_to),
  sold as (select * from fj where estimate_accepted_at >= p_from and estimate_accepted_at < p_to),
  done as (select * from fj where completed_at >= p_from and completed_at < p_to),
  margin as (
    select d.contract, app.job_direct_cost_cents(d.id) as cost from done d where v_costs and d.contract is not null
  ),
  started as (
    select * from fj where guarantee_start_date is not null and actual_start_date is not null
      and actual_start_date between v_from_day and v_to_day
  ),
  published as (
    select s.* from public.schedule_entries s join fj j on j.id = s.job_id where s.status = 'published'
  ),
  due_days as (
    select distinct p.job_id, d::date as day
    from published p
    cross join lateral generate_series(greatest(p.starts_on, v_from_day), least(p.ends_on, v_to_day, v_today), interval '1 day') d
    where extract(isodow from d)::smallint = any(v_days)
      and (d::date < v_today or extract(hour from v_now_local) >= v_cutoff)
      and not exists (select 1 from public.rain_delays r where r.job_id = p.job_id and r.delay_date = d::date)
  ),
  inv as (select i.* from public.invoice_ledger i join fj j on j.id = i.job_id),
  open_inv as (select * from inv where issued and balance_cents <> 0),
  paid as (
    select coalesce(sum(a.amount_cents), 0) as cents
    from public.payment_applications a
    join public.payments p on p.id = a.payment_id
    join fj j on j.id = p.job_id
    where p.status in ('received', 'cleared') and p.received_on between v_from_day and v_to_day
  ),
  billed as (
    select coalesce(sum(total_cents), 0) as billed, coalesce(sum(collected_cents), 0) as collected
    from inv where issued and issue_date between v_from_day and v_to_day
  ),
  paid_jobs as (
    select extract(epoch from (paid_in_full_at - completed_at)) / 86400.0 as days from fj
    where paid_in_full_at >= p_from and paid_in_full_at < p_to and completed_at is not null
  ),
  backlog as (
    select coalesce(j.work_types[1], 'other') as work_type, w.budgeted_hours
    from public.work_orders w join fj j on j.id = w.job_id
    where w.deleted_at is null and w.status not in ('completed', 'canceled')
      and j.stage in ('ready_to_schedule', 'scheduled', 'in_progress')
  ),
  spend as (
    select ms.lead_source,
           round(ms.amount_cents
                 * greatest(0, least((ms.month + interval '1 month' - interval '1 day')::date, v_to_day)
                               - greatest(ms.month, v_from_day) + 1)::numeric
                 / extract(day from (ms.month + interval '1 month' - interval '1 day'))::numeric)::bigint as cents
    from public.marketing_spend ms
    where ms.org_id = v_org and ms.month <= v_to_day and (ms.month + interval '1 month')::date > v_from_day
      and (v_src is null or ms.lead_source = v_src)
  ),
  reviews as (
    select rr.* from public.review_requests rr join fj j on j.id = rr.job_id
    where coalesce(rr.sent_at, rr.created_at) >= p_from and coalesce(rr.sent_at, rr.created_at) < p_to
      and rr.status <> 'skipped'
  ),
  refs as (
    select rf.*, j.estimate_accepted_at as sold_at from public.referrals rf
    left join public.jobs j on j.id = rf.job_id
    where rf.org_id = v_org and rf.created_at >= p_from and rf.created_at < p_to
      and (v_wt is null and v_terr is null and v_owner is null and v_src is null
           or rf.job_id in (select id from fj) or rf.lead_id in (select id from fl))
  )
  select jsonb_build_object(
    'can_see_money', v_money,
    'can_see_costs', v_costs,
    'period_days', greatest(v_to_day - v_from_day + 1, 0),
    'elapsed_days', greatest(least(v_today, v_to_day) - v_from_day + 1, 0),
    'filters_applied', (v_wt is not null or v_terr is not null or v_owner is not null or v_src is not null),
    'spend_applies', (v_wt is null and v_terr is null and v_owner is null),
    -- Leads (created in the period)
    'leads_created', (select count(*) from leads_p),
    'leads_contacted', (select count(*) from leads_p where first_contacted_at is not null
                          or status in ('contacted', 'walkthrough_scheduled', 'converted')),
    'leads_walkthrough', (select count(*) from leads_p where walkthrough_at is not null
                            or status in ('walkthrough_scheduled', 'converted')),
    'leads_converted', (select count(*) from leads_p where status = 'converted'),
    'speed_measured', (select count(*) from leads_p where speed_to_lead_seconds is not null),
    'speed_median_seconds', (select round(percentile_cont(0.5) within group (order by speed_to_lead_seconds)::numeric)
                             from leads_p where speed_to_lead_seconds is not null),
    'speed_p90_seconds', (select round(percentile_cont(0.9) within group (order by speed_to_lead_seconds)::numeric)
                          from leads_p where speed_to_lead_seconds is not null)
  ) || jsonb_build_object(
    -- Walkthroughs whose time came in the period
    'walkthroughs_due', (select count(*) from walk),
    'walkthroughs_completed', (select count(*) from walk where status = 'completed'),
    -- Estimates (first sent in the period = the cohort)
    'estimates_sent', (select count(*) from cohort),
    'estimates_sent_value_cents', (select coalesce(sum(total_cents), 0) from cohort),
    'sla_hours', v_sla,
    'sla_measured', (select count(*) from cohort where walkthrough_completed_at is not null),
    'sla_met', (select count(*) from cohort where walkthrough_completed_at is not null
                  and first_sent_at <= walkthrough_completed_at + make_interval(hours => v_sla)),
    'cohort_accepted', (select count(*) from cohort where status = 'accepted'),
    'cohort_accepted_value_cents', (select coalesce(sum(total_cents), 0) from cohort where status = 'accepted'),
    'accepted', (select count(*) from won),
    'accepted_value_cents', (select coalesce(sum(total_cents), 0) from won),
    'open_estimates', (select count(*) from est where status in ('sent', 'viewed')),
    'open_estimates_value_cents', (select coalesce(sum(total_cents), 0) from est where status in ('sent', 'viewed'))
  ) || jsonb_build_object(
    -- Jobs sold / completed in the period
    'sold_jobs', (select count(*) from sold),
    'sold_cents', case when v_money then (select coalesce(sum(contract), 0) from sold) end,
    'velocity_days_avg', (select round(avg(extract(epoch from (estimate_accepted_at - coalesce(lead_created_at, created_at))) / 86400.0)::numeric, 1) from sold),
    'sold_not_started_jobs', (select count(*) from fj where stage in ('sold', 'onboarding', 'ready_to_schedule', 'scheduled')),
    'sold_not_started_cents', case when v_money then (select coalesce(sum(contract), 0) from fj
                                where stage in ('sold', 'onboarding', 'ready_to_schedule', 'scheduled')) end,
    'completed_jobs', (select count(*) from done),
    'completed_cents', case when v_money then (select coalesce(sum(contract), 0) from done) end,
    'collected_cents', case when v_money then (select cents from paid) end,
    'billed_cents', case when v_money then (select billed from billed) end,
    'billed_collected_cents', case when v_money then (select collected from billed) end,
    'margin_jobs', case when v_costs then (select count(*) from margin) end,
    'margin_revenue_cents', case when v_costs then (select coalesce(sum(contract), 0) from margin) end,
    'margin_cost_cents', case when v_costs then (select coalesce(sum(cost), 0) from margin) end,
    'labor_budgeted_hours', (select coalesce(sum(w.budgeted_hours), 0) from public.work_orders w join done d on d.id = w.job_id
                             where w.deleted_at is null and w.status <> 'canceled'),
    'labor_actual_hours', (select coalesce(sum(t.hours), 0) from public.time_entries t join done d on d.id = t.job_id
                           where t.deleted_at is null),
    'punch_items', (select count(*) from public.punch_items p join done d on d.id = p.job_id where p.deleted_at is null)
  ) || jsonb_build_object(
    -- Production promises
    'daily_due', (select count(*) from due_days),
    'daily_logged', (select count(*) from due_days dd where exists (
                       select 1 from public.daily_logs l where l.job_id = dd.job_id and l.log_date = dd.day and l.deleted_at is null)),
    'on_time_met', (select count(*) from started where actual_start_date <= guarantee_start_date),
    'on_time_missed', (select count(*) from started where actual_start_date > guarantee_start_date
                         and coalesce(on_time_guarantee_status, '') <> 'missed_weather'),
    'rain_delay_days', (select count(*) from public.rain_delays r join fj j on j.id = r.job_id
                        where r.delay_date between v_from_day and v_to_day),
    -- Money right now and in the period
    'paid_jobs', (select count(*) from paid_jobs),
    'days_completed_to_paid_avg', (select round(avg(days)::numeric, 1) from paid_jobs),
    'ar_outstanding_cents', case when v_money then (select coalesce(sum(balance_cents), 0) from open_inv) end,
    'overdue_cents', case when v_money then (select coalesce(sum(balance_cents), 0) from open_inv where days_past_due > 0) end,
    'aging', case when v_money then jsonb_build_object(
      'current', (select coalesce(sum(balance_cents), 0) from open_inv where days_past_due = 0),
      'd1_30', (select coalesce(sum(balance_cents), 0) from open_inv where days_past_due between 1 and 30),
      'd31_60', (select coalesce(sum(balance_cents), 0) from open_inv where days_past_due between 31 and 60),
      'd61_90', (select coalesce(sum(balance_cents), 0) from open_inv where days_past_due between 61 and 90),
      'd90_plus', (select coalesce(sum(balance_cents), 0) from open_inv where days_past_due > 90)) end
  ) || jsonb_build_object(
    -- Growth
    'reviews_requested', (select count(*) from reviews),
    'reviews_left', (select count(*) from reviews where review_left),
    'referrals', (select count(*) from refs),
    'referrals_sold', (select count(*) from refs where sold_at is not null and ineligible_reason is null),
    -- Backlog (right now)
    'backlog_hours', (select coalesce(sum(budgeted_hours), 0) from backlog),
    'crew_day_hours', v_crew_hours,
    'backlog_by_work_type', coalesce((select jsonb_agg(jsonb_build_object('work_type', b.work_type, 'hours', b.hours) order by b.hours desc, b.work_type)
                                      from (select work_type, sum(budgeted_hours) as hours from backlog group by work_type) b), '[]'::jsonb),
    -- Marketing spend (prorated by day for partial months)
    'spend_cents', (select coalesce(sum(cents), 0) from spend),
    'cac_jobs', (select count(*) from public.jobs j where j.deleted_at is null and j.org_id = v_org
                   and j.estimate_accepted_at >= p_from and j.estimate_accepted_at < p_to
                   and (v_src is null or j.lead_source = v_src))
  ) || jsonb_build_object(
    -- Pipeline by stage (open jobs, right now)
    'by_stage', coalesce((select jsonb_agg(jsonb_build_object('stage', s.stage, 'jobs', s.n, 'value_cents', s.v)
                                           order by app.job_stage_order(s.stage))
                          from (select stage, count(*) n, case when v_money then coalesce(sum(contract), 0) end v
                                from fj where stage not in ('closed_won', 'closed_lost') group by stage) s), '[]'::jsonb),
    -- Lead funnel (leads created in the period)
    'funnel', jsonb_build_object(
      'leads', (select count(*) from leads_p),
      'contacted', (select count(*) from leads_p where first_contacted_at is not null
                      or status in ('contacted', 'walkthrough_scheduled', 'converted')),
      'walkthrough', (select count(*) from leads_p where walkthrough_at is not null
                        or status in ('walkthrough_scheduled', 'converted')),
      'estimate', (select count(*) from leads_p l join public.jobs j on j.id = l.converted_job_id
                   where j.estimate_sent_at is not null),
      'sold', (select count(*) from leads_p l join public.jobs j on j.id = l.converted_job_id
               where j.estimate_accepted_at is not null)),
    -- City performance (every territory, zeros included, plus Unknown)
    'by_city', coalesce((
      select jsonb_agg(jsonb_build_object('territory_id', c.id, 'city', c.name, 'service_area', c.svc,
                                          'leads', c.leads, 'sold_jobs', c.sold_jobs, 'sold_cents', c.sold_cents)
                       order by c.ord, c.name)
      from (
        select t.id, t.name, t.is_service_area as svc, t.sort_order as ord,
               (select count(*) from leads_p l where l.territory_id = t.id) as leads,
               (select count(*) from sold s where s.territory_id = t.id) as sold_jobs,
               case when v_money then (select coalesce(sum(contract), 0) from sold s where s.territory_id = t.id) end as sold_cents
        from public.territories t
        where t.org_id = v_org and t.deleted_at is null and (v_terr is null or t.id = v_terr)
        union all
        select null, 'Unknown', false, 1000,
               (select count(*) from leads_p l where l.territory_id is null),
               (select count(*) from sold s where s.territory_id is null),
               case when v_money then (select coalesce(sum(contract), 0) from sold s where s.territory_id is null) end
        where v_terr is null
      ) c), '[]'::jsonb),
    -- Estimator leaderboard (estimate owners)
    'by_estimator', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', x.owner_id, 'name', coalesce(p.full_name, 'Unassigned'),
                                          'sent', x.sent, 'cohort_accepted', x.cohort_accepted,
                                          'accepted', x.accepted, 'accepted_value_cents', x.accepted_value)
                       order by x.accepted_value desc, x.accepted desc, coalesce(p.full_name, 'Unassigned'))
      from (
        select owner_id,
               count(*) filter (where first_sent_at >= p_from and first_sent_at < p_to) as sent,
               count(*) filter (where first_sent_at >= p_from and first_sent_at < p_to and status = 'accepted') as cohort_accepted,
               count(*) filter (where status = 'accepted' and accepted_at >= p_from and accepted_at < p_to) as accepted,
               coalesce(sum(total_cents) filter (where status = 'accepted' and accepted_at >= p_from and accepted_at < p_to), 0) as accepted_value
        from est group by owner_id
      ) x left join public.profiles p on p.id = x.owner_id
      where x.sent > 0 or x.accepted > 0), '[]'::jsonb),
    -- Lead source performance
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('source', s.source, 'leads', s.leads, 'converted', s.converted,
                                          'sold_jobs', s.sold_jobs, 'sold_cents', s.sold_cents, 'spend_cents', s.spend)
                       order by s.leads desc, s.sold_jobs desc, s.source)
      from (
        select k.source,
               (select count(*) from leads_p l where l.lead_source is not distinct from k.source) as leads,
               (select count(*) from leads_p l where l.lead_source is not distinct from k.source and l.status = 'converted') as converted,
               (select count(*) from sold j where j.lead_source is not distinct from k.source) as sold_jobs,
               case when v_money then (select coalesce(sum(contract), 0) from sold j where j.lead_source is not distinct from k.source) end as sold_cents,
               (select coalesce(sum(cents), 0) from spend sp where sp.lead_source is not distinct from k.source) as spend
        from (select lead_source as source from leads_p union select lead_source from sold
              union select lead_source from spend) k
      ) s), '[]'::jsonb)
  ) || jsonb_build_object(
    -- Executive alerts: open attention items by rule (right now, not filtered)
    'alerts', coalesce((select jsonb_object_agg(a.rule_key, a.n) from (
        select rule_key, count(*) n from public.attention_items
        where org_id = v_org and status <> 'resolved' group by rule_key) a), '{}'::jsonb),
    'expiring_estimates', (select count(*) from public.estimates e where e.org_id = v_org and e.deleted_at is null
                             and e.status in ('sent', 'viewed') and e.expires_at < now() + interval '5 days'),
    'approvals_pending', (select count(*) from public.approval_requests r where r.org_id = v_org and r.status = 'pending'),
    -- Data quality (right now)
    'dq_leads_unassigned', (select count(*) from fl where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')
                              and owner_id is null),
    'dq_jobs_no_poc', (select count(*) from fj where stage not in ('closed_won', 'closed_lost') and point_of_contact_id is null),
    'dq_jobs_no_property', (select count(*) from fj where stage not in ('closed_won', 'closed_lost') and property_id is null),
    'dq_contacts_unreachable', (select count(*) from public.contacts c where c.org_id = v_org and c.deleted_at is null
                                  and c.mobile is null and c.phone is null and c.email is null)
  ) into v_out;
  return v_out;
end;
$$;

-- Monthly series for the Revenue Forecast and the seasonality dashboard:
-- p_months months starting at p_from_month (first of a month, Pacific).
create or replace function public.analytics_monthly(
  p_from_month date, p_months integer, p_filters jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with params as (
    select date_trunc('month', p_from_month)::date as m0, least(greatest(coalesce(p_months, 12), 1), 36) as n,
           nullif(btrim(coalesce(p_filters ->> 'work_type', '')), '') as wt,
           app.try_uuid(p_filters ->> 'territory_id') as terr,
           app.try_uuid(p_filters ->> 'owner_id') as own,
           nullif(btrim(coalesce(p_filters ->> 'source', '')), '') as src,
           app.has_perm('financials:read') as money
  ),
  months as (
    select (m0 + make_interval(months => g))::date as month from params, generate_series(0, (select n from params) - 1) g
  ),
  fj as (
    select j.*, f.contract_cents as contract from public.jobs j
    left join public.job_financials f on f.job_id = j.id, params p
    where j.deleted_at is null and j.org_id = app.current_org_id()
      and (p.wt is null or j.work_types @> array[p.wt]) and (p.terr is null or j.territory_id = p.terr)
      and (p.own is null or j.owner_id = p.own) and (p.src is null or j.lead_source = p.src)
  )
  select jsonb_build_object(
    'can_see_money', (select money from params),
    'months', coalesce((select jsonb_agg(jsonb_build_object(
        'month', to_char(m.month, 'YYYY-MM-DD'),
        'sold_jobs', (select count(*) from fj where date_trunc('month', estimate_accepted_at at time zone 'America/Los_Angeles')::date = m.month),
        'sold_cents', case when (select money from params) then (select coalesce(sum(contract), 0) from fj
                        where date_trunc('month', estimate_accepted_at at time zone 'America/Los_Angeles')::date = m.month) end,
        'completed_jobs', (select count(*) from fj where date_trunc('month', completed_at at time zone 'America/Los_Angeles')::date = m.month),
        'completed_cents', case when (select money from params) then (select coalesce(sum(contract), 0) from fj
                             where date_trunc('month', completed_at at time zone 'America/Los_Angeles')::date = m.month) end,
        'collected_cents', case when (select money from params) then (
            select coalesce(sum(a.amount_cents), 0) from public.payment_applications a
            join public.payments p on p.id = a.payment_id join fj on fj.id = p.job_id
            where p.status in ('received', 'cleared') and date_trunc('month', p.received_on)::date = m.month) end,
        'goal_cents', case when (select money from params) then (
            select g.goal_cents from public.revenue_goals g where g.org_id = app.current_org_id() and g.month = m.month) end
      ) order by m.month) from months m), '[]'::jsonb)
  );
$$;

-- Exterior Season Backlog (SPEC §8.2): booked crew-days vs capacity for each
-- month of the exterior season (Company Settings), plus sold exterior / deck
-- work not on the schedule yet.
create or replace function public.season_backlog(p_year integer)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
  v_start date;
  v_end date;
  v_days smallint[];
  v_crew_hours numeric;
  v_crews integer;
  v_out jsonb;
begin
  select make_date(p_year, split_part(coalesce(c.exterior_season_start, '06-01'), '-', 1)::int,
                   split_part(coalesce(c.exterior_season_start, '06-01'), '-', 2)::int),
         make_date(p_year, split_part(coalesce(c.exterior_season_end, '09-30'), '-', 1)::int,
                   split_part(coalesce(c.exterior_season_end, '09-30'), '-', 2)::int)
    into v_start, v_end
  from public.company_settings c where c.org_id = v_org;
  v_start := coalesce(v_start, make_date(p_year, 6, 1));
  v_end := coalesce(v_end, make_date(p_year, 9, 30));
  select coalesce(s.production_days, '{1,2,3,4,5}'), coalesce(s.crew_day_hours, 8) into v_days, v_crew_hours
  from public.schedule_settings s where s.org_id = v_org;
  v_days := coalesce(v_days, '{1,2,3,4,5}');
  v_crew_hours := coalesce(v_crew_hours, 8);
  select count(*) into v_crews from public.crews c where c.org_id = v_org and c.active and c.deleted_at is null;

  with months as (
    select greatest(m::date, v_start) as m_from,
           least((m + interval '1 month' - interval '1 day')::date, v_end) as m_to,
           m::date as month
    from generate_series(date_trunc('month', v_start), date_trunc('month', v_end), interval '1 month') m
  ),
  ext as (
    select j.* from public.jobs j
    where j.org_id = v_org and j.deleted_at is null and j.work_types && array['exterior', 'deck_fence']
  ),
  entries as (
    select s.* from public.schedule_entries s join ext j on j.id = s.job_id where s.status = 'published'
  ),
  unscheduled as (
    select j.id, coalesce(
      j.estimated_duration_days::numeric,
      ceil((select sum(w.budgeted_hours) from public.work_orders w
            where w.job_id = j.id and w.deleted_at is null and w.status not in ('completed', 'canceled')) / v_crew_hours),
      0) as crew_days
    from ext j
    where j.stage in ('sold', 'onboarding', 'ready_to_schedule')
      and (j.target_season is null or j.target_season = p_year)
      and not exists (select 1 from entries e where e.job_id = j.id)
  )
  select jsonb_build_object(
    'season_start', to_char(v_start, 'YYYY-MM-DD'),
    'season_end', to_char(v_end, 'YYYY-MM-DD'),
    'crews', v_crews,
    'months', coalesce((select jsonb_agg(jsonb_build_object(
        'month', to_char(m.month, 'YYYY-MM-DD'),
        'capacity_crew_days', v_crews * app.production_days_between(m.m_from, m.m_to, v_days),
        'booked_crew_days', coalesce((select sum(app.production_days_between(greatest(e.starts_on, m.m_from), least(e.ends_on, m.m_to), v_days))
                                       from entries e where e.starts_on <= m.m_to and e.ends_on >= m.m_from), 0)
      ) order by m.month) from months m), '[]'::jsonb),
    'unscheduled_jobs', (select count(*) from unscheduled),
    'unscheduled_crew_days', (select coalesce(sum(crew_days), 0) from unscheduled)
  ) into v_out;
  return v_out;
end;
$$;

-- =============================================================================
-- 7. My Numbers (SPEC §8.15): one person's cards, each on its own date field.
--    Row security applies: a rep sees their own records; owners can pass any
--    rep in their company.
-- =============================================================================

create or replace function public.my_numbers(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with b as (
    select (p_from at time zone 'America/Los_Angeles')::date as from_day,
           ((p_to at time zone 'America/Los_Angeles') - interval '1 microsecond')::date as to_day
  ),
  est as (
    select e.*, (select min(v.sent_at) from public.estimate_versions v where v.estimate_id = e.id and v.sent_at is not null) as first_sent_at
    from public.estimates e where e.deleted_at is null and e.owner_id = p_user
  )
  select jsonb_build_object(
    'leads_issued', (select count(*) from public.leads l where l.deleted_at is null and l.owner_id = p_user
                       and l.created_at >= p_from and l.created_at < p_to),
    'walkthroughs_set', (select count(*) from public.appointments a where a.deleted_at is null and a.type = 'walkthrough'
                           and a.created_by = p_user and a.created_at >= p_from and a.created_at < p_to),
    'walkthroughs_ran', (select count(*) from public.appointments a where a.deleted_at is null and a.type = 'walkthrough'
                           and a.status = 'completed' and p_user = any(a.assigned_user_ids)
                           and coalesce(a.completed_at, a.starts_at) >= p_from and coalesce(a.completed_at, a.starts_at) < p_to),
    'estimates_sent', (select count(*) from est where first_sent_at >= p_from and first_sent_at < p_to),
    'sold_count', (select count(*) from est where status = 'accepted' and accepted_at >= p_from and accepted_at < p_to),
    'sold_cents', (select coalesce(sum(total_cents), 0) from est where status = 'accepted' and accepted_at >= p_from and accepted_at < p_to),
    'completed', (select count(*) from public.jobs j where j.deleted_at is null and j.owner_id = p_user
                    and j.completed_at >= p_from and j.completed_at < p_to),
    'invoiced', (select count(*) from public.jobs j where j.deleted_at is null and j.owner_id = p_user
                   and j.final_invoiced_at >= p_from and j.final_invoiced_at < p_to),
    'paid', (select count(*) from public.jobs j where j.deleted_at is null and j.owner_id = p_user
               and j.paid_in_full_at >= p_from and j.paid_in_full_at < p_to)
  );
$$;

-- =============================================================================
-- 8. Workspace "My Day" (SPEC §8.3): the signed-in person's counts for today
--    (Pacific), in one query.
-- =============================================================================

create or replace function public.workspace_summary()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with me as (select app.effective_user_id() as id, app.production_today() as today),
  bounds as (
    select (today::timestamp at time zone 'America/Los_Angeles') as day_start,
           ((today + 1)::timestamp at time zone 'America/Los_Angeles') as day_end, id from me
  ),
  my_tasks as (
    select t.* from public.tasks t, bounds b
    where t.deleted_at is null and t.assignee_id = b.id and t.status not in ('done', 'canceled')
  ),
  my_attention as (
    select a.* from public.attention_items a, bounds b
    where a.owner_id = b.id and a.status <> 'resolved'
  ),
  my_jobs as (
    select j.* from public.jobs j, bounds b
    where j.deleted_at is null and j.team_user_ids @> array[b.id] and j.stage not in ('closed_won', 'closed_lost')
  )
  select jsonb_build_object(
    -- Due later today; anything whose due time has passed is overdue.
    'tasks_due_today', (select count(*) from my_tasks t, bounds b where t.due_at >= now() and t.due_at < b.day_end),
    'tasks_overdue', (select count(*) from my_tasks t where t.due_at < now()),
    'tasks_upcoming', (select count(*) from my_tasks t, bounds b where t.due_at >= b.day_end),
    'tasks_no_due', (select count(*) from my_tasks where due_at is null),
    'appointments_today', (select count(*) from public.appointments a, bounds b
                           where a.deleted_at is null and b.id = any(a.assigned_user_ids)
                             and a.status not in ('canceled', 'rescheduled')
                             and a.starts_at >= b.day_start and a.starts_at < b.day_end),
    'jobs_active', (select count(*) from my_jobs),
    'jobs_need_action', (select count(distinct a.subject_id) from my_attention a where a.subject_type = 'job'),
    'jobs_at_risk', (select count(*) from my_jobs where health_score is not null and health_score < 60),
    'leads_new', (select count(*) from public.leads l, bounds b where l.deleted_at is null and l.owner_id = b.id
                    and l.created_at >= b.day_start and l.created_at < b.day_end),
    'leads_awaiting_contact', (select count(*) from public.leads l, bounds b where l.deleted_at is null and l.owner_id = b.id
                                 and l.status = 'new' and l.first_contacted_at is null),
    'leads_follow_ups_today', (select count(*) from my_tasks t, bounds b where t.subject_type = 'lead'
                                 and t.due_at >= b.day_start and t.due_at < b.day_end),
    'leads_converted_today', (select count(*) from public.leads l, bounds b where l.deleted_at is null and l.owner_id = b.id
                                and l.converted_at >= b.day_start and l.converted_at < b.day_end),
    'cases_open', (select count(*) from public.cases c, bounds b where c.owner_id = b.id
                     and c.status not in ('resolved', 'closed')),
    'cases_overdue', (select count(*) from public.cases c, bounds b where c.owner_id = b.id
                        and c.status not in ('resolved', 'closed') and c.sla_due_at < now()),
    'unread_email', (select count(*) from public.message_threads t where t.unread and t.last_channel = 'email'),
    'unread_sms', (select count(*) from public.message_threads t where t.unread and t.last_channel = 'sms'),
    'mentions_unread', (select count(*) from public.notifications n, bounds b where n.user_id = b.id
                          and n.read_at is null and n.type = 'mention'),
    'notifications_unread', (select count(*) from public.notifications n, bounds b where n.user_id = b.id and n.read_at is null),
    'attention_open', (select count(*) from my_attention),
    'attention_urgent', (select count(*) from my_attention where priority in ('critical', 'high') and status = 'pending'),
    'attention_by_category', coalesce((select jsonb_object_agg(category, n) from (
        select category, count(*) n from my_attention group by category) c), '{}'::jsonb),
    'approvals_pending', case when app.has_perm('job_admin:override') or app.has_perm('estimates:approve_discount')
                                   or app.has_perm('credits:approve')
                              then (select count(*) from public.approval_requests r where r.status = 'pending')
                              else (select count(*) from public.approval_requests r, bounds b
                                    where r.status = 'pending' and r.requested_by = b.id) end,
    'estimates_awaiting_reply', (select count(*) from public.estimates e, bounds b where e.deleted_at is null
                                   and e.owner_id = b.id and e.status in ('sent', 'viewed'))
  );
$$;

-- =============================================================================
-- 9. Daily Brief (SPEC §8.14): what changed on one Pacific day, and what
--    needs attention now. Deterministic counts; the words are built in
--    lib/domain/analytics/daily-brief.ts.
-- =============================================================================

create or replace function public.daily_brief(p_day date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with b as (
    select (p_day::timestamp at time zone 'America/Los_Angeles') as s,
           ((p_day + 1)::timestamp at time zone 'America/Los_Angeles') as e,
           app.has_perm('financials:read') as money
  ),
  won as (
    select e.* from public.estimates e, b where e.deleted_at is null and e.status = 'accepted'
      and e.accepted_at >= b.s and e.accepted_at < b.e
  )
  select jsonb_build_object(
    'day', to_char(p_day, 'YYYY-MM-DD'),
    'can_see_money', (select money from b),
    'leads_created', (select count(*) from public.leads l, b where l.deleted_at is null and l.created_at >= b.s and l.created_at < b.e),
    'walkthroughs_completed', (select count(*) from public.appointments a, b where a.deleted_at is null and a.type = 'walkthrough'
                                 and a.status = 'completed' and a.completed_at >= b.s and a.completed_at < b.e),
    'estimates_sent', (select count(*) from public.estimate_versions v, b where v.sent_at >= b.s and v.sent_at < b.e),
    'estimates_accepted', (select count(*) from won),
    'accepted_value_cents', (select coalesce(sum(total_cents), 0) from won),
    'jobs_started', (select count(*) from public.jobs j where j.deleted_at is null and j.actual_start_date = p_day),
    'jobs_completed', (select count(*) from public.jobs j, b where j.deleted_at is null and j.completed_at >= b.s and j.completed_at < b.e),
    'daily_logs', (select count(*) from public.daily_logs l where l.deleted_at is null and l.log_date = p_day),
    'invoices_sent', case when (select money from b) then (select count(*) from public.invoices i, b
                        where i.status <> 'void' and i.sent_at >= b.s and i.sent_at < b.e) end,
    'collected_cents', case when (select money from b) then (
        select coalesce(sum(a.amount_cents), 0) from public.payment_applications a join public.payments p on p.id = a.payment_id
        where p.status in ('received', 'cleared') and p.received_on = p_day) end,
    'reviews_left', (select count(*) from public.review_requests r, b where r.review_left and r.review_left_at >= b.s and r.review_left_at < b.e),
    'attention_now', (select count(*) from public.attention_items a where a.status = 'pending' and a.priority in ('critical', 'high')),
    'attention_open', (select count(*) from public.attention_items a where a.status <> 'resolved'),
    'overdue_invoices', case when (select money from b) then (select count(*) from public.invoice_ledger i
                           where i.issued and i.balance_cents > 0 and i.days_past_due > 0) end,
    'approvals_pending', (select count(*) from public.approval_requests r where r.status = 'pending'),
    'unread_conversations', (select count(*) from public.message_threads t where t.unread),
    'ready_to_schedule', (select count(*) from public.jobs j where j.deleted_at is null and j.stage = 'ready_to_schedule')
  );
$$;

-- =============================================================================
-- 10. Worker helper: a person's current scope for some permissions (the
--     report-delivery worker re-checks the schedule owner's access each run).
-- =============================================================================

create or replace function public.user_permission_scopes(p_user uuid, p_permissions text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(p, app.user_perm_scope(p_user, p)), '{}'::jsonb)
  from unnest(coalesce(p_permissions, '{}'::text[])) p;
$$;

revoke execute on function public.user_permission_scopes(uuid, text[]) from public, anon, authenticated;
grant execute on function public.user_permission_scopes(uuid, text[]) to service_role;

revoke execute on function public.log_export(text, text, text, integer, jsonb), public.note_report_run(uuid),
  public.analytics_stats(timestamptz, timestamptz, jsonb), public.analytics_monthly(date, integer, jsonb),
  public.season_backlog(integer), public.my_numbers(uuid, timestamptz, timestamptz),
  public.workspace_summary(), public.daily_brief(date) from public, anon;
grant execute on function public.log_export(text, text, text, integer, jsonb), public.note_report_run(uuid),
  public.analytics_stats(timestamptz, timestamptz, jsonb), public.analytics_monthly(date, integer, jsonb),
  public.season_backlog(integer), public.my_numbers(uuid, timestamptz, timestamptz),
  public.workspace_summary(), public.daily_brief(date) to authenticated, service_role;
grant execute on function app.try_uuid(text), app.job_direct_cost_cents(uuid), app.work_type_service(text),
  app.production_days_between(date, date, smallint[]) to authenticated, service_role;
