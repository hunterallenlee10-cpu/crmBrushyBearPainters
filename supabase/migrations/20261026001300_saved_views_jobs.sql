-- The Job List supports saved views and column choices like the other lists.
alter table public.saved_views drop constraint saved_views_module_check,
  add constraint saved_views_module_check check (module in ('leads', 'accounts', 'contacts', 'jobs'));
