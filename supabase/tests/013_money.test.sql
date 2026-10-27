-- Phase 7: Money — no stored balances, the ledger view against the shared
-- scenario (lib/domain/ledger/fixtures.ts), forced application, reversals,
-- credits on the final invoice (incl. the Phase 6 On-Time Guarantee hand-off),
-- gates 10–12, month close with owner override, permissions per role and
-- cross-company isolation.
begin;

insert into public.organizations (name, slug) values ('Other Painting Co', 'other-co');
select app.seed_org_defaults(tests.org_id('other-co'));

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('office', tests.make_user('office@test.bb', 'office_manager')),
  ('books', tests.make_user('books@test.bb', 'bookkeeper')),
  ('ro', tests.make_user('ro@test.bb', 'read_only')),
  ('est', tests.make_user('est@test.bb', 'estimator')),
  ('lead', tests.make_user('lead@test.bb', 'project_manager')),
  ('painter', tests.make_user('painter@test.bb', 'painter')),
  ('other_owner', tests.make_user('owner@other.test', 'owner', tests.org_id('other-co')));
grant select on u to authenticated, service_role;
create temp table r (k text primary key, id uuid) on commit drop;
grant select, insert on r to authenticated, service_role;
create temp table d (k text primary key, v date) on commit drop;
grant select on d to authenticated, service_role;
insert into d values ('today', app.production_today()), ('m40', app.production_today() - 40),
  ('m26', app.production_today() - 26), ('m12', app.production_today() - 12), ('m10', app.production_today() - 10);

with a as (insert into public.accounts (org_id, display_name) values (tests.org_id(), 'Ledger Residence') returning id)
insert into r select 'acct', id from a;
with j as (
  insert into public.jobs (org_id, name, account_id, work_types, owner_id, project_manager_id)
  values (tests.org_id(), 'Ledger – Bellevue – Exterior', (select id from r where k = 'acct'), '{exterior}',
          (select id from u where k = 'est'), (select id from u where k = 'lead')) returning id
) insert into r select 'job', id from j;
with j as (
  insert into public.jobs (org_id, name, account_id, work_types)
  values (tests.org_id(), 'Ledger – Bellevue – Interior', (select id from r where k = 'acct'), '{interior}') returning id
) insert into r select 'job2', id from j;
insert into public.job_financials (job_id, org_id, contract_baseline_cents)
values ((select id from r where k = 'job'), tests.org_id(), 1000000),
       ((select id from r where k = 'job2'), tests.org_id(), 50000);

-- 1. No stored balance anywhere ------------------------------------------------------------------
select tests.assert_eq((
  select coalesce(string_agg(table_name || '.' || column_name, ', '), '')
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('jobs', 'invoices', 'accounts', 'job_financials', 'invoice_lines', 'payments')
    and (column_name like '%balance%' or column_name like '%collected%' or column_name like '%outstanding%'
         or column_name like '%amount_paid%' or column_name like '%paid_cents%' or column_name like '%amount_due%'
         or column_name like '%left_to_bill%' or column_name like '%unapplied%')), '',
  'no stored balance / collected / paid columns on jobs, invoices, accounts, contract or payments');
select tests.assert_eq((select count(*) from information_schema.views where table_schema = 'public'
                        and table_name in ('job_ledger', 'invoice_ledger', 'payment_ledger')), 3::bigint,
  'balances come from the ledger views');

-- 2. The shared scenario --------------------------------------------------------------------------
select tests.login_service((select id from u where k = 'owner'));
insert into r select 'dep', public.create_invoice((select id from r where k = 'job'), 'deposit',
  '[{"description": "Deposit", "unit_price_cents": 300000}]'::jsonb);
select tests.assert_raises(format($q$select public.create_invoice(%L, 'deposit', '[{"description": "Again", "unit_price_cents": 1}]')$q$,
  (select id from r where k = 'job')), 'one live deposit invoice per job', '23505');
select tests.assert_raises(format($q$select public.create_invoice(%L, 'credit_memo', '[{"description": "Oops", "unit_price_cents": 100}]')$q$,
  (select id from r where k = 'job')), 'a credit memo must take money off', '23514');
