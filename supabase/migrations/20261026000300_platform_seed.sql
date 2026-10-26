-- Phase 1 · Real configuration seed (SPEC §15.1, §4)
-- Permission catalog, and app.seed_org_defaults(org) which seeds an org's packs,
-- role templates, territories, picklists, company settings and integration rows.
-- Idempotent: safe to run again; never overwrites what owners have edited.
-- Rollback: supabase/rollbacks/20261026000300_platform_seed.down.sql

-- =============================================================================
-- Permission catalog. Keep in sync with lib/permissions/catalog.ts
-- (a unit test compares the two).
-- =============================================================================
insert into public.permissions (key, resource, action, label, category, supports_scope, sort_order)
select v.key, split_part(v.key, ':', 1), split_part(v.key, ':', 2), v.label, v.category, v.scoped, v.ord
from (values
-- @permissions:begin
  ('leads:read', 'View leads', 'core_records', true, 100),
  ('leads:create', 'Create leads', 'core_records', false, 101),
  ('leads:update', 'Edit leads', 'core_records', true, 102),
  ('leads:delete', 'Delete leads', 'core_records', false, 103),
  ('leads:assign', 'Assign leads', 'core_records', false, 104),
  ('accounts:read', 'View accounts', 'core_records', true, 110),
  ('accounts:create', 'Create accounts', 'core_records', false, 111),
  ('accounts:update', 'Edit accounts', 'core_records', true, 112),
  ('accounts:delete', 'Delete accounts', 'core_records', false, 113),
  ('contacts:read', 'View contacts', 'core_records', true, 120),
  ('contacts:create', 'Create contacts', 'core_records', false, 121),
  ('contacts:update', 'Edit contacts', 'core_records', true, 122),
  ('contacts:delete', 'Delete contacts', 'core_records', false, 123),
  ('tasks:read', 'View tasks', 'core_records', true, 130),
  ('tasks:manage', 'Create and edit tasks', 'core_records', false, 131),
  ('notes:read', 'View notes and comments', 'core_records', false, 140),
  ('notes:write', 'Write notes and comments', 'core_records', false, 141),
  ('documents:read', 'View documents', 'core_records', false, 150),
  ('documents:manage', 'Upload and manage documents', 'core_records', false, 151),
  ('attention:read', 'View Attention items', 'core_records', true, 160),
  ('jobs:read', 'View jobs', 'sales', true, 200),
  ('jobs:create', 'Create jobs', 'sales', false, 201),
  ('jobs:update', 'Edit jobs', 'sales', true, 202),
  ('jobs:delete', 'Delete jobs', 'sales', false, 203),
  ('jobs:assign', 'Assign jobs', 'sales', false, 204),
  ('jobs:advance_stage', 'Advance job stages', 'sales', false, 205),
  ('appointments:read', 'View appointments', 'sales', true, 210),
  ('appointments:manage', 'Book and edit appointments', 'sales', false, 211),
  ('estimates:read', 'View estimates', 'sales', true, 220),
  ('estimates:create', 'Build estimates', 'sales', false, 221),
  ('estimates:send', 'Send estimates', 'sales', false, 222),
  ('estimates:approve_discount', 'Approve discounts over the limit', 'sales', false, 223),
  ('messages:read', 'View customer messages', 'sales', true, 230),
  ('messages:send', 'Send customer messages', 'sales', false, 231),
  ('campaigns:manage', 'Manage campaigns and drips', 'sales', false, 240),
  ('referrals:manage', 'Manage referrals', 'sales', false, 241),
  ('reviews:manage', 'Manage review requests', 'sales', false, 242),
  ('schedule:read', 'View the schedule', 'production', false, 300),
  ('schedule:manage', 'Edit the schedule', 'production', false, 301),
  ('schedule:publish', 'Publish schedule changes', 'production', false, 302),
  ('crews:read', 'View crews', 'production', false, 310),
  ('crews:manage', 'Manage crews and subcontractors', 'production', false, 311),
  ('work_orders:read', 'View work orders', 'production', true, 320),
  ('work_orders:manage', 'Manage work orders', 'production', false, 321),
  ('daily_logs:read', 'View daily logs', 'production', true, 330),
  ('daily_logs:create', 'Submit daily logs', 'production', false, 331),
  ('photos:read', 'View job photos', 'production', true, 340),
  ('photos:upload', 'Upload job photos', 'production', false, 341),
  ('photos:delete', 'Delete job photos', 'production', false, 342),
  ('paint_orders:manage', 'Manage paint orders', 'production', false, 350),
  ('punch_list:manage', 'Manage punch lists', 'production', false, 360),
  ('time_entries:create', 'Clock hours', 'production', false, 370),
  ('time_entries:approve', 'Approve hours', 'production', false, 371),
  ('financials:read', 'See contract amounts, billing and payments', 'finance', true, 400),
  ('invoices:read', 'View invoices', 'finance', true, 410),
  ('invoices:edit', 'Create and edit invoices', 'finance', false, 411),
  ('payments:read', 'View payments', 'finance', false, 420),
  ('payments:record', 'Record payments', 'finance', false, 421),
  ('credits:approve', 'Approve credits (incl. On-Time Guarantee)', 'finance', false, 430),
  ('job_costing:read', 'See job costs and margins', 'finance', false, 440),
  ('finance:close_month', 'Close a month', 'finance', false, 450),
  ('reports:read', 'View reports and dashboards', 'data_reporting', false, 500),
  ('reports:build', 'Build and schedule reports', 'data_reporting', false, 501),
  ('analytics:read', 'Use Analytics and Ask Brushy Bear', 'data_reporting', false, 502),
  ('data:export', 'Export data to CSV', 'data_reporting', false, 510),
  ('leads:export', 'Export leads', 'data_reporting', false, 511),
  ('users:read', 'View users', 'operational_control', false, 600),
  ('users:manage', 'Invite, edit and deactivate users', 'operational_control', false, 601),
  ('users:view_as', 'View as another user', 'operational_control', false, 602),
  ('roles:manage', 'Edit roles and permissions', 'operational_control', false, 603),
  ('settings:manage', 'Edit company settings and territories', 'operational_control', false, 610),
  ('picklists:manage', 'Edit field picklists', 'operational_control', false, 611),
  ('workflows:manage', 'Manage workflows', 'operational_control', false, 612),
  ('templates:manage', 'Manage message templates', 'operational_control', false, 613),
  ('integrations:read', 'View integrations and the outbox', 'operational_control', false, 620),
  ('integrations:manage', 'Configure integrations', 'operational_control', false, 621),
  ('audit:read', 'View the audit log', 'operational_control', false, 630),
  ('records:restore', 'Restore deleted records', 'operational_control', false, 640),
  ('records:merge', 'Merge duplicate records', 'operational_control', false, 641),
  ('bulk:update', 'Bulk update records', 'operational_control', false, 642),
  ('job_admin:override', 'Override job stage gates and dates', 'operational_control', false, 650),
  ('hr:read', 'See pay and labor cost', 'hr_sensitive', false, 700),
  ('hr:manage', 'Edit pay and labor cost', 'hr_sensitive', false, 701),
  ('commissions:read', 'View commissions', 'hr_sensitive', true, 710),
  ('commissions:manage', 'Manage commission plans', 'hr_sensitive', false, 711)
-- @permissions:end
) as v(key, label, category, scoped, ord)
on conflict (key) do update
  set label = excluded.label, category = excluded.category,
      supports_scope = excluded.supports_scope, sort_order = excluded.sort_order;

