-- Phase 10 · Hardening & launch prep (SPEC §8.17, §8.18, §8.19, §10
-- commissions, §13 security, §15.2 demo data).
--
-- Additive and safe on a database that already has Phases 0–9 (production
-- starts empty). Adds:
--   1. Module Manager: custom_field_definitions, custom_field_values (jsonb on
--      leads / jobs / accounts / contacts), validation_rules, module_layouts,
--      and one trigger that checks values and rules on people's writes;
--   2. Data Import: imports + import_rows (mapping, review queue, result);
--   3. Bulk Update: bulk_updates + bulk_update_rows (before/after per row) and
--      bulk_update_apply() / bulk_update_revert(), which run as the caller so
--      row security, guards and the audit log apply to every change;
--   4. Merge Customers: record_merges and merge_customers() / undo_merge()
--      (service role, after the app's checks), reversible;
--   5. Export Controls: export_log kinds for list and audit-log exports;
--   6. Help Center: kb_categories + kb_articles (search vector, view counts);
--   7. Commissions (off by default): commission_settings, commission_plans,
--      commission_entries, commission_adjustments;
--   8. Demo data: is_demo on the records the demo script writes, and
--      purge_demo_data() / demo_data_counts() (service role, owner-checked in
--      the app). No demo data is ever inserted by a migration;
--   9. Gate/lockbox codes readable by the crew scheduled at the property
--      today (published schedule, Pacific day);
--  10. job_recovery_scan(): facts the Job Recovery screen turns into issues.
--
-- Rollback: supabase/rollbacks/20261031000100_hardening.down.sql

-- =============================================================================
-- 0. Permissions
-- =============================================================================

-- @permissions:begin
insert into public.permissions (key, resource, action, label, category, supports_scope, sort_order)
select v.key, split_part(v.key, ':', 1), split_part(v.key, ':', 2), v.label, v.category, v.scoped, v.ord
from (values
  ('help:manage', 'Write and publish Help Center articles', 'operational_control', false, 655)
) as v(key, label, category, scoped, ord)
on conflict (key) do nothing;
-- @permissions:end

-- Owners hold everything already (grants_all); the Administration pack gets
-- article management so an admin template can be given it.
insert into public.pack_permissions (org_id, pack_id, permission, scope)
select p.org_id, p.id, v.permission, v.scope
from public.permission_packs p
join (values ('administration', 'help:manage', 'all')) as v(pack_key, permission, scope) on v.pack_key = p.key
where not exists (select 1 from public.pack_permissions x where x.pack_id = p.id and x.permission = v.permission);

-- =============================================================================
-- 1. Module Manager (SPEC §5.9, §8.19)
-- =============================================================================

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  module text not null check (module in ('leads', 'jobs', 'accounts', 'contacts')),
  api_name text not null check (api_name ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(btrim(label)) between 1 and 80),
  field_type text not null check (field_type in ('text', 'long_text', 'number', 'currency', 'date', 'datetime',
                                                 'checkbox', 'picklist', 'multi_picklist', 'user', 'url')),
  -- Picklist options: [{"value": "a_b", "label": "A b"}, …]
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required boolean not null default false,
  help_text text check (length(help_text) <= 300),
  show_in_list boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, module, api_name)
);
create index custom_field_definitions_module_idx on public.custom_field_definitions (org_id, module, sort_order);

alter table public.leads add column if not exists custom_field_values jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_field_values) = 'object');
alter table public.jobs add column if not exists custom_field_values jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_field_values) = 'object');
alter table public.accounts add column if not exists custom_field_values jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_field_values) = 'object');
alter table public.contacts add column if not exists custom_field_values jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_field_values) = 'object');
create index if not exists leads_custom_field_values_idx on public.leads using gin (custom_field_values jsonb_path_ops);
create index if not exists jobs_custom_field_values_idx on public.jobs using gin (custom_field_values jsonb_path_ops);
create index if not exists accounts_custom_field_values_idx on public.accounts using gin (custom_field_values jsonb_path_ops);
create index if not exists contacts_custom_field_values_idx on public.contacts using gin (custom_field_values jsonb_path_ops);

-- Standard fields a validation rule may target (custom fields use "cf:<api_name>").
-- Must agree with VALIDATION_STANDARD_FIELDS in lib/domain/custom-fields/rules.ts.
create or replace function app.validation_standard_fields(p_module text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'leads' then array['first_name', 'last_name', 'company', 'email', 'phone', 'mobile', 'street', 'city', 'zip',
                            'customer_notes', 'year_built']
    when 'jobs' then array['name', 'priority_reason', 'estimated_duration_days', 'promised_start_date', 'target_season']
    when 'accounts' then array['display_name', 'notes']
    when 'contacts' then array['first_name', 'last_name', 'email', 'phone', 'mobile', 'language', 'notes']
    else array[]::text[]
  end;
$$;

create table public.validation_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  module text not null check (module in ('leads', 'jobs', 'accounts', 'contacts')),
  field text not null check (field ~ '^(cf:)?[a-z][a-z0-9_]{0,39}$'),
  rule_type text not null check (rule_type in ('required', 'regex', 'min', 'max', 'min_length', 'max_length')),
  value text check (length(value) <= 300),
  message text not null check (length(btrim(message)) between 1 and 200),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (rule_type = 'required' or value is not null)
);
create index validation_rules_module_idx on public.validation_rules (org_id, module) where active;

-- Section order and visibility on a module's detail page.
create table public.module_layouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  module text not null check (module in ('leads', 'jobs', 'accounts', 'contacts')),
  -- [{"key": "overview", "visible": true}, …] in display order
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, module)
);

create or replace function app.custom_field_definitions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_opt jsonb;
  v_values text[] := '{}';
begin
  if tg_op = 'UPDATE' and (new.module <> old.module or new.api_name <> old.api_name or new.field_type <> old.field_type) then
    raise exception 'A field''s module, API name and type can''t change. Add a new field instead.' using errcode = '23514';
  end if;
  if new.field_type in ('picklist', 'multi_picklist') then
    if jsonb_array_length(new.options) = 0 then
      raise exception 'A picklist field needs at least one option.' using errcode = '23514';
    end if;
    if jsonb_array_length(new.options) > 100 then
      raise exception 'A picklist field can have up to 100 options.' using errcode = '23514';
    end if;
    for v_opt in select * from jsonb_array_elements(new.options) loop
      if jsonb_typeof(v_opt) <> 'object' or coalesce(v_opt ->> 'value', '') !~ '^[a-z0-9][a-z0-9_]{0,59}$'
         or length(btrim(coalesce(v_opt ->> 'label', ''))) not between 1 and 80 then
        raise exception 'Each option needs a value (lowercase letters, numbers, _) and a label.' using errcode = '23514';
      end if;
      if (v_opt ->> 'value') = any(v_values) then
        raise exception 'Option "%" is listed twice.', v_opt ->> 'value' using errcode = '23514';
      end if;
      v_values := v_values || (v_opt ->> 'value');
    end loop;
  elsif jsonb_array_length(new.options) > 0 then
    raise exception 'Only picklist fields have options.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger custom_field_definitions_guard before insert or update on public.custom_field_definitions
  for each row execute function app.custom_field_definitions_guard();

create or replace function app.validation_rules_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.field like 'cf:%' then
    if not exists (select 1 from public.custom_field_definitions d
                   where d.org_id = new.org_id and d.module = new.module and d.api_name = substr(new.field, 4)) then
      raise exception 'Pick one of this module''s custom fields.' using errcode = '23514';
    end if;
  elsif not (new.field = any(app.validation_standard_fields(new.module))) then
    raise exception 'Rules can only be set on the listed fields.' using errcode = '23514';
  end if;
  if new.rule_type = 'regex' then
    begin
      perform '' ~ new.value;
    exception when others then
      raise exception 'That pattern isn''t a valid regular expression.' using errcode = '23514';
    end;
  elsif new.rule_type in ('min', 'max') then
    if new.value !~ '^-?\d+(\.\d+)?$' and new.value !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Enter a number or a date (YYYY-MM-DD).' using errcode = '23514';
    end if;
  elsif new.rule_type in ('min_length', 'max_length') then
    if new.value !~ '^\d{1,5}$' then
      raise exception 'Enter a whole number of characters.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger validation_rules_guard before insert or update on public.validation_rules
  for each row execute function app.validation_rules_guard();

create or replace function app.module_layouts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_s jsonb;
  v_keys text[] := '{}';