select tests.assert_raises(format($q$select public.create_invoice(%L, 'progress', '[{"description": "Neg", "unit_price_cents": -100}]')$q$,
  (select id from r where k = 'job')), 'an invoice total cannot go below $0', '23514');
select public.mark_invoice_sent((select id from r where k = 'dep'), (select v from d where k = 'm40'), (select v from d where k = 'm40'));
select tests.assert((select sent_at is not null and status = 'overdue' from public.invoices where id = (select id from r where k = 'dep')),
  'a sent, unpaid deposit past its due date reads overdue');

-- Forced application: the whole payment goes onto invoices.
select tests.assert_raises(format($q$select public.record_payment(%L, 'check', 300000, %L, '[{"invoice_id": "%s", "amount_cents": 100000}]')$q$,
  (select id from r where k = 'job'), (select v from d where k = 'm40'), (select id from r where k = 'dep')),
  'a payment must be applied in full while money is owed', '23514');
select tests.assert_raises(format($q$select public.record_payment(%L, 'check', 300000, %L, '[{"invoice_id": "%s", "amount_cents": 300001}]')$q$,
  (select id from r where k = 'job'), (select v from d where k = 'm40'), (select id from r where k = 'dep')),
  'an invoice never takes more than its total', '23514');
select tests.assert_raises(format($q$select public.record_payment(%L, 'check', 100, %L, '[]')$q$,
  (select id from r where k = 'job'), (select v from d where k = 'today') + 1),
  'the received date cannot be in the future', '23514');
insert into r select 'p1', public.record_payment((select id from r where k = 'job'), 'check', 300000, (select v from d where k = 'm40'),
  jsonb_build_array(jsonb_build_object('invoice_id', (select id from r where k = 'dep'), 'amount_cents', 300000)), 'CHK 1001');
select tests.assert_eq((select status from public.invoices where id = (select id from r where k = 'dep')), 'paid',
  'applying the deposit marks the invoice paid');
select tests.assert((select deposit_paid_at is not null from public.jobs where id = (select id from r where k = 'job')),
  'the deposit milestone is stamped when the deposit invoice is paid');
select tests.assert((select payment_number like 'PMT-____-____' from public.payments where id = (select id from r where k = 'p1')),
  'payments are numbered per year');
select public.update_payment_status((select id from r where k = 'p1'), 'clear');
select tests.assert_raises(format($q$select public.update_payment_status(%L, 'clear')$q$, (select id from r where k = 'p1')),
  'clearing twice is refused', '23514');
select tests.logout();

-- The Phase 6 hand-off: an owner approves the drafted On-Time Guarantee credit on Job → Schedule.
select tests.login_service();
insert into public.on_time_credits (org_id, job_id, amount_cents, promised_date, actual_start_date, reason)
values (tests.org_id(), (select id from r where k = 'job'), 25000, current_date - 30, current_date - 28, 'Started 2 days late.');
select tests.logout();
select tests.login((select id from u where k = 'owner'));
update public.on_time_credits set status = 'approved', decision_note = 'We owe it.' where job_id = (select id from r where k = 'job');
select tests.logout();
select tests.assert_eq((select status from public.credits where job_id = (select id from r where k = 'job')), 'approved',
  'an approved On-Time Guarantee credit joins the ledger');

-- Completed → the final invoice includes the approved credit.
select set_config('app.stage_change', 'on', true);
update public.jobs set stage = 'completed' where id = (select id from r where k = 'job');
select set_config('app.stage_change', 'off', true);
select tests.login_service((select id from u where k = 'owner'));
insert into r select 'fin', public.draft_final_invoice((select id from r where k = 'job'));
select tests.assert_eq(public.draft_final_invoice((select id from r where k = 'job')), (select id from r where k = 'fin'),
  'drafting the final invoice is idempotent');
select tests.assert_eq((select total_cents from public.invoices where id = (select id from r where k = 'fin')), 675000::bigint,
  'final invoice = what is left to bill (balance of contract minus the credit)');
