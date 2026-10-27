-- Rollback for 20261031000100_hardening.sql (Phase 10 · Hardening & launch prep).
-- Drops what the migration added. Custom field values, imports, bulk update
-- and merge history, Help Center articles and commission data are lost; take a
-- backup first in production. Purge demo data before rolling back (the
-- is_demo flags go with it).

drop function if exists public.job_recovery_scan(uuid, integer);
drop function if exists public.demo_backdate_stage(uuid, timestamptz);
drop function if exists public.claim_subject_events(text, text, integer);
drop index if exists public.events_pending_aggregate_idx;
drop function if exists public.purge_demo_data(uuid);
drop function if exists public.demo_data_counts(uuid);
drop function if exists public.undo_merge(uuid, text);
drop function if exists public.merge_customers(text, uuid, uuid, jsonb, text);
drop function if exists public.bulk_update_revert(uuid, text);
drop function if exists public.bulk_update_apply(uuid);
drop function if exists public.kb_article_viewed(uuid);

-- Gate codes: back to the permission only.
drop policy if exists property_secrets_select on public.property_secrets;
create policy property_secrets_select on public.property_secrets for select to authenticated
  using (
    org_id = (select app.current_org_id()) and (select app.has_perm('properties:view_access_codes'))
    and exists (select 1 from public.properties p where p.id = property_id)
  );
drop function if exists app.crew_on_site_today(uuid);

-- Messages: back to append-only with trusted deletes.
create or replace function app.messages_deny_write()
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

drop trigger if exists leads_check_module_fields on public.leads;
drop trigger if exists jobs_check_module_fields on public.jobs;
drop trigger if exists accounts_check_module_fields on public.accounts;
drop trigger if exists contacts_check_module_fields on public.contacts;

drop function if exists app.check_module_fields();
drop function if exists app.custom_value_error(public.custom_field_definitions, jsonb);

drop table if exists public.commission_adjustments;
drop table if exists public.commission_entries;
drop table if exists public.commission_plans;
drop table if exists public.commission_settings;
drop table if exists public.kb_article_stats;
drop table if exists public.kb_articles;
drop table if exists public.kb_categories;
drop table if exists public.record_merges;
drop table if exists public.bulk_update_rows;
drop table if exists public.bulk_updates;
drop table if exists public.import_rows;
drop table if exists public.imports;
drop table if exists public.module_layouts;
drop table if exists public.validation_rules;
drop table if exists public.custom_field_definitions;

alter table public.export_log drop constraint if exists export_log_kind_check;
delete from public.export_log where kind in ('list', 'audit_log', 'import_errors');
alter table public.export_log add constraint export_log_kind_check
  check (kind in ('chart', 'kpi_table', 'report', 'report_schedule'));

drop index if exists public.leads_custom_field_values_idx;
drop index if exists public.jobs_custom_field_values_idx;
drop index if exists public.accounts_custom_field_values_idx;
drop index if exists public.contacts_custom_field_values_idx;
alter table public.leads drop column if exists custom_field_values;
alter table public.jobs drop column if exists custom_field_values;
alter table public.accounts drop column if exists custom_field_values;
alter table public.contacts drop column if exists custom_field_values;

do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'contacts', 'properties', 'leads', 'jobs', 'appointments', 'job_holds',
                           'estimates', 'invoices', 'payments', 'daily_logs', 'crews', 'crew_members',
                           'subcontractors', 'schedule_entries', 'work_orders', 'rain_delays', 'attention_items',
                           'tasks', 'notes', 'cases', 'referral_champions', 'punch_items', 'paint_orders',
                           'messages', 'credits'] loop
    execute format('drop index if exists public.%I', t || '_is_demo_idx');
    execute format('alter table public.%I drop column if exists is_demo', t);
  end loop;
end
$$;

drop function if exists app.rule_value_text(jsonb);
drop function if exists app.module_layouts_guard();
drop function if exists app.validation_rules_guard();
drop function if exists app.custom_field_definitions_guard();
drop function if exists app.validation_standard_fields(text);
drop function if exists app.bulk_normalize(text, uuid, jsonb);
drop function if exists app.bulk_current_values(text, uuid, jsonb);
drop function if exists app.bulk_apply_patch(text, uuid, jsonb);
drop function if exists app.bulk_fields(text);
drop function if exists app.merge_subject_type(text);
drop function if exists app.merge_references(text);
drop function if exists app.merge_fields(text);
drop function if exists app.kb_articles_guard();
drop function if exists app.kb_search_document(text, text, text[], text);
drop function if exists app.commission_entries_guard();

delete from public.pack_permissions where permission = 'help:manage';
delete from public.user_permission_overrides where permission = 'help:manage';
delete from public.permissions where key = 'help:manage';
