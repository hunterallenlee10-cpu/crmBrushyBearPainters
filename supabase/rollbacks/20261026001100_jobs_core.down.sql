-- Rolls back Phase 3 jobs core. DESTROYS jobs, holds, team, stage history,
-- appointments, approvals and attention data. Owner approval required.
-- Notes/comments/tasks/messages that were moved onto jobs are deleted first
-- (their subject type no longer exists afterwards).

delete from app.number_sequences where kind = 'job';
alter table public.notes disable trigger user;
alter table public.comments disable trigger user;
alter table public.tasks disable trigger user;
alter table public.messages disable trigger user;
delete from public.notes where subject_type = 'job';
delete from public.comments where subject_type = 'job';
delete from public.tasks where subject_type = 'job';
delete from public.messages where subject_type = 'job';
alter table public.notes enable trigger user;
alter table public.comments enable trigger user;
alter table public.tasks enable trigger user;
alter table public.messages enable trigger user;
delete from public.activity where subject_type = 'job';

alter table public.notes drop constraint notes_subject_type_check,
  add constraint notes_subject_type_check check (subject_type in ('lead', 'account', 'contact'));
alter table public.comments drop constraint comments_subject_type_check,
  add constraint comments_subject_type_check check (subject_type in ('lead', 'account', 'contact'));
alter table public.tasks drop constraint tasks_subject_type_check,
  add constraint tasks_subject_type_check check (subject_type in ('lead', 'account', 'contact'));
alter table public.messages drop constraint messages_subject_type_check,
  add constraint messages_subject_type_check check (subject_type in ('lead', 'account', 'contact'));

drop function if exists public.apply_job_stage_change(uuid, text, text, boolean, text, text, jsonb, uuid);
drop function if exists public.convert_lead_to_job(uuid, text[]);
drop function if exists public.job_status_counts();
drop function if exists public.job_stats(timestamptz, timestamptz, timestamptz);
drop function if exists public.attention_summary();
drop function if exists app.job_gate_passes(uuid, text);
drop function if exists app.seed_jobs_defaults(uuid);

update public.leads set converted_job_id = null where converted_job_id is not null;
alter table public.leads drop constraint if exists leads_converted_job_fk;
drop index if exists public.leads_converted_job_idx;

drop table if exists public.attention_items;
drop table if exists public.attention_rules;
drop table if exists public.approval_requests;
drop table if exists public.appointments;
drop table if exists public.stage_history;
drop table if exists public.job_team;
drop table if exists public.job_holds;
drop table if exists public.job_financials;
drop table if exists public.jobs;

drop function if exists app.jobs_guard();
drop function if exists app.jobs_after_insert();
drop function if exists app.jobs_activity();
drop function if exists app.job_financials_guard();
drop function if exists app.job_holds_guard();
drop function if exists app.job_holds_after();
drop function if exists app.job_team_guard();
drop function if exists app.job_team_after();
drop function if exists app.job_team_ids(uuid, uuid, uuid, uuid);
drop function if exists app.appointments_guard();
drop function if exists app.appointments_after();
drop function if exists app.approval_requests_guard();
drop function if exists app.attention_items_guard();
drop function if exists app.deny_write_allow_trusted_delete();