select tests.assert_eq((select string_agg(description || ':' || amount_cents, ', ' order by sort_order) from public.invoice_lines
                        where invoice_id = (select id from r where k = 'fin')),
  'Balance of contract:700000, On-Time Guarantee credit:-25000', 'the credit is a negative line on the final invoice');
select tests.assert((select status = 'applied' and invoice_id = (select id from r where k = 'fin') from public.credits
                     where job_id = (select id from r where k = 'job')), 'the credit is applied to the final invoice');
select tests.assert((select status = 'applied' and invoice_id = (select id from r where k = 'fin') from public.on_time_credits
                     where job_id = (select id from r where k = 'job')), 'the on-time credit record says applied too');
select tests.assert_eq((select on_time_guarantee_status from public.jobs where id = (select id from r where k = 'job')), 'credit_applied',
  'the job shows the guarantee credit applied');
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'completed'),
  'Completed → Invoiced waits for the final invoice to be sent');
select public.mark_invoice_sent((select id from r where k = 'fin'), (select v from d where k = 'm26'), (select v from d where k = 'm12'));
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'completed'), 'sending the final invoice opens the gate');

insert into r select 'p2', public.record_payment((select id from r where k = 'job'), 'ach', 400000, (select v from d where k = 'm10'),
  jsonb_build_array(jsonb_build_object('invoice_id', (select id from r where k = 'fin'), 'amount_cents', 400000)));
insert into r select 'p3', public.record_payment((select id from r where k = 'job'), 'check', 100000, (select v from d where k = 'm10'),
  jsonb_build_array(jsonb_build_object('invoice_id', (select id from r where k = 'fin'), 'amount_cents', 100000)));
select tests.assert_raises(format($q$select public.update_payment_status(%L, 'bounce')$q$, (select id from r where k = 'p3')),
  'a bounce needs a reason', '23514');
select public.update_payment_status((select id from r where k = 'p3'), 'bounce', 'NSF – returned by the bank');
select tests.assert_raises(format($q$select public.set_payment_applications(%L, '[]')$q$, (select id from r where k = 'p3')),
  'a bounced payment cannot be applied again', '23514');
insert into r select 'p4', public.record_payment((select id from r where k = 'job'), 'zelle', 60000, (select v from d where k = 'm10'),
  jsonb_build_array(jsonb_build_object('invoice_id', (select id from r where k = 'fin'), 'amount_cents', 60000)));
select public.set_payment_applications((select id from r where k = 'p4'),
  jsonb_build_array(jsonb_build_object('invoice_id', (select id from r where k = 'fin'), 'amount_cents', 50000)));
insert into r select 'rf', public.refund_payment((select id from r where k = 'p4'), 5000, (select v from d where k = 'today'), 'zelle',
  'Paid twice by mistake');
select tests.assert_eq((select (detail ->> 'from_unapplied')::bigint from public.refunds where id = (select id from r where k = 'rf')),
  5000::bigint, 'a refund comes out of unapplied money first');
select tests.assert_raises(format($q$select public.refund_payment(%L, 55001, %L, 'zelle', 'Too much')$q$,
  (select id from r where k = 'p4'), (select v from d where k = 'today')), 'a refund cannot exceed what is left', '23514');
select public.sweep_invoices();
select tests.logout();

select tests.assert_eq((select row(contract_base_cents, credits_cents, contract_cents, billed_cents, left_to_bill_cents,
                                    collected_cents, balance_cents, due_cents, unapplied_cents, refunded_cents)::text
                        from public.job_ledger where job_id = (select id from r where k = 'job')),
  '(1000000,25000,975000,975000,0,750000,225000,225000,5000,5000)',
  'job_ledger matches the shared scenario (contract, billed, left to bill, collected, balance, due, unapplied, refunded)');
select tests.assert_eq((select row(collected_cents, balance_cents, days_past_due, display_status)::text
                        from public.invoice_ledger where id = (select id from r where k = 'fin')),
  '(450000,225000,12,overdue)', 'bounced money never counts; the final invoice is 12 days overdue');
select tests.assert_eq((select status from public.invoices where id = (select id from r where k = 'fin')), 'overdue',
  'the sweep keeps the stored status current');
