-- Generates N fake leads for the list benchmark (local databases only).
-- Every row is tagged utm_campaign = 'bench-50k' so cleanup can remove them.
-- Usage (psql): \set n 50000  then \i scripts/bench/seed-leads.sql
\set ON_ERROR_STOP on

create temp table bench_users as
  select id, row_number() over (order by id) as rn
  from public.profiles
  where org_id = (select id from public.organizations where slug = 'brushy-bear') and is_active;

create temp table bench_zips as
  select unnest(zip_codes) as zip, name as city from public.territories
  where org_id = (select id from public.organizations where slug = 'brushy-bear') and is_service_area
  union all select '98101', 'Seattle' union all select '98118', 'Seattle' union all select '98270', 'Marysville';
alter table bench_zips add column rn serial;

insert into public.leads (
  org_id, first_name, last_name, mobile, email, street, city, zip, services, timeline, home_built,
  status, lost_reason, lead_source, lead_sub_source, owner_id, created_by, score, grade, temperature,
  created_at, last_activity_at, utm_campaign
)
select
  o.id,
  (array['Ava','Ben','Cara','Dan','Ella','Finn','Gia','Hank','Ivy','Jack','Kim','Liam','Maya','Noah','Owen','Pia','Quinn','Rosa','Sam','Tara'])[1 + (g % 20)],
  (array['Smith','Nguyen','Garcia','Kim','Patel','Johnson','Lee','Brown','Lopez','Chen','Wilson','Anderson','Taylor','Moore','Martin'])[1 + ((g / 20) % 15)],
  '+1425' || lpad(((g * 7919) % 10000000)::text, 7, '0'),
  case when g % 3 = 0 then null else 'bench' || g || '@example.com' end,
  (100 + g % 9900) || ' ' || (array['Main St','Oak Ave','Lake Dr','Pine Ln','Ridge Rd'])[1 + (g % 5)],
  z.city,
  z.zip,
  case g % 6
    when 0 then array['interior'] when 1 then array['exterior'] when 2 then array['cabinets']
    when 3 then array['interior', 'exterior'] when 4 then array['deck_fence'] else array['other']
  end,
  (array['asap','1_3_months','3_plus_months','just_planning'])[1 + (g % 4)],
  (array['before_1978','1978_or_later','not_sure'])[1 + (g % 3)],
  s.status,
  case when s.status = 'lost' then 'price' end,
  (array['website','website','website','google_ads','nextdoor','yelp','customer_referral','past_customer','yard_sign'])[1 + (g % 9)],
  case when g % 9 < 3 then (array['organic','google_ads','facebook_instagram','direct'])[1 + (g % 4)] end,
  case when g % 7 = 0 then null else (select id from bench_users where rn = 1 + (g % greatest((select count(*) from bench_users), 1))) end,
  (select id from bench_users where rn = 1 + ((g / 7) % greatest((select count(*) from bench_users), 1))),
  sc.score,
  case when sc.score >= 85 then 'A' when sc.score >= 70 then 'B' when sc.score >= 55 then 'C' when sc.score >= 40 then 'D' else 'F' end,
  case when sc.score >= 85 then 'hot' when sc.score >= 55 then 'warm' else 'cold' end,
  now() - ((g % 730) || ' days')::interval - ((g % 1440) || ' minutes')::interval,
  now() - ((g % 60) || ' days')::interval,
  'bench-50k'
from generate_series(1, :n) as g
cross join (select id from public.organizations where slug = 'brushy-bear') o
join bench_zips z on z.rn = 1 + (g % (select count(*) from bench_zips))
cross join lateral (select (array['new','new','contacted','contacted','walkthrough_scheduled','nurture','unqualified','converted','lost'])[1 + (g % 9)] as status) s
cross join lateral (select (20 + (g * 37) % 80)::smallint as score) sc;

analyze public.leads;
select count(*) as bench_leads from public.leads where utm_campaign = 'bench-50k';