begin
  if jsonb_array_length(new.sections) > 40 then
    raise exception 'Too many sections.' using errcode = '23514';
  end if;
  for v_s in select * from jsonb_array_elements(new.sections) loop
    if jsonb_typeof(v_s) <> 'object' or coalesce(v_s ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
       or jsonb_typeof(v_s -> 'visible') is distinct from 'boolean' then
      raise exception 'Each section needs a key and a visible flag.' using errcode = '23514';
    end if;
    if (v_s ->> 'key') = any(v_keys) then
      raise exception 'Section "%" is listed twice.', v_s ->> 'key' using errcode = '23514';
    end if;
    v_keys := v_keys || (v_s ->> 'key');
  end loop;
  return new;
end;
$$;
create trigger module_layouts_guard before insert or update on public.module_layouts
  for each row execute function app.module_layouts_guard();

-- One custom value against its definition: null when fine, else the message.
-- Must agree with checkCustomValue() in lib/domain/custom-fields/values.ts.
create or replace function app.custom_value_error(p_def public.custom_field_definitions, p_value jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_t text := jsonb_typeof(p_value);
  v_s text;
  v_e jsonb;
begin
  if p_value is null or v_t = 'null' then
    return null;
  end if;
  case p_def.field_type
    when 'text', 'long_text', 'url', 'date', 'datetime', 'picklist', 'user' then
      if v_t <> 'string' then
        return p_def.label || ': enter text.';
      end if;
      v_s := p_value #>> '{}';
      if p_def.field_type = 'text' and length(v_s) > 500 then
        return p_def.label || ': 500 characters at most.';
      elsif p_def.field_type = 'long_text' and length(v_s) > 5000 then
        return p_def.label || ': 5,000 characters at most.';
      elsif p_def.field_type = 'url' and (v_s !~ '^https?://[^\s]+$' or length(v_s) > 500) then
        return p_def.label || ': enter a web address starting with http:// or https://.';
      elsif p_def.field_type = 'date' and v_s !~ '^\d{4}-\d{2}-\d{2}$' then
        return p_def.label || ': enter a date (YYYY-MM-DD).';
      elsif p_def.field_type = 'datetime' then
        begin
          perform v_s::timestamptz;
        exception when others then
          return p_def.label || ': enter a date and time.';
        end;
      elsif p_def.field_type = 'picklist'
            and not exists (select 1 from jsonb_array_elements(p_def.options) o where o ->> 'value' = v_s) then
        return p_def.label || ': pick one of the listed options.';
      elsif p_def.field_type = 'user'
            and not exists (select 1 from public.profiles p where p.id::text = v_s and p.org_id = p_def.org_id) then
        return p_def.label || ': pick a person in your company.';
      end if;
      if p_def.field_type = 'date' then
        begin
          perform v_s::date;
        exception when others then
          return p_def.label || ': enter a real date.';
        end;
      end if;
    when 'number' then
      if v_t <> 'number' then
        return p_def.label || ': enter a number.';
      end if;
    when 'currency' then
      if v_t <> 'number' or (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric) then
        return p_def.label || ': enter an amount in cents.';
      end if;
    when 'checkbox' then
      if v_t <> 'boolean' then
        return p_def.label || ': pick yes or no.';
      end if;
    when 'multi_picklist' then
      if v_t <> 'array' then
        return p_def.label || ': pick from the listed options.';
      end if;
      for v_e in select * from jsonb_array_elements(p_value) loop
        if jsonb_typeof(v_e) <> 'string'
           or not exists (select 1 from jsonb_array_elements(p_def.options) o where o ->> 'value' = v_e #>> '{}') then
          return p_def.label || ': pick from the listed options.';
        end if;
      end loop;
  end case;
  return null;
end;
$$;

-- A field value as text for rules ('' when empty).
create or replace function app.rule_value_text(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then ''
    when jsonb_typeof(p_value) = 'array' then case when jsonb_array_length(p_value) = 0 then '' else p_value::text end
    else coalesce(p_value #>> '{}', '')
  end;
$$;

-- Checks custom values and the module's validation rules on people's writes.
-- Trusted server code (website intake, worker) is not blocked: a website lead
-- is never lost to an office-side rule. "Required" is checked when a person
-- clears a field (and by the app's forms on create).
create or replace function app.check_module_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_module text := tg_argv[0];
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_key text;
  v_val jsonb;
  v_def public.custom_field_definitions%rowtype;
  v_err text;
  v_rule public.validation_rules%rowtype;
  v_cur jsonb;
  v_prev jsonb;
  v_txt text;
begin
  if app.is_trusted() then
    return new;
  end if;
  -- Custom values: known, active fields of this module, of the right shape.
  if v_old is null or (v_new -> 'custom_field_values') is distinct from (v_old -> 'custom_field_values') then
    for v_key, v_val in select * from jsonb_each(new.custom_field_values) loop
      if v_old is not null and (v_old -> 'custom_field_values' -> v_key) is not distinct from v_val then
        continue;
      end if;
      select * into v_def from public.custom_field_definitions d
      where d.org_id = new.org_id and d.module = v_module and d.api_name = v_key;
      if not found then
        raise exception 'Unknown custom field "%".', v_key using errcode = '23514';
      end if;
      if not v_def.active and jsonb_typeof(v_val) <> 'null' then
        raise exception '% is turned off in Module Manager.', v_def.label using errcode = '23514';
      end if;
      v_err := app.custom_value_error(v_def, v_val);
      if v_err is not null then
        raise exception '%', v_err using errcode = '23514';
      end if;
    end loop;
  end if;
  -- Validation rules: only fields this write changes.
  for v_rule in select * from public.validation_rules r
                where r.org_id = new.org_id and r.module = v_module and r.active order by r.sort_order loop
    if v_rule.field like 'cf:%' then
      v_cur := v_new -> 'custom_field_values' -> substr(v_rule.field, 4);
      v_prev := v_old -> 'custom_field_values' -> substr(v_rule.field, 4);
    else
      v_cur := v_new -> v_rule.field;
      v_prev := v_old -> v_rule.field;
    end if;
    if tg_op = 'UPDATE' and v_cur is not distinct from v_prev then
      continue;
    end if;
    v_txt := app.rule_value_text(v_cur);
    if v_rule.rule_type = 'required' then
      if tg_op = 'UPDATE' and v_txt = '' then
        raise exception '%', v_rule.message using errcode = '23514';
      end if;
      continue;
    end if;
    if v_txt = '' then
      continue;
    end if;
    if (v_rule.rule_type = 'regex' and v_txt !~ v_rule.value)
       or (v_rule.rule_type = 'min_length' and length(v_txt) < v_rule.value::integer)
       or (v_rule.rule_type = 'max_length' and length(v_txt) > v_rule.value::integer)
       or (v_rule.rule_type in ('min', 'max') and (
             case
               when v_rule.value ~ '^-?\d+(\.\d+)?$' and v_txt ~ '^-?\d+(\.\d+)?$' then
                 case v_rule.rule_type when 'min' then v_txt::numeric < v_rule.value::numeric
                                       else v_txt::numeric > v_rule.value::numeric end
               when v_rule.value ~ '^\d{4}-\d{2}-\d{2}$' then
                 case v_rule.rule_type when 'min' then left(v_txt, 10) < v_rule.value
                                       else left(v_txt, 10) > v_rule.value end
               else false
             end)) then
      raise exception '%', v_rule.message using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
create trigger leads_check_module_fields before insert or update on public.leads
  for each row execute function app.check_module_fields('leads');
create trigger jobs_check_module_fields before insert or update on public.jobs
  for each row execute function app.check_module_fields('jobs');
create trigger accounts_check_module_fields before insert or update on public.accounts
  for each row execute function app.check_module_fields('accounts');
create trigger contacts_check_module_fields before insert or update on public.contacts
  for each row execute function app.check_module_fields('contacts');

-- =============================================================================
-- 2. Data Import (SPEC §8.19): CSV → mapping → preview → review queue → apply
-- =============================================================================

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  module text not null check (module in ('leads', 'accounts', 'contacts')),
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  status text not null default 'mapping' check (status in ('mapping', 'review', 'applying', 'applied', 'canceled')),
  headers text[] not null default '{}' check (cardinality(headers) <= 100),
  -- {"CSV header": "field key"}; unmapped headers are left out.
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  -- {"duplicates": "skip" | "update" | "create"}
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  total_rows integer not null default 0 check (total_rows between 0 and 5000),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  applied_rows integer not null default 0 check (applied_rows >= 0),
  skipped_rows integer not null default 0 check (skipped_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  applied_at timestamptz,
  applied_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index imports_org_created_idx on public.imports (org_id, created_at desc);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  import_id uuid not null references public.imports (id) on delete cascade,
  row_number integer not null check (row_number between 1 and 5000),
  raw jsonb not null default '{}'::jsonb check (jsonb_typeof(raw) = 'object'),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'valid', 'error', 'duplicate', 'applied', 'skipped', 'failed')),
  errors text[] not null default '{}',
  duplicate_of uuid,
  duplicate_reason text check (length(duplicate_reason) <= 200),
  decision text check (decision in ('create', 'update', 'skip')),
  record_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (import_id, row_number)
);
create index import_rows_import_status_idx on public.import_rows (import_id, status, row_number);

-- =============================================================================
-- 3. Bulk Update (SPEC §8.19, §19): preview first → apply → revert
-- =============================================================================

create table public.bulk_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  module text not null check (module in ('leads', 'jobs', 'accounts', 'contacts')),
  source text not null check (source in ('selection', 'csv')),
  title text not null check (length(btrim(title)) between 1 and 200),
  -- Selection mode: {"field": value, "cf:api_name": value}
  changes jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  status text not null default 'preview' check (status in ('preview', 'applied', 'reverted', 'canceled')),
  total_rows integer not null default 0 check (total_rows between 0 and 2000),
  changed_rows integer not null default 0 check (changed_rows >= 0),
  applied_rows integer not null default 0 check (applied_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  reverted_rows integer not null default 0 check (reverted_rows >= 0),
  conflict_rows integer not null default 0 check (conflict_rows >= 0),
  applied_at timestamptz,
  applied_by uuid,
  reverted_at timestamptz,
  reverted_by uuid,
  revert_reason text check (length(revert_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index bulk_updates_org_created_idx on public.bulk_updates (org_id, created_at desc);

create table public.bulk_update_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  bulk_update_id uuid not null references public.bulk_updates (id) on delete cascade,
  row_number integer not null check (row_number between 1 and 2000),
  record_id uuid not null,
  label text check (length(label) <= 200),
  -- Only the fields this row changes: {"owner_id": …, "custom_field_values": {"k": …}}
  before jsonb not null default '{}'::jsonb check (jsonb_typeof(before) = 'object'),
  after jsonb not null default '{}'::jsonb check (jsonb_typeof(after) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'unchanged', 'error', 'applied', 'failed', 'reverted', 'conflict')),
  error text check (length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (bulk_update_id, row_number)
);
create index bulk_update_rows_bulk_idx on public.bulk_update_rows (bulk_update_id, status, row_number);

-- Fields a bulk update may change (custom fields go under custom_field_values).
-- Stage never changes here (only advanceJobStage). Consent fields are excluded.
-- Must agree with BULK_FIELDS in lib/domain/bulk/fields.ts.
create or replace function app.bulk_fields(p_module text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'leads' then array['owner_id', 'point_of_contact_id', 'lead_source', 'lead_sub_source', 'disposition',
                            'timeline', 'status', 'nurture_until']
    when 'jobs' then array['owner_id', 'point_of_contact_id', 'project_manager_id', 'priority', 'priority_reason',
                           'target_season', 'tags', 'lead_source', 'lead_sub_source', 'estimated_duration_days']
    when 'accounts' then array['account_type', 'status', 'owner_id', 'territory_id', 'tags']
    when 'contacts' then array['role', 'preferred_channel', 'language']
    else array[]::text[]
  end;
$$;

-- Applies one patch to one record as the caller (row security and guards apply).
create or replace function app.bulk_apply_patch(p_module text, p_id uuid, p_patch jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_table text := case p_module when 'leads' then 'leads' when 'jobs' then 'jobs'
                                when 'accounts' then 'accounts' when 'contacts' then 'contacts' end;
  v_key text;
  v_set text[] := '{}';
  v_count integer;
begin
  if v_table is null then
    raise exception 'Unknown module.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = 'custom_field_values' then
      if jsonb_typeof(p_patch -> v_key) <> 'object' then
        raise exception 'Custom values must be an object.' using errcode = '22023';
      end if;
      v_set := v_set || 'custom_field_values = jsonb_strip_nulls(t.custom_field_values || ($1 -> ''custom_field_values''))'::text;
    elsif v_key = any(app.bulk_fields(p_module)) then
      v_set := v_set || format('%I = r.%I', v_key, v_key);
    else
      raise exception 'Field "%" can''t be bulk updated.', v_key using errcode = '22023';
    end if;
  end loop;
  if cardinality(v_set) = 0 then
    return;
  end if;
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2 and t.deleted_at is null',
                 v_table, array_to_string(v_set, ', '), v_table)
  using p_patch, p_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'You can''t edit this record (or it was deleted).' using errcode = '42501';
  end if;
end;
$$;

-- The current values of a patch's fields on one record (for revert checks).
create or replace function app.bulk_current_values(p_module text, p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_table text := case p_module when 'leads' then 'leads' when 'jobs' then 'jobs'
                                when 'accounts' then 'accounts' when 'contacts' then 'contacts' end;
  v_row jsonb;
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_cf jsonb := '{}'::jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table) into v_row using p_id;
  if v_row is null then
    return null;
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = 'custom_field_values' then
      select coalesce(jsonb_object_agg(k, coalesce(v_row -> 'custom_field_values' -> k, 'null'::jsonb)), '{}'::jsonb)
      into v_cf from jsonb_object_keys(p_patch -> 'custom_field_values') k;
      v_out := v_out || jsonb_build_object('custom_field_values', v_cf);
    else
      v_out := v_out || jsonb_build_object(v_key, coalesce(v_row -> v_key, 'null'::jsonb));
    end if;
  end loop;
  return v_out;
end;
$$;

-- Apply a previewed bulk update. Runs as the caller: each row is a normal,
-- audited update; a row that fails is marked failed and the rest go ahead.
create or replace function public.bulk_update_apply(p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_bu public.bulk_updates%rowtype;
  v_row public.bulk_update_rows%rowtype;
  v_applied integer := 0;
  v_failed integer := 0;
begin
  if not app.can_write('bulk:update') then
    raise exception 'Your role can''t bulk update records.' using errcode = '42501';
  end if;
  select * into v_bu from public.bulk_updates where id = p_id for update;
  if not found then
    raise exception 'Bulk update not found.' using errcode = 'P0002';
  end if;
  if v_bu.status <> 'preview' then
    raise exception 'This bulk update was already %.', v_bu.status using errcode = '23514';
  end if;
  perform set_config('app.bulk_update_id', p_id::text, true);
  for v_row in select * from public.bulk_update_rows
               where bulk_update_id = p_id and status = 'pending' order by row_number loop
    begin
      perform app.bulk_apply_patch(v_bu.module, v_row.record_id, v_row.after);
      update public.bulk_update_rows set status = 'applied', error = null where id = v_row.id;
      v_applied := v_applied + 1;
    exception when others then
      update public.bulk_update_rows set status = 'failed', error = left(sqlerrm, 500) where id = v_row.id;
      v_failed := v_failed + 1;
    end;
  end loop;
  perform set_config('app.bulk_update_id', '', true);
  update public.bulk_updates
     set status = 'applied', applied_at = now(), applied_by = auth.uid(),
         applied_rows = v_applied, failed_rows = v_failed
   where id = p_id;
  return jsonb_build_object('applied', v_applied, 'failed', v_failed);
end;
$$;

-- Undo an applied bulk update: each applied row goes back to its "before"
-- values unless someone changed those fields since (then it's a conflict and
-- is left alone).
create or replace function public.bulk_update_revert(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_bu public.bulk_updates%rowtype;
  v_row public.bulk_update_rows%rowtype;
  v_cur jsonb;
  v_reverted integer := 0;
  v_conflict integer := 0;
begin
  if not app.can_write('bulk:update') then
    raise exception 'Your role can''t bulk update records.' using errcode = '42501';
  end if;
  select * into v_bu from public.bulk_updates where id = p_id for update;
  if not found then
    raise exception 'Bulk update not found.' using errcode = 'P0002';
  end if;
  if v_bu.status <> 'applied' then
    raise exception 'Only an applied bulk update can be reverted.' using errcode = '23514';
  end if;
  for v_row in select * from public.bulk_update_rows
               where bulk_update_id = p_id and status = 'applied' order by row_number loop
    v_cur := app.bulk_current_values(v_bu.module, v_row.record_id, v_row.after);
    if v_cur is null or v_cur is distinct from app.bulk_normalize(v_bu.module, v_row.record_id, v_row.after) then
      update public.bulk_update_rows set status = 'conflict',
        error = 'Changed since the bulk update; left as it is.' where id = v_row.id;
      v_conflict := v_conflict + 1;
      continue;
    end if;
    begin
      perform app.bulk_apply_patch(v_bu.module, v_row.record_id, v_row.before);
      update public.bulk_update_rows set status = 'reverted', error = null where id = v_row.id;
      v_reverted := v_reverted + 1;
    exception when others then
      update public.bulk_update_rows set status = 'conflict', error = left(sqlerrm, 500) where id = v_row.id;
      v_conflict := v_conflict + 1;
    end;
  end loop;
  update public.bulk_updates
     set status = 'reverted', reverted_at = now(), reverted_by = auth.uid(),
         revert_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         reverted_rows = v_reverted, conflict_rows = v_conflict
   where id = p_id;
  return jsonb_build_object('reverted', v_reverted, 'conflicts', v_conflict);
end;
$$;

-- What a patch looks like once stored (types normalized by the table), so the
-- revert check compares like with like (e.g. dates, arrays, numbers).
create or replace function app.bulk_normalize(p_module text, p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_table text := case p_module when 'leads' then 'leads' when 'jobs' then 'jobs'
                                when 'accounts' then 'accounts' when 'contacts' then 'contacts' end;
  v_row jsonb;
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_cf jsonb := '{}'::jsonb;
begin
  execute format('select to_jsonb(jsonb_populate_record(null::public.%I, $1))', v_table) into v_row using p_patch;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = 'custom_field_values' then
      select coalesce(jsonb_object_agg(k, coalesce(p_patch -> 'custom_field_values' -> k, 'null'::jsonb)), '{}'::jsonb)
      into v_cf from jsonb_object_keys(p_patch -> 'custom_field_values') k;
      v_out := v_out || jsonb_build_object('custom_field_values', v_cf);
    else
      v_out := v_out || jsonb_build_object(v_key, coalesce(v_row -> v_key, 'null'::jsonb));
    end if;
  end loop;
  return v_out;
end;
$$;

-- =============================================================================
-- 4. Merge Customers (SPEC §8.19): reversible account / contact merges
-- =============================================================================

create table public.record_merges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  module text not null check (module in ('accounts', 'contacts')),
  survivor_id uuid not null,
  merged_id uuid not null,
  survivor_label text check (length(survivor_label) <= 200),
  merged_label text check (length(merged_label) <= 200),
  -- {"field": "survivor" | "merged" | "union"}
  field_choices jsonb not null default '{}'::jsonb check (jsonb_typeof(field_choices) = 'object'),
  survivor_before jsonb not null check (jsonb_typeof(survivor_before) = 'object'),
  merged_before jsonb not null check (jsonb_typeof(merged_before) = 'object'),
  -- {"table.column": [ids moved from merged to survivor]}
  moved jsonb not null default '{}'::jsonb check (jsonb_typeof(moved) = 'object'),
  reason text check (length(reason) <= 500),
  status text not null default 'merged' check (status in ('merged', 'undone')),
  merged_at timestamptz not null default now(),
  merged_by uuid,
  undone_at timestamptz,
  undone_by uuid,
  undo_reason text check (length(undo_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (survivor_id <> merged_id)
);
create index record_merges_org_idx on public.record_merges (org_id, merged_at desc);
create index record_merges_merged_idx on public.record_merges (merged_id);

-- Fields a person may choose between when merging; consent is never chosen
-- (the stricter answer always wins). Must agree with lib/domain/merge/fields.ts.
create or replace function app.merge_fields(p_module text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'accounts' then array['display_name', 'account_type', 'status', 'owner_id', 'territory_id',
                               'primary_contact_id', 'notes', 'tags']
    when 'contacts' then array['first_name', 'last_name', 'role', 'mobile', 'phone', 'email', 'preferred_channel',
                               'language', 'notes', 'account_id']
    else array[]::text[]
  end;
$$;

-- References moved from the merged record to the survivor ("table.column").
create or replace function app.merge_references(p_module text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'accounts' then array['contacts.account_id', 'properties.account_id', 'leads.account_id', 'jobs.account_id',
                               'documents.account_id', 'invoices.account_id', 'payments.account_id', 'cases.account_id',
                               'referral_champions.account_id']
    when 'contacts' then array['leads.contact_id', 'jobs.primary_contact_id', 'accounts.primary_contact_id',
                               'message_threads.contact_id', 'messages.contact_id', 'cases.contact_id',
                               'review_requests.contact_id', 'campaign_recipients.contact_id',
                               'referral_champions.contact_id']
    else array[]::text[]
  end;
$$;

-- Subject-keyed records (notes, comments, tasks, attention items) moved too.
create or replace function app.merge_subject_type(p_module text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_module when 'accounts' then 'account' when 'contacts' then 'contact' end;
$$;

-- Messages are append-only; the only change allowed is a merge moving a
-- message to the surviving contact (trusted code, merge flag on, nothing else changes).
create or replace function app.messages_deny_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and app.is_trusted() then
    return old;
  end if;
  if tg_op = 'UPDATE' and app.is_trusted() and coalesce(current_setting('app.merge_op', true), '') = 'on'
     and (to_jsonb(new) - 'contact_id' - 'updated_at') = (to_jsonb(old) - 'contact_id' - 'updated_at') then
    return new;
  end if;
  raise exception 'This record cannot be changed.' using errcode = '42501';
end;
$$;

-- Merge p_merged into p_survivor. Service role only: the app checks
-- records:merge and that the person can open both records first.
create or replace function public.merge_customers(
  p_module text, p_survivor uuid, p_merged uuid, p_choices jsonb default '{}'::jsonb, p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text := case p_module when 'accounts' then 'accounts' when 'contacts' then 'contacts' end;
  v_surv jsonb;
  v_merg jsonb;
  v_org uuid;
  v_field text;
  v_choice text;
  v_set text[] := '{}';
  v_ref text;
  v_ids uuid[];
  v_moved jsonb := '{}'::jsonb;
  v_merge uuid;
  v_actor uuid := app.actor_id();
  v_label_s text;
  v_label_m text;
  v_subject text := app.merge_subject_type(p_module);
  v_cf jsonb;
begin
  if v_table is null then
    raise exception 'Only accounts and contacts can be merged.' using errcode = '22023';
  end if;
  if p_survivor = p_merged then
    raise exception 'Pick two different records.' using errcode = '22023';
  end if;
  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', v_table) into v_surv using p_survivor;
  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', v_table) into v_merg using p_merged;
  if v_surv is null or v_merg is null or (v_surv ->> 'deleted_at') is not null or (v_merg ->> 'deleted_at') is not null then
    raise exception 'Both records must exist and not be deleted.' using errcode = 'P0002';
  end if;
  v_org := (v_surv ->> 'org_id')::uuid;
  if v_org <> (v_merg ->> 'org_id')::uuid then
    raise exception 'Both records must belong to the same company.' using errcode = '42501';
  end if;
  if p_module = 'contacts' and exists (select 1 from public.referral_champions c where c.contact_id = p_survivor)
     and exists (select 1 from public.referral_champions c where c.contact_id = p_merged) then
    raise exception 'Both contacts are Bear Champions. Retire one champion first.' using errcode = '23514';
  end if;

  -- Survivor fields: keep, take the merged record's value, or (tags) combine.
  for v_field, v_choice in select key, value #>> '{}' from jsonb_each(coalesce(p_choices, '{}'::jsonb)) loop
    if v_field like 'cf:%' then
      continue;
    end if;
    if not (v_field = any(app.merge_fields(p_module))) then
      raise exception 'Field "%" can''t be merged.', v_field using errcode = '22023';
    end if;
    if v_choice = 'merged' then
      v_set := v_set || format('%I = m.%I', v_field, v_field);
    elsif v_choice = 'union' and v_field = 'tags' then
      v_set := v_set || 'tags = array(select distinct x from unnest(t.tags || m.tags) x order by x)'::text;
    elsif v_choice <> 'survivor' then
      raise exception 'Pick survivor or merged for "%".', v_field using errcode = '22023';
    end if;
  end loop;
  -- Custom fields: survivor's value unless the merged one is chosen ("cf:<key>": "merged")
  -- or the survivor has none.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_cf
  from jsonb_each(coalesce(v_merg -> 'custom_field_values', '{}'::jsonb)) as e(k, v)
  where coalesce(p_choices ->> ('cf:' || k), '') = 'merged'
     or not (coalesce(v_surv -> 'custom_field_values', '{}'::jsonb) ? k);
  if v_cf <> '{}'::jsonb then
    v_set := v_set || format('custom_field_values = t.custom_field_values || %L::jsonb', v_cf);
  end if;
  -- Consent: the stricter answer wins.
  if p_module = 'contacts' then
    v_set := v_set || array[
      'do_not_contact = t.do_not_contact or m.do_not_contact',
      'opted_out_at = coalesce(t.opted_out_at, m.opted_out_at)',
      'email_opted_out_at = coalesce(t.email_opted_out_at, m.email_opted_out_at)',
      'sms_opt_in = t.sms_opt_in and not (m.opted_out_at is not null)',
      'email_opt_in = t.email_opt_in and not (m.email_opted_out_at is not null)'];
  end if;
  if cardinality(v_set) > 0 then
    execute format('update public.%I t set %s from public.%I m where t.id = $1 and m.id = $2',
                   v_table, array_to_string(v_set, ', '), v_table)
    using p_survivor, p_merged;
  end if;

  -- Move references, remembering exactly which rows moved.
  perform set_config('app.merge_op', 'on', true);
  perform set_config('app.system_update', 'on', true);
  foreach v_ref in array app.merge_references(p_module) loop
    execute format('with u as (update public.%I set %I = $1 where %I = $2 returning id) select coalesce(array_agg(id), ''{}'') from u',
                   split_part(v_ref, '.', 1), split_part(v_ref, '.', 2), split_part(v_ref, '.', 2))
    into v_ids using p_survivor, p_merged;
    if cardinality(v_ids) > 0 then
      v_moved := v_moved || jsonb_build_object(v_ref, to_jsonb(v_ids));
    end if;
  end loop;
  foreach v_ref in array array['notes', 'comments', 'tasks', 'attention_items'] loop
    execute format('with u as (update public.%I set subject_id = $1 where subject_type = $3 and subject_id = $2 returning id) select coalesce(array_agg(id), ''{}'') from u', v_ref)
    into v_ids using p_survivor, p_merged, v_subject;
    if cardinality(v_ids) > 0 then
      v_moved := v_moved || jsonb_build_object(v_ref || '.subject_id', to_jsonb(v_ids));
    end if;
  end loop;
  perform set_config('app.merge_op', 'off', true);
  perform set_config('app.system_update', 'off', true);

  -- The merged record is soft-deleted (restorable by undo).
  if p_module = 'accounts' then
    v_label_s := v_surv ->> 'display_name';
    v_label_m := v_merg ->> 'display_name';
  else
    v_label_s := btrim(coalesce(v_surv ->> 'first_name', '') || ' ' || coalesce(v_surv ->> 'last_name', ''));
    v_label_m := btrim(coalesce(v_merg ->> 'first_name', '') || ' ' || coalesce(v_merg ->> 'last_name', ''));
  end if;
  execute format('update public.%I set deleted_at = now(), deleted_by = $2, delete_reason = $3 where id = $1', v_table)
  using p_merged, v_actor, left('Merged into ' || coalesce(nullif(v_label_s, ''), 'another record'), 500);

  insert into public.record_merges (org_id, module, survivor_id, merged_id, survivor_label, merged_label, field_choices,
                                    survivor_before, merged_before, moved, reason, merged_by)
  values (v_org, p_module, p_survivor, p_merged, left(v_label_s, 200), left(v_label_m, 200), coalesce(p_choices, '{}'::jsonb),
          v_surv, v_merg, v_moved, nullif(btrim(coalesce(p_reason, '')), ''), v_actor)
  returning id into v_merge;

  perform app.log_activity(v_org, v_subject, p_survivor::text, 'merged',
    'Merged ' || coalesce(nullif(v_label_m, ''), 'a duplicate') || ' into this record',
    jsonb_build_object('merge_id', v_merge, 'merged_id', p_merged));
  perform app.emit_event(v_org, 'merge.created', 'record_merge', v_merge::text,
    jsonb_build_object('module', p_module, 'survivor_id', p_survivor, 'merged_id', p_merged));
  return v_merge;
end;
$$;

-- Undo a merge: references go back, the survivor's chosen fields return to
-- what they were, the merged record is restored. Service role only.
create or replace function public.undo_merge(p_merge uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.record_merges%rowtype;
  v_table text;
  v_ref text;
  v_ids jsonb;
  v_field text;
  v_set text[] := '{}';
  v_subject text;
begin
  select * into v_m from public.record_merges where id = p_merge for update;
  if not found then
    raise exception 'Merge not found.' using errcode = 'P0002';
  end if;
  if v_m.status <> 'merged' then
    raise exception 'This merge was already undone.' using errcode = '23514';
  end if;
  if exists (select 1 from public.record_merges x where x.status = 'merged' and x.merged_at > v_m.merged_at
             and x.module = v_m.module and (x.survivor_id in (v_m.survivor_id, v_m.merged_id)
                                            or x.merged_id in (v_m.survivor_id, v_m.merged_id))) then
    raise exception 'Undo the later merge of these records first.' using errcode = '23514';
  end if;
  v_table := v_m.module;
  v_subject := app.merge_subject_type(v_m.module);

  perform set_config('app.merge_op', 'on', true);
  perform set_config('app.system_update', 'on', true);
  -- Same order as the merge (properties before jobs: a job's property must be on its account).
  for v_ref, v_ids in
    select x.ref, v_m.moved -> x.ref
    from unnest(app.merge_references(v_m.module) || array['notes.subject_id', 'comments.subject_id', 'tasks.subject_id',
                                                         'attention_items.subject_id']) with ordinality as x(ref, n)
    where v_m.moved ? x.ref order by x.n loop
    if v_ref like '%.subject_id' then
      if split_part(v_ref, '.', 1) not in ('notes', 'comments', 'tasks', 'attention_items') then
        raise exception 'Unexpected reference %.', v_ref using errcode = '22023';
      end if;
      execute format('update public.%I set subject_id = $1 where id in (select (jsonb_array_elements_text($3))::uuid) and subject_id = $2 and subject_type = $4',
                     split_part(v_ref, '.', 1))
      using v_m.merged_id, v_m.survivor_id, v_ids, v_subject;
    else
      if not (v_ref = any(app.merge_references(v_m.module))) then
        raise exception 'Unexpected reference %.', v_ref using errcode = '22023';
      end if;
      execute format('update public.%I set %I = $1 where id in (select (jsonb_array_elements_text($3))::uuid) and %I = $2',
                     split_part(v_ref, '.', 1), split_part(v_ref, '.', 2), split_part(v_ref, '.', 2))
      using v_m.merged_id, v_m.survivor_id, v_ids;
    end if;
  end loop;
  perform set_config('app.merge_op', 'off', true);
  perform set_config('app.system_update', 'off', true);

  -- Survivor fields back to their values before the merge.
  foreach v_field in array app.merge_fields(v_m.module) || array['custom_field_values'] loop
    v_set := v_set || format('%I = b.%I', v_field, v_field);
  end loop;
  if v_m.module = 'contacts' then
    v_set := v_set || array['do_not_contact = b.do_not_contact', 'opted_out_at = b.opted_out_at',
                            'email_opted_out_at = b.email_opted_out_at', 'sms_opt_in = b.sms_opt_in',
                            'email_opt_in = b.email_opt_in'];
  end if;
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $2) b where t.id = $1',
                 v_table, array_to_string(v_set, ', '), v_table)
  using v_m.survivor_id, v_m.survivor_before;

  execute format('update public.%I set deleted_at = null, deleted_by = null, delete_reason = null where id = $1', v_table)
  using v_m.merged_id;

  update public.record_merges
     set status = 'undone', undone_at = now(), undone_by = app.actor_id(),
         undo_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_merge;
  perform app.log_activity(v_m.org_id, v_subject, v_m.survivor_id::text, 'merge_undone',
    'Undid the merge of ' || coalesce(nullif(v_m.merged_label, ''), 'a duplicate'),
    jsonb_build_object('merge_id', p_merge, 'merged_id', v_m.merged_id));
  perform app.emit_event(v_m.org_id, 'merge.undone', 'record_merge', p_merge::text,
    jsonb_build_object('module', v_m.module, 'survivor_id', v_m.survivor_id, 'merged_id', v_m.merged_id));
end;
$$;

-- =============================================================================
-- 5. Export Controls: list and audit-log exports go to the same log
-- =============================================================================

alter table public.export_log drop constraint if exists export_log_kind_check;
alter table public.export_log add constraint export_log_kind_check
  check (kind in ('chart', 'kpi_table', 'report', 'report_schedule', 'list', 'audit_log', 'import_errors'));

-- =============================================================================
-- 6. Help Center (SPEC §8.17)
-- =============================================================================

create table public.kb_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text check (length(description) <= 300),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (org_id, key)
);

create or replace function app.kb_search_document(p_title text, p_summary text, p_tags text[], p_body text)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select setweight(to_tsvector('english'::regconfig, coalesce(p_title, '')), 'A')
      || setweight(to_tsvector('english'::regconfig, coalesce(p_summary, '') || ' '
                   || coalesce((select string_agg(t, ' ') from unnest(p_tags) t), '')), 'B')
      || setweight(to_tsvector('english'::regconfig, coalesce(p_body, '')), 'C');
$$;

create table public.kb_articles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  category_id uuid references public.kb_categories (id) on delete set null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null check (length(btrim(title)) between 1 and 160),
  summary text not null default '' check (length(summary) <= 300),
  body text not null default '' check (length(body) <= 40000),
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  audience text[] not null default '{}' check (audience <@ array['owner', 'office', 'sales', 'crew']::text[]),
  status text not null default 'draft' check (status in ('draft', 'published')),
  seed_key text check (seed_key ~ '^[a-z0-9_]{1,60}$'),
  sort_order integer not null default 0,
  published_at timestamptz,
  search tsvector generated always as (app.kb_search_document(title, summary, tags, body)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  unique (org_id, slug),
  unique (org_id, seed_key)
);
create index kb_articles_search_idx on public.kb_articles using gin (search);
create index kb_articles_tags_idx on public.kb_articles using gin (tags);
create index kb_articles_category_idx on public.kb_articles (org_id, category_id, sort_order) where deleted_at is null;

create or replace function app.kb_articles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    new.published_at := coalesce(new.published_at, now());
  end if;
  new.tags := array(select distinct lower(btrim(t)) from unnest(new.tags) t where btrim(t) <> '' order by 1);
  return new;
end;
$$;
create trigger kb_articles_guard before insert or update on public.kb_articles
  for each row execute function app.kb_articles_guard();

-- Read counts ("popular articles"), kept apart from the audited article.
create table public.kb_article_stats (
  article_id uuid primary key references public.kb_articles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  view_count integer not null default 0 check (view_count >= 0),
  last_viewed_at timestamptz
);

-- Counts a read (any signed-in person who can see the published article).
create or replace function public.kb_article_viewed(p_article uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
begin
  if v_org is null or app.is_impersonating() then
    return;
  end if;
  if not exists (select 1 from public.kb_articles a where a.id = p_article and a.org_id = v_org
                 and a.status = 'published' and a.deleted_at is null) then
    return;
  end if;
  insert into public.kb_article_stats (article_id, org_id, view_count, last_viewed_at)
  values (p_article, v_org, 1, now())
  on conflict (article_id) do update
    set view_count = public.kb_article_stats.view_count + 1, last_viewed_at = now();
end;
$$;

-- =============================================================================
-- 7. Commissions (SPEC §10) — disabled by default; owners configure every rate
-- =============================================================================

create table public.commission_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  enabled boolean not null default false,
  basis text not null default 'contract' check (basis in ('contract', 'collected')),
  overhead_deduction_percent numeric(5, 2) not null default 0 check (overhead_deduction_percent between 0 and 100),
  review_threshold_cents bigint check (review_threshold_cents is null or review_threshold_cents >= 0),
  -- Lead sources that count as self-generated (besides leads the rep set themselves).
  self_generated_sources text[] not null default '{}',
  require_cleared_funds boolean not null default true,
  notes text check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.commission_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  role_template_id uuid references public.role_templates (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  company_rate_percent numeric(6, 3) not null default 0 check (company_rate_percent between 0 and 100),
  self_rate_percent numeric(6, 3) not null default 0 check (self_rate_percent between 0 and 100),
  overhead_deduction_percent numeric(5, 2) check (overhead_deduction_percent is null or overhead_deduction_percent between 0 and 100),
  active boolean not null default true,
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  check (role_template_id is not null or user_id is not null)
);
create index commission_plans_org_idx on public.commission_plans (org_id) where deleted_at is null;

create table public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid references public.commission_plans (id) on delete set null,
  source_kind text not null check (source_kind in ('company', 'self')),
  basis_cents bigint not null default 0 check (basis_cents >= 0),
  overhead_cents bigint not null default 0 check (overhead_cents >= 0),
  rate_percent numeric(6, 3) not null default 0 check (rate_percent between 0 and 100),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending', 'eligible', 'needs_review', 'approved', 'paid', 'void')),
  reasons text[] not null default '{}',
  computed_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid,
  paid_on date,
  payroll_ref text check (length(payroll_ref) <= 80),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (job_id, user_id),
  check (status <> 'paid' or paid_on is not null),
  check (status not in ('approved', 'paid') or approved_at is not null)
);
create index commission_entries_user_idx on public.commission_entries (org_id, user_id, status);

create table public.commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  entry_id uuid references public.commission_entries (id) on delete set null,
  kind text not null check (kind in ('bonus', 'clawback', 'correction', 'other')),
  amount_cents bigint not null check (amount_cents between -100000000000 and 100000000000 and amount_cents <> 0),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'void')),
  approved_at timestamptz,
  approved_by uuid,
  paid_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (status <> 'paid' or paid_on is not null)
);
create index commission_adjustments_user_idx on public.commission_adjustments (org_id, user_id, status);

insert into public.commission_settings (org_id) select id from public.organizations on conflict (org_id) do nothing;

-- Paid entries are history: only their note can change.
create or replace function app.commission_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('approved', 'paid') then
      raise exception 'Approved and paid commissions stay on record. Void them instead.' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'paid'
     and (to_jsonb(new) - 'note' - 'updated_at' - 'updated_by') <> (to_jsonb(old) - 'note' - 'updated_at' - 'updated_by') then
    raise exception 'A paid commission can''t change.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' and new.status = 'approved'
     and (new.amount_cents <> old.amount_cents or new.basis_cents <> old.basis_cents) then
    raise exception 'An approved commission can''t be recalculated. Void it or add an adjustment.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger commission_entries_guard before insert or update or delete on public.commission_entries
  for each row execute function app.commission_entries_guard();

-- =============================================================================
-- 8. Demo data tags (SPEC §15.2). The demo script (`pnpm seed:demo`) sets
--    is_demo = true on everything it writes; migrations never insert demo rows.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'contacts', 'properties', 'leads', 'jobs', 'appointments', 'job_holds',
                           'estimates', 'invoices', 'payments', 'daily_logs', 'crews', 'crew_members',
                           'subcontractors', 'schedule_entries', 'work_orders', 'rain_delays', 'attention_items',
                           'tasks', 'notes', 'cases', 'referral_champions', 'punch_items', 'paint_orders',
                           'messages', 'credits'] loop
    execute format('alter table public.%I add column if not exists is_demo boolean not null default false', t);
    execute format('create index if not exists %I on public.%I (org_id) where is_demo', t || '_is_demo_idx', t);
  end loop;
end
$$;

-- Counts of demo records (Admin → Demo Data). Service role only.
create or replace function public.demo_data_counts(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t text;
  v_n bigint;
  v_out jsonb := '{}'::jsonb;
begin
  foreach t in array array['leads', 'accounts', 'contacts', 'properties', 'jobs', 'estimates', 'invoices', 'payments',
                           'daily_logs', 'crews', 'subcontractors', 'appointments', 'job_holds', 'attention_items'] loop
    execute format('select count(*) from public.%I where org_id = $1 and is_demo', t) into v_n using p_org;
    v_out := v_out || jsonb_build_object(t, v_n);
  end loop;
  return v_out;
end;
$$;

-- Removes every demo record of one company and everything hanging off it.
-- Service role only; the app checks that an owner asked. Never touches a
-- record without is_demo (or one that belongs only to demo records).
create or replace function public.purge_demo_data(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs uuid[];
  v_leads uuid[];
  v_accounts uuid[];
  v_contacts uuid[];
  v_crews uuid[];
  v_subjects uuid[];
  v_texts text[];
  v_n bigint;
  v_out jsonb := '{}'::jsonb;
begin
  if not app.is_trusted() then
    raise exception 'Only the server can purge demo data.' using errcode = '42501';
  end if;
  perform set_config('app.lock_override', 'on', true);
  perform set_config('app.system_update', 'on', true);

  select coalesce(array_agg(id), '{}') into v_jobs from public.jobs where org_id = p_org and is_demo;
  select coalesce(array_agg(id), '{}') into v_leads from public.leads where org_id = p_org and is_demo;
  select coalesce(array_agg(id), '{}') into v_accounts from public.accounts where org_id = p_org and is_demo;
  select coalesce(array_agg(id), '{}') into v_contacts from public.contacts where org_id = p_org and is_demo;
  select coalesce(array_agg(id), '{}') into v_crews from public.crews where org_id = p_org and is_demo;
  v_subjects := v_jobs || v_leads || v_accounts || v_contacts;
  select coalesce(array_agg(x::text), '{}') into v_texts from unnest(v_subjects) x;

  -- Messages and their threads, then the outbox rows they point to.
  delete from public.campaign_recipients where org_id = p_org
    and (contact_id = any(v_contacts) or lead_id = any(v_leads) or subject_id = any(v_subjects));
  delete from public.follow_up_attempts where org_id = p_org and subject_id = any(v_subjects);
  delete from public.drip_enrollments where org_id = p_org and subject_id = any(v_subjects);
  with d as (
    delete from public.messages where org_id = p_org
      and (is_demo or subject_id = any(v_subjects) or contact_id = any(v_contacts))
    returning outbox_id)
  delete from public.integration_outbox o using d where o.id = d.outbox_id;
  delete from public.integration_outbox where org_id = p_org and related_id = any(v_texts);
  delete from public.message_threads where org_id = p_org and (subject_id = any(v_subjects) or contact_id = any(v_contacts));

  -- Work items and timeline entries about demo records.
  delete from public.attention_items where org_id = p_org and (is_demo or subject_id = any(v_subjects));
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('attention_items', v_n);
  delete from public.tasks where org_id = p_org and (is_demo or subject_id = any(v_subjects));
  delete from public.notes where org_id = p_org and (is_demo or subject_id = any(v_subjects));
  delete from public.comments where org_id = p_org and subject_id = any(v_subjects);
  delete from public.activity where org_id = p_org and subject_id = any(v_texts);
  delete from public.workflow_runs where org_id = p_org and subject_id = any(v_texts);

  -- Growth records.
  delete from public.review_requests where org_id = p_org and (job_id = any(v_jobs) or contact_id = any(v_contacts));
  delete from public.referrals where org_id = p_org
    and (lead_id = any(v_leads) or job_id = any(v_jobs)
         or champion_id in (select id from public.referral_champions where org_id = p_org
                            and (is_demo or contact_id = any(v_contacts))));
  delete from public.referral_champions where org_id = p_org and (is_demo or contact_id = any(v_contacts));
  delete from public.cases where org_id = p_org
    and (is_demo or job_id = any(v_jobs) or account_id = any(v_accounts) or contact_id = any(v_contacts));

  -- Money first (applications hold invoices in place), then the jobs, which
  -- take their estimates, schedule, logs, photos, holds and history with them.
  delete from public.payments where org_id = p_org and (is_demo or job_id = any(v_jobs));
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('payments', v_n);
  update public.leads set converted_job_id = null where org_id = p_org and converted_job_id = any(v_jobs);
  delete from public.jobs where org_id = p_org and id = any(v_jobs);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('jobs', v_n);

  delete from public.lead_attachments where org_id = p_org and lead_id = any(v_leads);
  delete from public.leads where org_id = p_org and id = any(v_leads);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('leads', v_n);

  delete from public.documents where org_id = p_org and account_id = any(v_accounts);
  delete from public.properties where org_id = p_org and (is_demo or account_id = any(v_accounts));
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('properties', v_n);
  update public.accounts set primary_contact_id = null where org_id = p_org and primary_contact_id = any(v_contacts);
  delete from public.contacts where org_id = p_org and (id = any(v_contacts) or account_id = any(v_accounts));
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('contacts', v_n);
  delete from public.accounts where org_id = p_org and id = any(v_accounts);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('accounts', v_n);

  -- Crews and subcontractor companies.
  delete from public.crews where org_id = p_org and id = any(v_crews);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('crews', v_n);
  delete from public.subcontractors where org_id = p_org and is_demo;
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('subcontractors', v_n);

  perform set_config('app.system_update', 'off', true);
  perform set_config('app.lock_override', 'off', true);
  perform app.emit_event(p_org, 'demo_data.purged', 'organization', p_org::text, v_out);
  return v_out;
end;
$$;

-- Demo data only (pnpm seed:demo): backdates when a demo job entered its
-- current stage so "days in stage", attention items and job health look like
-- a real pipeline. Refuses any job that isn't demo data.
create or replace function public.demo_backdate_stage(p_job uuid, p_entered_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_trusted() then
    raise exception 'Only the server can change demo data.' using errcode = '42501';
  end if;
  if p_entered_at is null or p_entered_at > now() then
    raise exception 'The date must be in the past.' using errcode = '22023';
  end if;
  perform set_config('app.stage_change', 'on', true);
  update public.jobs set stage_entered_at = p_entered_at where id = p_job and is_demo;
  if not found then
    raise exception 'Only demo jobs can be backdated.' using errcode = 'P0002';
  end if;
  perform set_config('app.stage_change', 'off', true);
end;
$$;

-- =============================================================================
-- 9. Gate / lockbox codes for the crew on site today (SPEC §5.1, §13.1)
-- =============================================================================

-- True when the person is on (or leads) a crew with a published schedule day
-- at this property today (Pacific). Owners and the office keep their
-- permission-based access.
create or replace function app.crew_on_site_today(p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jobs j
    join public.schedule_entries s on s.job_id = j.id and s.status = 'published'
      and app.production_today() between s.starts_on and s.ends_on
    join public.crews c on c.id = s.crew_id and c.deleted_at is null and c.active
    where j.property_id = p_property and j.deleted_at is null and j.org_id = app.current_org_id()
      and j.status <> 'lost'
      and (c.lead_user_id = app.effective_user_id()
           or exists (select 1 from public.crew_members m
                      where m.crew_id = c.id and m.active and m.user_id = app.effective_user_id()))
  );
$$;

drop policy if exists property_secrets_select on public.property_secrets;
create policy property_secrets_select on public.property_secrets for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (
      ((select app.has_perm('properties:view_access_codes'))
       and exists (select 1 from public.properties p where p.id = property_id))
      or app.crew_on_site_today(property_id)
    )
  );

-- =============================================================================
-- 10. Job Recovery (Admin, owners): one row of facts per open job
-- =============================================================================

create or replace function public.job_recovery_scan(p_org uuid, p_limit integer default 2000)
returns table (
  job_id uuid,
  job_number text,
  name text,
  stage text,
  status text,
  stage_entered_at timestamptz,
  last_from_stage text,
  last_override boolean,
  last_changed_at timestamptz,
  gate_passes boolean,
  blocking_holds integer,
  milestones jsonb,
  has_published_schedule boolean,
  has_accepted_estimate boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.job_number, j.name, j.stage, j.status, j.stage_entered_at,
         h.from_stage, coalesce(h.override, false), h.changed_at,
         case
           when h.from_stage is null or h.override then null
           when app.job_stage_order(j.stage) = app.job_stage_order(h.from_stage) + 1 then app.job_gate_passes(j.id, h.from_stage)
           else null
         end,
         j.blocking_hold_count,
         jsonb_build_object(
           'walkthrough_scheduled_at', j.walkthrough_scheduled_at, 'walkthrough_completed_at', j.walkthrough_completed_at,
           'estimate_sent_at', j.estimate_sent_at, 'estimate_accepted_at', j.estimate_accepted_at,
           'contract_signed_at', j.contract_signed_at, 'deposit_paid_at', j.deposit_paid_at,
           'onboarding_started_at', j.onboarding_started_at, 'onboarding_completed_at', j.onboarding_completed_at,
           'ready_to_schedule_at', j.ready_to_schedule_at, 'scheduled_at', j.scheduled_at,
           'work_completed_at', j.work_completed_at, 'final_walkthrough_at', j.final_walkthrough_at,
           'completed_at', j.completed_at, 'final_invoiced_at', j.final_invoiced_at,
           'paid_in_full_at', j.paid_in_full_at, 'closed_at', j.closed_at, 'lost_at', j.lost_at,
           'actual_start_date', j.actual_start_date),
         exists (select 1 from public.schedule_entries s where s.job_id = j.id and s.status = 'published'),
         j.accepted_estimate_id is not null
  from public.jobs j
  left join lateral (
    select sh.from_stage, sh.override, sh.changed_at
    from public.stage_history sh where sh.job_id = j.id and sh.to_stage = j.stage
    order by sh.seq desc limit 1
  ) h on true
  where j.org_id = p_org and j.deleted_at is null and j.stage not in ('closed_won', 'closed_lost')
  order by j.stage_entered_at nulls first
  limit least(greatest(coalesce(p_limit, 2000), 1), 5000);
$$;

-- =============================================================================
-- 11. Stamps, audit, events
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['custom_field_definitions', 'validation_rules', 'module_layouts', 'imports', 'import_rows',
                           'bulk_updates', 'bulk_update_rows', 'record_merges', 'kb_categories', 'kb_articles',
                           'commission_settings', 'commission_plans', 'commission_entries', 'commission_adjustments'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function app.stamp_actor()', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end
$$;
create trigger custom_field_definitions_event after insert or update or delete on public.custom_field_definitions
  for each row execute function app.emit_change_event('custom_field');
create trigger validation_rules_event after insert or update or delete on public.validation_rules
  for each row execute function app.emit_change_event('validation_rule');
create trigger module_layouts_event after insert or update or delete on public.module_layouts
  for each row execute function app.emit_change_event('module_layout');
create trigger imports_event after insert or update or delete on public.imports
  for each row execute function app.emit_change_event('import', 'mapping', 'headers');
create trigger bulk_updates_event after insert or update or delete on public.bulk_updates
  for each row execute function app.emit_change_event('bulk_update', 'changes');
create trigger kb_categories_event after insert or update or delete on public.kb_categories
  for each row execute function app.emit_change_event('kb_category');
create trigger kb_articles_event after insert or update or delete on public.kb_articles
  for each row execute function app.emit_change_event('kb_article', 'body', 'search');
create trigger commission_settings_event after insert or update on public.commission_settings
  for each row execute function app.emit_change_event('commission_settings');
create trigger commission_plans_event after insert or update or delete on public.commission_plans
  for each row execute function app.emit_change_event('commission_plan');
create trigger commission_entries_event after insert or update or delete on public.commission_entries
  for each row execute function app.emit_change_event('commission_entry');
create trigger commission_adjustments_event after insert or update or delete on public.commission_adjustments
  for each row execute function app.emit_change_event('commission_adjustment');

-- =============================================================================
-- 12. Row level security
-- =============================================================================

alter table public.custom_field_definitions enable row level security;
alter table public.validation_rules enable row level security;
alter table public.module_layouts enable row level security;
alter table public.imports enable row level security;
alter table public.import_rows enable row level security;
alter table public.bulk_updates enable row level security;
alter table public.bulk_update_rows enable row level security;
alter table public.record_merges enable row level security;
alter table public.kb_categories enable row level security;
alter table public.kb_articles enable row level security;
alter table public.kb_article_stats enable row level security;
alter table public.commission_settings enable row level security;
alter table public.commission_plans enable row level security;
alter table public.commission_entries enable row level security;
alter table public.commission_adjustments enable row level security;

-- Module Manager: everyone in the company reads the definitions (forms and
-- lists need them); settings:manage changes them.
do $$
declare
  t text;
begin
  foreach t in array array['custom_field_definitions', 'validation_rules', 'module_layouts'] loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using (org_id = (select app.current_org_id()))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))
      with check (org_id = (select app.current_org_id()))$p$, t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (org_id = (select app.current_org_id()) and (select app.can_write('settings:manage')))$p$, t || '_delete', t);
  end loop;
end
$$;

-- Imports and bulk updates: bulk:update holders; the rows follow their parent.
do $$
declare
  t text;
begin
  foreach t in array array['imports', 'bulk_updates'] loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using (org_id = (select app.current_org_id()) and (select app.has_perm('bulk:update')))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (org_id = (select app.current_org_id()) and (select app.can_write('bulk:update')))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (org_id = (select app.current_org_id()) and (select app.can_write('bulk:update')))
      with check (org_id = (select app.current_org_id()))$p$, t || '_update', t);
  end loop;
end
$$;
create policy imports_delete on public.imports for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('bulk:update')) and status <> 'applied');

create policy import_rows_select on public.import_rows for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('bulk:update')));
create policy import_rows_insert on public.import_rows for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('bulk:update'))
              and exists (select 1 from public.imports i where i.id = import_id and i.status in ('mapping', 'review')));
create policy import_rows_update on public.import_rows for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('bulk:update')))
  with check (org_id = (select app.current_org_id()));
create policy import_rows_delete on public.import_rows for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('bulk:update'))
         and exists (select 1 from public.imports i where i.id = import_id and i.status in ('mapping', 'review', 'canceled')));

