-- One timed run of the Lead List queries as a signed-in user (psql variables:
-- :uid = profile id). Mirrors what PostgREST runs for /leads/list: the page of
-- rows (with the owner join) and the exact count, under RLS.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
begin;
\echo '### _setup'
select set_config('request.jwt.claims',
  json_build_object('sub', :'uid', 'role', 'authenticated', 'aal', 'aal2',
                    'session_id', '00000000-0000-0000-0000-00000000beef')::text, true);
select set_config('request.jwt.claim.sub', :'uid', true);
set local role authenticated;

\echo '### active_page1'
explain (analyze, format json) select l.id, l.first_name, l.last_name, l.status, l.score, l.created_at, p.full_name
  from public.leads l left join public.profiles p on p.id = l.owner_id
  where l.status in ('new','contacted','walkthrough_scheduled','nurture')
  order by l.created_at desc nulls last, l.id limit 25 offset 0;
\echo '### active_count'
explain (analyze, format json) select count(*) from public.leads l
  where l.status in ('new','contacted','walkthrough_scheduled','nurture');

\echo '### search_smith'
explain (analyze, format json) select l.id, l.first_name, l.last_name, p.full_name
  from public.leads l left join public.profiles p on p.id = l.owner_id
  where l.status in ('new','contacted','walkthrough_scheduled','nurture')
    and (l.search_text ilike '%smith%' or l.lead_source ilike '%smith%')
  order by l.created_at desc nulls last, l.id limit 25;
\echo '### search_smith_count'
explain (analyze, format json) select count(*) from public.leads l
  where l.status in ('new','contacted','walkthrough_scheduled','nurture')
    and (l.search_text ilike '%smith%' or l.lead_source ilike '%smith%');

\echo '### search_phone'
explain (analyze, format json) select l.id from public.leads l
  where l.phone_digits ilike '%4255551%' order by l.created_at desc nulls last, l.id limit 25;

\echo '### hot_chip'
explain (analyze, format json) select l.id, l.first_name from public.leads l
  where l.status in ('new','contacted','walkthrough_scheduled','nurture') and l.temperature = 'hot'
  order by l.created_at desc nulls last, l.id limit 25;

\echo '### advanced_score_90d_sort_activity'
explain (analyze, format json) select l.id, l.first_name from public.leads l
  where l.score > 70 and l.created_at >= now() - interval '90 days'
  order by l.last_activity_at desc nulls last, l.id limit 25;
\echo '### advanced_count'
explain (analyze, format json) select count(*) from public.leads l
  where l.score > 70 and l.created_at >= now() - interval '90 days';

\echo '### deep_page_200'
explain (analyze, format json) select l.id from public.leads l
  where l.status in ('new','contacted','walkthrough_scheduled','nurture')
  order by l.created_at desc nulls last, l.id limit 25 offset 4975;

\echo '### tab_counts_rpc'
explain (analyze, format json) select public.lead_status_counts();
\echo '### dashboard_stats_rpc'
explain (analyze, format json) select public.lead_stats();
\echo '### universal_search_rpc'
explain (analyze, format json) select * from public.search_records('smith', 'all', 8);
rollback;
