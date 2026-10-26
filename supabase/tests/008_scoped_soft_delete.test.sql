-- Deleting a lead/account/contact/property needs edit rights on that record,
-- even when a custom grant gives the delete permission.
begin;

create temp table u (k text primary key, id uuid) on commit drop;
insert into u values
  ('owner', tests.make_user('owner@test.bb', 'owner')),
  ('est', tests.make_user('est@test.bb', 'estimator')),
  ('est2', tests.make_user('est2@test.bb', 'estimator'));
grant select on u to authenticated;

-- Estimators edit only their own records; give one of them "delete" on top.
insert into public.user_permission_overrides (org_id, user_id, permission, effect, reason)
select tests.org_id(), (select id from u where k = 'est'), p, 'grant', 'Test delete grant'
from unnest(array['leads:delete', 'accounts:delete', 'contacts:delete']) p;

create temp table r (k text primary key, id uuid) on commit drop;
grant select on r to authenticated;
with ins as (
  insert into public.leads (org_id, first_name, email, lead_source, owner_id, created_by)
  values (tests.org_id(), 'Mine', 'mine@example.com', 'website', (select id from u where k = 'est'), (select id from u where k = 'est')),
         (tests.org_id(), 'Theirs', 'theirs@example.com', 'website', (select id from u where k = 'est2'), (select id from u where k = 'est2'))
  returning id, first_name
)
insert into r select 'lead_' || lower(first_name), id from ins;
with ins as (
  insert into public.accounts (org_id, display_name, owner_id, created_by)
  values (tests.org_id(), 'Their Account', (select id from u where k = 'est2'), (select id from u where k = 'est2'))
  returning id
)
insert into r select 'acct_theirs', id from ins;
with ins as (
  insert into public.contacts (org_id, account_id, first_name, email)
  values (tests.org_id(), (select id from r where k = 'acct_theirs'), 'Tess', 'tess@example.com')
  returning id
)
insert into r select 'contact_theirs', id from ins;

select tests.login((select id from u where k = 'est'));
select tests.assert_raises(
  format($q$select public.soft_delete_record('leads', %L, 'Not my lead')$q$, (select id from r where k = 'lead_theirs')),
  'a delete grant does not reach leads outside edit scope', 'P0002');
select tests.assert_raises(
  format($q$select public.soft_delete_record('accounts', %L, 'Not my account')$q$, (select id from r where k = 'acct_theirs')),
  'a delete grant does not reach accounts outside edit scope', 'P0002');
select tests.assert_raises(
  format($q$select public.soft_delete_record('contacts', %L, 'Not my contact')$q$, (select id from r where k = 'contact_theirs')),
  'a delete grant does not reach contacts on accounts outside edit scope', 'P0002');
select public.soft_delete_record('leads', (select id from r where k = 'lead_mine'), 'Duplicate entry');
select tests.logout();

select tests.assert((select deleted_at is not null from public.leads where id = (select id from r where k = 'lead_mine')),
  'own lead is deleted');
select tests.assert((select deleted_at is null from public.leads where id = (select id from r where k = 'lead_theirs')),
  'the other estimator''s lead is untouched');
select tests.assert((select deleted_at is null from public.contacts where id = (select id from r where k = 'contact_theirs')),
  'the other estimator''s contact is untouched');

-- Owners still delete anything.
select tests.login((select id from u where k = 'owner'));
select public.soft_delete_record('accounts', (select id from r where k = 'acct_theirs'), 'Owner cleanup');
select tests.logout();
select tests.assert((select deleted_at is not null from public.accounts where id = (select id from r where k = 'acct_theirs')),
  'owner can delete any account');

rollback;
