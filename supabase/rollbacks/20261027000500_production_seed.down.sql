-- Rolls back the Phase 6 production configuration seed. The seeded rows live
-- in Phase 6 tables (dropped by 20261027000400_production.down.sql); this
-- removes the production attention-rule thresholds and the seed function.

delete from public.attention_rules where rule_key in (
  'missing_crew', 'paint_not_ordered', 'missed_daily_update', 'punch_list_open',
  'sub_compliance_expiring', 'weather_risk');
delete from public.attention_items where rule_key in (
  'missing_crew', 'paint_not_ordered', 'missed_daily_update', 'punch_list_open',
  'sub_compliance_expiring', 'weather_risk');
drop function if exists app.seed_production_defaults(uuid);
