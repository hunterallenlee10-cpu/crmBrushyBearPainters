-- Real configuration seed (SPEC §15.1). Never contains demo data.
-- Runs after migrations on `supabase db reset`. Idempotent.
-- The migrations already create the Brushy Bear org and seed its defaults;
-- this re-applies them so a reset always ends in the same state.
-- Owners are created by `pnpm seed:owners` (reads SEED_OWNER_EMAILS).

insert into public.organizations (name, slug, timezone)
values ('Brushy Bear Painters', 'brushy-bear', 'America/Los_Angeles')
on conflict (slug) do nothing;

select app.seed_org_defaults(id) from public.organizations;
select app.seed_leads_defaults(id) from public.organizations;
