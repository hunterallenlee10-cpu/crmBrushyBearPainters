-- Rolls back Phase 4 estimating. DESTROYS estimates, change orders, signatures,
-- documents (rows; files are removed by the seed rollback), invoices,
-- onboarding requirements, paint orders and work orders. Run
-- 20261027000200_estimating_seed.down.sql first. Owner approval required.

-- Screen and engine functions.
drop function if exists public.create_estimate(uuid, text);
drop function if exists public.copy_estimate_version(uuid);
drop function if exists public.estimate_stats(timestamptz, timestamptz);
drop function if exists public.estimate_status_counts();
drop function if exists public.mark_estimate_sent(uuid, text, timestamptz, jsonb, bigint, text[]);
drop function if exists public.resolve_proposal_token(text);
drop function if exists public.record_proposal_view(text);
drop function if exists public.accept_estimate(text, uuid, uuid[], text, text, text, text, text, inet, text, jsonb, jsonb);
drop function if exists public.decline_proposal(text, text);
drop function if exists public.expire_proposals();
drop function if exists public.store_version_pricing(uuid, jsonb, jsonb, numeric, jsonb, jsonb);
drop function if exists public.store_change_order_pricing(uuid, jsonb, jsonb, bigint, bigint, bigint, jsonb);
drop function if exists public.approve_version_discount(uuid, numeric, uuid);
drop function if exists public.mark_change_order_sent(uuid, text, timestamptz, jsonb, text[]);
drop function if exists public.accept_change_order(text, text, text, text, text, text, inet, text, jsonb);
drop function if exists public.attach_signed_document(uuid, uuid);
drop function if exists app.signable_token(text);
drop function if exists app.org_estimate_sla_hours();
drop function if exists app.money_text(bigint);

-- Jobs Dashboard reads the Phase 3 baseline again.
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

-- Phase 3 gates.
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
revoke execute on function app.job_gate_passes(uuid, text) from public, anon, authenticated;
grant execute on function app.job_gate_passes(uuid, text) to service_role;

-- Approvals: Phase 3 policies, guard and types.
delete from public.approval_requests where type = 'estimate_discount';
drop policy if exists approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (requested_by = (select app.effective_user_id()) or (select app.has_perm('job_admin:override')))
    and exists (select 1 from public.jobs j where j.id = job_id)
  );
drop policy if exists approval_requests_insert on public.approval_requests;
create policy approval_requests_insert on public.approval_requests for insert to authenticated
  with check (
    org_id = (select app.current_org_id()) and (select app.can_write('jobs:advance_stage'))
    and exists (select 1 from public.jobs j where j.id = job_id)
  );
drop policy if exists approval_requests_update on public.approval_requests;
create policy approval_requests_update on public.approval_requests for update to authenticated
  using (
    org_id = (select app.current_org_id()) and not (select app.is_impersonating())
    and (requested_by = (select app.effective_user_id()) or (select app.has_perm('job_admin:override')))
  )
  with check (org_id = (select app.current_org_id()));
alter table public.approval_requests drop constraint approval_requests_type_check;
alter table public.approval_requests add constraint approval_requests_type_check check (type in ('stage_override'));

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

-- Contract money columns.
drop trigger if exists job_financials_contract_guard on public.job_financials;
drop function if exists app.job_financials_contract_guard();
alter table public.job_financials drop column if exists contract_cents;
alter table public.job_financials drop column if exists change_orders_cents;
alter table public.job_financials drop column if exists estimate_contract_cents;

-- Tables (children first).
update public.jobs set accepted_estimate_id = null where accepted_estimate_id is not null;
alter table public.jobs drop constraint if exists jobs_accepted_estimate_fk;
drop index if exists public.jobs_accepted_estimate_idx;
delete from public.job_holds where hold_type = 'deposit' and reason like 'Waiting for the deposit (invoice %';

drop table if exists public.work_order_costs;
drop table if exists public.work_orders;
drop table if exists public.paint_order_lines;
drop table if exists public.paint_orders;
drop table if exists public.onboarding_requirements;
drop table if exists public.invoice_lines;
drop table if exists public.invoices;
alter table if exists public.signatures drop constraint if exists signatures_document_fk;
drop table if exists public.documents;
drop table if exists public.signatures;
drop table if exists public.proposal_tokens;
drop table if exists public.agreement_templates;
drop table if exists public.color_selections;
drop table if exists public.estimate_line_items;
drop table if exists public.change_orders;
drop table if exists public.estimate_areas;
drop table if exists public.estimate_options;
alter table if exists public.estimates drop constraint if exists estimates_current_version_fk;
alter table if exists public.estimates drop constraint if exists estimates_accepted_version_fk;
drop table if exists public.estimate_versions;
drop table if exists public.estimates;
drop table if exists public.estimate_settings;
drop table if exists public.catalog_items;
drop table if exists public.production_rates;
drop table if exists public.paint_products;
drop table if exists public.price_books;

-- Guards and helpers.
drop function if exists app.catalog_guard();
drop function if exists app.price_books_guard();
drop function if exists app.estimate_settings_guard();
drop function if exists app.estimates_guard();
drop function if exists app.estimate_versions_guard();
drop function if exists app.estimate_versions_after();
drop function if exists app.estimate_content_guard();
drop function if exists app.change_orders_guard();
drop function if exists app.color_selections_guard();
drop function if exists app.agreement_templates_guard();
drop function if exists app.signatures_guard();
drop function if exists app.documents_guard();
drop function if exists app.invoices_guard();
drop function if exists app.invoice_lines_guard();
drop function if exists app.invoice_lines_after();
drop function if exists app.onboarding_requirements_guard();
drop function if exists app.paint_orders_guard();
drop function if exists app.paint_order_lines_guard();
drop function if exists app.paint_order_lines_after();
drop function if exists app.work_orders_guard();
drop function if exists app.work_order_costs_guard();
drop function if exists app.estimate_job_id(uuid);
drop function if exists app.version_job_id(uuid);
drop function if exists app.change_order_job_id(uuid);
drop function if exists app.can_edit_estimates(uuid);
drop function if exists app.is_money_document(text);
drop function if exists app.line_engine_columns();
drop function if exists app.is_key(text);

-- Numbers.
delete from app.number_sequences where kind = 'paint_order';
delete from app.number_sequences where kind in ('estimate', 'invoice', 'work_order', 'change_order');
alter table app.number_sequences drop constraint number_sequences_kind_check;
alter table app.number_sequences add constraint number_sequences_kind_check
  check (kind in ('job', 'estimate', 'invoice', 'payment', 'work_order', 'change_order'));
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

-- Permissions.
delete from public.user_permission_overrides where permission in ('catalog:manage', 'change_orders:draft');
delete from public.pack_permissions where permission in ('catalog:manage', 'change_orders:draft');
delete from public.permissions where key in ('catalog:manage', 'change_orders:draft');
