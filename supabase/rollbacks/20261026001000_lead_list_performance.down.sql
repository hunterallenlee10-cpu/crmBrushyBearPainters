-- Restores the Phase 2 originals: scope_match() policies, the earlier indexes,
-- and the earlier lead_status_counts() / lead_stats().

create index leads_org_status_created_idx on public.leads (org_id, status, created_at desc) where deleted_at is null;
create index leads_org_created_idx on public.leads (org_id, created_at desc) where deleted_at is null;
drop index public.leads_org_created_id_idx;
drop index public.leads_org_status_created_id_idx;

drop policy leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and app.scope_match((select app.perm_scope('leads:read')), owner_id, created_by, territory_id,
                        (select app.effective_user_id()), (select app.my_territory_id()))
  );

drop policy leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and app.scope_match((select app.perm_scope('leads:update')), owner_id, created_by, territory_id,
                        (select app.effective_user_id()), (select app.my_territory_id()))
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

drop policy accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and app.scope_match((select app.perm_scope('accounts:read')), owner_id, created_by, territory_id,
                        (select app.effective_user_id()), (select app.my_territory_id()))
  );

drop policy accounts_update on public.accounts;
create policy accounts_update on public.accounts for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and app.scope_match((select app.perm_scope('accounts:update')), owner_id, created_by, territory_id,
                        (select app.effective_user_id()), (select app.my_territory_id()))
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

drop policy contacts_select on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and exists (
      select 1 from public.accounts a where a.id = account_id
        and app.scope_match((select app.perm_scope('contacts:read')), a.owner_id, a.created_by, a.territory_id,
                            (select app.effective_user_id()), (select app.my_territory_id()))
    )
  );

drop policy contacts_update on public.contacts;
create policy contacts_update on public.contacts for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and exists (
      select 1 from public.accounts a where a.id = account_id
        and app.scope_match((select app.perm_scope('contacts:update')), a.owner_id, a.created_by, a.territory_id,
                            (select app.effective_user_id()), (select app.my_territory_id()))
    )
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

drop policy properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and exists (
      select 1 from public.accounts a where a.id = account_id
        and app.scope_match((select app.perm_scope('accounts:update')), a.owner_id, a.created_by, a.territory_id,
                            (select app.effective_user_id()), (select app.my_territory_id()))
    )
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and app.scope_match((select app.perm_scope('tasks:read')), assignee_id, created_by, null,
                        (select app.effective_user_id()), null)
    and (subject_id is null or app.can_see_subject(subject_type, subject_id))
  );

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('tasks:manage'))
    and app.scope_match((select app.perm_scope('tasks:manage')), assignee_id, created_by, null,
                        (select app.effective_user_id()), null)
  )
  with check (org_id = (select app.current_org_id()));

create or replace function public.lead_status_counts()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'active', count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')),
    'total', count(*),
    'new', count(*) filter (where status = 'new'),
    'contacted', count(*) filter (where status = 'contacted'),
    'walkthrough_scheduled', count(*) filter (where status = 'walkthrough_scheduled'),
    'nurture', count(*) filter (where status = 'nurture'),
    'mine', count(*) filter (where owner_id = app.effective_user_id()
                             and status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture'))
  )
  from public.leads;
$$;

create or replace function public.lead_stats(p_now timestamptz default now())
returns jsonb
language sql
stable
set search_path = ''
as $$
  with l as (
    select l.*, coalesce(t.name, case when l.out_of_area then 'Outside service area' else 'Unknown' end) as city_name
    from public.leads l
    left join public.territories t on t.id = l.territory_id
  ),
  open_l as (
    select * from l where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')
  )
  select jsonb_build_object(
    'total', (select count(*) from l),
    'open', (select count(*) from open_l),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from l group by status) s), '{}'::jsonb),
    'reached_contacted', (select count(*) from l where first_contacted_at is not null or status in ('contacted', 'walkthrough_scheduled', 'converted')),
    'reached_walkthrough', (select count(*) from l where walkthrough_at is not null or status in ('walkthrough_scheduled', 'converted')),
    'converted', (select count(*) from l where status = 'converted'),
    'unassigned', (select count(*) from open_l where owner_id is null),
    'hot', (select count(*) from open_l where temperature = 'hot'),
    'stale', (select count(*) from open_l where last_activity_at < p_now - interval '14 days'),
    'new_last_7_days', (select count(*) from l where created_at >= p_now - interval '7 days'),
    'aging', jsonb_build_object(
      '0_3', (select count(*) from open_l where created_at >= p_now - interval '3 days'),
      '4_7', (select count(*) from open_l where created_at < p_now - interval '3 days' and created_at >= p_now - interval '7 days'),
      '8_14', (select count(*) from open_l where created_at < p_now - interval '7 days' and created_at >= p_now - interval '14 days'),
      '15_30', (select count(*) from open_l where created_at < p_now - interval '14 days' and created_at >= p_now - interval '30 days'),
      '30_plus', (select count(*) from open_l where created_at < p_now - interval '30 days')
    ),
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('source', lead_source, 'leads', n, 'converted', c) order by n desc)
      from (select lead_source, count(*) n, count(*) filter (where status = 'converted') c
            from l group by lead_source order by count(*) desc limit 8) s), '[]'::jsonb),
    'by_city', coalesce((
      select jsonb_agg(jsonb_build_object('city', city_name, 'leads', n) order by n desc)
      from (select city_name, count(*) n from l group by city_name order by count(*) desc limit 10) c), '[]'::jsonb),
    'speed_to_lead_median_seconds', (
      select percentile_cont(0.5) within group (order by speed_to_lead_seconds)
      from l where speed_to_lead_seconds is not null and created_at >= p_now - interval '90 days')
  );
$$;
