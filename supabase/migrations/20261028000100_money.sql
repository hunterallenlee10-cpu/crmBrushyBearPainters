-- Phase 7: Money (SPEC §5.6, §10, §8.5 #5, §8.19 Finance, §9, §11.2 #6/#13/#14/#15,
-- §12.1).
--
-- Payments, payment applications (payments go onto invoices; unapplied cash is
-- a warning, never counted), refunds, credits (On-Time Guarantee, goodwill,
-- discount, referral) with approval, month closes (locked periods need an
-- owner override with a reason), job expenses (+ a private receipts bucket).
-- Ledger views computed from the records: public.invoice_ledger,
-- public.job_ledger. There is NO stored balance anywhere (tested in
-- supabase/tests/013_money.test.sql). Invoice status is kept by the database
-- from the facts (paid / partly paid / overdue), never typed in.
-- Money writes go through service-role RPCs called by trusted server code
-- after its permission checks; each RPC re-checks the actor's permission.
-- Gates Completed → Invoiced (final invoice sent), Invoiced → Paid in Full
-- (balance $0, nothing left to bill) and Paid in Full → Closed Won (balance
-- still $0) become real (must agree with lib/domain/jobs/gates.ts).
-- Approved On-Time Guarantee credits (Phase 6) become ledger credits and go
-- onto the final invoice. Finance numbers for the metrics registry:
-- public.finance_stats(). Universal search finds invoices.
--
-- Purely additive: new tables, columns, views and functions; replaced
-- functions keep their signatures. Safe on a database with Phases 0–6 applied.
--
-- Rollback: supabase/rollbacks/20261028000100_money.down.sql

-- =============================================================================
-- 0. Permission, helpers
-- =============================================================================

-- Owners only: no permission pack includes it (owner templates grant everything).
-- @permissions:begin
insert into public.permissions (key, resource, action, label, category, supports_scope, sort_order)
select v.key, split_part(v.key, ':', 1), split_part(v.key, ':', 2), v.label, v.category, v.scoped, v.ord
from (values
  ('finance:override_lock', 'Change invoices and payments in a closed month', 'finance', false, 455)
) as v(key, label, category, scoped, ord)
on conflict (key) do nothing;
-- @permissions:end