select tests.assert_eq((select row(available_cents, applied_cents, unapplied_cents)::text from public.payment_ledger
                        where id = (select id from r where k = 'p4')), '(55000,50000,5000)',
  'unapplied cash is shown, never counted as collected');
select tests.assert_eq((select count(*) from public.events where type = 'invoice.overdue'
                        and aggregate_id = (select id from r where k = 'fin')::text), 1::bigint,
  'one invoice.overdue event at 7 days (none yet at 30)');
select tests.login_service((select id from u where k = 'owner'));
select public.sweep_invoices();
select tests.logout();
select tests.assert_eq((select count(*) from public.events where type = 'invoice.overdue'
                        and aggregate_id = (select id from r where k = 'fin')::text), 1::bigint,
  'overdue events are not repeated');

-- 3. Gates 11–12 and reversals ------------------------------------------------------------------
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'invoiced'), 'a balance keeps the job in Invoiced');
select tests.login_service((select id from u where k = 'owner'));
select tests.assert_raises(format($q$select public.void_invoice(%L, 'Wrong amount')$q$, (select id from r where k = 'fin')),
  'an invoice with payments cannot be voided', '23514');
select tests.assert_raises(format($q$select public.set_payment_applications(%L, '[{"invoice_id": "%s", "amount_cents": 55001}]')$q$,
  (select id from r where k = 'p4'), (select id from r where k = 'fin')), 'a payment never gives more than it has left', '23514');
select tests.assert_raises(format($q$select public.set_payment_applications(%L, '[{"invoice_id": "%s", "amount_cents": 100}]')$q$,
  (select id from r where k = 'p4'), (select id from r where k = 'dep')), 'a paid invoice takes nothing more', '23514');
insert into r select 'p5', public.record_payment((select id from r where k = 'job'), 'card', 225000, (select v from d where k = 'today'),
  jsonb_build_array(jsonb_build_object('invoice_id', (select id from r where k = 'fin'), 'amount_cents', 225000)));
select tests.logout();
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'invoiced'), 'balance $0 → Invoiced → Paid in Full passes');
select tests.assert(app.job_gate_passes((select id from r where k = 'job'), 'paid_in_full'), 'and the job may close');
select tests.login_service((select id from u where k = 'owner'));
select public.update_payment_status((select id from r where k = 'p5'), 'bounce', 'Card charge-back');
select tests.logout();
select tests.assert(not app.job_gate_passes((select id from r where k = 'job'), 'paid_in_full'),
  'a bounce after Paid in Full stops the auto-close');
select tests.assert_eq((select balance_cents from public.job_ledger where job_id = (select id from r where k = 'job')), 225000::bigint,
  'the bounce puts exactly that money back on the balance');

-- A credit approved after the final invoice is sent becomes a credit memo.
select tests.login_service((select id from u where k = 'office'));
select tests.assert_raises(format($q$select public.create_credit(%L, 'goodwill', 10000, 'Scuffed a door', true)$q$, (select id from r where k = 'job')),
  'only people who approve credits can approve one', '42501');
insert into r select 'cr2', public.create_credit((select id from r where k = 'job'), 'goodwill', 10000, 'Scuffed a door');
select tests.assert_raises(format($q$select public.create_credit(%L, 'on_time_guarantee', 10000, 'Late')$q$, (select id from r where k = 'job')),
  'on-time credits come from the schedule only', '23514');
select tests.logout();
select tests.login_service((select id from u where k = 'owner'));
select public.decide_credit((select id from r where k = 'cr2'), 'approve', 'Fair');
select tests.logout();
select tests.assert((select i.invoice_type = 'credit_memo' and i.total_cents = -10000 from public.credits c join public.invoices i on i.id = c.invoice_id
                     where c.id = (select id from r where k = 'cr2')), 'after the final invoice is sent, a credit becomes a credit memo');
select tests.assert_eq((select row(contract_cents, billed_cents, left_to_bill_cents, balance_cents)::text from public.job_ledger
                        where job_id = (select id from r where k = 'job')), '(965000,965000,0,215000)',
  'the credit memo lowers contract, billed and balance together');

