-- Background worker (SPEC §2 "events outbox + worker route hit by Vercel Cron").
-- claim_events() hands out a batch of due events exactly once: rows are locked
-- with SKIP LOCKED so overlapping runs never take the same event, and events
-- stuck in "processing" (a crashed run) are retried after the lock expires.

create or replace function public.claim_events(p_limit integer default 100, p_lock_seconds integer default 300)
returns setof public.events
language sql
security definer
set search_path = ''
as $$
  update public.events e
     set status = 'processing', locked_at = now(), attempts = e.attempts + 1
   where e.id in (
     select x.id from public.events x
      where (x.status = 'pending' and x.available_at <= now())
         or (x.status = 'processing' and x.locked_at < now() - make_interval(secs => p_lock_seconds))
      order by x.id
      limit least(greatest(coalesce(p_limit, 100), 1), 1000)
      for update skip locked
   )
  returning e.*;
$$;

revoke execute on function public.claim_events(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_events(integer, integer) to service_role;

-- Finding stuck "processing" events stays cheap.
create index if not exists events_processing_idx on public.events (locked_at) where status = 'processing';
