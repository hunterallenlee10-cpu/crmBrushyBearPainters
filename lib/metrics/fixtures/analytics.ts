import type { AnalyticsMetricId, AnalyticsStats } from "@/lib/metrics/registry";

/**
 * The Phase 9 fixture (SPEC §12.1 "each metric has a unit test against seeded
 * fixtures with a known expected value"). supabase/tests/015_analytics.test.sql
 * inserts this scenario (March 2026, Pacific) and asserts that
 * public.analytics_stats() returns exactly these numbers; the unit tests feed
 * the same payload to the registry and check every metric's value. A unit
 * test also reads the SQL file's @fixture block and compares it with
 * ANALYTICS_FIXTURE_PAYLOAD, so the two can't drift.
 *
 * The scenario, in words:
 * - 5 leads in March (website 2, Google Ads 2, Nextdoor 1); 3 reached in
 *   300 / 600 / 900 seconds; 3 with a walkthrough booked; 1 converted.
 * - Walkthroughs due: 1 completed, 1 no-show.
 * - Estimates first sent in March: E1 $10,000 (SLA met, accepted), E2 $5,000
 *   (SLA missed, accepted), E3 $2,000 (open, expiring). E4 was February.
 * - Jobs sold in March: J1 $10,000 (lead → sold 10 days), J2 $5,000 (19 days).
 *   Sold, not started: J2, J6 ($3,000), J7, J8 → $8,000.
 * - J1 completed: $10,000 contract, $1,000 direct cost (30 h × $30 + $100
 *   expense), 40 h budgeted, 3 punch items; deposit $4,000 paid, $6,000
 *   progress invoice 90+ days past due.
 * - J2 production Mar 16–20 with one rain day: 4 days due, 3 logged; J1 started
 *   on time, J2 two days late.
 * - Spend: website $310 + Google Ads $620 in March; a $20,000 March goal.
 */
export const ANALYTICS_FIXTURE_PAYLOAD = {
  accepted: 2,
  accepted_value_cents: 1_500_000,
  approvals_pending: 0,
  ar_outstanding_cents: 600_000,
  backlog_hours: 48,
  billed_cents: 1_000_000,
  billed_collected_cents: 400_000,
  cac_jobs: 2,
  can_see_costs: true,
  can_see_money: true,
  cohort_accepted: 2,
  cohort_accepted_value_cents: 1_500_000,
  collected_cents: 400_000,
  completed_cents: 1_000_000,
  completed_jobs: 1,
  crew_day_hours: 8,
  daily_due: 4,
  daily_logged: 3,
  days_completed_to_paid_avg: 11,
  dq_contacts_unreachable: 1,
  dq_jobs_no_poc: 5,
  dq_jobs_no_property: 7,
  dq_leads_unassigned: 1,
  elapsed_days: 31,
  estimates_sent: 3,
  estimates_sent_value_cents: 1_700_000,
  expiring_estimates: 1,
  filters_applied: false,
  labor_actual_hours: 30,
  labor_budgeted_hours: 40,
  leads_contacted: 3,
  leads_converted: 1,
  leads_created: 5,
  leads_walkthrough: 3,
  margin_cost_cents: 100_000,
  margin_jobs: 1,
  margin_revenue_cents: 1_000_000,
  on_time_met: 1,
  on_time_missed: 1,
  open_estimates: 1,
  open_estimates_value_cents: 200_000,
  overdue_cents: 600_000,
  paid_jobs: 1,
  period_days: 31,
  punch_items: 3,
  rain_delay_days: 1,
  referrals: 2,
  referrals_sold: 1,
  reviews_left: 1,
  reviews_requested: 2,
  sla_hours: 24,
  sla_measured: 2,
  sla_met: 1,
  sold_cents: 1_500_000,
  sold_jobs: 2,
  sold_not_started_cents: 800_000,
  sold_not_started_jobs: 4,
  speed_measured: 3,
  speed_median_seconds: 600,
  speed_p90_seconds: 840,
  spend_applies: true,
  spend_cents: 93_000,
  velocity_days_avg: 14.5,
  walkthroughs_completed: 1,
  walkthroughs_due: 2,
} as const satisfies Partial<AnalyticsStats>;

