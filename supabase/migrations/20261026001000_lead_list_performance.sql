-- Lead List / dashboard speed at 50k leads (Phase 2 "done when": < 300 ms).
--
-- 1. Indexes that match the list's sort (created_at desc nulls last, id) and
--    cover the columns row security reads, so page 1 and the counts don't
--    read and sort every open lead.
-- 2. Row-security policies spell out the scope rule instead of calling
--    app.scope_match(). Postgres can't inline that function when its
--    arguments are sub-selects used more than once, so it ran once per row
--    (~75 ms per 33k rows). Same rule:
--      all  → every record in the company
--      own  → I own it or created it
--      team → own, plus anything in my territory
-- 3. lead_status_counts() reads the current user once, not per row.
-- 4. lead_stats() aggregates in a few passes instead of ~15 scans.

-- 1. Indexes ----------------------------------------------------------------------------
create index leads_org_created_id_idx
  on public.leads (org_id, created_at desc nulls last, id)
  where deleted_at is null;
create index leads_org_status_created_id_idx
  on public.leads (org_id, status, created_at desc nulls last, id)
  include (owner_id, created_by, territory_id)
  where deleted_at is null;
drop index public.leads_org_created_idx;
drop index public.leads_org_status_created_idx;

-- 2. Policies ---------------------------------------------------------------------------
drop policy leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and (
      (select app.perm_scope('leads:read')) = 'all'
      or ((select app.perm_scope('leads:read')) in ('own', 'team')
          and (select app.effective_user_id()) in (owner_id, created_by))
      or ((select app.perm_scope('leads:read')) = 'team' and territory_id = (select app.my_territory_id()))
    )
  );

drop policy leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and (
      (select app.perm_scope('leads:update')) = 'all'
      or ((select app.perm_scope('leads:update')) in ('own', 'team')
          and (select app.effective_user_id()) in (owner_id, created_by))
      or ((select app.perm_scope('leads:update')) = 'team' and territory_id = (select app.my_territory_id()))
    )
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

drop policy accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and (
      (select app.perm_scope('accounts:read')) = 'all'
      or ((select app.perm_scope('accounts:read')) in ('own', 'team')
          and (select app.effective_user_id()) in (owner_id, created_by))
      or ((select app.perm_scope('accounts:read')) = 'team' and territory_id = (select app.my_territory_id()))
    )
  );

drop policy accounts_update on public.accounts;
create policy accounts_update on public.accounts for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and (
      (select app.perm_scope('accounts:update')) = 'all'
      or ((select app.perm_scope('accounts:update')) in ('own', 'team')
          and (select app.effective_user_id()) in (owner_id, created_by))
      or ((select app.perm_scope('accounts:update')) = 'team' and territory_id = (select app.my_territory_id()))
    )
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

drop policy contacts_select on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and exists (
      select 1 from public.accounts a where a.id = account_id
        and (
          (select app.perm_scope('contacts:read')) = 'all'
          or ((select app.perm_scope('contacts:read')) in ('own', 'team')
              and (select app.effective_user_id()) in (a.owner_id, a.created_by))
          or ((select app.perm_scope('contacts:read')) = 'team' and a.territory_id = (select app.my_territory_id()))
        )
    )
  );

drop policy contacts_update on public.contacts;
create policy contacts_update on public.contacts for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and exists (
      select 1 from public.accounts a where a.id = account_id
        and (
          (select app.perm_scope('contacts:update')) = 'all'
          or ((select app.perm_scope('contacts:update')) in ('own', 'team')
              and (select app.effective_user_id()) in (a.owner_id, a.created_by))
          or ((select app.perm_scope('contacts:update')) = 'team' and a.territory_id = (select app.my_territory_id()))
        )
    )
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

drop policy properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and not (select app.is_impersonating())
    and exists (
      select 1 from public.accounts a where a.id = account_id
        and (
          (select app.perm_scope('accounts:update')) = 'all'
          or ((select app.perm_scope('accounts:update')) in ('own', 'team')
              and (select app.effective_user_id()) in (a.owner_id, a.created_by))
          or ((select app.perm_scope('accounts:update')) = 'team' and a.territory_id = (select app.my_territory_id()))
        )
    )
  )
  with check (org_id = (select app.current_org_id()) and deleted_at is null);

