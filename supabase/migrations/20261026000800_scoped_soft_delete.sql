-- Deleting a lead, account, contact or property also needs edit rights on that
-- record. soft_delete_record() runs as SECURITY DEFINER (row security doesn't
-- apply inside it), so before this it only checked the delete permission: a
-- custom grant of `leads:delete` would have let someone delete leads outside
-- their own scope. Records outside scope answer "Record not found." so the
-- function doesn't reveal that they exist.

create or replace function app.record_in_edit_scope(p_table text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_table
    when 'leads' then exists (
      select 1 from public.leads r
      where r.id = p_id and r.org_id = app.current_org_id() and r.deleted_at is null
        and app.scope_match(app.perm_scope('leads:update'), r.owner_id, r.created_by, r.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'accounts' then exists (
      select 1 from public.accounts r
      where r.id = p_id and r.org_id = app.current_org_id() and r.deleted_at is null
        and app.scope_match(app.perm_scope('accounts:update'), r.owner_id, r.created_by, r.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'contacts' then exists (
      select 1 from public.contacts r join public.accounts a on a.id = r.account_id
      where r.id = p_id and r.org_id = app.current_org_id() and r.deleted_at is null
        and app.scope_match(app.perm_scope('contacts:update'), a.owner_id, a.created_by, a.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'properties' then exists (
      select 1 from public.properties r join public.accounts a on a.id = r.account_id
      where r.id = p_id and r.org_id = app.current_org_id() and r.deleted_at is null
        and app.scope_match(app.perm_scope('accounts:update'), a.owner_id, a.created_by, a.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    else true
  end;
$$;

revoke all on function app.record_in_edit_scope(text, uuid) from public, anon, authenticated;

create or replace function public.soft_delete_record(p_table text, p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perm text := app.soft_delete_permission(p_table);
  v_org uuid := app.current_org_id();
  v_count integer;
begin
  if v_perm is null then
    raise exception 'Records in % cannot be deleted here.', p_table using errcode = '22023';
  end if;
  if v_org is null or not app.can_write(v_perm) then
    raise exception 'You do not have permission to delete this record.' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  if not app.record_in_edit_scope(p_table, p_id) then
    raise exception 'Record not found.' using errcode = 'P0002';
  end if;
  if p_table = 'role_templates' then
    if exists (select 1 from public.role_templates where id = p_id and is_system) then
      raise exception 'Built-in templates cannot be deleted.' using errcode = '42501';
    end if;
    if exists (select 1 from public.profiles where role_template_id = p_id) then
      raise exception 'Move the users on this template to another template first.' using errcode = '23503';
    end if;
  elsif p_table = 'permission_packs' and exists (select 1 from public.permission_packs where id = p_id and is_system) then
    raise exception 'Built-in packs cannot be deleted.' using errcode = '42501';
  end if;

  execute format(
    'update public.%I set deleted_at = now(), deleted_by = $1, delete_reason = $2 where id = $3 and org_id = $4 and deleted_at is null',
    p_table)
  using app.actor_id(), btrim(p_reason), p_id, v_org;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Record not found.' using errcode = 'P0002';
  end if;
end;
$$;
