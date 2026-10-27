-- Removes soft_delete_post() and restores the Phase 2 mention links.
drop function if exists public.soft_delete_post(text, uuid);

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