-- The acting person holds a permission (system calls without an actor pass).
create or replace function app.require_actor_perm(p_permission text, p_message text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.actor_id();
begin
  if v_actor is not null and app.user_perm_scope(v_actor, p_permission) is null then
    raise exception '%', p_message using errcode = '42501';
  end if;
end;
$$;

create or replace function app.lock_override_on()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.lock_override', true), '') = 'on';
$$;

-- Set by the money functions while they write credits and credit memos.
create or replace function app.money_write_on()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.money_write', true), '') = 'on';
$$;

-- Changing a record dated in a closed month needs an owner (finance:override_lock)
-- and a reason of at least 10 characters. Returns true when an override was used.
create or replace function app.check_money_lock(p_org uuid, p_days date[], p_reason text, p_what text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.actor_id();
  v_day date;
  v_locked date;
begin
  foreach v_day in array coalesce(p_days, '{}'::date[]) loop
    if app.money_locked(p_org, v_day) then
      v_locked := v_day;
      exit;
    end if;
  end loop;
  if v_locked is null then
    return false;
  end if;
  if v_actor is null or app.user_perm_scope(v_actor, 'finance:override_lock') is null then
    raise exception '% is in a closed month (%). Ask an owner to make this change with an override.',
      p_what, to_char(v_locked, 'FMMonth YYYY') using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception '% is in a closed month (%). Say why you''re changing it (at least 10 characters).',
      p_what, to_char(v_locked, 'FMMonth YYYY') using errcode = '23514';
  end if;
  perform set_config('app.lock_override', 'on', true);
  return true;
end;
$$;

-- What an invoice shows right now (same rules as lib/domain/ledger/ledger.ts invoiceDisplayStatus).
create or replace function app.invoice_display_status(
  p_status text, p_sent_at timestamptz, p_viewed_at timestamptz, p_due date,
  p_total bigint, p_collected bigint, p_today date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'void' then 'void'
    when p_total > 0 and p_total - p_collected <= 0 then 'paid'
    when p_sent_at is null then 'draft'
    when p_total <= 0 then 'sent'
    when p_due is not null and p_due < p_today then 'overdue'
    when p_collected > 0 then 'partially_paid'
    when p_viewed_at is not null then 'viewed'
    else 'sent'
  end;
$$;

-- =============================================================================
-- 1. Tables
-- =============================================================================

-- One live final invoice per job (the Completed → Invoiced gate reads it).
create unique index invoices_one_final_idx on public.invoices (job_id)
  where invoice_type = 'final' and status <> 'void';
create index invoices_org_issue_idx on public.invoices (org_id, issue_date) where status <> 'void';
create index invoices_org_due_idx on public.invoices (org_id, due_date) where status not in ('void', 'paid');

-- The PDF stored in Documents when the invoice was sent.
alter table public.invoices
  add column pdf_document_id uuid references public.documents (id) on delete set null;
create index invoices_pdf_doc_idx on public.invoices (pdf_document_id);

-- Payments (SPEC §5.6). `void` = entered by mistake (in addition to the SPEC list).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  payment_number text not null,
  method text not null check (method in ('check', 'cash', 'card', 'ach', 'zelle', 'financing', 'other')),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  received_on date not null,
  reference text check (length(reference) <= 120),
  notes text check (length(notes) <= 2000),
  status text not null default 'received' check (status in ('received', 'cleared', 'bounced', 'refunded', 'void')),
  cleared_on date,
  bounced_at timestamptz,
  voided_at timestamptz,
  status_reason text check (length(status_reason) <= 500),
  accounting_sync_status text not null default 'not_connected'
    check (accounting_sync_status in ('not_connected', 'pending', 'synced', 'error')),
  external_id text check (length(external_id) <= 200),
  external_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, payment_number),
  check (status <> 'cleared' or cleared_on is not null),
  check (status <> 'bounced' or (bounced_at is not null and status_reason is not null)),
  check (status <> 'void' or (voided_at is not null and status_reason is not null))
);
create index payments_job_idx on public.payments (job_id, received_on);
create index payments_org_received_idx on public.payments (org_id, received_on);
create index payments_org_status_idx on public.payments (org_id, status);
create index payments_account_idx on public.payments (account_id);

-- Payment → invoice (SPEC §5.6). One row per pair; the amount is what this
-- payment pays on that invoice.
create table public.payment_applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  payment_id uuid not null references public.payments (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (payment_id, invoice_id)
);
create index payment_applications_invoice_idx on public.payment_applications (invoice_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  payment_id uuid not null references public.payments (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  refunded_on date not null,
  method text not null check (method in ('check', 'cash', 'card', 'ach', 'zelle', 'financing', 'other')),
  reference text check (length(reference) <= 120),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  -- How the refund came off the payment: {"from_unapplied": cents, "reductions": [{invoice_id, before, after}]}
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index refunds_payment_idx on public.refunds (payment_id);
create index refunds_job_idx on public.refunds (job_id);
create index refunds_org_date_idx on public.refunds (org_id, refunded_on);

-- Credits (SPEC §5.6, §10): approved credits lower the contract; they go onto
-- the final invoice (or a credit memo once it's sent).
create table public.credits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  credit_type text not null check (credit_type in ('on_time_guarantee', 'goodwill', 'discount', 'referral')),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'applied', 'rejected', 'voided')),
  requested_by uuid references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 1000),
  invoice_id uuid references public.invoices (id) on delete set null,
  applied_at timestamptz,
  on_time_credit_id uuid unique references public.on_time_credits (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check ((status = 'applied') = (invoice_id is not null)),
  check (status = 'pending_approval' or decided_at is not null)
);
create index credits_job_idx on public.credits (job_id);
create index credits_org_status_idx on public.credits (org_id, status);
create index credits_invoice_idx on public.credits (invoice_id);

-- Month close (SPEC §10). One row per company and month.
create table public.month_closes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  status text not null default 'closed' check (status in ('closed', 'reopened')),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz not null default now(),
  note text check (length(note) <= 1000),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  reopened_by uuid references public.profiles (id),
  reopened_at timestamptz,
  reopen_reason text check (length(reopen_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, month),
  check (status = 'closed' or reopened_at is not null)
);

-- The acting person belongs to the record's company (system calls without an actor pass).
create or replace function app.require_actor_org(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.actor_id();
begin
  if v_actor is not null and not exists (select 1 from public.profiles p where p.id = v_actor and p.org_id = p_org) then
    raise exception 'That record isn''t available.' using errcode = '42501';
  end if;
end;
$$;

-- A Pacific date falls in a closed month.
create or replace function app.money_locked(p_org uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_day is not null and exists (
    select 1 from public.month_closes m
    where m.org_id = p_org and m.status = 'closed' and m.month = date_trunc('month', p_day)::date);
$$;

-- Job expenses with receipts (SPEC §5.6 job_costs "other expenses (receipts with photo)").
create table public.job_expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  category text not null check (category in ('materials', 'subcontractor', 'equipment', 'permit', 'disposal', 'other')),
  description text not null check (length(btrim(description)) between 1 and 300),
  vendor text check (length(vendor) <= 160),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  spent_on date not null,
  receipt_path text check (length(receipt_path) <= 500),
  receipt_mime text check (receipt_mime in ('image/jpeg', 'application/pdf')),
  receipt_bytes integer check (receipt_bytes between 1 and 26214400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text check (length(delete_reason) <= 500),
  check ((receipt_path is null) = (receipt_mime is null))
);
create index job_expenses_job_idx on public.job_expenses (job_id, spent_on) where deleted_at is null;
create index job_expenses_org_idx on public.job_expenses (org_id, spent_on) where deleted_at is null;

-- Saved views for the Invoices list.
alter table public.saved_views drop constraint saved_views_module_check,
  add constraint saved_views_module_check check (module in ('leads', 'accounts', 'contacts', 'jobs', 'invoices'));

-- =============================================================================
-- 2. Ledger views (caller's row security; money only with financials:read)
-- =============================================================================

create or replace view public.invoice_ledger with (security_invoker = true) as
select
  i.id, i.org_id, i.job_id, i.account_id, i.invoice_number, i.invoice_type, i.status,
  i.issue_date, i.due_date, i.total_cents, i.sent_at, i.viewed_at, i.voided_at, i.created_at,
  i.accounting_sync_status,
  case when i.status = 'void' then 0 else coalesce(c.collected, 0) end::bigint as collected_cents,
  case when i.status = 'void' then 0 else i.total_cents - coalesce(c.collected, 0) end::bigint as balance_cents,
  (i.status <> 'void' and i.sent_at is not null) as issued,
  case when i.status <> 'void' and i.sent_at is not null
            and i.total_cents - coalesce(c.collected, 0) > 0 and i.due_date is not null
       then greatest(0, app.production_today() - i.due_date) else 0 end as days_past_due,
  app.invoice_display_status(i.status, i.sent_at, i.viewed_at, i.due_date, i.total_cents,
                             coalesce(c.collected, 0), app.production_today()) as display_status,
  j.name as job_name, j.job_number, j.stage as job_stage, a.display_name as account_name
from public.invoices i
left join lateral (
  select sum(pa.amount_cents)::bigint as collected
  from public.payment_applications pa
  join public.payments p on p.id = pa.payment_id and p.status in ('received', 'cleared')
  where pa.invoice_id = i.id
) c on true
left join public.jobs j on j.id = i.job_id
left join public.accounts a on a.id = i.account_id
where (select app.is_trusted() or app.has_perm('invoices:read'));

create or replace view public.payment_ledger with (security_invoker = true) as
select
  p.id, p.org_id, p.job_id, p.account_id, p.payment_number, p.method, p.amount_cents, p.received_on,
  p.reference, p.status, p.cleared_on, p.accounting_sync_status, p.created_at,
  coalesce(r.refunded, 0)::bigint as refunded_cents,
  case when p.status in ('received', 'cleared') then coalesce(a.applied, 0) else 0 end::bigint as applied_cents,
  case when p.status in ('received', 'cleared') then greatest(0, p.amount_cents - coalesce(r.refunded, 0)) else 0 end::bigint
    as available_cents,
  case when p.status in ('received', 'cleared')
       then greatest(0, p.amount_cents - coalesce(r.refunded, 0) - coalesce(a.applied, 0)) else 0 end::bigint
    as unapplied_cents
from public.payments p
left join lateral (select sum(x.amount_cents) as refunded from public.refunds x where x.payment_id = p.id) r on true
left join lateral (select sum(x.amount_cents) as applied from public.payment_applications x where x.payment_id = p.id) a on true
where (select app.is_trusted() or app.has_perm('financials:read'));

-- The job's money (SPEC §10), same formulas as lib/domain/ledger/ledger.ts.
create or replace view public.job_ledger with (security_invoker = true) as
select
  j.id as job_id, j.org_id, j.stage,
  coalesce(f.contract_cents, 0)::bigint as contract_base_cents,
  coalesce(cr.approved, 0)::bigint as credits_cents,
  coalesce(cr.pending, 0)::bigint as pending_credits_cents,
  (coalesce(f.contract_cents, 0) - coalesce(cr.approved, 0))::bigint as contract_cents,
  coalesce(inv.billed, 0)::bigint as billed_cents,
  (coalesce(f.contract_cents, 0) - coalesce(cr.approved, 0) - coalesce(inv.billed, 0))::bigint as left_to_bill_cents,
  coalesce(inv.collected, 0)::bigint as collected_cents,
  (coalesce(inv.billed, 0) - coalesce(inv.collected, 0))::bigint as balance_cents,
  greatest(0, least(coalesce(inv.overdue, 0), coalesce(inv.billed, 0) - coalesce(inv.collected, 0)))::bigint as due_cents,
  coalesce(pay.unapplied, 0)::bigint as unapplied_cents,
  coalesce(pay.refunded, 0)::bigint as refunded_cents,
  coalesce(pay.uncleared, 0)::bigint as uncleared_cents,
  pay.last_payment_on,
  coalesce(inv.overdue_count, 0)::integer as overdue_invoices
from public.jobs j
left join public.job_financials f on f.job_id = j.id
left join lateral (
  select sum(c.amount_cents) filter (where c.status in ('approved', 'applied')) as approved,
         sum(c.amount_cents) filter (where c.status = 'pending_approval') as pending
  from public.credits c where c.job_id = j.id
) cr on true
left join lateral (
  select sum(il.total_cents) as billed, sum(il.collected_cents) as collected,
         sum(il.balance_cents) filter (where il.days_past_due > 0) as overdue,
         count(*) filter (where il.days_past_due > 0) as overdue_count
  from public.invoice_ledger il where il.job_id = j.id and il.status <> 'void'
) inv on true
left join lateral (
  select sum(pl.unapplied_cents) as unapplied, sum(pl.refunded_cents) as refunded,
         sum(pl.available_cents) filter (where pl.status = 'received') as uncleared,
         max(pl.received_on) filter (where pl.status in ('received', 'cleared')) as last_payment_on
  from public.payment_ledger pl where pl.job_id = j.id
) pay on true
where j.deleted_at is null and (select app.is_trusted() or app.has_perm('financials:read'));

-- One job's ledger row for gates and trusted code.
create or replace function app.job_money(p_job uuid)
returns public.job_ledger
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.job_ledger where job_id = p_job;
$$;

-- =============================================================================
-- 3. Bookkeeping: invoice status from the facts, deposit milestone
-- =============================================================================

create or replace function app.refresh_invoice_status(p_invoice uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_collected bigint;
  v_status text;
begin
  select * into v_inv from public.invoices where id = p_invoice;
  if not found then return null; end if;
  select coalesce(sum(pa.amount_cents), 0) into v_collected
  from public.payment_applications pa
  join public.payments p on p.id = pa.payment_id and p.status in ('received', 'cleared')
  where pa.invoice_id = p_invoice;
  v_status := app.invoice_display_status(v_inv.status, v_inv.sent_at, v_inv.viewed_at, v_inv.due_date,
    v_inv.total_cents, v_collected, app.production_today());
  -- A paid draft that is later unpaid goes back to draft.
  if v_status is distinct from v_inv.status then
    perform set_config('app.system_update', 'on', true);
    update public.invoices set status = v_status where id = p_invoice;
    perform set_config('app.system_update', 'off', true);
  end if;
  -- Deposit paid: stamp the milestone the first time (the onboarding check
  -- clears the deposit item and releases the Deposit Hold).
  if v_inv.invoice_type = 'deposit' and v_status = 'paid' then
    perform set_config('app.system_update', 'on', true);
    update public.jobs set deposit_paid_at = now() where id = v_inv.job_id and deposit_paid_at is null;
    perform set_config('app.system_update', 'off', true);
  end if;
  return v_status;
end;
$$;

-- =============================================================================
-- 4. Guards
-- =============================================================================

-- Invoices in a closed month: amounts, dates and voiding need an owner override.
create or replace function app.invoices_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.lock_override_on() then
    return new;
  end if;
  if (app.money_locked(old.org_id, old.issue_date) or app.money_locked(new.org_id, new.issue_date))
     and (new.total_cents is distinct from old.total_cents
          or new.issue_date is distinct from old.issue_date
          or new.due_date is distinct from old.due_date
          or (new.status = 'void' and old.status <> 'void')) then
    raise exception 'This invoice is in a closed month. An owner can change it with an override.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app.payments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_trusted() then
    raise exception 'Payments are recorded through Job → Financial.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    new.payment_number := app.next_number(new.org_id, 'payment', now());
    if new.account_id is null then
      select j.account_id into new.account_id from public.jobs j where j.id = new.job_id;
    end if;
    if app.money_locked(new.org_id, new.received_on) and not app.lock_override_on() then
      raise exception 'That date is in a closed month. An owner can record it with an override.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.job_id <> old.job_id then
    raise exception 'A payment cannot move to another job.' using errcode = '42501';
  end if;
  new.payment_number := old.payment_number;
  if new.amount_cents <> old.amount_cents then
    raise exception 'A payment''s amount never changes. Void it and record it again.' using errcode = '42501';
  end if;
  if old.status in ('bounced', 'void', 'refunded') and new.status is distinct from old.status then
    raise exception 'This payment is already %.', old.status using errcode = '23514';
  end if;
  if (app.money_locked(old.org_id, old.received_on) or app.money_locked(new.org_id, new.received_on))
     and not app.lock_override_on()
     and (new.status is distinct from old.status or new.received_on is distinct from old.received_on
          or new.method is distinct from old.method) then
    raise exception 'This payment is in a closed month. An owner can change it with an override.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Applications: same job, live payment and invoice, never more than either has.
create or replace function app.payment_applications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_inv public.invoices%rowtype;
  v_refunded bigint;
  v_applied bigint;
  v_on_invoice bigint;
begin
  if not app.is_trusted() then
    raise exception 'Payments are applied through Job → Financial.' using errcode = '42501';
  end if;
  select * into v_pay from public.payments where id = coalesce(new.payment_id, old.payment_id);
  if tg_op = 'DELETE' then
    if v_pay.id is not null and app.money_locked(v_pay.org_id, v_pay.received_on) and not app.lock_override_on() then
      raise exception 'This payment is in a closed month. An owner can change it with an override.' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.payment_id <> old.payment_id or new.invoice_id <> old.invoice_id) then
    raise exception 'An application cannot move. Remove it and apply again.' using errcode = '42501';
  end if;
  select * into v_inv from public.invoices where id = new.invoice_id;
  if v_pay.id is null or v_inv.id is null or v_pay.org_id <> new.org_id or v_inv.org_id <> new.org_id then
    raise exception 'The payment and invoice must belong to this organization.' using errcode = '42501';
  end if;
  if v_pay.job_id <> v_inv.job_id then
    raise exception 'A payment is applied to invoices on its own job.' using errcode = '23514';
  end if;
  if v_pay.status not in ('received', 'cleared') then
    raise exception '% is %, so it can''t be applied.', v_pay.payment_number, v_pay.status using errcode = '23514';
  end if;
  if v_inv.status = 'void' then
    raise exception '% is void.', v_inv.invoice_number using errcode = '23514';
  end if;
  if v_inv.total_cents <= 0 then
    raise exception '% is a credit, so payments can''t be applied to it.', v_inv.invoice_number using errcode = '23514';
  end if;
  if app.money_locked(v_pay.org_id, v_pay.received_on) and not app.lock_override_on() then
    raise exception 'This payment is in a closed month. An owner can change it with an override.' using errcode = '42501';
  end if;
  select coalesce(sum(r.amount_cents), 0) into v_refunded from public.refunds r where r.payment_id = v_pay.id;
  select coalesce(sum(a.amount_cents), 0) into v_applied from public.payment_applications a
  where a.payment_id = v_pay.id and a.id <> new.id;
  if v_applied + new.amount_cents > v_pay.amount_cents - v_refunded then
    raise exception '% only has % left to apply.', v_pay.payment_number,
      app.money_text(greatest(0, v_pay.amount_cents - v_refunded - v_applied)) using errcode = '23514';
  end if;
  select coalesce(sum(a.amount_cents), 0) into v_on_invoice
  from public.payment_applications a join public.payments p on p.id = a.payment_id
  where a.invoice_id = v_inv.id and a.id <> new.id and p.status in ('received', 'cleared');
  if v_on_invoice + new.amount_cents > v_inv.total_cents then
    raise exception '% only has % left to pay.', v_inv.invoice_number,
      app.money_text(greatest(0, v_inv.total_cents - v_on_invoice)) using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.payment_applications_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.refresh_invoice_status(old.invoice_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.refresh_invoice_status(new.invoice_id);
  end if;
  return null;
end;
$$;

-- A payment's status change (cleared, bounced, void, refunded) re-reads its invoices.
create or replace function app.payments_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv uuid;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    for v_inv in select a.invoice_id from public.payment_applications a where a.payment_id = new.id loop
      perform app.refresh_invoice_status(v_inv);
    end loop;
  end if;
  return null;
end;
$$;

create or replace function app.refunds_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_refunded bigint;
  v_applied bigint;
begin
  if not app.is_trusted() then
    raise exception 'Refunds are recorded through Job → Financial.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'A refund cannot be changed.' using errcode = '42501';
  end if;
  select * into v_pay from public.payments where id = new.payment_id;
  if v_pay.id is null or v_pay.org_id <> new.org_id then
    raise exception 'The payment must belong to this organization.' using errcode = '42501';
  end if;
  new.job_id := v_pay.job_id;
  if v_pay.status not in ('received', 'cleared') then
    raise exception '% is %; there''s nothing to refund.', v_pay.payment_number, v_pay.status using errcode = '23514';
  end if;
  if (app.money_locked(v_pay.org_id, v_pay.received_on) or app.money_locked(v_pay.org_id, new.refunded_on))
     and not app.lock_override_on() then
    raise exception 'This payment is in a closed month. An owner can refund it with an override.' using errcode = '42501';
  end if;
  select coalesce(sum(r.amount_cents), 0) into v_refunded from public.refunds r where r.payment_id = v_pay.id;
  if v_refunded + new.amount_cents > v_pay.amount_cents then
    raise exception 'A refund can''t be more than what''s left of the payment (%).',
      app.money_text(v_pay.amount_cents - v_refunded) using errcode = '23514';
  end if;
  select coalesce(sum(a.amount_cents), 0) into v_applied from public.payment_applications a where a.payment_id = v_pay.id;
  if v_applied > v_pay.amount_cents - v_refunded - new.amount_cents then
    raise exception 'Take the refund off the invoices first (the payment is applied).' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Credits: created by trusted code; people (through the RPCs) only decide.
create or replace function app.credits_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.is_trusted() or app.money_write_on()) then
    raise exception 'Credits change through Job → Financial.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    perform app.check_same_org(new.org_id, 'invoices', new.invoice_id, 'Invoice');
    return new;
  end if;
  if new.org_id <> old.org_id or new.job_id <> old.job_id or new.credit_type <> old.credit_type then
    raise exception 'A credit cannot move.' using errcode = '42501';
  end if;
  if new.amount_cents <> old.amount_cents and old.status <> 'pending_approval' then
    raise exception 'A decided credit''s amount never changes.' using errcode = '42501';
  end if;
  if old.status in ('rejected', 'voided') and new.status is distinct from old.status then
    raise exception 'This credit was %.', old.status using errcode = '23514';
  end if;
  perform app.check_same_org(new.org_id, 'invoices', new.invoice_id, 'Invoice');
  if new.status = 'applied' and old.status <> 'applied' then
    new.applied_at := now();
  elsif new.status <> 'applied' then
    new.applied_at := null;
  end if;
  return new;
end;
$$;

-- Credits on an invoice mirror to the On-Time Guarantee record (Phase 6).
create or replace function app.credits_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.on_time_credit_id is not null and (tg_op = 'INSERT' or new.status is distinct from old.status
                                            or new.invoice_id is distinct from old.invoice_id) then
    perform set_config('app.system_update', 'on', true);
    update public.on_time_credits set
      status = case when new.status = 'applied' then 'applied' else 'approved' end,
      invoice_id = new.invoice_id
    where id = new.on_time_credit_id and status in ('approved', 'applied');
    if new.status <> 'applied' then
      update public.jobs set on_time_guarantee_status = 'missed_credit_pending'
      where id = new.job_id and on_time_guarantee_status = 'credit_applied';
    end if;
    perform set_config('app.system_update', 'off', true);
  end if;
  return null;
end;
$$;

-- An owner approving an On-Time Guarantee credit (Job → Schedule) puts it in the ledger.
create or replace function app.on_time_credits_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status = 'pending_approval' then
    perform set_config('app.money_write', 'on', true);
    insert into public.credits (org_id, job_id, credit_type, amount_cents, reason, status,
                                requested_at, decided_by, decided_at, decision_note, on_time_credit_id)
    values (new.org_id, new.job_id, 'on_time_guarantee', new.amount_cents, new.reason, 'approved',
            new.drafted_at, new.decided_by, coalesce(new.decided_at, now()), new.decision_note, new.id)
    on conflict (on_time_credit_id) do nothing;
    perform app.place_job_credits(new.job_id);
    perform set_config('app.money_write', 'off', true);
  end if;
  return null;
end;
$$;

create or replace function app.month_closes_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_trusted() then
    raise exception 'Months are closed and reopened in Admin → Finance.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.month <> old.month) then
    raise exception 'A month close cannot move.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Expenses: same company and job; the receipt file lives under the company's folder.
create or replace function app.job_expenses_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    if new.receipt_path is not null and new.receipt_path not like new.org_id::text || '/%' then
      raise exception 'That receipt isn''t in this company''s storage.' using errcode = '42501';
    end if;
    new.deleted_at := null;
    new.deleted_by := null;
    return new;
  end if;
  if new.org_id <> old.org_id or new.job_id <> old.job_id
     or new.receipt_path is distinct from old.receipt_path then
    raise exception 'An expense''s job and receipt cannot change.' using errcode = '42501';
  end if;
  if old.deleted_at is not null and not app.is_trusted() then
    raise exception 'This expense was removed.' using errcode = '42501';
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := coalesce(app.effective_user_id(), app.actor_id(), new.deleted_by);
    if length(btrim(coalesce(new.delete_reason, ''))) < 3 then
      raise exception 'Say why you''re removing the expense.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 5. Money actions (service role only; trusted server code checks the person
--    first, then each function re-checks the actor's permission)
-- =============================================================================

-- Validates and writes an invoice's lines from jsonb [{description, quantity?, unit_price_cents,
-- source_type?, source_id?}]. Tax is included in prices (Phase 4 decision), so lines are untaxed.
create or replace function app.write_invoice_lines(p_invoice uuid, p_org uuid, p_lines jsonb, p_start integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_n integer := p_start;
begin
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Invoice lines must be a list.' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_n := v_n + 1;
    insert into public.invoice_lines (org_id, invoice_id, description, quantity, unit_price_cents, taxable,
                                      tax_cents, sort_order, source_type, source_id)
    values (p_org, p_invoice, btrim(v_line ->> 'description'),
            coalesce((v_line ->> 'quantity')::numeric, 1), (v_line ->> 'unit_price_cents')::bigint, false, 0,
            v_n, coalesce(v_line ->> 'source_type', 'manual'), nullif(v_line ->> 'source_id', '')::uuid);
  end loop;
  return v_n;
end;
$$;

create or replace function app.check_invoice_total(p_invoice uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_collected bigint;
begin
  select * into v_inv from public.invoices where id = p_invoice;
  if v_inv.invoice_type = 'credit_memo' and v_inv.total_cents >= 0 then
    raise exception 'A credit memo takes money off, so its total is below $0.' using errcode = '23514';
  end if;
  if v_inv.invoice_type <> 'credit_memo' and v_inv.total_cents < 0 then
    raise exception 'An invoice total can''t be below $0. Use a credit memo to take money off.' using errcode = '23514';
  end if;
  select coalesce(sum(pa.amount_cents), 0) into v_collected
  from public.payment_applications pa join public.payments p on p.id = pa.payment_id
  where pa.invoice_id = p_invoice and p.status in ('received', 'cleared');
  if v_collected > v_inv.total_cents then
    raise exception '% has % paid on it, so its total can''t be less than that.',
      v_inv.invoice_number, app.money_text(v_collected) using errcode = '23514';
  end if;
end;
$$;

create or replace function public.create_invoice(
  p_job uuid,
  p_type text,
  p_lines jsonb,
  p_due_date date default null,
  p_terms text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_id uuid;
  v_number text;
begin
  perform app.require_actor_perm('invoices:edit', 'You don''t have permission to create invoices.');
  select * into v_job from public.jobs where id = p_job and deleted_at is null;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_job.org_id);
  if v_job.stage = 'closed_lost' then
    raise exception 'This job is closed as lost.' using errcode = '23514';
  end if;
  if p_type not in ('deposit', 'progress', 'final', 'change_order', 'credit_memo') then
    raise exception 'Unknown invoice type.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one line.' using errcode = '23514';
  end if;
  begin
    insert into public.invoices (org_id, job_id, invoice_type, status, due_date, terms, notes)
    values (v_job.org_id, p_job, p_type, 'draft', p_due_date, nullif(btrim(p_terms), ''), nullif(btrim(p_notes), ''))
    returning id, invoice_number into v_id, v_number;
  exception when unique_violation then
    raise exception 'This job already has a % invoice.', case p_type when 'deposit' then 'deposit' else 'final' end
      using errcode = '23505';
  end;
  perform app.write_invoice_lines(v_id, v_job.org_id, p_lines, 0);
  perform app.check_invoice_total(v_id);
  perform app.log_activity(v_job.org_id, 'job', p_job::text, 'invoice_created',
    'Invoice ' || v_number || ' drafted (' || replace(p_type, '_', ' ') || ')',
    jsonb_build_object('invoice_id', v_id));
  return v_id;
end;
$$;

create or replace function public.update_invoice_draft(
  p_invoice uuid,
  p_lines jsonb,
  p_due_date date default null,
  p_terms text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_last integer;
begin
  perform app.require_actor_perm('invoices:edit', 'You don''t have permission to edit invoices.');
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_inv.org_id);
  if v_inv.status = 'void' or v_inv.sent_at is not null then
    raise exception 'Only a draft invoice can be edited. Void it or issue a credit memo instead.' using errcode = '23514';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one line.' using errcode = '23514';
  end if;
  -- Credit lines stay (they're tied to their credits); the rest is replaced.
  delete from public.invoice_lines where invoice_id = p_invoice and source_type is distinct from 'credit';
  select coalesce(max(sort_order), 0) into v_last from public.invoice_lines where invoice_id = p_invoice;
  perform app.write_invoice_lines(p_invoice, v_inv.org_id, p_lines, v_last);
  update public.invoices set due_date = p_due_date, terms = nullif(btrim(p_terms), ''),
    notes = nullif(btrim(p_notes), '') where id = p_invoice;
  perform app.check_invoice_total(p_invoice);
  perform app.refresh_invoice_status(p_invoice);
end;
$$;

-- Marks an invoice sent (the server sends the simulated text/email and stores the PDF).
create or replace function public.mark_invoice_sent(
  p_invoice uuid,
  p_issue_date date,
  p_due_date date,
  p_document uuid default null,
  p_override_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_override boolean;
begin
  perform app.require_actor_perm('invoices:edit', 'You don''t have permission to send invoices.');
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_inv.org_id);
  if v_inv.status = 'void' then
    raise exception 'A void invoice can''t be sent.' using errcode = '23514';
  end if;
  if p_due_date is not null and p_issue_date is not null and p_due_date < p_issue_date then
    raise exception 'The due date can''t be before the issue date.' using errcode = '23514';
  end if;
  v_override := app.check_money_lock(v_inv.org_id, array[coalesce(p_issue_date, app.production_today()), v_inv.issue_date],
    p_override_reason, 'Invoice ' || v_inv.invoice_number);
  perform app.check_same_org(v_inv.org_id, 'documents', p_document, 'Document');
  perform set_config('app.system_update', 'on', true);
  update public.invoices set
    sent_at = coalesce(sent_at, now()),
    issue_date = coalesce(p_issue_date, issue_date, app.production_today()),
    due_date = coalesce(p_due_date, due_date, coalesce(p_issue_date, issue_date, app.production_today())),
    status = case when status = 'draft' then 'sent' else status end,
    pdf_document_id = coalesce(p_document, pdf_document_id),
    accounting_sync_status = 'not_connected'
  where id = p_invoice;
  perform set_config('app.system_update', 'off', true);
  perform app.refresh_invoice_status(p_invoice);
  perform app.log_activity(v_inv.org_id, 'job', v_inv.job_id::text, 'invoice_sent',
    'Invoice ' || v_inv.invoice_number || ' sent (' || app.money_text(v_inv.total_cents) || ')'
      || case when v_override then ' with an owner override: ' || btrim(p_override_reason) else '' end,
    jsonb_build_object('invoice_id', p_invoice));
  perform app.emit_event(v_inv.org_id, 'invoice.sent', 'invoice', p_invoice::text,
    jsonb_build_object('job_id', v_inv.job_id, 'type', v_inv.invoice_type, 'total_cents', v_inv.total_cents));
end;
$$;

create or replace function public.void_invoice(p_invoice uuid, p_reason text, p_override_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_override boolean;
begin
  perform app.require_actor_perm('invoices:edit', 'You don''t have permission to void invoices.');
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_inv.org_id);
  if v_inv.status = 'void' then
    raise exception 'It''s already void.' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why you''re voiding it.' using errcode = '23514';
  end if;
  if exists (select 1 from public.payment_applications a join public.payments p on p.id = a.payment_id
             where a.invoice_id = p_invoice and p.status in ('received', 'cleared')) then
    raise exception 'Payments are applied to %. Move or remove them first.', v_inv.invoice_number using errcode = '23514';
  end if;
  v_override := app.check_money_lock(v_inv.org_id, array[v_inv.issue_date], p_override_reason,
    'Invoice ' || v_inv.invoice_number);
  perform set_config('app.system_update', 'on', true);
  update public.invoices set status = 'void', voided_at = now(), void_reason = btrim(p_reason) where id = p_invoice;
  perform set_config('app.system_update', 'off', true);
  -- Credits billed on it wait for an invoice again.
  update public.credits set status = 'approved', invoice_id = null where invoice_id = p_invoice and status = 'applied';
  perform app.log_activity(v_inv.org_id, 'job', v_inv.job_id::text, 'invoice_voided',
    'Invoice ' || v_inv.invoice_number || ' voided: ' || btrim(p_reason)
      || case when v_override then ' (owner override: ' || btrim(p_override_reason) || ')' else '' end,
    jsonb_build_object('invoice_id', p_invoice));
end;
$$;

-- Writes one payment's applications ([{invoice_id, amount_cents}], the full set).
create or replace function app.write_applications(p_payment uuid, p_org uuid, p_applications jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a jsonb;
  v_total bigint := 0;
  v_amount bigint;
begin
  if jsonb_typeof(coalesce(p_applications, '[]'::jsonb)) <> 'array' then
    raise exception 'Applications must be a list.' using errcode = '22023';
  end if;
  delete from public.payment_applications where payment_id = p_payment;
  for v_a in select * from jsonb_array_elements(coalesce(p_applications, '[]'::jsonb)) loop
    v_amount := (v_a ->> 'amount_cents')::bigint;
    if v_amount is null or v_amount < 0 then
      raise exception 'Enter an amount of $0 or more.' using errcode = '23514';
    end if;
    if v_amount > 0 then
      insert into public.payment_applications (org_id, payment_id, invoice_id, amount_cents)
      values (p_org, p_payment, (v_a ->> 'invoice_id')::uuid, v_amount);
      v_total := v_total + v_amount;
    end if;
  end loop;
  return v_total;
end;
$$;

create or replace function public.record_payment(
  p_job uuid,
  p_method text,
  p_amount_cents bigint,
  p_received_on date,
  p_applications jsonb,
  p_reference text default null,
  p_notes text default null,
  p_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_id uuid;
  v_number text;
  v_applied bigint;
  v_open bigint;
  v_override boolean;
begin
  perform app.require_actor_perm('payments:record', 'You don''t have permission to record payments.');
  select * into v_job from public.jobs where id = p_job and deleted_at is null;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_job.org_id);
  if p_received_on > app.production_today() then
    raise exception 'The received date can''t be in the future.' using errcode = '23514';
  end if;
  v_override := app.check_money_lock(v_job.org_id, array[p_received_on], p_override_reason, 'That payment date');
  insert into public.payments (org_id, job_id, method, amount_cents, received_on, reference, notes)
  values (v_job.org_id, p_job, p_method, p_amount_cents, p_received_on,
          nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''))
  returning id, payment_number into v_id, v_number;
  v_applied := app.write_applications(v_id, v_job.org_id, p_applications);
  -- Forced application: the whole payment goes onto invoices unless everything owed is covered.
  if v_applied < p_amount_cents then
    select coalesce(sum(balance_cents), 0) into v_open from public.invoice_ledger
    where job_id = p_job and status <> 'void' and total_cents > 0 and balance_cents > 0;
    if v_open > 0 then
      raise exception 'Apply % more. Payments must go onto invoices so the balance is right.',
        app.money_text(least(p_amount_cents - v_applied, v_open)) using errcode = '23514';
    end if;
    if v_applied = 0 then
      raise exception 'Nothing is owed on this job''s invoices. Create the invoice first, then record the payment against it.'
        using errcode = '23514';
    end if;
  end if;
  perform app.log_activity(v_job.org_id, 'job', p_job::text, 'payment_recorded',
    'Payment ' || v_number || ' of ' || app.money_text(p_amount_cents) || ' recorded ('
      || replace(p_method, '_', ' ') || ')'
      || case when v_override then ' with an owner override: ' || btrim(p_override_reason) else '' end,
    jsonb_build_object('payment_id', v_id));
  return v_id;
end;
$$;

create or replace function public.set_payment_applications(
  p_payment uuid,
  p_applications jsonb,
  p_override_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_old uuid[];
  v_inv uuid;
  v_override boolean;
begin
  perform app.require_actor_perm('payments:record', 'You don''t have permission to apply payments.');
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_pay.org_id);
  if v_pay.status not in ('received', 'cleared') then
    raise exception '% is %, so it can''t be applied.', v_pay.payment_number, v_pay.status using errcode = '23514';
  end if;
  v_override := app.check_money_lock(v_pay.org_id, array[v_pay.received_on], p_override_reason,
    'Payment ' || v_pay.payment_number);
  select array_agg(invoice_id) into v_old from public.payment_applications where payment_id = p_payment;
  perform app.write_applications(p_payment, v_pay.org_id, p_applications);
  foreach v_inv in array coalesce(v_old, '{}'::uuid[]) loop
    perform app.refresh_invoice_status(v_inv);
  end loop;
  perform app.log_activity(v_pay.org_id, 'job', v_pay.job_id::text, 'payment_applied',
    'Payment ' || v_pay.payment_number || ' applied to invoices'
      || case when v_override then ' (owner override: ' || btrim(p_override_reason) || ')' else '' end,
    jsonb_build_object('payment_id', p_payment));
end;
$$;

-- clear | bounce | void
create or replace function public.update_payment_status(
  p_payment uuid,
  p_action text,
  p_reason text default null,
  p_on date default null,
  p_override_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_override boolean;
  v_label text;
begin
  perform app.require_actor_perm('payments:record', 'You don''t have permission to change payments.');
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_pay.org_id);
  if v_pay.status in ('bounced', 'void', 'refunded') then
    raise exception 'This payment is already %.', v_pay.status using errcode = '23514';
  end if;
  if p_action = 'clear' and v_pay.status = 'cleared' then
    raise exception 'It''s already marked cleared.' using errcode = '23514';
  end if;
  if p_action not in ('clear', 'bounce', 'void') then
    raise exception 'Unknown payment action.' using errcode = '22023';
  end if;
  if p_action in ('bounce', 'void') and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say what happened (at least 3 characters).' using errcode = '23514';
  end if;
  v_override := app.check_money_lock(v_pay.org_id, array[v_pay.received_on], p_override_reason,
    'Payment ' || v_pay.payment_number);
  update public.payments set
    status = case p_action when 'clear' then 'cleared' when 'bounce' then 'bounced' else 'void' end,
    cleared_on = case when p_action = 'clear' then coalesce(p_on, app.production_today()) else cleared_on end,
    bounced_at = case when p_action = 'bounce' then now() else bounced_at end,
    voided_at = case when p_action = 'void' then now() else voided_at end,
    status_reason = case when p_action = 'clear' then status_reason else btrim(p_reason) end
  where id = p_payment;
  v_label := case p_action when 'clear' then 'marked cleared' when 'bounce' then 'bounced' else 'voided' end;
  perform app.log_activity(v_pay.org_id, 'job', v_pay.job_id::text, 'payment_' || p_action,
    'Payment ' || v_pay.payment_number || ' (' || app.money_text(v_pay.amount_cents) || ') ' || v_label
      || coalesce(': ' || nullif(btrim(p_reason), ''), '')
      || case when v_override then ' (owner override: ' || btrim(p_override_reason) || ')' else '' end,
    jsonb_build_object('payment_id', p_payment));
  if p_action = 'bounce' then
    perform app.emit_event(v_pay.org_id, 'payment.bounced', 'payment', p_payment::text,
      jsonb_build_object('job_id', v_pay.job_id, 'amount_cents', v_pay.amount_cents));
  end if;
end;
$$;

-- Refund: from unapplied money first, then off the payment's applications, newest first
-- (or the chosen invoice first). Fully refunded payments become "refunded".
create or replace function public.refund_payment(
  p_payment uuid,
  p_amount_cents bigint,
  p_refunded_on date,
  p_method text,
  p_reason text,
  p_reference text default null,
  p_invoice uuid default null,
  p_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_refunded bigint;
  v_applied bigint;
  v_available bigint;
  v_from_unapplied bigint;
  v_left bigint;
  v_app record;
  v_take bigint;
  v_reductions jsonb := '[]'::jsonb;
  v_id uuid;
  v_override boolean;
begin
  perform app.require_actor_perm('payments:record', 'You don''t have permission to refund payments.');
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_pay.org_id);
  if v_pay.status not in ('received', 'cleared') then
    raise exception '% is %; there''s nothing to refund.', v_pay.payment_number, v_pay.status using errcode = '23514';
  end if;
  if p_refunded_on > app.production_today() then
    raise exception 'The refund date can''t be in the future.' using errcode = '23514';
  end if;
  select coalesce(sum(amount_cents), 0) into v_refunded from public.refunds where payment_id = p_payment;
  select coalesce(sum(amount_cents), 0) into v_applied from public.payment_applications where payment_id = p_payment;
  v_available := v_pay.amount_cents - v_refunded;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v_available then
    raise exception 'A refund can''t be more than what''s left of the payment (%).', app.money_text(v_available)
      using errcode = '23514';
  end if;
  v_override := app.check_money_lock(v_pay.org_id, array[v_pay.received_on, p_refunded_on], p_override_reason,
    'Payment ' || v_pay.payment_number);
  v_from_unapplied := least(p_amount_cents, greatest(0, v_available - v_applied));
  v_left := p_amount_cents - v_from_unapplied;
  for v_app in
    select a.id, a.invoice_id, a.amount_cents from public.payment_applications a
    where a.payment_id = p_payment
    order by (a.invoice_id = p_invoice) desc nulls last, a.created_at desc, a.id desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_app.amount_cents);
    if v_take = v_app.amount_cents then
      delete from public.payment_applications where id = v_app.id;
    else
      update public.payment_applications set amount_cents = amount_cents - v_take where id = v_app.id;
    end if;
    v_reductions := v_reductions || jsonb_build_object('invoice_id', v_app.invoice_id,
      'before', v_app.amount_cents, 'after', v_app.amount_cents - v_take);
    v_left := v_left - v_take;
  end loop;
  insert into public.refunds (org_id, payment_id, job_id, amount_cents, refunded_on, method, reference, reason, detail)
  values (v_pay.org_id, p_payment, v_pay.job_id, p_amount_cents, p_refunded_on, p_method,
          nullif(btrim(p_reference), ''), btrim(p_reason),
          jsonb_build_object('from_unapplied', v_from_unapplied, 'reductions', v_reductions))
  returning id into v_id;
  if p_amount_cents = v_available then
    update public.payments set status = 'refunded' where id = p_payment;
  end if;
  perform app.log_activity(v_pay.org_id, 'job', v_pay.job_id::text, 'payment_refunded',
    'Refunded ' || app.money_text(p_amount_cents) || ' of payment ' || v_pay.payment_number || ': ' || btrim(p_reason)
      || case when v_override then ' (owner override: ' || btrim(p_override_reason) || ')' else '' end,
    jsonb_build_object('payment_id', p_payment, 'refund_id', v_id));
  return v_id;
end;
$$;

-- Approved credits not yet billed go onto the draft final invoice (when it can
-- take them without dropping below what's paid on it), otherwise onto a draft
-- credit memo once the final invoice is sent. Before the final invoice exists
-- they wait (the final invoice picks them up when it's drafted).
create or replace function app.place_job_credits(p_job uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_final public.invoices%rowtype;
  v_total bigint;
  v_paid bigint;
  v_target uuid;
  v_c record;
  v_n integer := 0;
  v_sort integer;
begin
  select * into v_job from public.jobs where id = p_job;
  perform set_config('app.money_write', 'on', true);
  select coalesce(sum(amount_cents), 0) into v_total from public.credits
  where job_id = p_job and status = 'approved' and invoice_id is null;
  if v_total = 0 then return 0; end if;
  select * into v_final from public.invoices
  where job_id = p_job and invoice_type = 'final' and status <> 'void' for update;
  if v_final.id is null then
    return 0;
  end if;
  select coalesce(sum(pa.amount_cents), 0) into v_paid
  from public.payment_applications pa join public.payments p on p.id = pa.payment_id
  where pa.invoice_id = v_final.id and p.status in ('received', 'cleared');
  if v_final.sent_at is null and v_final.total_cents - v_total >= v_paid then
    v_target := v_final.id;
  else
    insert into public.invoices (org_id, job_id, invoice_type, status, notes)
    values (v_job.org_id, p_job, 'credit_memo', 'draft', 'Credits approved after the final invoice.')
    returning id into v_target;
  end if;
  select coalesce(max(sort_order), 0) into v_sort from public.invoice_lines where invoice_id = v_target;
  for v_c in select * from public.credits where job_id = p_job and status = 'approved' and invoice_id is null
             order by decided_at, created_at loop
    v_sort := v_sort + 1;
    insert into public.invoice_lines (org_id, invoice_id, description, quantity, unit_price_cents, taxable,
                                      tax_cents, sort_order, source_type, source_id)
    values (v_job.org_id, v_target,
            case v_c.credit_type when 'on_time_guarantee' then 'On-Time Guarantee credit'
                                 when 'goodwill' then 'Goodwill credit' when 'discount' then 'Discount credit'
                                 else 'Referral credit' end,
            1, -v_c.amount_cents, false, 0, v_sort, 'credit', v_c.id);
    update public.credits set status = 'applied', invoice_id = v_target where id = v_c.id;
    v_n := v_n + 1;
  end loop;
  perform app.refresh_invoice_status(v_target);
  perform app.log_activity(v_job.org_id, 'job', p_job::text, 'credits_applied',
    app.money_text(v_total) || ' of credit put on ' || (select invoice_number from public.invoices where id = v_target),
    jsonb_build_object('invoice_id', v_target));
  perform set_config('app.money_write', 'off', true);
  return v_n;
end;
$$;

create or replace function public.place_job_credits(p_job uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_actor_perm('invoices:edit', 'You don''t have permission to edit invoices.');
  perform app.require_actor_org((select org_id from public.jobs where id = p_job));
  return app.place_job_credits(p_job);
end;
$$;

create or replace function public.create_credit(
  p_job uuid,
  p_type text,
  p_amount_cents bigint,
  p_reason text,
  p_approve boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_actor uuid := app.actor_id();
  v_id uuid;
begin
  if v_actor is not null and app.user_perm_scope(v_actor, 'invoices:edit') is null
     and app.user_perm_scope(v_actor, 'credits:approve') is null then
    raise exception 'You don''t have permission to add credits.' using errcode = '42501';
  end if;
  if coalesce(p_approve, false) then
    perform app.require_actor_perm('credits:approve', 'Only people who approve credits can approve one.');
  end if;
  if p_type = 'on_time_guarantee' then
    raise exception 'On-Time Guarantee credits are drafted by the schedule and approved on Job → Schedule.'
      using errcode = '23514';
  end if;
  select * into v_job from public.jobs where id = p_job and deleted_at is null;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_job.org_id);
  insert into public.credits (org_id, job_id, credit_type, amount_cents, reason, status, requested_by,
                              decided_by, decided_at)
  values (v_job.org_id, p_job, p_type, p_amount_cents, btrim(p_reason),
          case when p_approve then 'approved' else 'pending_approval' end, v_actor,
          case when p_approve then v_actor end, case when p_approve then now() end)
  returning id into v_id;
  perform app.log_activity(v_job.org_id, 'job', p_job::text, 'credit_created',
    initcap(replace(p_type, '_', ' ')) || ' credit of ' || app.money_text(p_amount_cents)
      || case when p_approve then ' approved: ' else ' waiting for approval: ' end || btrim(p_reason),
    jsonb_build_object('credit_id', v_id));
  if p_approve then
    perform app.place_job_credits(p_job);
  end if;
  return v_id;
end;
$$;

-- approve | reject | void
create or replace function public.decide_credit(p_credit uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.credits%rowtype;
  v_actor uuid := app.actor_id();
begin
  perform app.require_actor_perm('credits:approve', 'Only people who approve credits can decide them.');
  select * into v_c from public.credits where id = p_credit for update;
  if not found then
    raise exception 'Credit not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_c.org_id);
  if p_decision in ('approve', 'reject') and v_c.status <> 'pending_approval' then
    raise exception 'That credit was already decided.' using errcode = '23514';
  end if;
  if p_decision = 'void' and v_c.status not in ('pending_approval', 'approved') then
    raise exception 'A credit on an invoice is removed by voiding that invoice.' using errcode = '23514';
  end if;
  if p_decision in ('reject', 'void') and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why (at least 3 characters).' using errcode = '23514';
  end if;
  if p_decision not in ('approve', 'reject', 'void') then
    raise exception 'Unknown decision.' using errcode = '22023';
  end if;
  update public.credits set
    status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'voided' end,
    decided_by = v_actor, decided_at = now(), decision_note = nullif(btrim(p_note), '')
  where id = p_credit;
  perform app.log_activity(v_c.org_id, 'job', v_c.job_id::text, 'credit_' || p_decision,
    initcap(replace(v_c.credit_type, '_', ' ')) || ' credit of ' || app.money_text(v_c.amount_cents) || ' '
      || case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'voided' end
      || coalesce(': ' || nullif(btrim(p_note), ''), ''),
    jsonb_build_object('credit_id', p_credit));
  if p_decision = 'approve' then
    perform app.place_job_credits(v_c.job_id);
  end if;
end;
$$;

-- The final invoice (SPEC §10, §11.2 #13): drafted at Completed for what's left
-- to bill, with approved credits as negative lines. Idempotent.
create or replace function public.draft_final_invoice(p_job uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_existing uuid;
  v_ledger public.job_ledger;
  v_waiting bigint;
  v_id uuid;
  v_number text;
begin
  perform app.require_actor_perm('invoices:edit', 'You don''t have permission to create invoices.');
  select * into v_job from public.jobs where id = p_job and deleted_at is null for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  perform app.require_actor_org(v_job.org_id);
  select id into v_existing from public.invoices
  where job_id = p_job and invoice_type = 'final' and status <> 'void';
  if v_existing is not null then
    perform app.place_job_credits(p_job);
    return v_existing;
  end if;
  v_ledger := app.job_money(p_job);
  select coalesce(sum(amount_cents), 0) into v_waiting from public.credits
  where job_id = p_job and status = 'approved' and invoice_id is null;
  if coalesce(v_ledger.left_to_bill_cents, 0) < 0 then
    raise exception 'Invoices already add up to more than the contract. Void the extra invoice or issue a credit memo.'
      using errcode = '23514';
  end if;
  insert into public.invoices (org_id, job_id, invoice_type, status)
  values (v_job.org_id, p_job, 'final', 'draft')
  returning id, invoice_number into v_id, v_number;
  insert into public.invoice_lines (org_id, invoice_id, description, quantity, unit_price_cents, taxable,
                                    tax_cents, sort_order, source_type)
  values (v_job.org_id, v_id, 'Balance of contract', 1,
          coalesce(v_ledger.left_to_bill_cents, 0) + v_waiting, false, 0, 1, 'estimate');
  perform app.place_job_credits(p_job);
  perform app.log_activity(v_job.org_id, 'job', p_job::text, 'invoice_created',
    'Final invoice ' || v_number || ' drafted', jsonb_build_object('invoice_id', v_id));
  return v_id;
end;
$$;

create or replace function public.close_month(p_month date, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.actor_id();
  v_org uuid;
  v_month date := date_trunc('month', p_month)::date;
  v_id uuid;
  v_summary jsonb;
begin
  perform app.require_actor_perm('finance:close_month', 'You don''t have permission to close a month.');
  select org_id into v_org from public.profiles where id = v_actor;
  if v_org is null then
    raise exception 'Closing a month needs a signed-in person.' using errcode = '42501';
  end if;
  if v_month >= date_trunc('month', app.production_today())::date then
    raise exception 'Only a month that has ended can be closed.' using errcode = '23514';
  end if;
  select jsonb_build_object(
    'billed_cents', coalesce((select sum(total_cents) from public.invoices where org_id = v_org and status <> 'void'
        and sent_at is not null and date_trunc('month', issue_date) = v_month), 0),
    'collected_cents', coalesce((select sum(a.amount_cents) from public.payment_applications a
        join public.payments p on p.id = a.payment_id
        where p.org_id = v_org and p.status in ('received', 'cleared') and date_trunc('month', p.received_on) = v_month), 0),
    'payments', (select count(*) from public.payments where org_id = v_org and date_trunc('month', received_on) = v_month),
    'invoices', (select count(*) from public.invoices where org_id = v_org and date_trunc('month', issue_date) = v_month))
  into v_summary;
  insert into public.month_closes (org_id, month, status, closed_by, closed_at, note, summary)
  values (v_org, v_month, 'closed', v_actor, now(), nullif(btrim(p_note), ''), v_summary)
  on conflict (org_id, month) do update set status = 'closed', closed_by = excluded.closed_by,
    closed_at = now(), note = excluded.note, summary = excluded.summary,
    reopened_by = null, reopened_at = null, reopen_reason = null
  where public.month_closes.status = 'reopened'
  returning id into v_id;
  if v_id is null then
    raise exception '% is already closed.', to_char(v_month, 'FMMonth YYYY') using errcode = '23505';
  end if;
  perform app.emit_event(v_org, 'month.closed', 'month_close', v_id::text, jsonb_build_object('month', v_month));
  return v_id;
end;
$$;

create or replace function public.reopen_month(p_month date, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.actor_id();
  v_org uuid;
begin
  perform app.require_actor_perm('finance:override_lock', 'Only an owner can reopen a closed month.');
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Say why you''re reopening it (at least 10 characters).' using errcode = '23514';
  end if;
  select org_id into v_org from public.profiles where id = v_actor;
  update public.month_closes set status = 'reopened', reopened_by = v_actor, reopened_at = now(),
    reopen_reason = btrim(p_reason)
  where org_id = v_org and month = date_trunc('month', p_month)::date and status = 'closed';
  if not found then
    raise exception 'That month isn''t closed.' using errcode = 'P0002';
  end if;
end;
$$;

-- Worker: keep invoice statuses current (overdue) and raise one invoice.overdue
-- event per invoice at 7 and 30 days past due (SPEC §9, §11.2 #14).
create or replace function public.sweep_invoices(p_limit integer default 2000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_changed integer := 0;
  v_events integer := 0;
  v_status text;
  v_threshold integer;
begin
  for v_row in
    select il.* from public.invoice_ledger il
    where il.status not in ('void', 'paid') or il.display_status <> il.status
    order by il.due_date nulls last
    limit greatest(1, least(coalesce(p_limit, 2000), 10000))
  loop
    v_status := app.refresh_invoice_status(v_row.id);
    if v_status is distinct from v_row.status then v_changed := v_changed + 1; end if;
    foreach v_threshold in array array[7, 30] loop
      if v_row.days_past_due >= v_threshold then
        if app.emit_event(v_row.org_id, 'invoice.overdue', 'invoice', v_row.id::text,
             jsonb_build_object('job_id', v_row.job_id, 'days', v_threshold, 'balance_cents', v_row.balance_cents,
                                'invoice_number', v_row.invoice_number),
             'invoice.overdue:' || v_row.id || ':' || v_threshold) is not null then
          v_events := v_events + 1;
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('changed', v_changed, 'events', v_events);
end;
$$;

-- =============================================================================
-- 6. Stage gates 10–12 are real (must agree with lib/domain/jobs/gates.ts)
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
    -- The final invoice is sent.
    when 'completed' then exists (
      select 1 from public.invoices i
      where i.job_id = p_job and i.invoice_type = 'final' and i.status <> 'void' and i.sent_at is not null)
    -- Paid in full: something was billed, nothing is left to bill, the balance is $0.
    when 'invoiced' then coalesce((
      select l.billed_cents > 0 and l.left_to_bill_cents = 0 and l.balance_cents = 0
      from public.job_ledger l where l.job_id = p_job), false)
    -- Closes 3 days after Paid in Full while the balance is still $0 (a bounce stops it).
    when 'paid_in_full' then coalesce((select l.balance_cents = 0 from public.job_ledger l where l.job_id = p_job), true)
    else false
  end;
$$;
revoke execute on function app.job_gate_passes(uuid, text) from public, anon, authenticated;
grant execute on function app.job_gate_passes(uuid, text) to service_role;

-- =============================================================================
-- 7. Finance numbers (metrics registry source; caller's row security)
-- =============================================================================

create or replace function public.finance_stats(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with flags as (
    select app.has_perm('financials:read') as money, app.has_perm('job_costing:read') as can_cost
  ),
  inv as (select * from public.invoice_ledger where org_id = app.current_org_id()),
  open_inv as (select * from inv where issued and balance_cents <> 0),
  jl as (select l.*, j.estimate_accepted_at, j.completed_at, j.paid_in_full_at
         from public.job_ledger l join public.jobs j on j.id = l.job_id
         where l.org_id = app.current_org_id()),
  paid as (
    select coalesce(sum(a.amount_cents), 0) as cents
    from public.payment_applications a join public.payments p on p.id = a.payment_id
    where p.org_id = app.current_org_id() and p.status in ('received', 'cleared')
      and p.received_on between p_from and p_to
  ),
  done as (
    select jl.job_id, jl.contract_cents from jl
    where jl.completed_at is not null
      and (jl.completed_at at time zone 'America/Los_Angeles')::date between p_from and p_to
  ),
  costs as (
    select d.job_id, d.contract_cents,
      coalesce((select sum(round(t.hours * coalesce(c.hourly_cost_cents, 0)))
                from public.time_entries t left join public.profile_compensation c on c.profile_id = t.user_id
                where t.job_id = d.job_id and t.deleted_at is null), 0)
      + coalesce((select sum(o.total_cost_cents) from public.paint_orders o
                  where o.job_id = d.job_id and o.deleted_at is null and o.status <> 'canceled'), 0)
      + coalesce((select sum(wc.sub_po_cents) from public.work_order_costs wc join public.work_orders w on w.id = wc.work_order_id
                  where w.job_id = d.job_id and w.deleted_at is null and w.status <> 'canceled'), 0)
      + coalesce((select sum(e.amount_cents) from public.job_expenses e
                  where e.job_id = d.job_id and e.deleted_at is null), 0) as cost_cents
    from done d where (select can_cost from flags)
  ),
  paid_jobs as (
    select extract(epoch from (jl.paid_in_full_at - jl.completed_at)) / 86400.0 as days from jl
    where jl.paid_in_full_at is not null and jl.completed_at is not null
      and (jl.paid_in_full_at at time zone 'America/Los_Angeles')::date between p_from and p_to
  ),
  billed as (
    select coalesce(sum(total_cents), 0) as billed, coalesce(sum(collected_cents), 0) as collected
    from inv where issued and issue_date between p_from and p_to
  )
  select case when not (select money from flags) then jsonb_build_object('can_see_money', false, 'can_see_costs', false)
  else jsonb_build_object(
    'can_see_money', true,
    'can_see_costs', (select can_cost from flags),
    'ar_outstanding_cents', coalesce((select sum(balance_cents) from open_inv), 0),
    'ar_open_invoices', (select count(*) from open_inv where balance_cents > 0),
    'overdue_cents', coalesce((select sum(balance_cents) from open_inv where days_past_due > 0), 0),
    'overdue_invoices', (select count(*) from open_inv where days_past_due > 0),
    'aging', jsonb_build_object(
      'current', coalesce((select sum(balance_cents) from open_inv where days_past_due = 0), 0),
      'd1_30', coalesce((select sum(balance_cents) from open_inv where days_past_due between 1 and 30), 0),
      'd31_60', coalesce((select sum(balance_cents) from open_inv where days_past_due between 31 and 60), 0),
      'd61_90', coalesce((select sum(balance_cents) from open_inv where days_past_due between 61 and 90), 0),
      'd90_plus', coalesce((select sum(balance_cents) from open_inv where days_past_due > 90), 0)),
    'aging_counts', jsonb_build_object(
      'current', (select count(*) from open_inv where days_past_due = 0),
      'd1_30', (select count(*) from open_inv where days_past_due between 1 and 30),
      'd31_60', (select count(*) from open_inv where days_past_due between 31 and 60),
      'd61_90', (select count(*) from open_inv where days_past_due between 61 and 90),
      'd90_plus', (select count(*) from open_inv where days_past_due > 90)),
    'collected_cents', (select cents from paid),
    'refunded_cents', coalesce((select sum(r.amount_cents) from public.refunds r
                                where r.org_id = app.current_org_id() and r.refunded_on between p_from and p_to), 0),
    'billed_cents', (select billed from billed),
    'billed_collected_cents', (select collected from billed),
    'unapplied_cents', coalesce((select sum(unapplied_cents) from jl), 0),
    'sold_cents', coalesce((select sum(contract_cents) from jl where estimate_accepted_at is not null
        and (estimate_accepted_at at time zone 'America/Los_Angeles')::date between p_from and p_to), 0),
    'sold_jobs', (select count(*) from jl where estimate_accepted_at is not null
        and (estimate_accepted_at at time zone 'America/Los_Angeles')::date between p_from and p_to),
    'completed_cents', coalesce((select sum(contract_cents) from done), 0),
    'completed_jobs', (select count(*) from done),
    'margin_revenue_cents', case when (select can_cost from flags) then coalesce((select sum(contract_cents) from costs), 0) end,
    'margin_cost_cents', case when (select can_cost from flags) then coalesce((select sum(cost_cents) from costs), 0) end,
    'paid_jobs', (select count(*) from paid_jobs),
    'days_completed_to_paid_avg', (select round(avg(days)::numeric, 1) from paid_jobs),
    'pending_credit_cents', coalesce((select sum(pending_credits_cents) from jl), 0),
    'invoices', jsonb_build_object(
      'all', (select count(*) from inv),
      'draft', (select count(*) from inv where display_status = 'draft'),
      'open', (select count(*) from inv where issued and balance_cents > 0),
      'overdue', (select count(*) from inv where display_status = 'overdue'),
      'paid', (select count(*) from inv where display_status = 'paid'),
      'void', (select count(*) from inv where display_status = 'void'))
  ) end;
$$;

-- =============================================================================
-- 8. Universal search: invoices (SPEC §8.1)
-- =============================================================================

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
  ),
  -- Invoices by number, or by the job's name (row security: invoices:read only).
  invoice_hits as (
    select 'invoice'::text, i.id, i.invoice_number || ' · ' || j.name,
           concat_ws(' · ', initcap(replace(i.invoice_type, '_', ' ')), initcap(replace(i.status, '_', ' ')),
                     app.money_text(i.total_cents)),
           '/jobs/' || i.job_id || '?section=financial&tab=invoices&invoice=' || i.id,
           (case when lower(i.invoice_number) like '%' || q.term || '%' then 0.97
                 else extensions.similarity(j.search_text, q.term) * 0.8 end)::real
    from public.invoices i join public.jobs j on j.id = i.job_id, q
    where p_scope in ('all', 'invoices') and length(q.term) >= 2
      and (lower(i.invoice_number) like '%' || q.term || '%'
           or (p_scope = 'invoices' and j.search_text like '%' || q.term || '%'))
    order by 6 desc, i.created_at desc
    limit (select lim from q)
  )
  select * from (
    select * from lead_hits
    union all select * from job_hits
    union all select * from account_hits
    union all select * from contact_hits
    union all select * from property_hits
    union all select * from invoice_hits
  ) r
  order by r.rank desc
  limit (select lim * 2 from q);
$$;

-- =============================================================================
-- 9. Triggers
-- =============================================================================

create trigger invoices_lock_guard before update on public.invoices
  for each row execute function app.invoices_lock_guard();
create trigger payments_guard before insert or update on public.payments
  for each row execute function app.payments_guard();
create trigger payments_after after update on public.payments
  for each row execute function app.payments_after();
create trigger payment_applications_guard before insert or update or delete on public.payment_applications
  for each row execute function app.payment_applications_guard();
create trigger payment_applications_after after insert or update or delete on public.payment_applications
  for each row execute function app.payment_applications_after();
create trigger refunds_guard before insert or update on public.refunds
  for each row execute function app.refunds_guard();
create trigger credits_guard before insert or update on public.credits
  for each row execute function app.credits_guard();
create trigger credits_after after insert or update on public.credits
  for each row execute function app.credits_after();
create trigger on_time_credits_to_ledger after update on public.on_time_credits
  for each row execute function app.on_time_credits_to_ledger();
create trigger month_closes_guard before insert or update on public.month_closes
  for each row execute function app.month_closes_guard();
create trigger job_expenses_guard before insert or update on public.job_expenses
  for each row execute function app.job_expenses_guard();

do $$
declare
  t text;
begin
  foreach t in array array['payments', 'payment_applications', 'refunds', 'credits', 'month_closes', 'job_expenses'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function app.stamp_actor()', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end
$$;

create trigger payments_event after insert or update on public.payments
  for each row execute function app.emit_change_event('payment');
create trigger payment_applications_event after insert or update or delete on public.payment_applications
  for each row execute function app.emit_change_event('payment_application');
create trigger refunds_event after insert on public.refunds
  for each row execute function app.emit_change_event('refund');
create trigger credits_event after insert or update on public.credits
  for each row execute function app.emit_change_event('credit');
create trigger month_closes_event after update on public.month_closes
  for each row execute function app.emit_change_event('month_close');
create trigger job_expenses_event after insert or update on public.job_expenses
  for each row execute function app.emit_change_event('job_expense');

-- =============================================================================
-- 10. Row level security: money only with financials:read; costs with job_costing:read
-- =============================================================================

alter table public.payments enable row level security;
alter table public.payment_applications enable row level security;
alter table public.refunds enable row level security;
alter table public.credits enable row level security;
alter table public.month_closes enable row level security;
alter table public.job_expenses enable row level security;

-- Written only through the RPCs above (service role).
revoke insert, update, delete on public.payments, public.payment_applications, public.refunds,
  public.credits, public.month_closes from authenticated;
revoke delete on public.job_expenses from authenticated;

create policy payments_select on public.payments for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('financials:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy payment_applications_select on public.payment_applications for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('financials:read'))
         and exists (select 1 from public.payments p where p.id = payment_id));
create policy refunds_select on public.refunds for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('financials:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy credits_select on public.credits for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('financials:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy month_closes_select on public.month_closes for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('financials:read')));

create policy job_expenses_select on public.job_expenses for select to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and (select app.has_perm('job_costing:read'))
         and exists (select 1 from public.jobs j where j.id = job_id));
create policy job_expenses_insert on public.job_expenses for insert to authenticated
  with check (org_id = (select app.current_org_id()) and deleted_at is null
              and (select app.can_write('job_costing:read'))
              and exists (select 1 from public.jobs j where j.id = job_id));
create policy job_expenses_update on public.job_expenses for update to authenticated
  using (org_id = (select app.current_org_id()) and deleted_at is null
         and (select app.can_write('job_costing:read')))
  with check (org_id = (select app.current_org_id()));

-- Job costing reads each person's hourly cost (owners and the bookkeeper).
create policy profile_compensation_select_costing on public.profile_compensation for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('job_costing:read')));

-- =============================================================================
-- 11. Receipts bucket (private; files stream through the app after a check)
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('receipts', 'receipts', false, 15728640, array['image/jpeg', 'application/pdf'])
    on conflict (id) do nothing;
  end if;
end
$$;

-- =============================================================================
-- 12. Existing data: approved On-Time Guarantee credits join the ledger
-- =============================================================================

insert into public.credits (org_id, job_id, credit_type, amount_cents, reason, status, requested_at,
                            decided_by, decided_at, decision_note, on_time_credit_id, invoice_id)
select o.org_id, o.job_id, 'on_time_guarantee', o.amount_cents, o.reason,
       case when o.status = 'applied' and o.invoice_id is not null then 'applied' else 'approved' end,
       o.drafted_at, o.decided_by, coalesce(o.decided_at, now()), o.decision_note, o.id,
       case when o.status = 'applied' then o.invoice_id end
from public.on_time_credits o
where o.status in ('approved', 'applied')
on conflict (on_time_credit_id) do nothing;

-- =============================================================================
-- 13. Attention rules (SPEC §9 "Overdue invoice 7 / 30 days → Medium/High")
-- =============================================================================

create or replace function app.seed_money_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attention_rules (org_id, rule_key, thresholds) values
    (p_org, 'overdue_invoice', '{"medium_days": 7, "high_days": 30}'::jsonb)
  on conflict (org_id, rule_key) do nothing;
end;
$$;
revoke execute on function app.seed_money_defaults(uuid) from public, anon, authenticated;
select app.seed_money_defaults(id) from public.organizations;

-- =============================================================================
-- 14. Grants
-- =============================================================================

grant select on public.invoice_ledger, public.payment_ledger, public.job_ledger to authenticated, service_role;

revoke execute on function app.require_actor_perm(text, text), app.require_actor_org(uuid), app.check_money_lock(uuid, date[], text, text),
  app.refresh_invoice_status(uuid), app.write_invoice_lines(uuid, uuid, jsonb, integer),
  app.check_invoice_total(uuid), app.write_applications(uuid, uuid, jsonb), app.place_job_credits(uuid),
  app.job_money(uuid) from public, anon, authenticated;
grant execute on function app.money_locked(uuid, date), app.lock_override_on(), app.money_write_on(),
  app.invoice_display_status(text, timestamptz, timestamptz, date, bigint, bigint, date) to authenticated, service_role;
grant execute on function app.job_money(uuid) to service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_invoice(uuid, text, jsonb, date, text, text)',
    'public.update_invoice_draft(uuid, jsonb, date, text, text)',
    'public.mark_invoice_sent(uuid, date, date, uuid, text)',
    'public.void_invoice(uuid, text, text)',
    'public.record_payment(uuid, text, bigint, date, jsonb, text, text, text)',
    'public.set_payment_applications(uuid, jsonb, text)',
    'public.update_payment_status(uuid, text, text, date, text)',
    'public.refund_payment(uuid, bigint, date, text, text, text, uuid, text)',
    'public.place_job_credits(uuid)',
    'public.create_credit(uuid, text, bigint, text, boolean)',
    'public.decide_credit(uuid, text, text)',
    'public.draft_final_invoice(uuid)',
    'public.close_month(date, text)',
    'public.reopen_month(date, text)',
    'public.sweep_invoices(integer)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;
revoke execute on function public.finance_stats(date, date) from public, anon;
grant execute on function public.finance_stats(date, date) to authenticated, service_role;