-- 4. Permissions -------------------------------------------------------------------------------
select tests.login_service((select id from u where k = 'est'));
select tests.assert_raises(format($q$select public.record_payment(%L, 'cash', 100, current_date, '[]')$q$, (select id from r where k = 'job2')),
  'estimators cannot record payments', '42501');
select tests.logout();
select tests.login_service((select id from u where k = 'lead'));
select tests.assert_raises(format($q$select public.create_invoice(%L, 'progress', '[{"description": "x", "unit_price_cents": 1}]')$q$,
  (select id from r where k = 'job2')), 'crew leads cannot create invoices', '42501');
select tests.logout();

do $$
declare
  who text;
  n bigint;
begin
  foreach who in array array['owner', 'office', 'books', 'ro'] loop
    perform tests.login((select id from u where u.k = who));
    select count(*) into n from public.payments;
    perform tests.assert(n = 5, who || ' sees payments');
    perform tests.assert((select count(*) from public.job_ledger where job_id = (select id from r where r.k = 'job')) = 1,
      who || ' sees the job ledger');
    perform tests.assert((select count(*) from public.credits) = 2, who || ' sees credits');
    perform tests.logout();
  end loop;
  foreach who in array array['est', 'lead', 'painter'] loop
    perform tests.login((select id from u where u.k = who));
    perform tests.assert((select count(*) from public.payments) = 0, who || ' sees no payments');
    perform tests.assert((select count(*) from public.payment_applications) = 0, who || ' sees no applications');
    perform tests.assert((select count(*) from public.refunds) = 0, who || ' sees no refunds');
    perform tests.assert((select count(*) from public.credits) = 0, who || ' sees no credits');
    perform tests.assert((select count(*) from public.job_ledger) = 0, who || ' sees no job ledger rows');
    perform tests.assert((select count(*) from public.invoice_ledger) = 0, who || ' sees no invoice amounts');
    perform tests.assert((select count(*) from public.payment_ledger) = 0, who || ' sees no payment ledger');
    perform tests.assert((select not (public.finance_stats(current_date - 30, current_date) ->> 'can_see_money')::boolean),
      who || ' gets no finance numbers');
    perform tests.logout();
  end loop;
end
$$;

select tests.login((select id from u where k = 'owner'));
select tests.assert_raises(format($q$insert into public.payments (org_id, job_id, method, amount_cents, received_on) values (%L, %L, 'cash', 100, current_date)$q$,
  tests.org_id(), (select id from r where k = 'job')), 'people cannot write payments directly (only through the money functions)', '42501');
select tests.assert_raises(format($q$update public.invoices set status = 'paid' where id = %L$q$, (select id from r where k = 'fin')),
  'invoice status is never typed in', '42501');
select tests.assert_raises(format($q$select public.record_payment(%L, 'cash', 100, current_date, '[]')$q$, (select id from r where k = 'job')),
  'the money functions are not callable from the browser', '42501');
select tests.assert_eq((select (public.finance_stats(current_date - 400, current_date) ->> 'ar_outstanding_cents')::bigint), 225000::bigint,
  'A/R outstanding = sent invoice balances (credit memo drafts are not receivables yet)');
select tests.assert_eq((select public.finance_stats(current_date - 400, current_date) -> 'aging' ->> 'd1_30'), '225000',
  'the overdue final invoice sits in the 1–30 day bucket');
select tests.assert_eq((select kind from public.search_records((select invoice_number from public.invoices where id = (select id from r where k = 'fin')), 'all') limit 1),
  'invoice', 'universal search finds an invoice by number');
select tests.logout();
select tests.login((select id from u where k = 'painter'));
select tests.assert_eq((select count(*) from public.search_records('INV-', 'invoices')), 0::bigint, 'crews never find invoices');
select tests.logout();

