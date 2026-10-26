-- Restores soft_delete_record() without the per-record scope check.
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

drop function if exists app.record_in_edit_scope(text, uuid);