create policy bulk_update_rows_select on public.bulk_update_rows for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('bulk:update')));
create policy bulk_update_rows_insert on public.bulk_update_rows for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('bulk:update'))
              and exists (select 1 from public.bulk_updates b where b.id = bulk_update_id and b.status = 'preview'));
create policy bulk_update_rows_update on public.bulk_update_rows for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('bulk:update')))
  with check (org_id = (select app.current_org_id()));

-- Merges: written by merge_customers() (service role) only; records:merge reads.
create policy record_merges_select on public.record_merges for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_perm('records:merge')));
revoke insert, update, delete on public.record_merges from authenticated;

-- Help Center: everyone reads published articles; help:manage writes and sees drafts.
create policy kb_categories_select on public.kb_categories for select to authenticated
  using (org_id = (select app.current_org_id()));
create policy kb_categories_insert on public.kb_categories for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('help:manage')));
create policy kb_categories_update on public.kb_categories for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('help:manage')))
  with check (org_id = (select app.current_org_id()));
create policy kb_categories_delete on public.kb_categories for delete to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('help:manage')));
create policy kb_articles_select on public.kb_articles for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((status = 'published' and deleted_at is null) or (select app.has_perm('help:manage'))));
create policy kb_article_stats_select on public.kb_article_stats for select to authenticated
  using (org_id = (select app.current_org_id()));
