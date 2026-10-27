-- Rollback for 20261030000100_analytics.sql (Phase 9 · Analytics & home).
-- Drops what the migration added: functions, views, tables and helpers.
-- Owner-entered marketing spend, revenue goals, saved reports, dashboards and
-- the export log are lost; take a backup first in production.

drop function if exists public.user_permission_scopes(uuid, text[]);
drop function if exists public.daily_brief(date);
drop function if exists public.workspace_summary();
drop function if exists public.my_numbers(uuid, timestamptz, timestamptz);
drop function if exists public.season_backlog(integer);
drop function if exists public.analytics_monthly(date, integer, jsonb);
drop function if exists public.analytics_stats(timestamptz, timestamptz, jsonb);
drop function if exists public.note_report_run(uuid);
drop function if exists public.log_export(text, text, text, integer, jsonb);

drop view if exists public.report_invoices;
drop view if exists public.report_estimates;
drop view if exists public.report_jobs;
drop view if exists public.report_leads;

drop table if exists public.analytics_favorites;
drop table if exists public.dashboards;
drop table if exists public.report_schedules;
drop table if exists public.report_run_stats;
drop table if exists public.reports;
drop table if exists public.export_log;
drop table if exists public.revenue_goals;
drop table if exists public.marketing_spend;

drop function if exists app.reports_guard();
drop function if exists app.report_schedules_guard();
drop function if exists app.marketing_spend_guard();
drop function if exists app.production_days_between(date, date, smallint[]);
drop function if exists app.work_type_service(text);
drop function if exists app.job_direct_cost_cents(uuid);
drop function if exists app.try_uuid(text);
