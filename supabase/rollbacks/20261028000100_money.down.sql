-- Rolls back Phase 7 (Money): drops the money tables, views and functions and
-- restores the Phase 6 versions of the replaced functions (gates and search).
-- Run in a transaction. Invoices and invoice lines (Phase 4) stay; only the
-- column and indexes this migration added are removed. Payments, credits,
-- month closes, expenses and receipt files are deleted: owner approval required.

-- Gates and search back to Phase 6 / Phase 3.
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
    when 'walkthrough_complete' then exists (
      select 1 from public.estimate_versions v join public.estimates e on e.id = v.estimate_id
      where e.job_id = p_job and e.deleted_at is null and v.sent_at is not null)
    when 'estimate_sent' then exists (
      select 1 from public.estimates e
      join public.signatures s on s.estimate_version_id = e.accepted_version_id
      where e.job_id = p_job and e.deleted_at is null and e.status = 'accepted')
    when 'sold' then exists (
      select 1 from public.invoices i
      where i.job_id = p_job and i.invoice_type = 'deposit' and i.status <> 'void')
      or exists (
      select 1 from public.estimates e join public.estimate_versions v on v.id = e.accepted_version_id
      where e.job_id = p_job and e.status = 'accepted'
        and coalesce((v.accepted_totals ->> 'depositCents')::bigint, 0) = 0)
    when 'onboarding' then app.onboarding_cleared(p_job)
      and not exists (select 1 from public.job_holds h
                      where h.job_id = p_job and h.released_at is null and h.blocks_scheduling)
    when 'ready_to_schedule' then exists (
      select 1 from public.schedule_entries s where s.job_id = p_job and s.status = 'published')
    when 'scheduled' then app.job_materials_ready(p_job)
      and exists (select 1 from public.schedule_entries s
                  where s.job_id = p_job and s.status = 'published' and s.starts_on <= app.production_today())
    when 'in_progress' then exists (
      select 1 from public.work_orders w where w.job_id = p_job and w.deleted_at is null and w.status <> 'canceled')
      and not exists (
      select 1 from public.work_orders w where w.job_id = p_job and w.deleted_at is null
        and w.status not in ('completed', 'canceled'))
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

drop function if exists public.finance_stats(date, date);
drop function if exists public.sweep_invoices(integer);
drop function if exists public.reopen_month(date, text);
drop function if exists public.close_month(date, text);
drop function if exists public.draft_final_invoice(uuid);
drop function if exists public.decide_credit(uuid, text, text);
drop function if exists public.create_credit(uuid, text, bigint, text, boolean);
drop function if exists public.place_job_credits(uuid);
drop function if exists public.refund_payment(uuid, bigint, date, text, text, text, uuid, text);
drop function if exists public.update_payment_status(uuid, text, text, date, text);
drop function if exists public.set_payment_applications(uuid, jsonb, text);
drop function if exists public.record_payment(uuid, text, bigint, date, jsonb, text, text, text);
drop function if exists public.void_invoice(uuid, text, text);
drop function if exists public.mark_invoice_sent(uuid, date, date, uuid, text);
drop function if exists public.update_invoice_draft(uuid, jsonb, date, text, text);
drop function if exists public.create_invoice(uuid, text, jsonb, date, text, text);

drop trigger if exists on_time_credits_to_ledger on public.on_time_credits;
drop trigger if exists invoices_lock_guard on public.invoices;
drop policy if exists profile_compensation_select_costing on public.profile_compensation;

drop function if exists app.job_money(uuid);
drop view if exists public.job_ledger;
drop view if exists public.payment_ledger;
drop view if exists public.invoice_ledger;

drop table if exists public.job_expenses;
drop table if exists public.credits;
drop table if exists public.refunds;
drop table if exists public.payment_applications;
drop table if exists public.payments;
drop table if exists public.month_closes;

drop function if exists app.seed_money_defaults(uuid);
drop function if exists app.place_job_credits(uuid);
drop function if exists app.write_applications(uuid, uuid, jsonb);
drop function if exists app.check_invoice_total(uuid);
drop function if exists app.write_invoice_lines(uuid, uuid, jsonb, integer);
drop function if exists app.refresh_invoice_status(uuid);
drop function if exists app.invoices_lock_guard();
drop function if exists app.payments_guard();
drop function if exists app.payments_after();
drop function if exists app.payment_applications_guard();
drop function if exists app.payment_applications_after();
drop function if exists app.refunds_guard();
drop function if exists app.credits_guard();
drop function if exists app.credits_after();
drop function if exists app.on_time_credits_to_ledger();
drop function if exists app.month_closes_guard();
drop function if exists app.job_expenses_guard();
drop function if exists app.invoice_display_status(text, timestamptz, timestamptz, date, bigint, bigint, date);
drop function if exists app.check_money_lock(uuid, date[], text, text);
drop function if exists app.money_write_on();
drop function if exists app.lock_override_on();
drop function if exists app.money_locked(uuid, date);
drop function if exists app.require_actor_perm(text, text);
drop function if exists app.require_actor_org(uuid);

delete from public.saved_views where module = 'invoices';
alter table public.saved_views drop constraint saved_views_module_check,
  add constraint saved_views_module_check check (module in ('leads', 'accounts', 'contacts', 'jobs'));

drop index if exists public.invoices_one_final_idx;
drop index if exists public.invoices_org_issue_idx;
drop index if exists public.invoices_org_due_idx;
alter table public.invoices drop column if exists pdf_document_id;

delete from public.attention_items where rule_key = 'overdue_invoice';
delete from public.attention_rules where rule_key = 'overdue_invoice';
delete from public.user_permission_overrides where permission = 'finance:override_lock';
delete from public.pack_permissions where permission = 'finance:override_lock';
delete from public.permissions where key = 'finance:override_lock';

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    -- Supabase blocks direct deletes unless this is set (receipt files go with the bucket).
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where bucket_id = 'receipts';
    delete from storage.buckets where id = 'receipts';
  end if;
end
$$;
