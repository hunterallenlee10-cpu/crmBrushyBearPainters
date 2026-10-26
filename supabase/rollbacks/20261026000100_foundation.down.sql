-- Reverses supabase/migrations/20261026000100_foundation.sql
-- Destructive: drops organizations and all numbering state. Ask before running anywhere but local.

drop function if exists app.next_number(uuid, text, timestamptz);
drop function if exists app.number_prefix(text);
drop table if exists app.number_sequences;
drop table if exists public.organizations;
drop function if exists app.set_updated_at();
drop schema if exists app;
