-- Phase 5: Onboarding, documents & photos (SPEC §6.2 gate 5, §6.4, §8.5 #2/#6/#7,
-- §8.7, §8.13, §13.1, §13.3).
--
-- Onboarding: the requirement rows seeded by acceptance (Phase 4) now carry the
-- result of their auto-verify rule (computed in TypeScript by
-- lib/domain/onboarding over a job snapshot and written by the service-role
-- function apply_onboarding_checks()), people can mark an item cleared with a
-- note or reopen it, and clearing the deposit item releases the Deposit Hold.
-- The Onboarding → Ready to Schedule gate becomes a real check.
--
-- Documents: uploads into the private "documents" bucket (more file types),
-- linking to another job of the same customer, soft delete + restore, and
-- document_stats() for the Documents KPIs.
--
-- Photos: job_photos + a private "photos" bucket. Files are written by the
-- server after it re-encodes them (orientation fixed, every EXIF field incl.
-- GPS dropped) and makes a thumbnail; the row is inserted with the person's own
-- client so row security proves they can upload to that job.
--
-- Messages get a template key so "prep instructions sent" can be verified.
--
-- Rollback: supabase/rollbacks/20261027000300_onboarding_documents_photos.down.sql

-- =============================================================================
-- 1. Messages: which template a message came from
-- =============================================================================

alter table public.messages add column template_key text check (app.is_key(template_key));
create index messages_template_idx on public.messages (subject_type, subject_id, template_key)
  where template_key is not null;

-- =============================================================================
-- 2. Onboarding requirements (SPEC §6.4)
-- =============================================================================

alter table public.onboarding_requirements
  add column auto_status text check (auto_status in ('verified', 'pending', 'missing', 'needs_review', 'not_required')),
  add column auto_detail text check (length(auto_detail) <= 500),
  add column requested_at timestamptz,
  add column requested_by uuid,
  add column task_id uuid references public.tasks (id) on delete set null;
create index onboarding_requirements_job_idx on public.onboarding_requirements (job_id, sort_order);
create index onboarding_requirements_task_idx on public.onboarding_requirements (task_id);
create index onboarding_requirements_open_idx on public.onboarding_requirements (job_id)
  where required and status <> 'verified';

-- People may only mark an item cleared (with a note saying how) or reopen it;
-- everything else on the row is written by the checks. A manual clear is a
-- verified row with verified_auto = false; the checks never overwrite it.
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

  if tg_op = 'UPDATE' and not app.is_trusted() then
    if new.group_key <> old.group_key or new.label <> old.label or new.required <> old.required
       or new.auto_verify_rule is distinct from old.auto_verify_rule or new.sort_order <> old.sort_order
       or new.source_estimate_version_id is distinct from old.source_estimate_version_id then
      raise exception 'Only an onboarding item''s status, note and follow-ups can change.' using errcode = '42501';
    end if;
    new.auto_status := old.auto_status;
    new.auto_detail := old.auto_detail;
    new.last_checked_at := old.last_checked_at;
    if new.status <> old.status then
      if new.status = 'verified' then
        if length(btrim(coalesce(new.note, ''))) < 3 then
          raise exception 'Add a note saying how this was cleared.' using errcode = '23514';
        end if;
        new.verified_at := now();
        new.verified_by := app.actor_id();
        new.verified_auto := false;
      elsif new.status = 'pending' and old.status = 'verified' then
        null;  -- reopened; the next check sets the real status
      else
        raise exception 'Onboarding items are checked automatically. Mark one cleared with a note, or reopen it.'
          using errcode = '23514';
      end if;
    else
      new.verified_auto := old.verified_auto;
      new.verified_at := old.verified_at;
      new.verified_by := old.verified_by;
    end if;
    if new.requested_at is distinct from old.requested_at then
      new.requested_at := now();
      new.requested_by := app.actor_id();
    else
      new.requested_by := old.requested_by;
    end if;
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

