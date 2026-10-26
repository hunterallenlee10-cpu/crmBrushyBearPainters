-- Reverses supabase/migrations/20261026000400_audit_paging_outbox_events.sql (no data loss).

drop trigger if exists integration_outbox_event on public.integration_outbox;
drop index if exists public.audit_log_org_table_id_idx;
drop index if exists public.audit_log_org_id_idx;
