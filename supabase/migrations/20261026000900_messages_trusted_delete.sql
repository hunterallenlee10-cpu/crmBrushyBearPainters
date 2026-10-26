-- Messages stay append-only for people: nobody signed in can edit or delete
-- one. Trusted server code (service role) may delete, so test cleanup and the
-- Phase 10 demo-data purge can remove a lead's messages (and the outbox rows
-- they reference) instead of leaving them behind. Edits stay blocked for
-- everyone. Deletes are still audit-logged.

create or replace function app.messages_deny_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and app.is_trusted() then
    return old;
  end if;
  raise exception 'This record cannot be changed.' using errcode = '42501';
end;
$$;

drop trigger messages_immutable on public.messages;
create trigger messages_immutable before update or delete on public.messages
  for each row execute function app.messages_deny_write();
