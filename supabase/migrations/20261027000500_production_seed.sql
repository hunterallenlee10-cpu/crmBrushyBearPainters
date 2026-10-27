-- Phase 6 · Production configuration seed (SPEC §15.1, §5.4, §9, §13.3).
--
-- Real configuration only, no crews, jobs or schedules. Skills (§5.4), work
-- types with default durations (§15.1), work rules (§15.1, plus crew time off
-- and subcontractor paperwork, which the scheduler also checks), checklist
-- templates (§15.1; lead-safe items from §13.3), schedule settings (production
-- days Mon–Fri, 8:00 start, 30-minute arrival window from §11.2 #8, 8-hour
-- crew day, recommendations need approval and never run on their own, 15-minute
-- undo) and the production attention rules (§9). Everything is editable in
-- Admin → Schedule Admin / Attention Rules.
--
-- Idempotent (on conflict do nothing): safe to run on a database that already
-- has Phases 0–5 and never overwrites what owners have edited.
--
-- Rollback: supabase/rollbacks/20261027000500_production_seed.down.sql

create or replace function app.seed_production_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.skills (org_id, key, label, description, is_certification, sort_order) values
    (p_org, 'interior', 'Interior', 'Walls, ceilings, trim and doors.', false, 10),
    (p_org, 'exterior_high_access', 'Exterior high-access (2-story+)', 'Ladders, planks and lifts on two-story and taller homes.', false, 20),
    (p_org, 'spray_finish', 'Spray finish / cabinets', 'Sprayed enamel for cabinet doors, drawers and built-ins.', false, 30),
    (p_org, 'rrp_certified', 'Lead-safe RRP certified renovator', 'A certified renovator for pre-1978 homes. Track the certificate''s expiry.', true, 40),
    (p_org, 'staining', 'Staining', 'Decks, fences, railings and pergolas.', false, 50),
    (p_org, 'carpentry', 'Carpentry / rot repair', 'Wood rot repair and trim replacement.', false, 60),
    (p_org, 'drywall', 'Drywall', 'Drywall patching and repair.', false, 70),
    (p_org, 'pressure_washing', 'Pressure washing', 'Washing siding, decks and fences before prep.', false, 80)
  on conflict (org_id, key) do nothing;

  insert into public.work_types (org_id, key, label, default_minutes, assigned_role, required_skill_key, is_production, color, sort_order) values
    (p_org, 'walkthrough', 'Walkthrough / Estimate', 60, 'estimator', null, false, '#2563EB', 10),
    (p_org, 'color_consultation', 'Color Consultation', 60, 'estimator', null, false, '#7C3AED', 20),
    (p_org, 'interior_production', 'Interior Production Day', 480, 'crew', null, true, '#1F4D3A', 30),
    (p_org, 'exterior_production', 'Exterior Production Day', 480, 'crew', null, true, '#0F766E', 40),
    (p_org, 'cabinet_shop', 'Cabinet Spray / Shop Day', 480, 'crew', 'spray_finish', true, '#9A3412', 50),
    (p_org, 'deck_fence', 'Deck & Fence Day', 480, 'crew', null, true, '#854D0E', 60),
    (p_org, 'pressure_washing', 'Pressure Washing', 240, 'crew', null, true, '#0369A1', 70),
    (p_org, 'rot_repair', 'Rot Repair', 240, 'crew', 'carpentry', true, '#78350F', 80),
    (p_org, 'final_walkthrough', 'Final Walkthrough', 45, 'pm', null, false, '#15803D', 90),
    (p_org, 'touch_up', 'Touch-up Visit', 120, 'crew', null, true, '#4D7C0F', 100),
    (p_org, 'warranty_visit', 'Warranty Visit', 60, 'pm', null, false, '#B91C1C', 110),
    (p_org, 'paint_pickup', 'Paint Pickup', 60, 'pm', null, false, '#6B7280', 120)
  on conflict (org_id, key) do nothing;

  insert into public.work_rules (org_id, key, label, description, severity, owner_override, requires_weather, params, sort_order) values
    (p_org, 'walkthrough_before_production', 'Walkthrough before production',
     'Production can''t be scheduled until the walkthrough is completed with the result "Measured".', 'block', false, false, '{}'::jsonb, 10),
    (p_org, 'deposit_before_scheduling', 'Deposit before scheduling',
     'A job on Deposit Hold (or any hold that blocks scheduling) can''t go on the schedule.', 'block', false, false, '{}'::jsonb, 20),
    (p_org, 'hoa_before_exterior', 'HOA approval before exterior color change',
     'Exterior work on an HOA home waits for the HOA approval on the onboarding checklist.', 'block', false, false, '{}'::jsonb, 30),
    (p_org, 'lead_safe_renovator', 'Lead-safe certified renovator on pre-1978 jobs',
     'Pre-1978 (or not sure) homes need a crew with a current RRP certified renovator.', 'block', false, false, '{}'::jsonb, 40),
    (p_org, 'exterior_in_season', 'Exterior/deck only in season',
     'Exterior and deck & fence work stays inside the exterior season (Company Settings). An owner can override with a reason.',
     'block', true, false, '{}'::jsonb, 50),
    (p_org, 'weather_forecast', 'No exterior painting in rain or cold',
     'No exterior painting when the rain forecast is at or above the threshold, or the temperature is below the product''s minimum. Checked only when weather is connected.',
     'block', true, true, '{"rain_percent": 60}'::jsonb, 60),
    (p_org, 'max_jobs_per_crew_day', 'Max 1 active job per crew per day unless split',
     'A crew works one job a day (the crew''s own limit) unless the entry is marked "split".', 'block', false, false, '{}'::jsonb, 70),
    (p_org, 'spray_for_cabinets', 'Spray-finish skill required for cabinets',
     'Cabinet jobs go to crews with the "Spray finish / cabinets" skill.', 'block', false, false, '{"skill": "spray_finish"}'::jsonb, 80),
    (p_org, 'high_access_two_story', '2-story exterior requires high-access skill',
     'Exterior work on homes with two or more stories goes to crews with the high-access skill.', 'block', false, false,
     '{"skill": "exterior_high_access", "min_stories": 2}'::jsonb, 90),
    (p_org, 'crew_time_off', 'Crew time off and blackout dates',
     'Crews aren''t scheduled on their time off or on company blackout dates.', 'block', false, false, '{}'::jsonb, 100),
    (p_org, 'sub_compliance', 'Subcontractor paperwork current',
     'Subcontractor crews need current L&I registration and insurance (COI) on the scheduled days, and can''t be scheduled while suspended.',
     'block', false, false, '{}'::jsonb, 110)
  on conflict (org_id, key) do nothing;

  insert into public.checklist_templates (org_id, key, name, applies_to, items, sort_order) values
    (p_org, 'walkthrough', 'Walkthrough', 'walkthrough', jsonb_build_array(
      jsonb_build_object('key', 'measure_areas', 'label', 'Measure each area', 'required', true),
      jsonb_build_object('key', 'photos_every_area', 'label', 'Photos of every elevation/room', 'required', true),
      jsonb_build_object('key', 'note_repairs', 'label', 'Note rot and repairs', 'required', true),
      jsonb_build_object('key', 'year_built', 'label', 'Year built', 'required', true),
      jsonb_build_object('key', 'hoa', 'label', 'HOA', 'required', true),
      jsonb_build_object('key', 'colors_discussed', 'label', 'Colors discussed', 'required', true),
      jsonb_build_object('key', 'access_pets_parking', 'label', 'Access, pets and parking', 'required', true)), 10),
    (p_org, 'exterior_prep', 'Exterior Prep', 'exterior', jsonb_build_array(
      jsonb_build_object('key', 'wash', 'label', 'Wash', 'required', true),
      jsonb_build_object('key', 'moss_mildew', 'label', 'Moss/mildew treatment', 'required', true),
      jsonb_build_object('key', 'scrape_sand', 'label', 'Scrape/sand', 'required', true),
      jsonb_build_object('key', 'repairs', 'label', 'Repairs', 'required', true),
      jsonb_build_object('key', 'caulk', 'label', 'Caulk', 'required', true),
      jsonb_build_object('key', 'prime', 'label', 'Spot-prime/prime', 'required', true),
      jsonb_build_object('key', 'masking', 'label', 'Masking/protection', 'required', true)), 20),
    (p_org, 'interior_prep', 'Interior Prep', 'interior', jsonb_build_array(
      jsonb_build_object('key', 'furniture', 'label', 'Move/cover furniture', 'required', true),
      jsonb_build_object('key', 'floor_protection', 'label', 'Floor protection', 'required', true),
      jsonb_build_object('key', 'patch', 'label', 'Patch', 'required', true),
      jsonb_build_object('key', 'sand', 'label', 'Sand', 'required', true),
      jsonb_build_object('key', 'caulk', 'label', 'Caulk', 'required', true),
      jsonb_build_object('key', 'prime', 'label', 'Prime', 'required', true)), 30),
    (p_org, 'cabinet_process', 'Cabinet Process', 'cabinets', jsonb_build_array(
      jsonb_build_object('key', 'label_remove', 'label', 'Label & remove doors/drawers/hardware', 'required', true),
      jsonb_build_object('key', 'degrease', 'label', 'Degrease', 'required', true),
      jsonb_build_object('key', 'scuff_sand', 'label', 'Scuff-sand', 'required', true),
      jsonb_build_object('key', 'bonding_primer', 'label', 'Bonding primer', 'required', true),
      jsonb_build_object('key', 'spray_coats', 'label', 'Spray coats', 'required', true),
      jsonb_build_object('key', 'cure', 'label', 'Cure', 'required', true),
      jsonb_build_object('key', 'reinstall', 'label', 'Reinstall', 'required', true),
      jsonb_build_object('key', 'adjust', 'label', 'Adjust', 'required', true)), 40),
    (p_org, 'deck_fence', 'Deck & Fence', 'deck_fence', jsonb_build_array(
      jsonb_build_object('key', 'clean', 'label', 'Clean', 'required', true),
      jsonb_build_object('key', 'brighten', 'label', 'Brighten', 'required', true),
      jsonb_build_object('key', 'dry_time', 'label', 'Dry time', 'required', true),
      jsonb_build_object('key', 'stain', 'label', 'Stain', 'required', true),
      jsonb_build_object('key', 'protect_plants', 'label', 'Protect plants', 'required', true)), 50),
    (p_org, 'lead_safe', 'Lead-Safe', 'lead_safe', jsonb_build_array(
      jsonb_build_object('key', 'containment', 'label', 'Containment', 'required', true),
      jsonb_build_object('key', 'cleanup', 'label', 'Cleanup', 'required', true),
      jsonb_build_object('key', 'cleaning_verification', 'label', 'Cleaning verification', 'required', true)), 60),
    (p_org, 'daily_cleanup', 'Daily Cleanup', 'daily', jsonb_build_array(
      jsonb_build_object('key', 'cleanup_done', 'label', 'Cleanup done', 'required', true),
      jsonb_build_object('key', 'cleanup_photo', 'label', 'Cleanup photo', 'required', true)), 70),
    (p_org, 'final_walkthrough', 'Final Walkthrough', 'final_walkthrough', jsonb_build_array(
      jsonb_build_object('key', 'customer_walk', 'label', 'Customer walk', 'required', true),
      jsonb_build_object('key', 'punch_list', 'label', 'Punch list', 'required', true),
      jsonb_build_object('key', 'touch_ups', 'label', 'Touch-ups', 'required', true),
      jsonb_build_object('key', 'before_after_photos', 'label', 'Before/after photos', 'required', true),
      jsonb_build_object('key', 'sign_off', 'label', 'Sign-off', 'required', true)), 80)
  on conflict (org_id, key) do nothing;

  insert into public.schedule_settings (org_id) values (p_org) on conflict (org_id) do nothing;

  -- Production attention rules (SPEC §9). Weather risk stays dormant until weather is connected.
  insert into public.attention_rules (org_id, rule_key, thresholds) values
    (p_org, 'missing_crew', '{"days": 5}'::jsonb),
    (p_org, 'paint_not_ordered', '{"days": 3}'::jsonb),
    (p_org, 'missed_daily_update', '{"cutoff_hour": 19, "lookback_days": 3}'::jsonb),
    (p_org, 'punch_list_open', '{"days": 3}'::jsonb),
    (p_org, 'sub_compliance_expiring', '{"days": 30}'::jsonb),
    (p_org, 'weather_risk', '{"rain_percent": 60}'::jsonb)
  on conflict (org_id, rule_key) do nothing;
end;
$$;
revoke execute on function app.seed_production_defaults(uuid) from public, anon, authenticated;

select app.seed_production_defaults(id) from public.organizations;