-- Clearing the deposit item releases the Deposit Hold (SPEC §11.2 #6).
create or replace function app.onboarding_requirements_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key = 'deposit_received' and new.status = 'verified'
     and (tg_op = 'INSERT' or old.status is distinct from 'verified') then
    update public.job_holds set
      released_at = now(),
      release_note = left(case when new.verified_auto then 'The deposit is paid.'
                               else 'Deposit item cleared: ' || btrim(coalesce(new.note, '')) end, 1000)
    where job_id = new.job_id and hold_type = 'deposit' and released_at is null;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and (new.status = 'verified' and not new.verified_auto or old.status = 'verified' and not old.verified_auto) then
    perform app.log_activity(new.org_id, 'job', new.job_id::text,
      case when new.status = 'verified' then 'onboarding_cleared' else 'onboarding_reopened' end,
      case when new.status = 'verified' then 'Onboarding item cleared: ' || new.label || ' (' || btrim(coalesce(new.note, '')) || ')'
           else 'Onboarding item reopened: ' || new.label end,
      jsonb_build_object('requirement_id', new.id, 'key', new.key));
  end if;
  return null;
end;
$$;
create trigger onboarding_requirements_after after insert or update on public.onboarding_requirements
  for each row execute function app.onboarding_requirements_after();

-- Writes the auto-verify results (lib/domain/onboarding) for one job. Only rows
-- whose result changed are touched; a manual clear is never overwritten.
-- p_results: [{ key, status, detail, required? }].
create or replace function public.apply_onboarding_checks(p_job uuid, p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_changed integer := 0;
  v_n integer;
begin
  if jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then
    raise exception 'Results must be a list.' using errcode = '22023';
  end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    if (v_row ->> 'status') not in ('verified', 'pending', 'missing', 'needs_review', 'not_required') then
      raise exception 'Unknown onboarding status: %', v_row ->> 'status' using errcode = '22023';
    end if;
    update public.onboarding_requirements r set
      auto_status = v_row ->> 'status',
      auto_detail = left(nullif(v_row ->> 'detail', ''), 500),
      last_checked_at = now(),
      required = coalesce((v_row ->> 'required')::boolean, r.required),
      status = case when r.status = 'verified' and not r.verified_auto then 'verified' else v_row ->> 'status' end,
      verified_auto = case when r.status = 'verified' and not r.verified_auto then false
                           else (v_row ->> 'status') = 'verified' end
    where r.job_id = p_job and r.key = v_row ->> 'key'
      and (r.auto_status is distinct from v_row ->> 'status'
           or r.auto_detail is distinct from left(nullif(v_row ->> 'detail', ''), 500)
           or r.required is distinct from coalesce((v_row ->> 'required')::boolean, r.required)
           or (not (r.status = 'verified' and not r.verified_auto) and r.status is distinct from v_row ->> 'status'));
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
  end loop;
  update public.onboarding_requirements set last_checked_at = now() where job_id = p_job;
  return jsonb_build_object('changed', v_changed, 'cleared', app.onboarding_cleared(p_job));
end;
$$;

-- Every required item is cleared (the checklist exists and nothing required is open).
create or replace function app.onboarding_cleared(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.onboarding_requirements r where r.job_id = p_job)
     and not exists (select 1 from public.onboarding_requirements r
                     where r.job_id = p_job and r.required and r.status <> 'verified');
$$;

-- =============================================================================
-- 3. Stage gate 5 is real (must agree with lib/domain/jobs/gates.ts)
-- =============================================================================

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
    -- Every required onboarding item is cleared and no hold blocks scheduling.
    when 'onboarding' then app.onboarding_cleared(p_job)
      and not exists (select 1 from public.job_holds h
                      where h.job_id = p_job and h.released_at is null and h.blocks_scheduling)
    when 'paid_in_full' then true
    else false
  end;
$$;
revoke execute on function app.job_gate_passes(uuid, text) from public, anon, authenticated;
grant execute on function app.job_gate_passes(uuid, text) to service_role;

-- =============================================================================
-- 4. Documents (SPEC §8.5 #7, §8.13)
-- =============================================================================

-- Uploads keep their file; a document can be linked to another job of the same
-- customer (or kept on the customer only). Signed documents can't be deleted.
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
      new.status := case when new.status = 'awaiting_signature' then 'awaiting_signature' else 'active' end;
      if new.storage_path not like new.org_id::text || '/%' then
        raise exception 'That file isn''t in this company''s storage.' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.storage_path <> old.storage_path then
    raise exception 'A document''s file cannot change.' using errcode = '42501';
  end if;
  if new.job_id is distinct from old.job_id then
    if old.source = 'generated' then
      raise exception 'Generated documents stay on their job.' using errcode = '42501';
    end if;
    if new.job_id is null then
      if old.account_id is null then
        raise exception 'Link the document to a job or a customer.' using errcode = '23514';
      end if;
    elsif not exists (select 1 from public.jobs j where j.id = new.job_id and j.org_id = new.org_id
                      and j.account_id = old.account_id and j.deleted_at is null) then
      raise exception 'A document can only move to another job for the same customer.' using errcode = '23514';
    elsif not app.is_trusted() and not app.can_edit_subject('job', new.job_id) then
      raise exception 'You can''t add documents to that job.' using errcode = '42501';
    end if;
  end if;
  if new.account_id is distinct from old.account_id and not app.is_trusted() then
    new.account_id := old.account_id;
  end if;
  if new.deleted_at is not null and old.deleted_at is null and old.signature_id is not null then
    raise exception 'Signed documents are kept for the record and can''t be deleted.' using errcode = '23514';
  end if;
  if not app.is_trusted() then
    new.source := old.source;
    new.signature_id := old.signature_id;
    new.sha256 := old.sha256;
    new.size_bytes := old.size_bytes;
    new.mime_type := old.mime_type;
    new.uploaded_by := old.uploaded_by;
    if old.status in ('signed', 'superseded') then
      new.status := old.status;
    elsif new.status not in ('active', 'awaiting_signature') then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;

create index documents_org_created_idx on public.documents (org_id, created_at desc) where deleted_at is null;
create index documents_uploaded_by_idx on public.documents (uploaded_by);

-- Documents KPIs (SPEC §8.13, §8.5 #7). Runs as the caller: row security
-- decides which documents count. p_job limits it to one job.
create or replace function public.document_stats(p_job uuid default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with d as (
    select * from public.documents x where p_job is null or x.job_id = p_job
  ),
  open_doc_items as (
    select r.job_id, r.key from public.onboarding_requirements r
    where r.required and r.status <> 'verified'
      and r.key in ('signed_contract', 'hoa_approval', 'lead_safe_plan')
      and (p_job is null or r.job_id = p_job)
  )
  select jsonb_build_object(
    'total', (select count(*) from d),
    'awaiting_signature', (select count(*) from d where status = 'awaiting_signature'),
    'linked_to_jobs', (select count(*) from d where job_id is not null),
    'storage_bytes', (select coalesce(sum(size_bytes), 0) from d),
    'recent', (select count(*) from d where created_at >= now() - interval '7 days'),
    'needs_action', (select count(*) from open_doc_items),
    'by_category', coalesce((select jsonb_object_agg(c.category, c.n)
                             from (select category, count(*) n from d group by category) c), '{}'::jsonb)
  );
$$;
revoke execute on function public.document_stats(uuid) from public, anon;
grant execute on function public.document_stats(uuid) to authenticated, service_role;

-- More file types for uploads (25 MB each).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    update storage.buckets set
      file_size_limit = 26214400,
      allowed_mime_types = array[
        'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
        'text/plain', 'text/csv', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    where id = 'documents';
  end if;
end
$$;

-- =============================================================================
-- 5. Photos (SPEC §8.5 #6, §13.1)
-- =============================================================================

create table public.job_photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  category text not null default 'other' check (category in (
    'before', 'prep', 'progress', 'after', 'damage', 'color', 'cleanup', 'other')),
  area text check (length(btrim(area)) between 1 and 120),
  caption text check (length(caption) <= 500),
  checklist_key text check (app.is_key(checklist_key)),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-z/._-]{1,240}$'),
  thumb_path text not null unique check (thumb_path ~ '^[0-9a-f-]{36}/[0-9a-z/._-]{1,240}$'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/webp', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 15728640),
  thumb_size_bytes bigint not null default 0 check (thumb_size_bytes between 0 and 2097152),
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  taken_at timestamptz,
  client_id uuid,
  source text not null default 'upload' check (source in ('upload', 'camera', 'offline')),
  exif_stripped boolean not null default true check (exif_stripped),
  customer_visible boolean not null default false,
  shared_at timestamptz,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (job_id, client_id)
);
create index job_photos_job_idx on public.job_photos (job_id, created_at desc) where deleted_at is null;
create index job_photos_job_category_idx on public.job_photos (job_id, category) where deleted_at is null;
create index job_photos_org_idx on public.job_photos (org_id, created_at desc);
create index job_photos_uploaded_by_idx on public.job_photos (uploaded_by);

-- The job's photos are visible at the person's photos:read scope (and only on jobs they can open).
create or replace function app.job_in_scope(p_scope text, p_job uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job
      and (p_scope = 'all'
           or (p_scope in ('own', 'team')
               and (app.effective_user_id() in (j.owner_id, j.created_by) or app.effective_user_id() = any(j.team_user_ids)))
           or (p_scope = 'team' and j.territory_id = app.my_territory_id())));
$$;

create or replace function app.job_photos_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.check_same_org(new.org_id, 'jobs', new.job_id, 'Job');
    if not app.is_trusted() then
      new.uploaded_by := app.effective_user_id();
      new.customer_visible := false;
      new.shared_at := null;
      new.exif_stripped := true;
    end if;
    if new.storage_path not like new.org_id::text || '/jobs/' || new.job_id::text || '/%'
       or new.thumb_path not like new.org_id::text || '/jobs/' || new.job_id::text || '/%' then
      raise exception 'That file isn''t stored with this job.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.job_id <> old.job_id or new.storage_path <> old.storage_path
     or new.thumb_path <> old.thumb_path then
    raise exception 'A photo''s file and job cannot change.' using errcode = '42501';
  end if;
  if not app.is_trusted() then
    new.mime_type := old.mime_type;
    new.size_bytes := old.size_bytes;
    new.thumb_size_bytes := old.thumb_size_bytes;
    new.width := old.width;
    new.height := old.height;
    new.sha256 := old.sha256;
    new.uploaded_by := old.uploaded_by;
    new.client_id := old.client_id;
    new.source := old.source;
    new.taken_at := old.taken_at;
    if new.customer_visible and not old.customer_visible then
      new.shared_at := now();
    elsif new.shared_at is distinct from old.shared_at then
      new.shared_at := old.shared_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger job_photos_guard before insert or update on public.job_photos
  for each row execute function app.job_photos_guard();
create trigger job_photos_set_updated_at before update on public.job_photos
  for each row execute function app.set_updated_at();
create trigger job_photos_stamp_actor before insert or update on public.job_photos
  for each row execute function app.stamp_actor();
create trigger job_photos_audit after insert or update or delete on public.job_photos
  for each row execute function app.audit_row();
create trigger job_photos_event after insert or update or delete on public.job_photos
  for each row execute function app.emit_change_event('job_photo');

alter table public.job_photos enable row level security;
revoke delete on public.job_photos from authenticated;

create policy job_photos_select on public.job_photos for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.has_perm('photos:read'))
    and app.job_in_scope((select app.perm_scope('photos:read')), job_id)
  );
create policy job_photos_insert on public.job_photos for insert to authenticated
  with check (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('photos:upload'))
    and exists (select 1 from public.jobs j where j.id = job_id)
  );
create policy job_photos_update on public.job_photos for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('photos:upload'))
    and (uploaded_by = (select app.effective_user_id()) or app.can_edit_subject('job', job_id))
  )
  with check (org_id = (select app.current_org_id()));

-- Photo counts for one job's summary panel (Pacific days; weeks start Monday).
create or replace function public.job_photo_summary(p_job uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with p as (select * from public.job_photos x where x.job_id = p_job),
  today as (select (now() at time zone 'America/Los_Angeles')::date as d)
  select jsonb_build_object(
    'total', (select count(*) from p),
    'today', (select count(*) from p, today where (p.created_at at time zone 'America/Los_Angeles')::date = today.d),
    'this_week', (select count(*) from p, today
                  where (p.created_at at time zone 'America/Los_Angeles')::date >= date_trunc('week', today.d)::date),
    'shared', (select count(*) from p where customer_visible),
    'by_category', coalesce((select jsonb_object_agg(c.category, c.n)
                             from (select category, count(*) n from p group by category) c), '{}'::jsonb)
  );
$$;
revoke execute on function public.job_photo_summary(uuid) from public, anon;
grant execute on function public.job_photo_summary(uuid) to authenticated, service_role;
grant execute on function app.job_in_scope(text, uuid) to authenticated, service_role;

-- Private bucket for job photos (display copies and thumbnails, metadata stripped).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('photos', 'photos', false, 15728640, array['image/jpeg', 'image/webp', 'image/png'])
    on conflict (id) do nothing;
  end if;
end
$$;

-- =============================================================================
-- 6. Soft delete, restore and Deleted Records: documents and photos
-- =============================================================================

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
    when 'documents' then 'documents:manage'
    when 'job_photos' then 'photos:delete'
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
    -- Documents: editable job, or (customer-only documents) editable account.
    when 'documents' then exists (
      select 1 from public.documents d
      where d.id = p_id and d.org_id = app.current_org_id() and d.deleted_at is null
        and ((d.job_id is not null and app.can_edit_subject('job', d.job_id))
             or (d.job_id is null and app.can_edit_subject('account', d.account_id))))
    -- Photos: the person who took it, or anyone who can edit the job.
    when 'job_photos' then exists (
      select 1 from public.job_photos p
      where p.id = p_id and p.org_id = app.current_org_id() and p.deleted_at is null
        and (p.uploaded_by = app.effective_user_id() or app.can_edit_subject('job', p.job_id)))
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
      union all
      select 'jobs', jb.id, jb.job_number || ' · ' || jb.name, jb.deleted_at, jb.deleted_by, jb.delete_reason
      from public.jobs jb where jb.org_id = v_org and jb.deleted_at is not null
      union all
      select 'documents', dc.id, dc.title, dc.deleted_at, dc.deleted_by, dc.delete_reason
      from public.documents dc where dc.org_id = v_org and dc.deleted_at is not null
      union all
      select 'job_photos', ph.id, initcap(ph.category) || ' photo · ' || coalesce(jp.job_number, 'job'),
             ph.deleted_at, ph.deleted_by, ph.delete_reason
      from public.job_photos ph left join public.jobs jp on jp.id = ph.job_id
      where ph.org_id = v_org and ph.deleted_at is not null
    ) d
    left join public.profiles p on p.id = d.deleted_by
    order by d.deleted_at desc;
end;
$$;

-- =============================================================================
-- 7. Grants
-- =============================================================================

revoke execute on function public.apply_onboarding_checks(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_onboarding_checks(uuid, jsonb) to service_role;
revoke execute on function app.onboarding_cleared(uuid) from public, anon, authenticated;
grant execute on function app.onboarding_cleared(uuid) to service_role;
