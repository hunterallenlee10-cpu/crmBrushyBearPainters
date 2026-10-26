-- Reverses supabase/migrations/20261026000300_platform_seed.sql
-- Destructive: removes seeded configuration. Owner approval required outside local dev.

drop function if exists app.seed_org_defaults(uuid);
delete from public.integration_connections;
delete from public.picklist_values;
delete from public.picklists;
delete from public.company_settings;
delete from public.territories;
delete from public.template_packs;
delete from public.role_templates where not exists (select 1 from public.profiles p where p.role_template_id = role_templates.id);
delete from public.pack_permissions;
delete from public.permission_packs;
delete from public.permissions;
