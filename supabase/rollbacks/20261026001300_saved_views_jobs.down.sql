-- Removes saved job views, then restores the Phase 2 module list.
delete from public.saved_views where module = 'jobs';
alter table public.saved_views drop constraint saved_views_module_check,
  add constraint saved_views_module_check check (module in ('leads', 'accounts', 'contacts'));