/** The breakdowns the SQL test asserts, in the RPC's shape. */
export const ANALYTICS_FIXTURE_BREAKDOWNS = {
  funnel: { leads: 5, contacted: 3, walkthrough: 3, estimate: 1, sold: 1 },
  by_city: [
    {
      territory_id: "t-bellevue",
      city: "Bellevue",
      service_area: true,
      leads: 2,
      sold_jobs: 1,
      sold_cents: 1_000_000,
    },
    {
      territory_id: "t-kirkland",
      city: "Kirkland",
      service_area: true,
      leads: 1,
      sold_jobs: 1,
      sold_cents: 500_000,
    },
    {
      territory_id: "t-redmond",
      city: "Redmond",
      service_area: true,
      leads: 1,
      sold_jobs: 0,
      sold_cents: 0,
    },
    {
      territory_id: "t-sammamish",
      city: "Sammamish",
      service_area: true,
      leads: 0,
      sold_jobs: 0,
      sold_cents: 0,
    },
    {
      territory_id: "t-issaquah",
      city: "Issaquah",
      service_area: true,
      leads: 0,
      sold_jobs: 0,
      sold_cents: 0,
    },
    {
      territory_id: "t-out",
      city: "Outside service area",
      service_area: false,
      leads: 0,
      sold_jobs: 0,
      sold_cents: 0,
    },
    {
      territory_id: null,
      city: "Unknown",
      service_area: false,
      leads: 1,
      sold_jobs: 0,
      sold_cents: 0,
    },
  ],
  by_estimator: [
    {
      user_id: "u-avery",
      name: "Avery Estimator",
      sent: 2,
      cohort_accepted: 1,
      accepted: 1,
      accepted_value_cents: 1_000_000,
    },
    {
      user_id: "u-blake",
      name: "Blake Estimator",
      sent: 1,
      cohort_accepted: 1,
      accepted: 1,
      accepted_value_cents: 500_000,
    },
  ],
  by_source: [
    {
      source: "google_ads",
      leads: 2,
      converted: 0,
      sold_jobs: 1,
      sold_cents: 500_000,
      spend_cents: 62_000,
    },
    {
      source: "website",
      leads: 2,
      converted: 1,
      sold_jobs: 1,
      sold_cents: 1_000_000,
      spend_cents: 31_000,
    },
    { source: "nextdoor", leads: 1, converted: 0, sold_jobs: 0, sold_cents: 0, spend_cents: 0 },
  ],
  by_stage: [
    { stage: "estimate_sent", jobs: 1, value_cents: 0 },
    { stage: "sold", jobs: 1, value_cents: 0 },
    { stage: "ready_to_schedule", jobs: 1, value_cents: 300_000 },
    { stage: "scheduled", jobs: 2, value_cents: 500_000 },
    { stage: "completed", jobs: 1, value_cents: 1_000_000 },
    { stage: "paid_in_full", jobs: 1, value_cents: 300_000 },
  ],
  aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 600_000 },
  backlog_by_work_type: [{ work_type: "interior", hours: 48 }],
  alerts: { untouched_lead: 2 },
} satisfies Partial<AnalyticsStats>;

/** The whole fixture as the registry sees it. */
export const ANALYTICS_FIXTURE: AnalyticsStats = {
  ...ANALYTICS_FIXTURE_PAYLOAD,
  ...ANALYTICS_FIXTURE_BREAKDOWNS,
};

/** Every §12.1 metric's known value (and display) on the fixture. */
export const ANALYTICS_EXPECTED: Record<
  AnalyticsMetricId,
  { value: number | null; display: string }
