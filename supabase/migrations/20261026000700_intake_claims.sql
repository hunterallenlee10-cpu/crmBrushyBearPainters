-- Phase 2 follow-up (additive): the website intake claims an Idempotency-Key
-- before creating the lead, so two identical requests can never create two
-- leads; and the route reaches the rate limiter through a service-role-only RPC.

alter table public.intake_requests alter column lead_id drop not null;
alter table public.intake_requests drop constraint intake_requests_outcome_check;
alter table public.intake_requests add constraint intake_requests_outcome_check
  check (outcome in ('pending', 'created', 'duplicate'));
alter table public.intake_requests add constraint intake_requests_lead_when_done
  check (outcome = 'pending' or lead_id is not null);

create or replace function public.consume_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select app.consume_rate_limit(p_bucket, p_limit, p_window_seconds);
$$;
revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
