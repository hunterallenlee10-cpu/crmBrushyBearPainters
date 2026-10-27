-- Rollback for 20261030000200_analytics_seed.sql.
-- Removes the seeded report templates (and anything run or scheduled from
-- them) and the seed function. The schema rollback (20261030000100) drops the
-- tables afterwards anyway.

delete from public.report_schedules where report_id in (select id from public.reports where is_template);
alter table public.reports disable trigger reports_guard;
delete from public.reports where is_template;
alter table public.reports enable trigger reports_guard;

drop function if exists app.seed_analytics_defaults(uuid);
