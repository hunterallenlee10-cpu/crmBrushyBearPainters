-- Rolls back Phase 6 (production). DESTROYS crews, subcontractors and their
-- compliance files, schedules, daily logs, hours, punch lists, checklists,
-- rain delays and drafted on-time credits. Jobs keep their rows (crew, on-time
-- date and priority-reschedule timestamp columns are dropped); the Phase 5
-- gate function comes back. Owner approval required.

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where bucket_id = 'documents' and name like '%/subcontractors/%';
  end if;
end
$$;

drop function if exists public.production_stats();
drop function if exists public.emit_production_event(text, text, text, jsonb);

delete from public.attention_items where subject_type = 'subcontractor';
alter table public.attention_items drop constraint attention_items_subject_type_check;
alter table public.attention_items add constraint attention_items_subject_type_check
  check (subject_type in ('lead', 'job'));

drop trigger if exists jobs_production_guard on public.jobs;
drop trigger if exists job_photos_links_guard on public.job_photos;

alter table public.daily_logs drop constraint if exists daily_logs_cleanup_photo_fk;
alter table public.job_photos drop column if exists daily_log_id, drop column if exists work_order_id;
alter table public.work_orders drop constraint if exists work_orders_checklist_fk;
alter table public.work_orders drop constraint if exists work_orders_crew_fk;
drop index if exists public.work_orders_checklist_idx;

drop function if exists app.subcontractor_status(public.subcontractors, date);

drop table if exists public.punch_signoffs;
drop table if exists public.punch_items;
drop table if exists public.time_entries;
drop table if exists public.daily_logs;
drop table if exists public.checklist_items;
drop table if exists public.checklist_instances;
drop table if exists public.checklist_templates;
drop table if exists public.on_time_credits;
drop table if exists public.rain_delays;
drop table if exists public.weather_forecasts;
drop table if exists public.schedule_recommendations;
drop table if exists public.schedule_entries;

drop index if exists public.jobs_priority_reschedule_idx;
alter table public.jobs
  drop column if exists crew_id,
  drop column if exists guarantee_start_date,
  drop column if exists priority_reschedule_at;

drop table if exists public.schedule_settings;
drop table if exists public.work_rules;
drop table if exists public.work_types;
drop table if exists public.crew_availability;
drop table if exists public.crew_skills;
drop table if exists public.crew_members;
drop table if exists public.crews;
drop table if exists public.subcontractor_documents;
drop table if exists public.subcontractors;
drop table if exists public.skills;

drop function if exists app.jobs_production_guard();
drop function if exists app.refresh_job_teams(uuid[]);
drop function if exists app.jobs_for_crew(uuid);
drop function if exists app.job_crew_user_ids(uuid, uuid);
drop function if exists app.crew_lead_ids(uuid, uuid);
drop function if exists app.crew_people_after();
drop function if exists app.crews_after();
drop function if exists app.subcontractors_guard();
drop function if exists app.subcontractor_documents_guard();
drop function if exists app.crews_guard();
drop function if exists app.crew_child_guard();
drop function if exists app.schedule_entries_guard();
drop function if exists app.schedule_entries_after();
drop function if exists app.schedule_recommendations_guard();
drop function if exists app.rain_delays_guard();
drop function if exists app.rain_delays_after();
drop function if exists app.on_time_credits_guard();
drop function if exists app.on_time_credits_after();
drop function if exists app.daily_logs_guard();
drop function if exists app.daily_logs_after();
drop function if exists app.time_entries_guard();
drop function if exists app.punch_items_guard();
drop function if exists app.punch_items_after();
drop function if exists app.punch_signoffs_guard();
drop function if exists app.punch_signoffs_after();
drop function if exists app.checklist_instances_guard();
drop function if exists app.checklist_items_guard();
drop function if exists app.checklist_items_after();
drop function if exists app.job_photos_links_guard();
drop function if exists app.org_config_guard();
drop function if exists app.job_materials_ready(uuid);

-- Team lists without crews.
select set_config('app.system_update', 'on', true);
update public.jobs j set team_user_ids = app.job_team_ids(j.id, j.owner_id, j.point_of_contact_id, j.project_manager_id);
select set_config('app.system_update', 'off', true);

-- The Phase 5 gate function.
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
    when 'paid_in_full' then true
    else false
  end;
$$;
revoke execute on function app.job_gate_passes(uuid, text) from public, anon, authenticated;
grant execute on function app.job_gate_passes(uuid, text) to service_role;

drop function if exists app.production_today();
