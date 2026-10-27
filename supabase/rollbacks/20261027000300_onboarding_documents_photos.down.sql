-- Rolls back Phase 5 (onboarding checks, document uploads, photos). DESTROYS
-- job photos (rows and the "photos" bucket files) and the onboarding check
-- results; restores the Phase 4 gate, document guard and Deleted Records list.
-- Uploaded documents stay (their rows are Phase 4's table) but documents of the
-- new file types remain in storage. Owner approval required.

-- Photos.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    -- Supabase blocks direct deletes unless this is set (the files go with the bucket).
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where bucket_id = 'photos';
    delete from storage.buckets where id = 'photos';
    update storage.buckets set file_size_limit = 26214400,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    where id = 'documents';
  end if;
end
$$;
drop function if exists public.job_photo_summary(uuid);
drop table if exists public.job_photos;
drop function if exists app.job_photos_guard();
drop function if exists app.job_in_scope(text, uuid);

-- Documents.
drop function if exists public.document_stats(uuid);
drop index if exists public.documents_org_created_idx;
drop index if exists public.documents_uploaded_by_idx;

-- Onboarding.
drop function if exists public.apply_onboarding_checks(uuid, jsonb);
drop trigger if exists onboarding_requirements_after on public.onboarding_requirements;
drop function if exists app.onboarding_requirements_after();
drop index if exists public.onboarding_requirements_job_idx;
drop index if exists public.onboarding_requirements_task_idx;
drop index if exists public.onboarding_requirements_open_idx;
alter table public.onboarding_requirements
  drop column if exists auto_status,
  drop column if exists auto_detail,
  drop column if exists requested_at,
  drop column if exists requested_by,
  drop column if exists task_id;

-- Messages.
drop index if exists public.messages_template_idx;
alter table public.messages drop column if exists template_key;

-- Earlier versions of replaced functions.
create or replace function app.job_gate_passes(p_job uuid, p_from text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_from
    when 'walkthrough_scheduled' then exists (
      select 1 from public.appointments a
      where a.job_id = p_job and a.type = 'walkthrough' and a.status = 'completed'
        and a.result = 'measured' and a.deleted_at is null)
    -- An estimate version has been sent.
    when 'walkthrough_complete' then exists (
      select 1 from public.estimate_versions v join public.estimates e on e.id = v.estimate_id
      where e.job_id = p_job and e.deleted_at is null and v.sent_at is not null)
    -- The estimate is accepted and the customer signed it.
    when 'estimate_sent' then exists (
      select 1 from public.estimates e
      join public.signatures s on s.estimate_version_id = e.accepted_version_id
      where e.job_id = p_job and e.deleted_at is null and e.status = 'accepted')
    -- The deposit invoice exists (or the accepted estimate asks for no deposit).
    when 'sold' then exists (
      select 1 from public.invoices i
      where i.job_id = p_job and i.invoice_type = 'deposit' and i.status <> 'void')
      or exists (
      select 1 from public.estimates e join public.estimate_versions v on v.id = e.accepted_version_id
      where e.job_id = p_job and e.status = 'accepted'
        and coalesce((v.accepted_totals ->> 'depositCents')::bigint, 0) = 0)
    when 'paid_in_full' then true
    else false
  end;
$$;

create or replace function app.documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    perform app.check_same_org(new.org_id, 'accounts', new.account_id, 'Account');
    if new.account_id is null and new.job_id is not null then
      select j.account_id into new.account_id from public.jobs j where j.id = new.job_id;
    end if;
    if not app.is_trusted() then
      new.source := 'upload';
      new.uploaded_by := app.effective_user_id();
      new.signature_id := null;
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.storage_path <> old.storage_path or new.job_id is distinct from old.job_id then
    raise exception 'A document''s file and job cannot change.' using errcode = '42501';
  end if;
  if not app.is_trusted() then
    new.source := old.source;
    new.signature_id := old.signature_id;
    new.sha256 := old.sha256;
    new.size_bytes := old.size_bytes;
    new.mime_type := old.mime_type;
  end if;
  return new;
end;
$$;

create or replace function app.onboarding_requirements_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
  elsif new.org_id <> old.org_id or new.job_id <> old.job_id or new.key <> old.key then
    raise exception 'An onboarding item cannot move to another job.' using errcode = '42501';
  end if;
  if new.status = 'verified' then
    if tg_op = 'INSERT' or old.status <> 'verified' then
      new.verified_at := coalesce(new.verified_at, now());
      new.verified_by := coalesce(new.verified_by, app.actor_id());
    end if;
  else
    new.verified_at := null;
    new.verified_by := null;
    new.verified_auto := false;
  end if;
  return new;
end;
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
    when 'jobs' then 'jobs:delete'
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
    when 'jobs' then exists (
      select 1 from public.jobs r
      where r.id = p_id and r.org_id = app.current_org_id() and r.deleted_at is null
        and (app.perm_scope('jobs:update') = 'all'
             or (app.perm_scope('jobs:update') in ('own', 'team')
                 and (app.effective_user_id() in (r.owner_id, r.created_by) or app.effective_user_id() = any(r.team_user_ids)))
             or (app.perm_scope('jobs:update') = 'team' and r.territory_id = app.my_territory_id())))
    else true
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
      union all
      select 'jobs', jb.id, jb.job_number || ' · ' || jb.name, jb.deleted_at, jb.deleted_by, jb.delete_reason
      from public.jobs jb where jb.org_id = v_org and jb.deleted_at is not null
    ) d
    left join public.profiles p on p.id = d.deleted_by
    order by d.deleted_at desc;
end;
$$;

revoke execute on function app.job_gate_passes(uuid, text) from public, anon, authenticated;
grant execute on function app.job_gate_passes(uuid, text) to service_role;
revoke all on function app.record_in_edit_scope(text, uuid) from public, anon, authenticated;
drop function if exists app.onboarding_cleared(uuid);
