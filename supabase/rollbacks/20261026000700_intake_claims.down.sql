-- Reverses supabase/migrations/20261026000700_intake_claims.sql.
-- Unfinished (pending) intake claims are removed first.

drop function if exists public.consume_rate_limit(text, integer, integer);
delete from public.intake_requests where lead_id is null;
alter table public.intake_requests drop constraint if exists intake_requests_lead_when_done;
alter table public.intake_requests drop constraint if exists intake_requests_outcome_check;
alter table public.intake_requests add constraint intake_requests_outcome_check
  check (outcome in ('created', 'duplicate'));
alter table public.intake_requests alter column lead_id set not null;
