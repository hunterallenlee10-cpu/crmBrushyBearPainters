-- Rollback for 20261031000200_hardening_seed.sql (Phase 10 · Help Center seed).
-- Removes the seeded categories and articles (owner edits to them are lost)
-- and the seed function. Owner-written articles stay unless their category goes.

delete from public.kb_articles where seed_key is not null;
delete from public.kb_categories c
where c.key in ('leads', 'estimates', 'money', 'production', 'field', 'closing')
  and not exists (select 1 from public.kb_articles a where a.category_id = c.id);
drop function if exists app.seed_help_defaults(uuid);
