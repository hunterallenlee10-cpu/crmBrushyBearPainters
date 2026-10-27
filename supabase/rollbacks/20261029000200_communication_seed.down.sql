-- Rollback for 20261029000200_communication_seed.sql.
-- Removes the seeded configuration rows that nobody has changed since, and the
-- seed function. Rows an owner edited stay (they're the owners' data); the
-- schema rollback (20261029000100) drops the tables afterwards anyway.

delete from public.attention_items where rule_key in ('unread_message', 'warranty_request');
delete from public.attention_rules where rule_key in ('unread_message', 'warranty_request');
delete from public.message_templates where is_system and status = 'draft' and updated_by is null;
delete from public.workflow_runs;
delete from public.workflows where is_system;
delete from public.follow_up_dispositions where updated_by is null;
delete from public.follow_up_lists where updated_by is null;
delete from public.drip_enrollments where drip_id in (select id from public.drips where is_system);
delete from public.drips where is_system and updated_by is null;
delete from public.notification_settings where updated_by is null;
delete from public.messaging_settings where updated_by is null;
delete from public.referral_settings where updated_by is null;

drop function if exists app.seed_communication_defaults(uuid);