-- Tasks have no territory, so "team" works like "own" (assigned to me or created by me).
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null
    and (
      (select app.perm_scope('tasks:read')) = 'all'
      or ((select app.perm_scope('tasks:read')) in ('own', 'team')
          and (select app.effective_user_id()) in (assignee_id, created_by))
    )
    and (subject_id is null or app.can_see_subject(subject_type, subject_id))
  );

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    org_id = (select app.current_org_id()) and deleted_at is null and (select app.can_write('tasks:manage'))
    and (
      (select app.perm_scope('tasks:manage')) = 'all'
      or ((select app.perm_scope('tasks:manage')) in ('own', 'team')
          and (select app.effective_user_id()) in (assignee_id, created_by))
    )
  )
  with check (org_id = (select app.current_org_id()));

-- 3. Tab counts ---------------------------------------------------------------------------
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
    'mine', count(*) filter (where owner_id = (select app.effective_user_id())
                             and status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture'))
  )
  from public.leads;
$$;

-- 4. Dashboard stats ------------------------------------------------------------------------
create or replace function public.lead_stats(p_now timestamptz default now())
returns jsonb
language sql
stable
set search_path = ''
as $$
  with agg as (
    select
      count(*) as total,
      count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')) as open,
      count(*) filter (where first_contacted_at is not null
                        or status in ('contacted', 'walkthrough_scheduled', 'converted')) as reached_contacted,
      count(*) filter (where walkthrough_at is not null
                        or status in ('walkthrough_scheduled', 'converted')) as reached_walkthrough,
      count(*) filter (where status = 'converted') as converted,
      count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture') and owner_id is null) as unassigned,
      count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture') and temperature = 'hot') as hot,
      count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')
                        and last_activity_at < p_now - interval '14 days') as stale,
      count(*) filter (where created_at >= p_now - interval '7 days') as new_last_7_days,
      count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')
                        and created_at >= p_now - interval '3 days') as age_0_3,
      count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')
                        and created_at < p_now - interval '3 days' and created_at >= p_now - interval '7 days') as age_4_7,
      count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')
                        and created_at < p_now - interval '7 days' and created_at >= p_now - interval '14 days') as age_8_14,
      count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')
                        and created_at < p_now - interval '14 days' and created_at >= p_now - interval '30 days') as age_15_30,
      count(*) filter (where status in ('new', 'contacted', 'walkthrough_scheduled', 'nurture')
                        and created_at < p_now - interval '30 days') as age_30_plus,
      percentile_cont(0.5) within group (order by speed_to_lead_seconds)
        filter (where speed_to_lead_seconds is not null and created_at >= p_now - interval '90 days') as speed
    from public.leads
  )
  select jsonb_build_object(
    'total', a.total,
    'open', a.open,
    'by_status', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from public.leads group by status) s), '{}'::jsonb),
    'reached_contacted', a.reached_contacted,
    'reached_walkthrough', a.reached_walkthrough,
    'converted', a.converted,
    'unassigned', a.unassigned,
    'hot', a.hot,
    'stale', a.stale,
    'new_last_7_days', a.new_last_7_days,
    'aging', jsonb_build_object('0_3', a.age_0_3, '4_7', a.age_4_7, '8_14', a.age_8_14,
                                '15_30', a.age_15_30, '30_plus', a.age_30_plus),
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('source', lead_source, 'leads', n, 'converted', c) order by n desc, lead_source)
      from (select lead_source, count(*) n, count(*) filter (where status = 'converted') c
            from public.leads group by lead_source order by count(*) desc, lead_source limit 8) s), '[]'::jsonb),
    'by_city', coalesce((
      select jsonb_agg(jsonb_build_object('city', city_name, 'leads', n) order by n desc, city_name)
      from (select coalesce(t.name, case when l.out_of_area then 'Outside service area' else 'Unknown' end) as city_name,
                   count(*) n
            from public.leads l left join public.territories t on t.id = l.territory_id
            group by 1 order by count(*) desc, 1 limit 10) c), '[]'::jsonb),
    'speed_to_lead_median_seconds', a.speed
  )
  from agg a;
$$;
