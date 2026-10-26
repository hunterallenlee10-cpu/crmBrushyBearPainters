-- Real configuration seed (SPEC §15.1). Never contains demo data.
-- Runs after migrations on `supabase db reset`. Idempotent.
-- Phase 0 seeds only the organization; roles, territories, picklists and
-- Company Settings (with placeholders) arrive in Phase 1.

insert into public.organizations (name, slug, timezone)
values ('Brushy Bear Painters', 'brushy-bear', 'America/Los_Angeles')
on conflict (slug) do nothing;
