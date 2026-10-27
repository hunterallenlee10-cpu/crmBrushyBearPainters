-- Phase 9 · Analytics configuration seed (SPEC §8.14, §15.1).
--
-- Real configuration only: the 10 report templates of SPEC §8.14 (Sold by
-- month, Leads by source, Estimates sent vs accepted, A/R aging, Jobs missing
-- daily logs, Sold – no deposit, Gross margin by job, Speed to lead, 24h SLA
-- misses, On-time start misses). No marketing spend, no revenue goals (the
-- owners enter those), no reports or dashboards of anyone's.
--
-- The JSON configs must match REPORT_TEMPLATES in
-- lib/domain/reports/templates.ts (a unit test reads this file and compares).
--
-- Idempotent (on conflict do nothing): safe on a database with Phases 0–8.
-- Rollback: supabase/rollbacks/20261030000200_analytics_seed.down.sql

create or replace function app.seed_analytics_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reports (org_id, owner_id, name, description, category, module, config, is_template, template_key, shared)
  select p_org, null, v.name, v.description, v.category, v.module, v.config::jsonb, true, v.key, true
  from (values
    -- @report-templates:begin
    ('sold_by_month', 'Sold by month', 'Jobs whose estimate was accepted, by month, with contract value.', 'sales', 'jobs',
     '{"columns":["job_number","name","sold_at","contract_cents","owner_name","territory"],"filter":{"match":"all","rules":[{"field":"sold_at","op":"is_not_empty"}]},"groupBy":{"field":"sold_at","bucket":"month"},"summaries":[{"fn":"count"},{"fn":"sum","field":"contract_cents"}],"chart":"bar","sort":{"column":"sold_at","dir":"desc"}}'),
    ('leads_by_source', 'Leads by source', 'Every lead by where it came from, with how many converted.', 'marketing', 'leads',
     '{"columns":["name","lead_source","status","territory","created_at","owner_name"],"filter":{"match":"all","rules":[]},"groupBy":{"field":"lead_source"},"summaries":[{"fn":"count"},{"fn":"count_of","field":"converted_at"}],"chart":"donut","sort":{"column":"created_at","dir":"desc"}}'),
    ('estimates_sent_vs_accepted', 'Estimates sent vs accepted', 'Estimates by the month they were first sent, and how many of them were accepted.', 'sales', 'estimates',
     '{"columns":["estimate_number","job_name","owner_name","first_sent_at","status","accepted_at","total_cents"],"filter":{"match":"all","rules":[{"field":"first_sent_at","op":"is_not_empty"}]},"groupBy":{"field":"first_sent_at","bucket":"month"},"summaries":[{"fn":"count"},{"fn":"count_of","field":"accepted_at"}],"chart":"bar","sort":{"column":"first_sent_at","dir":"desc"}}'),
    ('ar_aging', 'A/R aging', 'Sent invoices with money owed, by how far past due they are.', 'finance', 'invoices',
     '{"columns":["invoice_number","account_name","job_name","due_date","days_past_due","balance_cents","aging_bucket"],"filter":{"match":"all","rules":[{"field":"issued","op":"equals","value":"true"},{"field":"balance_cents","op":"gt","value":"0"}]},"groupBy":{"field":"aging_bucket"},"summaries":[{"fn":"count"},{"fn":"sum","field":"balance_cents"}],"chart":"bar","sort":{"column":"days_past_due","dir":"desc"}}'),
    ('jobs_missing_daily_logs', 'Jobs missing daily logs', 'Production days in the last 30 days with no daily log (rain days don''t count).', 'production', 'jobs',
     '{"columns":["job_number","name","stage","point_of_contact_name","missed_daily_logs"],"filter":{"match":"all","rules":[{"field":"missed_daily_logs","op":"gt","value":"0"}]},"groupBy":null,"summaries":[{"fn":"count"},{"fn":"sum","field":"missed_daily_logs"}],"chart":"table","sort":{"column":"missed_daily_logs","dir":"desc"}}'),
    ('sold_no_deposit', 'Sold – no deposit', 'Sold jobs whose deposit isn''t paid yet.', 'finance', 'jobs',
     '{"columns":["job_number","name","stage","sold_at","contract_cents","owner_name"],"filter":{"match":"all","rules":[{"field":"sold_at","op":"is_not_empty"},{"field":"deposit_paid_at","op":"is_empty"},{"field":"stage","op":"not_equals","value":"closed_lost"}]},"groupBy":null,"summaries":[{"fn":"count"},{"fn":"sum","field":"contract_cents"}],"chart":"table","sort":{"column":"sold_at","dir":"asc"}}'),
    ('gross_margin_by_job', 'Gross margin by job', 'Completed jobs: contract, direct costs and gross margin. Owners and the bookkeeper only.', 'finance', 'jobs',
     '{"columns":["job_number","name","completed_at","contract_cents","cost_cents","margin_cents","margin_percent"],"filter":{"match":"all","rules":[{"field":"completed_at","op":"is_not_empty"}]},"groupBy":null,"summaries":[{"fn":"count"},{"fn":"sum","field":"contract_cents"},{"fn":"sum","field":"margin_cents"}],"chart":"table","sort":{"column":"completed_at","dir":"desc"}}'),
    ('speed_to_lead', 'Speed to lead', 'Minutes from a lead arriving to a person first reaching them (business hours), by month.', 'sales', 'leads',
     '{"columns":["name","lead_source","created_at","first_contacted_at","speed_to_lead_minutes","owner_name"],"filter":{"match":"all","rules":[{"field":"speed_to_lead_minutes","op":"is_not_empty"}]},"groupBy":{"field":"created_at","bucket":"month"},"summaries":[{"fn":"count"},{"fn":"avg","field":"speed_to_lead_minutes"}],"chart":"line","sort":{"column":"created_at","dir":"desc"}}'),
    ('sla_24h_misses', '24h SLA misses', 'Estimates sent later than the estimate SLA after the walkthrough.', 'sales', 'estimates',
     '{"columns":["estimate_number","job_name","owner_name","walkthrough_completed_at","first_sent_at","hours_to_send"],"filter":{"match":"all","rules":[{"field":"sla_met","op":"equals","value":"false"}]},"groupBy":{"field":"owner_name"},"summaries":[{"fn":"count"},{"fn":"avg","field":"hours_to_send"}],"chart":"table","sort":{"column":"first_sent_at","dir":"desc"}}'),
    ('on_time_start_misses', 'On-time start misses', 'Jobs that started after their guaranteed start date (rain delays don''t count).', 'production', 'jobs',
     '{"columns":["job_number","name","guarantee_start_date","actual_start_date","on_time_guarantee_status","point_of_contact_name"],"filter":{"match":"all","rules":[{"field":"started_late","op":"equals","value":"true"}]},"groupBy":null,"summaries":[{"fn":"count"}],"chart":"table","sort":{"column":"actual_start_date","dir":"desc"}}')
    -- @report-templates:end
  ) as v(key, name, description, category, module, config)
  on conflict (org_id, template_key) do nothing;
end;
$$;
revoke execute on function app.seed_analytics_defaults(uuid) from public, anon, authenticated;

select app.seed_analytics_defaults(id) from public.organizations;