> = {
  "kpi.leads_created": { value: 5, display: "5" },
  "kpi.speed_to_lead_median": { value: 600, display: "10 min" },
  "kpi.speed_to_lead_p90": { value: 840, display: "14 min" },
  "kpi.contact_rate": { value: 0.6, display: "60%" },
  "kpi.walkthrough_set_rate": { value: 0.6, display: "60%" },
  "kpi.walkthrough_show_rate": { value: 0.5, display: "50%" },
  "kpi.estimates_sent": { value: 3, display: "3" },
  "kpi.sla_24h": { value: 0.5, display: "50%" },
  "kpi.close_rate": { value: 2 / 3, display: "67%" },
  "kpi.close_rate_value": { value: 1_500_000 / 1_700_000, display: "88%" },
  "kpi.avg_job_value": { value: 750_000, display: "$7,500" },
  "kpi.sales_velocity": { value: 14.5, display: "15 days" },
  "kpi.sold_jobs": { value: 2, display: "2" },
  "kpi.pipeline_value": { value: 1_000_000, display: "$10,000" },
  "kpi.pipeline_open_estimates": { value: 200_000, display: "$2,000" },
  "kpi.pipeline_sold_not_started": { value: 800_000, display: "$8,000" },
  "kpi.projected_revenue": { value: 1_500_000, display: "$15,000" },
  "kpi.revenue_sold": { value: 1_500_000, display: "$15,000" },
  "kpi.revenue_completed": { value: 1_000_000, display: "$10,000" },
  "kpi.revenue_collected": { value: 400_000, display: "$4,000" },
  "kpi.completed_jobs": { value: 1, display: "1" },
  "kpi.gross_margin_completed": { value: 0.9, display: "90%" },
  "kpi.labor_hours_estimated": { value: 40, display: "40 h" },
  "kpi.labor_hours_actual": { value: 30, display: "30 h" },
  "kpi.labor_hours_variance": { value: 75, display: "75" },
  "kpi.daily_update_compliance": { value: 0.75, display: "75%" },
  "kpi.on_time_start": { value: 0.5, display: "50%" },
  "kpi.rain_delay_days": { value: 1, display: "1" },
  "kpi.punch_per_job": { value: 3, display: "3" },
  "kpi.backlog_crew_days": { value: 6, display: "6 days" },
  "kpi.days_completed_to_paid": { value: 11, display: "11 days" },
  "kpi.ar_outstanding": { value: 600_000, display: "$6,000" },
  "kpi.ar_overdue": { value: 600_000, display: "$6,000" },
  "kpi.collection_rate": { value: 0.4, display: "40%" },
  "kpi.reviews_requested": { value: 2, display: "2" },
  "kpi.review_rate": { value: 0.5, display: "50%" },
  "kpi.referrals": { value: 2, display: "2" },
  "kpi.referral_conversions": { value: 1, display: "1" },
  "kpi.marketing_spend": { value: 93_000, display: "$930" },
  "kpi.cost_per_lead": { value: 18_600, display: "$186" },
  "kpi.cac": { value: 46_500, display: "$465" },
  "kpi.expiring_estimates": { value: 1, display: "1" },
  "kpi.dq_leads_unassigned": { value: 1, display: "1" },
  "kpi.dq_jobs_no_poc": { value: 5, display: "5" },
  "kpi.dq_jobs_no_property": { value: 7, display: "7" },
  "kpi.dq_contacts_unreachable": { value: 1, display: "1" },
};

/** my_numbers() for Avery in March (asserted in the same SQL test). */
export const MY_NUMBERS_FIXTURE = {
  leads_issued: 2,
  walkthroughs_set: 2,
  walkthroughs_ran: 1,
  estimates_sent: 2,
  sold_count: 1,
  sold_cents: 1_000_000,
  completed: 1,
  invoiced: 1,
  paid: 1,
} as const;
