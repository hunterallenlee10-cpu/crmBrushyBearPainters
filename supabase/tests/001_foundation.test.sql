-- Phase 0 foundation: organizations, updated_at trigger, per-year numbers.
begin;

insert into public.organizations (id, name, slug)
values
  ('00000000-0000-0000-0000-0000000000a1', 'Test Org A', 'test-org-a'),
  ('00000000-0000-0000-0000-0000000000b2', 'Test Org B', 'test-org-b');

-- Numbers -------------------------------------------------------------------
select tests.assert_eq(
  app.next_number('00000000-0000-0000-0000-0000000000a1', 'job', '2026-06-01T17:00:00Z'),
  'BB-2026-0001', 'first job number of the year is BB-2026-0001');

select tests.assert_eq(
  app.next_number('00000000-0000-0000-0000-0000000000a1', 'job', '2026-06-02T17:00:00Z'),
  'BB-2026-0002', 'job numbers increment');

select tests.assert_eq(
  app.next_number('00000000-0000-0000-0000-0000000000a1', 'estimate', '2026-06-02T17:00:00Z'),
  'EST-2026-0001', 'each kind has its own counter');

select tests.assert_eq(
  app.next_number('00000000-0000-0000-0000-0000000000b2', 'job', '2026-06-02T17:00:00Z'),
  'BB-2026-0001', 'each org has its own counter');

select tests.assert_eq(
  app.next_number('00000000-0000-0000-0000-0000000000a1', 'job', '2027-01-01T07:00:00Z'),
  'BB-2026-0003', '11 pm Dec 31 Pacific still counts as that year');

select tests.assert_eq(
  app.next_number('00000000-0000-0000-0000-0000000000a1', 'job', '2027-01-01T09:00:00Z'),
  'BB-2027-0001', 'counter restarts each Pacific year');

select tests.assert_eq(
  concat_ws(',',
    app.next_number('00000000-0000-0000-0000-0000000000a1', 'invoice', '2026-06-02T17:00:00Z'),
    app.next_number('00000000-0000-0000-0000-0000000000a1', 'payment', '2026-06-02T17:00:00Z'),
    app.next_number('00000000-0000-0000-0000-0000000000a1', 'work_order', '2026-06-02T17:00:00Z'),
    app.next_number('00000000-0000-0000-0000-0000000000a1', 'change_order', '2026-06-02T17:00:00Z')),
  'INV-2026-0001,PMT-2026-0001,WO-2026-0001,CO-2026-0001',
  'invoice, payment, work order and change order prefixes');

update app.number_sequences set last_value = 9999
where org_id = '00000000-0000-0000-0000-0000000000a1' and kind = 'job' and year = 2026;

select tests.assert_eq(
  app.next_number('00000000-0000-0000-0000-0000000000a1', 'job', '2026-06-03T17:00:00Z'),
  'BB-2026-10000', 'numbers past 9999 are not truncated');

select tests.assert_raises(
  $$select app.next_number('00000000-0000-0000-0000-0000000000a1', 'quote')$$,
  'unknown number kind is rejected', '22023');

select tests.assert_raises(
  $$select app.next_number('00000000-0000-0000-0000-00000000dead', 'job')$$,
  'unknown organization is rejected', '22023');

-- updated_at trigger --------------------------------------------------------
update public.organizations set updated_at = '2000-01-01', created_at = '2000-01-01'
where id = '00000000-0000-0000-0000-0000000000a1';
-- The BEFORE UPDATE trigger overwrote the value we tried to set.
select tests.assert(
  (select updated_at > '2000-01-02' from public.organizations where id = '00000000-0000-0000-0000-0000000000a1'),
  'updated_at is stamped by trigger on update');

-- Access: deny by default -----------------------------------------------------
set local role anon;
select tests.assert_eq((select count(*) from public.organizations), 0::bigint,
  'anon cannot read organizations');
select tests.assert_raises(
  $$select app.next_number('00000000-0000-0000-0000-0000000000a1', 'job')$$,
  'anon cannot mint numbers', '42501');
reset role;

set local role authenticated;
select tests.assert_eq((select count(*) from public.organizations), 0::bigint,
  'signed-in users see no organizations until Phase 1 policies exist');
select tests.assert_raises(
  $$select app.next_number('00000000-0000-0000-0000-0000000000a1', 'job')$$,
  'signed-in users cannot mint numbers directly', '42501');
select tests.assert_raises(
  $$select * from app.number_sequences$$,
  'signed-in users cannot read number counters', '42501');
reset role;

rollback;
