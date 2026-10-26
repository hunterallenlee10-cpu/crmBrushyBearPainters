-- Reverses supabase/migrations/20261026000600_leads_customers.sql.
-- DESTRUCTIVE: drops every lead, account, contact, property, note, comment, task,
-- message, notification and saved view. Owner approval required outside local dev.

-- Phase 1 versions of replaced functions and the activity policy.
drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity for select to authenticated
  using (org_id = (select app.current_org_id()) and app.can_read_subject(subject_type));

create or replace function app.soft_delete_permission(p_table text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'territories' then 'settings:manage'
    when 'role_templates' then 'roles:manage'
    when 'permission_packs' then 'roles:manage'
  end;
$$;

create or replace function public.list_deleted_records()
returns table (
  table_name text, record_id uuid, label text, deleted_at timestamptz,
  deleted_by uuid, deleted_by_name text, delete_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := app.current_org_id();
begin
  if v_org is null or not app.has_perm('records:restore') then
    raise exception 'You do not have permission to view deleted records.' using errcode = '42501';
  end if;
  return query
    select d.table_name, d.record_id, d.label, d.deleted_at, d.deleted_by, p.full_name, d.delete_reason
    from (
      select 'territories'::text as table_name, t.id as record_id, t.name as label, t.deleted_at, t.deleted_by, t.delete_reason
      from public.territories t where t.org_id = v_org and t.deleted_at is not null
      union all
      select 'role_templates', r.id, r.name, r.deleted_at, r.deleted_by, r.delete_reason
      from public.role_templates r where r.org_id = v_org and r.deleted_at is not null
      union all
      select 'permission_packs', k.id, k.name, k.deleted_at, k.deleted_by, k.delete_reason
      from public.permission_packs k where k.org_id = v_org and k.deleted_at is not null
    ) d
    left join public.profiles p on p.id = d.deleted_by
    order by d.deleted_at desc;
end;
$$;

create or replace function public.open_work_counts(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.current_org_id() is null or not app.has_perm('users:manage') then
    raise exception 'You do not have permission to manage users.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and org_id = app.current_org_id()) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  return '{}'::jsonb;
end;
$$;

drop function if exists public.search_records(text, text, integer);
drop function if exists public.lead_stats(timestamptz);
drop function if exists public.lead_status_counts();
drop function if exists app.seed_leads_defaults(uuid);

-- The private 'lead-attachments' Storage bucket is left in place: Supabase blocks deleting
-- buckets from SQL. Empty and delete it from the Storage dashboard if it is no longer wanted.

drop table if exists public.rate_limits;
drop table if exists public.intake_requests;
drop table if exists public.lead_scoring_rules;
drop table if exists public.saved_views;
drop table if exists public.notifications;
drop table if exists public.messages;
drop table if exists public.tasks;
drop table if exists public.comments;
drop table if exists public.notes;
drop table if exists public.lead_attachments;
drop table if exists public.leads;
drop table if exists public.property_secrets;
drop table if exists public.properties;
alter table if exists public.accounts drop constraint if exists accounts_primary_contact_fk;
drop table if exists public.contacts;
drop table if exists public.accounts;

drop function if exists app.can_read_activity(text, text);
drop function if exists app.can_edit_subject(text, uuid);
drop function if exists app.can_see_subject(text, uuid);
drop function if exists app.consume_rate_limit(text, integer, integer);
drop function if exists app.deny_write();
drop function if exists app.stamp_creator();
drop function if exists app.leads_activity();
drop function if exists app.touch_lead_activity();
drop function if exists app.messages_guard();
drop function if exists app.tasks_guard();
drop function if exists app.comments_notify();
drop function if exists app.comments_guard();
drop function if exists app.subject_guard();
drop function if exists app.subject_table(text);
drop function if exists app.property_secrets_guard();
drop function if exists app.properties_sync_account();
drop function if exists app.properties_guard();
drop function if exists app.contacts_guard();
drop function if exists app.accounts_guard();
drop function if exists app.leads_guard();
drop function if exists app.check_same_org(uuid, text, uuid, text);
drop function if exists app.is_email(text);
drop function if exists app.is_e164(text);
drop function if exists app.check_picklist(uuid, text, text, text);
drop function if exists app.picklist_value_exists(uuid, text, text);
drop function if exists app.scope_match(text, uuid, uuid, uuid, uuid, uuid);
drop function if exists app.my_territory_id();

delete from public.user_permission_overrides where permission = 'properties:view_access_codes';
delete from public.pack_permissions where permission = 'properties:view_access_codes';
delete from public.permissions where key = 'properties:view_access_codes';
-- pg_trgm is left installed (harmless, and other objects may use it).