-- Job costing: owners and the bookkeeper only.
select tests.login((select id from u where k = 'books'));
with e as (
  insert into public.job_expenses (org_id, job_id, category, description, amount_cents, spent_on)
  values (tests.org_id(), (select id from r where k = 'job'), 'disposal', 'Dump fee', 4500, current_date) returning id
) insert into r select 'exp', id from e;
select tests.assert_eq((select count(*) from public.job_expenses), 1::bigint, 'the bookkeeper records and sees expenses');
select tests.assert_raises(format($q$update public.job_expenses set deleted_at = now() where id = %L$q$, (select id from r where k = 'exp')),
  'removing an expense needs a reason', '23514');
select tests.logout();
select tests.login((select id from u where k = 'office'));
select tests.assert_eq((select count(*) from public.job_expenses), 0::bigint, 'the office manager sees no job costs');
select tests.assert_raises(format($q$insert into public.job_expenses (org_id, job_id, category, description, amount_cents, spent_on) values (%L, %L, 'other', 'x', 1, current_date)$q$,
  tests.org_id(), (select id from r where k = 'job')), 'and cannot add them', '42501');
select tests.logout();

-- 5. Month close and the owner override -----------------------------------------------------------
select tests.login_service((select id from u where k = 'office'));
select tests.assert_raises(format($q$select public.close_month(%L)$q$, date_trunc('month', app.production_today() - 40)),
  'the office manager cannot close a month', '42501');
select tests.logout();
select tests.login_service((select id from u where k = 'books'));
select tests.assert_raises(format($q$select public.close_month(%L)$q$, app.production_today()), 'the current month cannot be closed', '23514');
insert into r select 'close', public.close_month(date_trunc('month', app.production_today() - 40)::date, 'Bank reconciled');
select tests.assert_raises(format($q$select public.close_month(%L)$q$, date_trunc('month', app.production_today() - 40)),
  'a month is closed once', '23505');
select tests.assert_raises(format($q$select public.update_payment_status(%L, 'void', 'Typo')$q$, (select id from r where k = 'p1')),
  'the bookkeeper cannot change a payment in a closed month', '42501');
select tests.assert_raises(format($q$select public.reopen_month(%L, 'Need to fix a typo in a check')$q$, date_trunc('month', app.production_today() - 40)),
  'only an owner reopens a month', '42501');
select tests.logout();
select tests.login_service((select id from u where k = 'owner'));
select tests.assert_raises(format($q$select public.record_payment(%L, 'cash', 100, %L, '[]')$q$, (select id from r where k = 'job2'),
  (select v from d where k = 'm40')), 'an owner needs a reason to record into a closed month', '23514');
select tests.assert_raises(format($q$update public.payments set method = 'cash' where id = %L$q$, (select id from r where k = 'p1')),
  'even trusted code cannot quietly edit a closed-month payment', '42501');
select tests.assert_eq((select summary ->> 'collected_cents' from public.month_closes where id = (select id from r where k = 'close'))::bigint,
  (select coalesce(sum(a.amount_cents), 0) from public.payment_applications a join public.payments p on p.id = a.payment_id
   where p.status in ('received', 'cleared') and date_trunc('month', p.received_on) = date_trunc('month', app.production_today() - 40))::bigint,
  'the close keeps a summary of the month');
select public.reopen_month(date_trunc('month', app.production_today() - 40)::date, 'Check date was entered wrong');
select tests.assert_eq((select status from public.month_closes where id = (select id from r where k = 'close')), 'reopened',
  'an owner can reopen a month with a reason');
select tests.logout();

-- 6. Other companies see nothing ---------------------------------------------------------------
select tests.login((select id from u where k = 'other_owner'));
select tests.assert_eq((select count(*) from public.payments) + (select count(*) from public.credits)
  + (select count(*) from public.job_ledger) + (select count(*) from public.invoice_ledger)
  + (select count(*) from public.month_closes) + (select count(*) from public.job_expenses), 0::bigint,
  'another company sees none of this company''s money');
select tests.logout();
select tests.login_service((select id from u where k = 'other_owner'));
select tests.assert_raises(format($q$select public.set_payment_applications(%L, '[{"invoice_id": "%s", "amount_cents": 1}]')$q$,
  (select id from r where k = 'p4'), (select id from r where k = 'fin')), 'or change it', null);
select tests.logout();

rollback;
