-- Phase 1 follow-up (additive).
-- 1. Indexes for Admin → Audit Log, which pages by id and filters by table.
-- 2. A domain event for every simulated send (SPEC §18 rule 9). The outbox row
--    itself is the full record of what would have been sent; the event carries
--    only ids, so no message text or recipient is copied into `events`.

create index audit_log_org_id_idx on public.audit_log (org_id, id desc);
create index audit_log_org_table_id_idx on public.audit_log (org_id, table_name, id desc);

create trigger integration_outbox_event after insert on public.integration_outbox
  for each row execute function app.emit_change_event('outbox_message');