revoke insert, update, delete on public.kb_article_stats from authenticated;
create policy kb_articles_insert on public.kb_articles for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('help:manage')));
create policy kb_articles_update on public.kb_articles for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('help:manage')))
  with check (org_id = (select app.current_org_id()));

-- Commissions: settings and plans for commission readers; your own entries
-- (or everyone's with an all-records scope); commissions:manage writes.
create policy commission_settings_select on public.commission_settings for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.has_perm('commissions:read')) or (select app.has_perm('commissions:manage'))));
create policy commission_settings_insert on public.commission_settings for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('commissions:manage')));
create policy commission_settings_update on public.commission_settings for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('commissions:manage')))
  with check (org_id = (select app.current_org_id()));
create policy commission_plans_select on public.commission_plans for select to authenticated
  using (org_id = (select app.current_org_id())
         and ((select app.has_perm('commissions:manage'))
              or ((select app.has_perm('commissions:read')) and deleted_at is null)));
create policy commission_plans_insert on public.commission_plans for insert to authenticated
  with check (org_id = (select app.current_org_id()) and (select app.can_write('commissions:manage')));
create policy commission_plans_update on public.commission_plans for update to authenticated
  using (org_id = (select app.current_org_id()) and (select app.can_write('commissions:manage')))
  with check (org_id = (select app.current_org_id()));
