-- Rollback for 20261029000100_communication.sql (Phase 8 schema).
-- Drops the Phase 8 tables, columns, functions and policies and restores the
delete from app.number_sequences where kind = 'case';
alter table app.number_sequences drop constraint number_sequences_kind_check;
alter table app.number_sequences add constraint number_sequences_kind_check
  check (kind in ('job', 'estimate', 'invoice', 'payment', 'work_order', 'change_order', 'paint_order'));

-- Phase 7 versions of the replaced functions. Messages keep their rows; only
-- the new columns go. Run the seed rollback (20261029000200) first.

drop trigger if exists messages_thread on public.messages;
drop trigger if exists messages_thread_after on public.messages;
drop trigger if exists notifications_preferences on public.notifications;
drop trigger if exists leads_referral on public.leads;

drop function if exists public.communication_stats(timestamptz, timestamptz);
drop function if exists public.workflow_stats();
drop function if exists public.users_with_permission(uuid, text);
drop function if exists public.claim_workflow_runs(integer);
drop function if exists public.claim_drip_enrollments(integer);
drop function if exists public.emit_domain_event(uuid, text, text, text, jsonb, text);
drop function if exists public.mark_thread_read(uuid, boolean);
drop function if exists public.approve_template(uuid);

drop index if exists public.messages_campaign_idx;
drop index if exists public.messages_thread_idx;
drop index if exists public.messages_workflow_run_idx;
drop index if exists public.messages_provider_message_idx;
alter table public.messages
  drop column if exists campaign_id,
  drop column if exists thread_id,
  drop column if exists message_type,
  drop column if exists workflow_run_id,
  drop column if exists provider_message_id;

drop index if exists public.appointments_case_idx;
alter table public.appointments drop column if exists case_id;

drop table if exists public.follow_up_attempts;
drop table if exists public.follow_up_dispositions;
drop table if exists public.follow_up_lists;
drop table if exists public.drip_enrollments;
drop table if exists public.drips;
drop table if exists public.campaign_recipients;
drop table if exists public.campaigns;
drop table if exists public.segments;
drop table if exists public.review_requests;
drop table if exists public.referrals;
drop table if exists public.referral_champions;
drop table if exists public.referral_settings;
drop table if exists public.cases;
drop table if exists public.message_threads;
drop table if exists public.workflow_runs;
drop table if exists public.workflows;
drop table if exists public.message_templates;
drop table if exists public.notification_preferences;
drop table if exists public.notification_settings;
drop table if exists public.messaging_settings;

drop function if exists app.message_templates_guard();
drop function if exists app.workflows_guard();
drop function if exists app.messages_thread();
drop function if exists app.messages_thread_after();
drop function if exists app.cases_guard();
drop function if exists app.cases_activity();
drop function if exists app.referral_champions_guard();
drop function if exists app.referrals_guard();
drop function if exists app.leads_referral();
drop function if exists app.campaigns_guard();
drop function if exists app.drip_enrollments_guard();
drop function if exists app.notifications_preferences();

delete from public.attention_items where subject_type = 'case';
alter table public.attention_items drop constraint attention_items_subject_type_check;
alter table public.attention_items add constraint attention_items_subject_type_check
  check (subject_type in ('lead', 'job', 'subcontractor'));

alter table public.rain_delays drop column if exists notify_customer;
alter table public.contacts drop column if exists email_opted_out_at;
alter table public.leads
  drop column if exists sms_opted_out_at,
  drop column if exists email_opted_out_at;

delete from app.number_sequences where kind = 'case';
alter table app.number_sequences drop constraint number_sequences_kind_check;
alter table app.number_sequences add constraint number_sequences_kind_check
  check (kind in ('job', 'estimate', 'invoice', 'payment', 'work_order', 'change_order', 'paint_order'));

-- Phase 7 versions of the replaced functions.
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
                    'recommendation.undone', 'daily_log.customer_update', 'weather.risk_detected') then
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

delete from public.pack_permissions where permission in ('cases:read', 'cases:manage');
delete from public.pack_permissions pp using public.permission_packs p
 where pp.pack_id = p.id and p.key = 'crew_lead' and pp.permission = 'messages:read';
delete from public.user_permission_overrides where permission in ('cases:read', 'cases:manage');
delete from public.permissions where key in ('cases:read', 'cases:manage');