-- Previous versions of the functions this migration replaced.
create or replace function app.subject_table(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type when 'lead' then 'leads' when 'account' then 'accounts' when 'contact' then 'contacts' end;
$$;

create or replace function app.subject_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := new.org_id;
  v_type text;
  v_id uuid;
begin
  if tg_table_name = 'lead_attachments' then
    v_type := 'lead';
    v_id := new.lead_id;
  else
    v_type := to_jsonb(new) ->> 'subject_type';
    v_id := (to_jsonb(new) ->> 'subject_id')::uuid;
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id
       or (to_jsonb(new) ->> 'subject_id') is distinct from (to_jsonb(old) ->> 'subject_id')
       or (to_jsonb(new) ->> 'subject_type') is distinct from (to_jsonb(old) ->> 'subject_type') then
      raise exception 'A note, comment or task cannot be moved to another record.' using errcode = '42501';
    end if;
    return new;
  end if;
  if v_type is not null then
    perform app.check_same_org(v_org, app.subject_table(v_type), v_id, 'The record');
  end if;
  return new;
end;
$$;

create or replace function app.can_see_subject(p_type text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_type
    when 'lead' then exists (select 1 from public.leads l where l.id = p_id)
    when 'account' then exists (select 1 from public.accounts a where a.id = p_id)
    when 'contact' then exists (select 1 from public.contacts c where c.id = p_id)
    else false
  end;
$$;

create or replace function app.can_edit_subject(p_type text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_type
    when 'lead' then exists (
      select 1 from public.leads l where l.id = p_id
        and app.scope_match(app.perm_scope('leads:update'), l.owner_id, l.created_by, l.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'account' then exists (
      select 1 from public.accounts a where a.id = p_id
        and app.scope_match(app.perm_scope('accounts:update'), a.owner_id, a.created_by, a.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    when 'contact' then exists (
      select 1 from public.contacts c join public.accounts a on a.id = c.account_id where c.id = p_id
        and app.scope_match(app.perm_scope('contacts:update'), a.owner_id, a.created_by, a.territory_id,
                            app.effective_user_id(), app.my_territory_id()))
    else false
  end;
$$;

create or replace function app.can_read_activity(p_type text, p_id text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_type in ('lead', 'account', 'contact') then
    return app.can_see_subject(p_type, p_id::uuid);
  end if;
  return app.can_read_subject(p_type);
exception when invalid_text_representation then
  return false;
end;
$$;

create or replace function public.search_records(p_query text, p_scope text default 'all', p_limit integer default 8)
returns table (kind text, id uuid, title text, subtitle text, href text, rank real)
language sql
stable
set search_path = ''
as $$
  with q as (
    select lower(btrim(p_query)) as term,
           nullif(regexp_replace(p_query, '[^0-9]', '', 'g'), '') as digits,
           least(greatest(coalesce(p_limit, 8), 1), 25) as lim
  ),
  lead_hits as (
    select 'lead'::text as kind, l.id,
           btrim(l.first_name || ' ' || coalesce(l.last_name, '')) as title,
           concat_ws(' · ', initcap(replace(l.status, '_', ' ')), l.city, coalesce(l.mobile, l.phone, l.email)) as subtitle,
           '/leads/' || l.id as href,
           greatest(extensions.similarity(l.search_text, q.term),
                    case when q.digits is not null and length(q.digits) >= 4 and l.phone_digits like '%' || q.digits || '%' then 0.9 else 0 end)::real as rank
    from public.leads l, q
    where p_scope in ('all', 'leads') and length(q.term) >= 2
      and (l.search_text like '%' || q.term || '%'
           or (q.digits is not null and length(q.digits) >= 4 and l.phone_digits like '%' || q.digits || '%'))
    order by rank desc, l.last_activity_at desc
    limit (select lim from q)
  ),
  account_hits as (
    select 'account'::text, a.id, a.display_name,
           concat_ws(' · ', initcap(replace(a.status, '_', ' ')), initcap(replace(a.account_type, '_', ' '))),
           '/accounts/' || a.id,
           extensions.similarity(a.search_text, q.term)::real
    from public.accounts a, q
    where p_scope in ('all', 'accounts') and length(q.term) >= 2 and a.search_text like '%' || q.term || '%'
    order by 6 desc
    limit (select lim from q)
  ),
  contact_hits as (
    select 'contact'::text, c.id, btrim(c.first_name || ' ' || coalesce(c.last_name, '')),
           concat_ws(' · ', coalesce(c.mobile, c.phone), c.email),
           '/contacts/' || c.id,
           greatest(extensions.similarity(c.search_text, q.term),
                    case when q.digits is not null and length(q.digits) >= 4 and c.phone_digits like '%' || q.digits || '%' then 0.9 else 0 end)::real
    from public.contacts c, q
    where p_scope in ('all', 'contacts') and length(q.term) >= 2
      and (c.search_text like '%' || q.term || '%'
           or (q.digits is not null and length(q.digits) >= 4 and c.phone_digits like '%' || q.digits || '%'))
    order by 6 desc
    limit (select lim from q)
  ),
  property_hits as (
    select 'account'::text, a.id, a.display_name,
           concat_ws(', ', p.street, p.city),
           '/accounts/' || a.id,
           (extensions.similarity(p.search_text, q.term) * 0.9)::real
    from public.properties p join public.accounts a on a.id = p.account_id, q
    where p_scope in ('all', 'accounts') and length(q.term) >= 3 and p.search_text like '%' || q.term || '%'
    order by 6 desc
    limit (select lim from q)
  )
  select * from (
    select * from lead_hits
    union all select * from account_hits
    union all select * from contact_hits
    union all select * from property_hits
  ) r
  order by r.rank desc
  limit (select lim * 2 from q);
$$;

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
    when 'leads' then 'leads:delete'
    when 'accounts' then 'accounts:delete'
    when 'contacts' then 'contacts:delete'
    when 'properties' then 'accounts:delete'
  end;
$$;

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
      union all
      select 'leads', l.id, btrim(l.first_name || ' ' || coalesce(l.last_name, '')), l.deleted_at, l.deleted_by, l.delete_reason
      from public.leads l where l.org_id = v_org and l.deleted_at is not null
      union all
      select 'accounts', a.id, a.display_name, a.deleted_at, a.deleted_by, a.delete_reason
      from public.accounts a where a.org_id = v_org and a.deleted_at is not null
      union all
      select 'contacts', c.id, btrim(c.first_name || ' ' || coalesce(c.last_name, '')), c.deleted_at, c.deleted_by, c.delete_reason
      from public.contacts c where c.org_id = v_org and c.deleted_at is not null
      union all
      select 'properties', pr.id, coalesce(nullif(concat_ws(', ', pr.street, pr.city), ''), 'Property'), pr.deleted_at, pr.deleted_by, pr.delete_reason
      from public.properties pr where pr.org_id = v_org and pr.deleted_at is not null
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
declare
  v_org uuid := app.current_org_id();
begin
  if v_org is null or not app.has_perm('users:read') then
    raise exception 'You do not have permission to view this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and org_id = v_org) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'leads', nullif((select count(*) from public.leads l
                     where l.org_id = v_org and l.owner_id = p_user_id and l.deleted_at is null
                       and l.status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')), 0),
    'tasks', nullif((select count(*) from public.tasks t
                     where t.org_id = v_org and t.assignee_id = p_user_id and t.deleted_at is null and t.status = 'open'), 0)
  ));
end;
$$;

drop function if exists app.job_stage_order(text);
drop function if exists app.system_update_on();
