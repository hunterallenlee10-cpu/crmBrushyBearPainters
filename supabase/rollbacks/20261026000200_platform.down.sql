-- Reverses supabase/migrations/20261026000200_platform.sql
-- Destructive: drops users/profiles, permissions, settings, picklists, audit log and more.
-- Owner approval required outside local dev.

drop function if exists public.open_work_counts(uuid);
drop function if exists public.reorder_picklist_values(uuid, uuid[]);
drop function if exists public.list_deleted_records();
drop function if exists public.restore_record(text, uuid);
drop function if exists public.soft_delete_record(text, uuid, text);
drop function if exists app.soft_delete_permission(text);
drop function if exists public.integration_summary();
drop function if exists public.stop_view_as();
drop function if exists public.start_view_as(uuid);
drop function if exists public.my_access();

drop table if exists app.impersonation_sessions;
drop table if exists public.integration_outbox;
drop table if exists public.integration_connections;
drop table if exists public.events;
drop table if exists public.activity;
alter table public.audit_log disable trigger audit_log_append_only;
drop table if exists public.audit_log;
drop table if exists public.picklist_values;
drop table if exists public.picklists;
drop table if exists public.company_settings;
drop table if exists public.user_permission_overrides;
drop table if exists public.profile_compensation;
drop table if exists public.profiles;
drop table if exists public.territories;
drop table if exists public.template_packs;
drop table if exists public.pack_permissions;
drop table if exists public.permission_packs;
drop table if exists public.role_templates;
drop table if exists public.permissions;

drop trigger if exists organizations_audit on public.organizations;
drop trigger if exists organizations_event on public.organizations;
drop policy if exists organizations_select on public.organizations;
drop policy if exists organizations_update on public.organizations;

drop function if exists app.deny_change();
drop function if exists app.integration_connections_guard();
drop function if exists app.same_org_profile();
drop function if exists app.territory_for_zip(uuid, text);
drop function if exists app.territories_guard();
drop function if exists app.picklist_values_guard();
drop function if exists app.overrides_guard();
drop function if exists app.permission_packs_guard();
drop function if exists app.pack_permissions_guard();
drop function if exists app.template_packs_guard();
drop function if exists app.role_templates_guard();
drop function if exists app.ensure_active_owner();
drop function if exists app.profiles_guard();
drop function if exists app.can_read_subject(text);
drop function if exists app.stamp_actor();
drop function if exists app.log_activity(uuid, text, text, text, text, jsonb);
drop function if exists app.emit_change_event();
drop function if exists app.emit_event(uuid, text, text, text, jsonb, text);
drop function if exists app.audit_row();
drop function if exists app.client_ip();
drop function if exists app.impersonator_id();
drop function if exists app.actor_id();
drop function if exists app.request_header(text);
drop function if exists app.is_grants_all_user(uuid);
drop function if exists app.real_has_perm(text);
drop function if exists app.can_write(text);
drop function if exists app.has_perm(text);
drop function if exists app.perm_scope(text);
drop function if exists app.user_perm_scope(uuid, text);
drop function if exists app.is_impersonating();
drop function if exists app.effective_user_id();
drop function if exists app.current_org_id();
drop function if exists app.session_ok();
drop function if exists app.is_trusted();
drop function if exists app.all_zips_valid(text[]);
