-- 1. Soft-deleting your own note or comment. A plain UPDATE setting
--    deleted_at fails row security: the new row must still pass the SELECT
--    policy (deleted_at is null). This function does the same checks the
--    policies would (same company, the author, notes:write, not viewing as
--    someone else) and sets deleted_at. Audit and events come from triggers.
-- 2. @mention notifications on job comments link to the job's Notes section.

create or replace function public.soft_delete_post(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_table not in ('notes', 'comments') then
    raise exception 'Only notes and comments can be deleted here.' using errcode = '22023';
  end if;
  if app.current_org_id() is null or not app.can_write('notes:write') then
    raise exception 'You do not have permission to delete this.' using errcode = '42501';
  end if;
  execute format(
    'update public.%I set deleted_at = now() where id = $1 and org_id = $2 and created_by = $3 and deleted_at is null',
    p_table)
  using p_id, app.current_org_id(), auth.uid();
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'You can only delete your own notes and comments.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.soft_delete_post(text, uuid) from public, anon;
grant execute on function public.soft_delete_post(text, uuid) to authenticated;

create or replace function app.comments_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author text;
  v_link text := case new.subject_type
    when 'lead' then '/leads/' || new.subject_id
    when 'account' then '/accounts/' || new.subject_id
    when 'contact' then '/contacts/' || new.subject_id
    when 'job' then '/jobs/' || new.subject_id || '?section=notes'
  end;
begin
  select p.full_name into v_author from public.profiles p where p.id = new.created_by;
  insert into public.notifications (org_id, user_id, type, title, body, link)
  select new.org_id, m.id, 'mention',
         coalesce(v_author, 'Someone') || ' mentioned you',
         left(new.body, 200), v_link
  from (
    select distinct unnest(new.mentions) as id
    except
    select unnest(case when tg_op = 'UPDATE' then old.mentions else '{}'::uuid[] end)
  ) m
  where m.id is distinct from new.created_by;
  return null;
end;
$$;
