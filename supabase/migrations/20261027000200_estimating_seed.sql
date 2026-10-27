-- Phase 4 · Estimating configuration seed (SPEC §15.1, §7.2, §7.4, §7.6, §8.19).
--
-- Real configuration only, no demo jobs or estimates. Every production rate,
-- coverage, cost and price below is SAMPLE data (is_sample = true, shown with a
-- "Sample – Erik to calibrate" badge) until an owner edits it. Paint products
-- use brands from the picklist with generic names; they are not real SKUs or
-- real prices. Wording for interior, cabinet and deck/fence inclusions and the
-- agreement templates are drafts for the owners (and their attorney) to approve.
-- Idempotent: never overwrites what owners have edited.
--
-- Rollback: supabase/rollbacks/20261027000200_estimating_seed.down.sql

create or replace function app.seed_estimating_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_book uuid;
begin
  -- ---------------------------------------------------------------------------
  -- Estimate settings (SAMPLE values; Estimate Setup clears the flag on save)
  -- ---------------------------------------------------------------------------
  insert into public.estimate_settings (org_id, pricing, discount_limits, whats_included, guarantees,
                                        guarantees_status, lead_safe_disclosure, is_sample)
  values (
    p_org,
    jsonb_build_object(
      'loaded_labor_rate_cents', 6500,
      'sundries_percent', 8,
      'waste_percent', 10,
      'target_margin_percent', 50,
      'margin_floor_percent', 40,
      'minimum_job_cents', 150000,
      'height_multipliers', jsonb_build_object('one_story', 1, 'two_story', 1.25, 'three_plus', 1.5),
      'access_multipliers', jsonb_build_object('ladder', 1, 'tall_ladder', 1.1, 'staging', 1.25, 'lift', 1.15),
      'coat_factors', jsonb_build_object('1', 1, '2', 1.75, '3', 2.5),
      'prep_level_factors', jsonb_build_object('light', 0.5, 'standard', 1, 'heavy', 1.75),
      'spot_primer_fraction', 0.25,
      'color_change_rule', jsonb_build_object('light_to_dark', 'extra_coat', 'dark_to_light', 'primer'),
      'lead_safe_labor_percent', 15,
      'rrp_supplies_cost_cents', 7500,
      'crew_size', 2,
      'hours_per_crew_day', 8,
      'door_deduction_sqft', 21,
      'window_deduction_sqft', 15,
      'gable_factor', 1.15
    ),
    jsonb_build_object('roles', jsonb_build_object('estimator', 5, 'office_manager', 10), 'users', '{}'::jsonb),
    jsonb_build_object(
      -- From the website (SPEC §7.6), word for word.
      'exterior', jsonb_build_object('status', 'approved', 'source', 'website', 'items', jsonb_build_array(
        'plants/decks/walkways/windows/fixtures covered or masked before work starts',
        'washing siding and trim to remove dirt, chalky old paint, mildew and moss',
        'scraping and sanding loose or peeling paint back to a sound edge',
        'soft or rotted wood pointed out to you, with any repair quoted before we paint over it',
        'caulking open joints, trim seams and gaps around windows and doors',
        'priming bare wood, repairs and stained areas',
        'finish coats on siding, trim, fascia, soffits and doors',
        'daily cleanup of paint chips, drop cloths and equipment',
        'a crew-lead quality check and a final walkthrough, with touch-ups fixed on the spot')),
      -- Drafts in the same voice: owner to approve.
      'interior', jsonb_build_object('status', 'draft', 'source', 'draft', 'items', jsonb_build_array(
        'furniture moved to the middle of the room and covered, and floors protected with drop cloths',
        'nail holes, cracks and dings patched and sanded smooth',
        'gaps along trim, corners and baseboards caulked',
        'stains spot-primed so they don''t bleed through',
        'the right sheen for each room: flatter on ceilings, tougher finishes in kitchens, baths and on trim',
        'clean, straight lines where walls meet ceilings and trim',
        'daily cleanup, with rooms put back the way we found them',
        'a crew-lead quality check and a final walkthrough, with touch-ups fixed on the spot')),
      'cabinets', jsonb_build_object('status', 'draft', 'source', 'draft', 'items', jsonb_build_array(
        'doors, drawer fronts and hardware labeled, removed and stored safely',
        'counters, floors, appliances and the cabinet boxes masked and covered',
        'every surface degreased and cleaned',
        'scuff-sanding so the primer grips',
        'a bonding primer, then sprayed enamel finish coats',
        'doors and drawers given time to cure before they go back up',
        'everything reinstalled and adjusted so doors close evenly',
        'daily cleanup and a final walkthrough, with touch-ups fixed on the spot')),
      'deck_fence', jsonb_build_object('status', 'draft', 'source', 'draft', 'items', jsonb_build_array(
        'plants, siding and nearby surfaces covered before work starts',
        'boards cleaned to remove dirt, mildew and gray, weathered wood',
        'a wood brightener to bring back the color and open the grain',
        'time for the wood to dry before any stain goes on',
        'loose boards and popped nails pointed out to you, with any repair quoted first',
        'stain on the boards, railings and posts in the scope',
        'cleanup of the yard and work area every day',
        'a final walkthrough, with touch-ups fixed on the spot'))
    ),
    -- Website promises (SPEC §1.3). Amounts come from Company Settings.
    jsonb_build_array(
      jsonb_build_object('key', 'estimate_24h', 'title', 'Written estimate in 24 hours', 'body', 'After the walkthrough, your written estimate arrives within {{company.estimate_sla_hours}} hours.', 'enabled', true),
      jsonb_build_object('key', 'one_point_of_contact', 'title', 'One point of contact', 'body', '{{job.point_of_contact}} is your person from the first call to the final walkthrough.', 'enabled', true),
      jsonb_build_object('key', 'daily_photo_update', 'title', 'A photo update every day', 'body', 'A photo update every day your job is in progress.', 'enabled', true),
      jsonb_build_object('key', 'clean_house', 'title', 'A clean house every evening', 'body', 'A clean house every evening.', 'enabled', true),
      jsonb_build_object('key', 'rain_day', 'title', 'Rain-day promise', 'body', 'You''re first on the schedule when it clears. The delay never costs you anything.', 'enabled', true),
      jsonb_build_object('key', 'on_time_start', 'title', 'On-time start', 'body', 'We start on the scheduled date or take {{company.on_time_guarantee}} off. Rain delays don''t count.', 'enabled', true)
    ),
    'draft',
    'Homes built before 1978 get lead-safe prep. [LEAD_SAFE_DISCLOSURE — owner to provide the customer disclosure; verify current Washington RRP requirements with the Department of Commerce]',
    true
  )
  on conflict (org_id) do nothing;

  -- ---------------------------------------------------------------------------
  -- Price book "Brushy Bear Standard"
  -- ---------------------------------------------------------------------------
  insert into public.price_books (org_id, name, description, active, is_default)
  select p_org, 'Brushy Bear Standard',
         'Surfaces, add-ons and fees used to build estimates. Sample numbers until Erik calibrates them.', true, true
  where not exists (select 1 from public.price_books b where b.org_id = p_org and lower(b.name) = 'brushy bear standard');
  select b.id into v_book from public.price_books b
  where b.org_id = p_org and lower(b.name) = 'brushy bear standard' and b.deleted_at is null;

  -- ---------------------------------------------------------------------------
  -- Paint catalog (SAMPLE: generic product names, made-up coverages and costs)
  -- ---------------------------------------------------------------------------
  insert into public.paint_products (org_id, brand, line, product, use, sheens, coverage_sqft_per_gal,
                                     cost_per_gal_cents, containers, is_primer, min_temp_f, notes, is_sample)
  select p_org, v.brand, v.line, v.product, v.use, v.sheens, v.coverage, v.cost, v.containers, v.primer, v.min_temp,
         'Sample product – Erik to calibrate (not a real SKU or price).', true
  from (values
    ('sherwin_williams', 'Interior (sample)', 'Interior acrylic wall paint', 'interior', array['flat', 'matte', 'eggshell', 'satin'], 400, 3800, array['gallon', 'five_gallon'], false, 50),
    ('sherwin_williams', 'Interior (sample)', 'Interior ceiling paint', 'interior', array['flat'], 375, 3000, array['gallon', 'five_gallon'], false, 50),
    ('miller_paint', 'Interior (sample)', 'Interior acrylic wall paint', 'interior', array['matte', 'eggshell', 'satin'], 400, 3400, array['gallon', 'five_gallon'], false, 50),
    ('benjamin_moore', 'Trim (sample)', 'Interior/exterior trim enamel', 'both', array['satin', 'semi_gloss', 'gloss'], 400, 5200, array['quart', 'gallon'], false, 50),
    ('benjamin_moore', 'Cabinet (sample)', 'Cabinet & trim enamel', 'interior', array['satin', 'semi_gloss'], 375, 6800, array['quart', 'gallon'], false, 50),
    ('benjamin_moore', 'Exterior (sample)', 'Exterior acrylic house paint', 'exterior', array['flat', 'satin'], 350, 5000, array['gallon', 'five_gallon'], false, 40),
    ('miller_paint', 'Exterior (sample)', 'Exterior acrylic house paint', 'exterior', array['flat', 'satin'], 350, 4600, array['gallon', 'five_gallon'], false, 40),
    ('ppg', 'Primer (sample)', 'Stain-blocking primer', 'both', array['flat'], 300, 3600, array['gallon', 'five_gallon'], true, 40),
    ('sherwin_williams', 'Primer (sample)', 'Bonding primer', 'both', array['flat'], 350, 4200, array['quart', 'gallon', 'five_gallon'], true, 50),
    ('behr', 'Stain (sample)', 'Semi-transparent deck & fence stain', 'exterior', array['flat'], 250, 4000, array['gallon', 'five_gallon'], false, 50)
  ) as v(brand, line, product, use, sheens, coverage, cost, containers, primer, min_temp)
  where not exists (select 1 from public.paint_products p where p.org_id = p_org and p.is_sample);

  -- ---------------------------------------------------------------------------
  -- Catalog: the surfaces in SPEC §7.2 and the add-ons in §1.2
  -- ---------------------------------------------------------------------------
  insert into public.catalog_items (org_id, price_book_id, item_type, family, code, name, unit, pricing_method,
                                    surface, work_type, work_order_phase, paint_sqft_per_unit, default_coats,
                                    default_method, default_product_id, unit_price_cents, unit_cost_cents,
                                    labor_hours_per_unit, taxable, is_optional_default, is_repair_allowance,
                                    allowance_note, customer_description, is_sample, sort_order)
  select p_org, v_book, v.item_type, v.family, v.code, v.name, v.unit, v.method,
         case when v.method = 'production_rate' then v.code end, v.work_type, v.phase, v.sqft, v.coats, v.paint_method,
         (select p.id from public.paint_products p where p.org_id = p_org and p.is_sample and p.product = v.product
          order by p.brand limit 1),
         v.price, v.cost, v.hours, true, v.optional, v.repair, v.note, v.customer, true, v.ord
  from (values
    -- Interior
    ('labor', 'interior_labor', 'int_walls', 'Walls', 'sqft', 'production_rate', 'interior', null, 1, 2, 'brush_roll', 'Interior acrylic wall paint', null, null, 0, false, false, null, null, 10),
    ('labor', 'interior_labor', 'int_ceilings', 'Ceilings', 'sqft', 'production_rate', 'interior', null, 1, 1, 'brush_roll', 'Interior ceiling paint', null, null, 0, false, false, null, null, 20),
    ('labor', 'interior_labor', 'int_accent_wall', 'Accent wall', 'sqft', 'production_rate', 'interior', null, 1, 2, 'brush_roll', 'Interior acrylic wall paint', null, null, 0, false, false, null, null, 30),
    ('labor', 'interior_labor', 'int_baseboard', 'Baseboard', 'lf', 'production_rate', 'interior', null, 0.5, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 40),
    ('labor', 'interior_labor', 'int_crown', 'Crown molding', 'lf', 'production_rate', 'interior', null, 0.5, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 50),
    ('labor', 'interior_labor', 'int_chair_rail', 'Chair rail', 'lf', 'production_rate', 'interior', null, 0.33, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 60),
    ('labor', 'interior_labor', 'int_door', 'Door', 'each', 'production_rate', 'interior', null, 21, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 70),
    ('labor', 'interior_labor', 'int_door_frame', 'Door frame', 'each', 'production_rate', 'interior', null, 7, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 80),
    ('labor', 'interior_labor', 'int_window_trim', 'Window trim', 'each', 'production_rate', 'interior', null, 6, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 90),
    ('labor', 'interior_labor', 'int_closet_small', 'Closet – small', 'each', 'production_rate', 'interior', null, 120, 2, 'brush_roll', 'Interior acrylic wall paint', null, null, 0, false, false, null, null, 100),
    ('labor', 'interior_labor', 'int_closet_walk_in', 'Closet – walk-in', 'each', 'production_rate', 'interior', null, 300, 2, 'brush_roll', 'Interior acrylic wall paint', null, null, 0, false, false, null, null, 110),
    ('labor', 'interior_labor', 'int_stair_railing', 'Stair railing & spindles', 'lf', 'production_rate', 'interior', null, 2, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 120),
    ('labor', 'interior_labor', 'int_built_ins', 'Built-ins', 'each', 'production_rate', 'interior', null, 40, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 130),
    -- Exterior
    ('labor', 'exterior_labor', 'ext_siding_cedar', 'Body siding – cedar/wood', 'sqft', 'production_rate', 'exterior', null, 1, 2, 'brush_roll', 'Exterior acrylic house paint', null, null, 0, false, false, null, null, 10),
    ('labor', 'exterior_labor', 'ext_siding_fiber_cement', 'Body siding – fiber-cement', 'sqft', 'production_rate', 'exterior', null, 1, 2, 'spray', 'Exterior acrylic house paint', null, null, 0, false, false, null, null, 20),
    ('labor', 'exterior_labor', 'ext_siding_vinyl', 'Body siding – vinyl', 'sqft', 'production_rate', 'exterior', null, 1, 2, 'spray', 'Exterior acrylic house paint', null, null, 0, false, false, null, null, 30),
    ('labor', 'exterior_labor', 'ext_siding_stucco', 'Body siding – stucco', 'sqft', 'production_rate', 'exterior', null, 1, 2, 'spray', 'Exterior acrylic house paint', null, null, 0, false, false, null, null, 40),
    ('labor', 'exterior_labor', 'ext_trim', 'Trim', 'lf', 'production_rate', 'exterior', null, 0.5, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 50),
    ('labor', 'exterior_labor', 'ext_fascia', 'Fascia', 'lf', 'production_rate', 'exterior', null, 0.75, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 60),
    ('labor', 'exterior_labor', 'ext_soffit', 'Soffit', 'sqft', 'production_rate', 'exterior', null, 1, 2, 'spray', 'Exterior acrylic house paint', null, null, 0, false, false, null, null, 70),
    ('labor', 'exterior_labor', 'ext_gutters', 'Gutters & downspouts (paint only)', 'lf', 'production_rate', 'exterior', null, 0.75, 2, 'brush_roll', 'Exterior acrylic house paint', null, null, 0, false, false, null, null, 80),
    ('labor', 'exterior_labor', 'ext_entry_door', 'Entry door', 'each', 'production_rate', 'exterior', null, 21, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 90),
    ('labor', 'exterior_labor', 'ext_garage_door', 'Garage door', 'each', 'production_rate', 'exterior', null, 140, 2, 'brush_roll', 'Exterior acrylic house paint', null, null, 0, false, false, null, null, 100),
    ('labor', 'exterior_labor', 'ext_shutters', 'Shutters', 'pair', 'production_rate', 'exterior', null, 24, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 110),
    ('labor', 'exterior_labor', 'ext_window_trim', 'Window trim', 'each', 'production_rate', 'exterior', null, 8, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 120),
    ('labor', 'exterior_labor', 'ext_railings', 'Railings', 'lf', 'production_rate', 'exterior', null, 2, 2, 'brush_roll', 'Interior/exterior trim enamel', null, null, 0, false, false, null, null, 130),
    ('labor', 'exterior_labor', 'ext_foundation', 'Foundation', 'sqft', 'production_rate', 'exterior', null, 1, 2, 'brush_roll', 'Exterior acrylic house paint', null, null, 0, false, false, null, null, 140),
    -- Cabinets
    ('labor', 'cabinets', 'cab_doors', 'Cabinet doors', 'door', 'production_rate', 'cabinets', null, 12, 2, 'spray', 'Cabinet & trim enamel', null, null, 0, false, false, null, null, 10),
    ('labor', 'cabinets', 'cab_drawer_fronts', 'Drawer fronts', 'drawer', 'production_rate', 'cabinets', null, 3, 2, 'spray', 'Cabinet & trim enamel', null, null, 0, false, false, null, null, 20),
    ('labor', 'cabinets', 'cab_end_panels', 'End panels', 'each', 'production_rate', 'cabinets', null, 8, 2, 'spray', 'Cabinet & trim enamel', null, null, 0, false, false, null, null, 30),
    ('labor', 'cabinets', 'cab_island', 'Island', 'each', 'production_rate', 'cabinets', null, 40, 2, 'spray', 'Cabinet & trim enamel', null, null, 0, false, false, null, null, 40),
    ('labor', 'cabinets', 'cab_crown_light_rail', 'Crown / light rail', 'lf', 'production_rate', 'cabinets', null, 0.5, 2, 'spray', 'Cabinet & trim enamel', null, null, 0, false, false, null, null, 50),
    ('labor', 'cabinets', 'cab_box_interiors', 'Interiors of boxes', 'each', 'production_rate', 'cabinets', null, 10, 2, 'spray', 'Cabinet & trim enamel', null, null, 0, false, false, null, null, 60),
    ('labor', 'cabinets', 'cab_hardware', 'Hardware removal & reinstall', 'each', 'production_rate', 'cabinets', null, 0, 1, 'brush_roll', null, null, null, 0, false, false, null, null, 70),
    -- Deck & fence
    ('labor', 'deck_fence', 'deck_boards', 'Deck boards', 'sqft', 'production_rate', 'deck_fence', null, 1, 1, 'brush_roll', 'Semi-transparent deck & fence stain', null, null, 0, false, false, null, null, 10),
    ('labor', 'deck_fence', 'deck_stairs', 'Stairs', 'step', 'production_rate', 'deck_fence', null, 6, 1, 'brush_roll', 'Semi-transparent deck & fence stain', null, null, 0, false, false, null, null, 20),
    ('labor', 'deck_fence', 'deck_railings', 'Railings & balusters', 'lf', 'production_rate', 'deck_fence', null, 3, 1, 'brush_roll', 'Semi-transparent deck & fence stain', null, null, 0, false, false, null, null, 30),
    ('labor', 'deck_fence', 'fence', 'Fence (length × height)', 'sqft', 'production_rate', 'deck_fence', null, 1, 1, 'spray', 'Semi-transparent deck & fence stain', null, null, 0, false, false, null, null, 40),
    ('labor', 'deck_fence', 'pergola', 'Pergola', 'sqft', 'production_rate', 'deck_fence', null, 1, 1, 'brush_roll', 'Semi-transparent deck & fence stain', null, null, 0, false, false, null, null, 50),
    ('labor', 'deck_fence', 'deck_clean_brighten', 'Cleaning & brightening', 'sqft', 'production_rate', 'deck_fence', null, 0, 1, 'brush_roll', null, null, null, 0, false, false, null, null, 60),
    -- Add-ons (optional lines the customer picks)
    ('add_on', 'add_ons', 'pressure_washing', 'Pressure washing', 'sqft', 'flat', 'exterior', 'prep', 0, 1, 'brush_roll', null, 30, 12, 0.01, true, false, null, 'Pressure wash the driveway, walkways or patio.', 10),
    ('add_on', 'add_ons', 'rot_repair_allowance', 'Wood rot repair allowance', 'lf', 'flat', 'exterior', 'repair', 0, 1, 'brush_roll', null, 2500, 1200, 0.5, true, true, 'Covers up to the quantity shown. More rot than that is priced as a change order before we fix it ([T&M_RATE] per hour plus materials – owner to set).', 'Replace soft or rotted wood up to the length shown. Anything more is quoted before we fix it.', 20),
    ('add_on', 'add_ons', 'drywall_repair', 'Drywall repair', 'each', 'flat', 'interior', 'repair', 0, 1, 'brush_roll', null, 7500, 2500, 0.75, true, false, null, 'Patch and texture-match drywall damage (per patch).', 30),
    ('add_on', 'add_ons', 'trim_millwork', 'Trim & millwork', 'hour', 'flat', null, 'repair', 0, 1, 'brush_roll', null, 8500, 4500, 1, true, false, null, 'Repair or replace trim and millwork (per hour, materials extra).', 40),
    ('add_on', 'add_ons', 'color_consultation', 'Color consultation', 'lump', 'flat', null, null, 0, 1, 'brush_roll', null, 15000, 5000, 1, true, false, 'Credited if the job is booked (owner to confirm).', 'A color consultation at your home before we start.', 50)
  ) as v(item_type, family, code, name, unit, method, work_type, phase, sqft, coats, paint_method, product, price,
         cost, hours, optional, repair, note, customer, ord)
  where v_book is not null
  on conflict (price_book_id, code) do nothing;

  -- ---------------------------------------------------------------------------
  -- Production rates (SAMPLE). Base = brush & roll in good condition; fair and
  -- poor surfaces go slower and need more prep; spraying is faster.
  -- ---------------------------------------------------------------------------
  insert into public.production_rates (org_id, surface, method, condition, units_per_labor_hour,
                                       prep_hours_per_unit, notes, is_sample)
  select p_org, b.surface, m.method, c.condition,
         round((b.rate * m.rate_mult * c.rate_mult)::numeric, 4),
         round((b.prep * c.prep_mult)::numeric, 4),
         'Sample rate – Erik to calibrate.', true
  from (values
    ('int_walls', 175, 0.004), ('int_ceilings', 140, 0.002), ('int_accent_wall', 150, 0.004),
    ('int_baseboard', 45, 0.01), ('int_crown', 30, 0.01), ('int_chair_rail', 45, 0.01),
    ('int_door', 1.5, 0.1), ('int_door_frame', 2.5, 0.05), ('int_window_trim', 2, 0.08),
    ('int_closet_small', 0.75, 0.2), ('int_closet_walk_in', 0.35, 0.4), ('int_stair_railing', 6, 0.05),
    ('int_built_ins', 0.5, 0.3),
    ('ext_siding_cedar', 110, 0.012), ('ext_siding_fiber_cement', 140, 0.006), ('ext_siding_vinyl', 150, 0.005),
    ('ext_siding_stucco', 120, 0.006), ('ext_trim', 40, 0.015), ('ext_fascia', 35, 0.015), ('ext_soffit', 70, 0.008),
    ('ext_gutters', 30, 0.01), ('ext_entry_door', 0.75, 0.3), ('ext_garage_door', 0.3, 0.6),
    ('ext_shutters', 1, 0.2), ('ext_window_trim', 1.5, 0.15), ('ext_railings', 8, 0.05),
    ('ext_foundation', 120, 0.005),
    ('cab_doors', 1.2, 0.3), ('cab_drawer_fronts', 3, 0.12), ('cab_end_panels', 2, 0.15), ('cab_island', 0.25, 1),
    ('cab_crown_light_rail', 20, 0.02), ('cab_box_interiors', 1, 0.2), ('cab_hardware', 20, 0),
    ('deck_boards', 120, 0.006), ('deck_stairs', 4, 0.05), ('deck_railings', 12, 0.03), ('fence', 140, 0.004),
    ('pergola', 60, 0.01), ('deck_clean_brighten', 250, 0)
  ) as b(surface, rate, prep)
  cross join (values ('brush_roll', 1.0), ('spray', 1.6), ('mixed', 1.3)) as m(method, rate_mult)
  cross join (values ('good', 1.0, 1.0), ('fair', 0.85, 1.5), ('poor', 0.7, 2.5)) as c(condition, rate_mult, prep_mult)
  on conflict (org_id, surface, method, condition) do nothing;

  -- ---------------------------------------------------------------------------
  -- BearSign agreement templates: DRAFTS for the owners and their attorney.
  -- Square-bracket slots must be filled before a template can be published.
  -- ---------------------------------------------------------------------------
  insert into public.agreement_templates (org_id, doc_type, name, body, clauses, signer_roles, required_fields,
                                          status, is_default)
  select p_org, v.doc_type, v.name, v.body, v.clauses, array['customer'], v.required, 'draft', true
  from (values
    ('proposal', 'Proposal',
     E'# Proposal {{estimate.number}}\n\nPrepared for {{customer.name}} · {{property.address}}\nPrepared by {{company.name}} · WA L&I contractor reg. {{company.lni_number}} · UBI {{company.ubi_number}}\n\n## Terms\n[PROPOSAL_TERMS — owner/attorney to provide: payment schedule, what happens if the scope changes, how long prices hold]\n\n## Warranty\n[WARRANTY_TERMS — owner to provide]\n\n## Required notices\n[WA_CUSTOMER_DISCLOSURE_NOTICE — attorney to confirm which Washington notices must appear here]',
     '[]'::jsonb,
     array['company.name', 'company.lni_number', 'company.ubi_number', 'estimate.number', 'customer.name']),
    ('contract', 'Contract',
     E'# Contract for painting services\n\nThis agreement is between {{company.name}} (WA L&I contractor reg. {{company.lni_number}}, UBI {{company.ubi_number}}) and {{customer.name}} for the work described in accepted estimate {{estimate.number}} at {{property.address}}.\n\n## Scope\nThe option and add-ons the customer selected on the proposal, listed in this document.\n\n## Price and deposit\nContract price: {{estimate.total}}. Deposit: {{estimate.deposit}}.\n[PAYMENT_TERMS — owner/attorney to provide]\n\n## Schedule\n[SCHEDULE_TERMS — owner to provide]\n\n## Changes\n[CHANGE_ORDER_TERMS — attorney to provide]\n\n## Warranty\n[WARRANTY_TERMS — owner to provide]\n\n## Cancellation\n[CANCELLATION_TERMS — attorney to confirm Washington requirements]\n\n## Required notices\n[WA_CUSTOMER_DISCLOSURE_NOTICE — attorney to provide]\n[LIEN_DISCLOSURE — attorney to confirm whether a notice is required]',
     jsonb_build_array(
       jsonb_build_object('key', 'lead_safe', 'title', 'Lead-safe work', 'when', 'lead_safe',
                          'body', 'Homes built before 1978 get lead-safe prep. [LEAD_SAFE_CLAUSE — owner/attorney to provide]'),
       jsonb_build_object('key', 'hoa', 'title', 'HOA approval', 'when', 'hoa',
                          'body', '[HOA_CLAUSE — owner to provide: who gets HOA approval for color changes, and what happens if it''s denied]')),
     array['company.name', 'company.lni_number', 'company.ubi_number', 'estimate.number', 'estimate.total', 'customer.name']),
    ('change_order', 'Change order',
     E'# Change order {{change_order.number}}\n\nFor job {{job.number}} at {{property.address}}, under estimate {{estimate.number}}.\n\nReason: {{change_order.reason}}\n\nThis change: {{change_order.total}}. New contract amount after this change: {{contract.total}}.\n\n[CHANGE_ORDER_TERMS — attorney to provide]',
     '[]'::jsonb,
     array['change_order.number', 'change_order.total', 'customer.name']),
    ('lead_safe_ack', 'Lead-safe acknowledgment',
     E'# Lead-safe work acknowledgment\n\nHomes built before 1978 get lead-safe prep.\n\nCustomer: {{customer.name}} · Property: {{property.address}}\n\n[RRP_PAMPHLET_ACKNOWLEDGMENT — owner to provide the exact acknowledgment wording for the “Renovate Right” pamphlet; verify current requirements with the Washington State Department of Commerce]',
     '[]'::jsonb,
     array['customer.name', 'property.address'])
  ) as v(doc_type, name, body, clauses, required)
  where not exists (select 1 from public.agreement_templates t where t.org_id = p_org and t.doc_type = v.doc_type);

  -- ---------------------------------------------------------------------------
  -- Attention rules (SPEC §9) and permissions
  -- ---------------------------------------------------------------------------
  insert into public.attention_rules (org_id, rule_key, thresholds) values
    (p_org, 'estimate_awaiting_reply', '{"days": 3}'::jsonb),
    (p_org, 'estimate_expiring', '{"days": 5}'::jsonb)
  on conflict (org_id, rule_key) do nothing;

  -- Crew leads (and sales) can start a change order from the field.
  insert into public.pack_permissions (org_id, pack_id, permission, scope)
  select p_org, pk.id, 'change_orders:draft', 'all'
  from public.permission_packs pk
  where pk.org_id = p_org and pk.key in ('crew_lead', 'sales_all', 'sales_own')
  on conflict do nothing;
end;
$$;
revoke execute on function app.seed_estimating_defaults(uuid) from public, anon, authenticated;

select app.seed_estimating_defaults(id) from public.organizations;

-- Private bucket for documents (served through short-lived signed URLs only).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('documents', 'documents', false, 26214400,
            array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
    on conflict (id) do nothing;
  end if;
end
$$;
