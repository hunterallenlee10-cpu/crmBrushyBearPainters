-- Back to fully immutable messages (no deletes, even for the service role).
drop trigger messages_immutable on public.messages;
create trigger messages_immutable before update or delete on public.messages
  for each row execute function app.deny_write();
drop function if exists app.messages_deny_write();