do $$
declare
  t text;
begin
  foreach t in array array['commission_entries', 'commission_adjustments'] loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using (org_id = (select app.current_org_id())
             and ((select app.has_perm('commissions:manage'))
                  or (select app.perm_scope('commissions:read')) = 'all'
                  or ((select app.has_perm('commissions:read')) and user_id = (select app.effective_user_id()))))$p$,
      t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (org_id = (select app.current_org_id()) and (select app.can_write('commissions:manage')))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (org_id = (select app.current_org_id()) and (select app.can_write('commissions:manage')))
      with check (org_id = (select app.current_org_id()))$p$, t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (org_id = (select app.current_org_id()) and (select app.can_write('commissions:manage')))$p$, t || '_delete', t);
  end loop;
end
$$;

grant select, insert, update, delete on public.custom_field_definitions, public.validation_rules, public.module_layouts,
  public.imports, public.import_rows, public.bulk_updates, public.bulk_update_rows, public.record_merges,
  public.kb_categories, public.kb_articles, public.kb_article_stats, public.commission_settings, public.commission_plans,
  public.commission_entries, public.commission_adjustments to service_role;

-- =============================================================================
-- 13. Function grants
-- =============================================================================

revoke execute on function public.merge_customers(text, uuid, uuid, jsonb, text), public.undo_merge(uuid, text),
  public.purge_demo_data(uuid), public.demo_data_counts(uuid), public.job_recovery_scan(uuid, integer),
  public.demo_backdate_stage(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.merge_customers(text, uuid, uuid, jsonb, text), public.undo_merge(uuid, text),
  public.purge_demo_data(uuid), public.demo_data_counts(uuid), public.job_recovery_scan(uuid, integer),
  public.demo_backdate_stage(uuid, timestamptz)
  to service_role;

revoke execute on function public.bulk_update_apply(uuid), public.bulk_update_revert(uuid, text),
  public.kb_article_viewed(uuid) from public, anon;
grant execute on function public.bulk_update_apply(uuid), public.bulk_update_revert(uuid, text),
  public.kb_article_viewed(uuid) to authenticated, service_role;

grant execute on function app.validation_standard_fields(text), app.bulk_fields(text), app.merge_fields(text),
  app.merge_references(text), app.merge_subject_type(text), app.rule_value_text(jsonb),
  app.custom_value_error(public.custom_field_definitions, jsonb), app.kb_search_document(text, text, text[], text),
  app.bulk_apply_patch(text, uuid, jsonb), app.bulk_current_values(text, uuid, jsonb),
  app.bulk_normalize(text, uuid, jsonb), app.crew_on_site_today(uuid) to authenticated, service_role;
