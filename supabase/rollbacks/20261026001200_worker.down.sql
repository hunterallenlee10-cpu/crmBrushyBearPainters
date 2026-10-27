-- Removes the worker's event-claiming function.
drop function if exists public.claim_events(integer, integer);
drop index if exists public.events_processing_idx;