-- =============================================================================
-- Per-org defaults
-- =============================================================================
create or replace function app.seed_org_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ---------------------------------------------------------------------------
  -- Permission packs (SPEC §4.2) and their permissions
  -- ---------------------------------------------------------------------------
  insert into public.permission_packs (org_id, key, name, category, description, is_system, sort_order)
  select p_org, v.key, v.name, v.category, v.description, true, v.ord
  from (values
    ('core_records_all', 'Core records — everyone''s', 'core_records', 'Leads, accounts, contacts, tasks, notes and documents for the whole company.', 10),
    ('core_records_own', 'Core records — own', 'core_records', 'Leads, accounts and contacts the user owns or is assigned to.', 20),
    ('read_everything', 'Read all records', 'core_records', 'View access across modules. No edits, no exports.', 30),
    ('sales_all', 'Sales — everyone''s', 'sales', 'Jobs, appointments, estimates and messages for the whole company, plus campaigns, referrals and reviews.', 40),
    ('sales_own', 'Sales — own', 'sales', 'Own jobs, appointments, estimates and messages; own commissions.', 50),
    ('production_manage', 'Production — manage', 'production', 'Schedule, crews, work orders, paint orders, daily logs, photos, punch lists and hours.', 60),
    ('crew_lead', 'Crew lead', 'production', 'Assigned jobs: scope, colors, photos, daily logs, punch list, hours. No contract amounts.', 70),
    ('field_crew', 'Field crew', 'production', 'Today''s jobs on mobile: scope, colors, photo upload, hours. Nothing financial.', 80),
    ('finance_billing', 'Finance — billing', 'finance', 'Contract amounts, invoices and payments.', 90),
    ('finance_view', 'Finance — view', 'finance', 'See contract amounts, invoices and payments.', 95),
    ('finance_controls', 'Finance — controls', 'finance', 'Job costing, margins and month close.', 100),
    ('reporting', 'Reporting', 'data_reporting', 'Dashboards, Analytics and the report builder.', 110),
    ('reporting_view', 'Reporting — view', 'data_reporting', 'View dashboards and Analytics.', 115),
    ('data_export', 'Data export', 'data_reporting', 'CSV exports (every export is logged).', 120),
    ('approvals', 'Approvals & overrides', 'operational_control', 'Approve discounts and credits; override stage gates.', 130),
    ('administration', 'Administration', 'operational_control', 'Users, roles, settings, picklists, workflows, templates, integrations, audit log and data tools.', 140),
    ('office_admin', 'Office admin', 'operational_control', 'User directory, message templates, integrations view, restore deleted records.', 150),
    ('hr_sensitive', 'HR & sensitive', 'hr_sensitive', 'Pay, labor cost and commission plans.', 160)
  ) as v(key, name, category, description, ord)
  on conflict (org_id, key) do nothing;

  insert into public.pack_permissions (org_id, pack_id, permission, scope)
  select p_org, pk.id, v.perm, v.scope
  from (values
    ('core_records_all', 'leads:read', 'all'), ('core_records_all', 'leads:create', 'all'),
    ('core_records_all', 'leads:update', 'all'), ('core_records_all', 'leads:delete', 'all'),
    ('core_records_all', 'leads:assign', 'all'), ('core_records_all', 'accounts:read', 'all'),
    ('core_records_all', 'accounts:create', 'all'), ('core_records_all', 'accounts:update', 'all'),
    ('core_records_all', 'accounts:delete', 'all'), ('core_records_all', 'contacts:read', 'all'),
    ('core_records_all', 'contacts:create', 'all'), ('core_records_all', 'contacts:update', 'all'),
    ('core_records_all', 'contacts:delete', 'all'), ('core_records_all', 'tasks:read', 'all'),
    ('core_records_all', 'tasks:manage', 'all'), ('core_records_all', 'notes:read', 'all'),
    ('core_records_all', 'notes:write', 'all'), ('core_records_all', 'documents:read', 'all'),
    ('core_records_all', 'documents:manage', 'all'), ('core_records_all', 'attention:read', 'all'),

    ('core_records_own', 'leads:read', 'own'), ('core_records_own', 'leads:create', 'all'),
    ('core_records_own', 'leads:update', 'own'), ('core_records_own', 'accounts:read', 'own'),
    ('core_records_own', 'accounts:create', 'all'), ('core_records_own', 'accounts:update', 'own'),
    ('core_records_own', 'contacts:read', 'own'), ('core_records_own', 'contacts:create', 'all'),
    ('core_records_own', 'contacts:update', 'own'), ('core_records_own', 'tasks:read', 'own'),
    ('core_records_own', 'tasks:manage', 'all'), ('core_records_own', 'notes:read', 'all'),
    ('core_records_own', 'notes:write', 'all'), ('core_records_own', 'documents:read', 'all'),
    ('core_records_own', 'attention:read', 'own'),

    ('read_everything', 'leads:read', 'all'), ('read_everything', 'accounts:read', 'all'),
    ('read_everything', 'contacts:read', 'all'), ('read_everything', 'tasks:read', 'all'),
    ('read_everything', 'notes:read', 'all'), ('read_everything', 'documents:read', 'all'),
    ('read_everything', 'attention:read', 'all'), ('read_everything', 'jobs:read', 'all'),
    ('read_everything', 'appointments:read', 'all'), ('read_everything', 'estimates:read', 'all'),
    ('read_everything', 'messages:read', 'all'), ('read_everything', 'schedule:read', 'all'),
    ('read_everything', 'crews:read', 'all'), ('read_everything', 'work_orders:read', 'all'),
    ('read_everything', 'daily_logs:read', 'all'), ('read_everything', 'photos:read', 'all'),
    ('read_everything', 'users:read', 'all'),

    ('sales_all', 'jobs:read', 'all'), ('sales_all', 'jobs:create', 'all'),
    ('sales_all', 'jobs:update', 'all'), ('sales_all', 'jobs:delete', 'all'),
    ('sales_all', 'jobs:assign', 'all'), ('sales_all', 'jobs:advance_stage', 'all'),
    ('sales_all', 'appointments:read', 'all'), ('sales_all', 'appointments:manage', 'all'),
    ('sales_all', 'estimates:read', 'all'), ('sales_all', 'estimates:create', 'all'),
    ('sales_all', 'estimates:send', 'all'), ('sales_all', 'messages:read', 'all'),
    ('sales_all', 'messages:send', 'all'), ('sales_all', 'campaigns:manage', 'all'),
    ('sales_all', 'referrals:manage', 'all'), ('sales_all', 'reviews:manage', 'all'),

    ('sales_own', 'jobs:read', 'own'), ('sales_own', 'jobs:create', 'all'),
    ('sales_own', 'jobs:update', 'own'), ('sales_own', 'jobs:advance_stage', 'all'),
    ('sales_own', 'appointments:read', 'own'), ('sales_own', 'appointments:manage', 'all'),
    ('sales_own', 'estimates:read', 'own'), ('sales_own', 'estimates:create', 'all'),
    ('sales_own', 'estimates:send', 'all'), ('sales_own', 'messages:read', 'own'),
    ('sales_own', 'messages:send', 'all'), ('sales_own', 'commissions:read', 'own'),

    ('production_manage', 'schedule:read', 'all'), ('production_manage', 'schedule:manage', 'all'),
    ('production_manage', 'schedule:publish', 'all'), ('production_manage', 'crews:read', 'all'),
    ('production_manage', 'crews:manage', 'all'), ('production_manage', 'work_orders:read', 'all'),
    ('production_manage', 'work_orders:manage', 'all'), ('production_manage', 'daily_logs:read', 'all'),
    ('production_manage', 'daily_logs:create', 'all'), ('production_manage', 'photos:read', 'all'),
    ('production_manage', 'photos:upload', 'all'), ('production_manage', 'photos:delete', 'all'),
    ('production_manage', 'paint_orders:manage', 'all'), ('production_manage', 'punch_list:manage', 'all'),
    ('production_manage', 'time_entries:create', 'all'), ('production_manage', 'time_entries:approve', 'all'),

    ('crew_lead', 'jobs:read', 'own'), ('crew_lead', 'appointments:read', 'own'),
    ('crew_lead', 'contacts:read', 'own'), ('crew_lead', 'schedule:read', 'all'),
    ('crew_lead', 'crews:read', 'all'), ('crew_lead', 'work_orders:read', 'own'),
    ('crew_lead', 'daily_logs:read', 'own'), ('crew_lead', 'daily_logs:create', 'all'),
    ('crew_lead', 'photos:read', 'own'), ('crew_lead', 'photos:upload', 'all'),
    ('crew_lead', 'punch_list:manage', 'all'), ('crew_lead', 'time_entries:create', 'all'),
    ('crew_lead', 'documents:read', 'all'), ('crew_lead', 'notes:read', 'all'),
    ('crew_lead', 'notes:write', 'all'), ('crew_lead', 'tasks:read', 'own'),
    ('crew_lead', 'tasks:manage', 'all'),

    ('field_crew', 'jobs:read', 'own'), ('field_crew', 'schedule:read', 'all'),
    ('field_crew', 'work_orders:read', 'own'), ('field_crew', 'daily_logs:read', 'own'),
    ('field_crew', 'photos:read', 'own'), ('field_crew', 'photos:upload', 'all'),
    ('field_crew', 'time_entries:create', 'all'), ('field_crew', 'documents:read', 'all'),

    ('finance_billing', 'financials:read', 'all'), ('finance_billing', 'invoices:read', 'all'),
    ('finance_billing', 'invoices:edit', 'all'), ('finance_billing', 'payments:read', 'all'),
    ('finance_billing', 'payments:record', 'all'),

    ('finance_view', 'financials:read', 'all'), ('finance_view', 'invoices:read', 'all'),
    ('finance_view', 'payments:read', 'all'),

    ('finance_controls', 'job_costing:read', 'all'), ('finance_controls', 'finance:close_month', 'all'),

    ('reporting', 'reports:read', 'all'), ('reporting', 'reports:build', 'all'),
    ('reporting', 'analytics:read', 'all'),
    ('reporting_view', 'reports:read', 'all'), ('reporting_view', 'analytics:read', 'all'),

    ('data_export', 'data:export', 'all'), ('data_export', 'leads:export', 'all'),

    ('approvals', 'estimates:approve_discount', 'all'), ('approvals', 'credits:approve', 'all'),
    ('approvals', 'job_admin:override', 'all'),

    ('administration', 'users:read', 'all'), ('administration', 'users:manage', 'all'),
    ('administration', 'users:view_as', 'all'), ('administration', 'roles:manage', 'all'),
    ('administration', 'settings:manage', 'all'), ('administration', 'picklists:manage', 'all'),
    ('administration', 'workflows:manage', 'all'), ('administration', 'templates:manage', 'all'),
    ('administration', 'integrations:read', 'all'), ('administration', 'integrations:manage', 'all'),
    ('administration', 'audit:read', 'all'), ('administration', 'records:restore', 'all'),
    ('administration', 'records:merge', 'all'), ('administration', 'bulk:update', 'all'),

    ('office_admin', 'users:read', 'all'), ('office_admin', 'templates:manage', 'all'),
    ('office_admin', 'integrations:read', 'all'), ('office_admin', 'records:restore', 'all'),

    ('hr_sensitive', 'hr:read', 'all'), ('hr_sensitive', 'hr:manage', 'all'),
    ('hr_sensitive', 'commissions:read', 'all'), ('hr_sensitive', 'commissions:manage', 'all')
  ) as v(pack, perm, scope)
  join public.permission_packs pk on pk.org_id = p_org and pk.key = v.pack
  on conflict (pack_id, permission) do nothing;

  -- ---------------------------------------------------------------------------
  -- Role templates (SPEC §4.1)
  -- ---------------------------------------------------------------------------
  insert into public.role_templates (org_id, key, name, description, is_system, grants_all, requires_mfa, is_crew, sort_order)
  select p_org, v.key, v.name, v.description, true, v.grants_all, v.mfa, v.crew, v.ord
  from (values
    ('owner', 'Owner', 'Everything, including financials, margins, settings, permissions and View as user.', true, true, false, 10),
    ('office_manager', 'Office Manager', 'All leads, jobs, schedule, invoices and payments. No permission editing; no margins.', false, false, false, 20),
    ('estimator', 'Estimator / Sales', 'Own and assigned leads and jobs; builds and sends estimates; own numbers and commissions.', false, false, false, 30),
    ('project_manager', 'Project Manager / Crew Lead', 'Assigned jobs from scheduled to completed. No contract amounts or margins.', false, false, true, 40),
    ('painter', 'Painter (Crew Member)', 'Today''s jobs on mobile: address, access notes, scope, colors, photos, hours. Nothing financial.', false, false, true, 50),
    ('subcontractor', 'Subcontractor', 'Like Painter, limited to their company''s jobs and work orders, plus compliance documents.', false, false, true, 60),
    ('bookkeeper', 'Bookkeeper', 'Invoices, payments, A/R, job costing and exports. Read-only on everything else.', false, true, false, 70),
    ('read_only', 'Read-only', 'Dashboards and records. No edits, no PII exports.', false, false, false, 80)
  ) as v(key, name, description, grants_all, mfa, crew, ord)
  on conflict (org_id, key) do nothing;

  insert into public.template_packs (org_id, template_id, pack_id)
  select p_org, t.id, pk.id
  from (values
    ('office_manager', 'core_records_all'), ('office_manager', 'sales_all'),
    ('office_manager', 'production_manage'), ('office_manager', 'finance_billing'),
    ('office_manager', 'reporting'), ('office_manager', 'office_admin'),
    ('estimator', 'core_records_own'), ('estimator', 'sales_own'),
    ('project_manager', 'crew_lead'),
    ('painter', 'field_crew'),
    ('subcontractor', 'field_crew'),
    ('bookkeeper', 'finance_billing'), ('bookkeeper', 'finance_controls'),
    ('bookkeeper', 'data_export'), ('bookkeeper', 'reporting'), ('bookkeeper', 'read_everything'),
    ('read_only', 'read_everything'), ('read_only', 'reporting_view'), ('read_only', 'finance_view')
  ) as v(template, pack)
  join public.role_templates t on t.org_id = p_org and t.key = v.template
  join public.permission_packs pk on pk.org_id = p_org and pk.key = v.pack
  on conflict (template_id, pack_id) do nothing;

  -- ---------------------------------------------------------------------------
  -- Territories + ZIPs (SPEC §5.1 — owners to verify the ZIP lists)
  -- ---------------------------------------------------------------------------
  insert into public.territories (org_id, name, zip_codes, is_service_area, sort_order)
  select p_org, v.name, v.zips, v.service, v.ord
  from (values
    ('Bellevue', array['98004', '98005', '98006', '98007', '98008'], true, 10),
    ('Kirkland', array['98033', '98034'], true, 20),
    ('Redmond', array['98052', '98053'], true, 30),
    ('Sammamish', array['98074', '98075'], true, 40),
    ('Issaquah', array['98027', '98029'], true, 50),
    ('Outside service area', array[]::text[], false, 90)
  ) as v(name, zips, service, ord)
  where not exists (
    select 1 from public.territories t where t.org_id = p_org and lower(t.name) = lower(v.name)
  );

  -- ---------------------------------------------------------------------------
  -- Company settings (placeholders until the owners provide real values)
  -- ---------------------------------------------------------------------------
  insert into public.company_settings (
    org_id, company_name, tagline, website_url, service_area_note, business_hours
  ) values (
    p_org,
    'Brushy Bear Painters',
    'Eastside house painting that holds up to the rain.',
    'https://brushybear.vercel.app',
    'Near one of these cities but not in it? Ask us.',
    jsonb_build_object(
      'mon', jsonb_build_object('open', '08:00', 'close', '17:00'),
      'tue', jsonb_build_object('open', '08:00', 'close', '17:00'),
      'wed', jsonb_build_object('open', '08:00', 'close', '17:00'),
      'thu', jsonb_build_object('open', '08:00', 'close', '17:00'),
      'fri', jsonb_build_object('open', '08:00', 'close', '17:00'),
      'sat', jsonb_build_object('by_appointment', true),
      'sun', null
    )
  )
  on conflict (org_id) do nothing;

  -- ---------------------------------------------------------------------------
  -- Picklists (SPEC §15.1)
  -- ---------------------------------------------------------------------------
  insert into public.picklists (org_id, key, name, module, description, is_system)
  select p_org, v.key, v.name, v.module, v.description, true
  from (values
    ('lead_source', 'Lead Source', 'leads', 'Where a lead came from.'),
    ('lead_sub_source', 'Lead Sub-source', 'leads', 'Detail under a lead source (e.g. Website → Google Ads).'),
    ('lead_disposition', 'Lead Disposition', 'leads', 'Outcome of the latest contact attempt.'),
    ('work_type', 'Work Type', 'jobs', 'Kind of painting work.'),
    ('property_type', 'Property Type', 'properties', 'Kind of home or building.'),
    ('siding_type', 'Siding Type', 'properties', 'Exterior siding material (drives prep and product).'),
    ('lost_reason', 'Lost Reason', 'jobs', 'Why a job was lost. Required for Closed Lost.'),
    ('hold_type', 'Hold Type', 'jobs', 'Reasons a job is on hold.'),
    ('paint_brand', 'Paint Brand', 'estimates', 'Paint manufacturers.'),
    ('sheen', 'Sheen', 'estimates', 'Paint sheens.')
  ) as v(key, name, module, description)
  on conflict (org_id, key) do nothing;

  update public.picklists c set parent_picklist_id = p.id
  from public.picklists p
  where c.org_id = p_org and p.org_id = p_org
    and c.key = 'lead_sub_source' and p.key = 'lead_source' and c.parent_picklist_id is null;

  insert into public.picklist_values (org_id, picklist_id, value, label, category, sort_order, is_system)
  select p_org, pl.id, v.value, v.label, v.category, v.ord, true
  from (values
    ('lead_source', 'website', 'Website', null, 10),
    ('lead_source', 'google_ads', 'Google Ads', null, 20),
    ('lead_source', 'google_business_profile', 'Google Business Profile', null, 30),
    ('lead_source', 'local_services_ads', 'Local Services Ads', null, 40),
    ('lead_source', 'facebook_instagram', 'Facebook/Instagram', null, 50),
    ('lead_source', 'nextdoor', 'Nextdoor', null, 60),
    ('lead_source', 'yelp', 'Yelp', null, 70),
    ('lead_source', 'angi', 'Angi', null, 80),
    ('lead_source', 'thumbtack', 'Thumbtack', null, 90),
    ('lead_source', 'customer_referral', 'Customer Referral', null, 100),
    ('lead_source', 'past_customer', 'Past Customer (Repeat)', null, 110),
    ('lead_source', 'neighbor_jobsite_sign', 'Neighbor/Job-site Sign', null, 120),
    ('lead_source', 'yard_sign', 'Yard Sign', null, 130),
    ('lead_source', 'vehicle_truck', 'Vehicle/Truck', null, 140),
    ('lead_source', 'door_hanger_flyer', 'Door Hanger/Flyer', null, 150),
    ('lead_source', 'realtor_property_manager', 'Realtor/Property Manager', null, 160),
    ('lead_source', 'home_show_event', 'Home Show/Event', null, 170),
    ('lead_source', 'partner_vendor_referral', 'Partner/Vendor Referral', null, 180),
    ('lead_source', 'other', 'Other', null, 190),

    ('lead_sub_source', 'organic', 'Organic', null, 10),
    ('lead_sub_source', 'google_ads', 'Google Ads', null, 20),
    ('lead_sub_source', 'google_business_profile', 'Google Business Profile', null, 30),
    ('lead_sub_source', 'local_services_ads', 'Local Services Ads', null, 40),
    ('lead_sub_source', 'facebook_instagram', 'Facebook/Instagram', null, 50),
    ('lead_sub_source', 'nextdoor', 'Nextdoor', null, 60),
    ('lead_sub_source', 'yelp', 'Yelp', null, 70),
    ('lead_sub_source', 'referral_link', 'Referral link', null, 80),
    ('lead_sub_source', 'direct', 'Direct', null, 90),

    ('lead_disposition', 'walkthrough_scheduled', 'Walkthrough scheduled', 'positive', 10),
    ('lead_disposition', 'call_back', 'Call back', 'callback', 20),
    ('lead_disposition', 'just_planning', 'Just planning', 'callback', 30),
    ('lead_disposition', 'no_answer', 'No answer', 'no_contact', 40),
    ('lead_disposition', 'left_voicemail', 'Left voicemail', 'no_contact', 50),
    ('lead_disposition', 'texted_no_reply', 'Texted, no reply', 'no_contact', 60),
    ('lead_disposition', 'not_interested', 'Not interested', 'negative', 70),
    ('lead_disposition', 'out_of_area', 'Out of area', 'negative', 80),
    ('lead_disposition', 'price_shopping', 'Price shopping', 'negative', 90),
    ('lead_disposition', 'diy', 'DIY', 'negative', 100),
    ('lead_disposition', 'hired_someone_else', 'Hired someone else', 'negative', 110),
    ('lead_disposition', 'wrong_number', 'Wrong number', 'negative', 120),
    ('lead_disposition', 'do_not_contact', 'Do not contact', 'negative', 130),

    ('work_type', 'interior', 'Interior', null, 10),
    ('work_type', 'exterior', 'Exterior', null, 20),
    ('work_type', 'cabinets', 'Cabinets', null, 30),
    ('work_type', 'deck_fence', 'Deck & Fence', null, 40),
    ('work_type', 'add_on_only', 'Add-on Only', null, 50),
    ('work_type', 'warranty_touch_up', 'Warranty/Touch-up', null, 60),

    ('property_type', 'single_family', 'Single-family', null, 10),
    ('property_type', 'townhome', 'Townhome', null, 20),
    ('property_type', 'condo', 'Condo', null, 30),
    ('property_type', 'multi_family', 'Multi-family', null, 40),
    ('property_type', 'commercial', 'Commercial', null, 50),

    ('siding_type', 'cedar_wood', 'Cedar/Wood', null, 10),
    ('siding_type', 'fiber_cement', 'Fiber-cement', null, 20),
    ('siding_type', 'vinyl', 'Vinyl', null, 30),
    ('siding_type', 'stucco', 'Stucco', null, 40),
    ('siding_type', 'brick_masonry', 'Brick/Masonry', null, 50),
    ('siding_type', 'mixed', 'Mixed', null, 60),
    ('siding_type', 'other', 'Other', null, 70),

    ('lost_reason', 'price', 'Price', null, 10),
    ('lost_reason', 'timing', 'Timing', null, 20),
    ('lost_reason', 'chose_competitor', 'Chose competitor', null, 30),
    ('lost_reason', 'diy', 'DIY', null, 40),
    ('lost_reason', 'no_response', 'No response', null, 50),
    ('lost_reason', 'out_of_area', 'Out of area', null, 60),
    ('lost_reason', 'scope_not_a_fit', 'Scope not a fit', null, 70),
    ('lost_reason', 'other', 'Other', null, 80),

    ('hold_type', 'deposit', 'Deposit Hold', null, 10),
    ('hold_type', 'hoa', 'HOA Hold', null, 20),
    ('hold_type', 'lead_safe', 'Lead-Safe Hold', null, 30),
    ('hold_type', 'weather', 'Weather Hold', null, 40),
    ('hold_type', 'customer', 'Customer Hold', null, 50),
    ('hold_type', 'color', 'Color Hold', null, 60),
    ('hold_type', 'repair_approval', 'Repair Approval Hold', null, 70),
    ('hold_type', 'materials', 'Materials Hold', null, 80),
    ('hold_type', 'other', 'Other Hold', null, 90),

    ('paint_brand', 'sherwin_williams', 'Sherwin-Williams', null, 10),
    ('paint_brand', 'benjamin_moore', 'Benjamin Moore', null, 20),
    ('paint_brand', 'miller_paint', 'Miller Paint', null, 30),
    ('paint_brand', 'ppg', 'PPG', null, 40),
    ('paint_brand', 'behr', 'Behr', null, 50),
    ('paint_brand', 'other', 'Other', null, 60),

    ('sheen', 'flat', 'Flat', null, 10),
    ('sheen', 'matte', 'Matte', null, 20),
    ('sheen', 'eggshell', 'Eggshell', null, 30),
    ('sheen', 'satin', 'Satin', null, 40),
    ('sheen', 'semi_gloss', 'Semi-gloss', null, 50),
    ('sheen', 'gloss', 'Gloss', null, 60)
  ) as v(picklist, value, label, category, ord)
  join public.picklists pl on pl.org_id = p_org and pl.key = v.picklist
  on conflict (picklist_id, value) do nothing;

  -- Website sub-sources hang under the Website source (SPEC §14.4).
  update public.picklist_values sv set parent_value_id = src.id
  from public.picklists sp, public.picklist_values src, public.picklists srcl
  where sv.picklist_id = sp.id and sp.org_id = p_org and sp.key = 'lead_sub_source'
    and src.picklist_id = srcl.id and srcl.org_id = p_org and srcl.key = 'lead_source'
    and src.value = 'website' and sv.parent_value_id is null;

  -- ---------------------------------------------------------------------------
  -- Integration connections: all 11 domains, all disconnected (SPEC §2.1)
  -- ---------------------------------------------------------------------------
  insert into public.integration_connections (org_id, domain, provider, status)
  select p_org, v.domain, v.provider, 'not_connected'
  from (values
    ('sms_voice', 'outbox'), ('email', 'outbox'), ('calendar', 'outbox'),
    ('accounting', 'outbox'), ('payments', 'outbox'), ('esign', 'builtin'),
    ('geo', 'outbox'), ('weather', 'outbox'), ('photos', 'outbox'),
    ('reviews', 'outbox'), ('ai', 'disabled')
  ) as v(domain, provider)
  on conflict (org_id, domain) do nothing;
end;
$$;
revoke execute on function app.seed_org_defaults(uuid) from public, anon, authenticated;

-- Bootstrap the Brushy Bear org (real configuration, SPEC §15.1) and seed every org.
insert into public.organizations (name, slug, timezone)
values ('Brushy Bear Painters', 'brushy-bear', 'America/Los_Angeles')
on conflict (slug) do nothing;

select app.seed_org_defaults(id) from public.organizations;
