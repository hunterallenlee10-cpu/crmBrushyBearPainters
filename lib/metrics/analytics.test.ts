import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_BREAKDOWNS,
  ANALYTICS_METRICS,
  EMPTY_ANALYTICS_STATS,
  METRICS,
  MY_NUMBERS_METRICS,
  allMetricIds,
  analyticsAging,
  analyticsFunnel,
  analyticsMetricValue,
  backlogByWorkType,
  cityPerformance,
  estimatorLeaderboard,
  executiveAlerts,
  hasRevenueGoal,
  leadSourcePerformance,
  metricSpec,
  myNumbersValue,
  parseAnalyticsMonthly,
  parseAnalyticsStats,
  parseMyNumbers,
  parseSeasonBacklog,
  pipelineByStage,
  projectedRevenue,
  revenueForecast,
  seasonBacklogRows,
  seasonTotals,
  type AnalyticsMetricId,
} from "@/lib/metrics/registry";
import {
  ANALYTICS_EXPECTED,
  ANALYTICS_FIXTURE,
  ANALYTICS_FIXTURE_PAYLOAD,
  MY_NUMBERS_FIXTURE,
} from "@/lib/metrics/fixtures/analytics";

const ids = Object.keys(ANALYTICS_METRICS) as AnalyticsMetricId[];
const words = { period: "in March", prior: "February", start: "Mar 1" };

describe("SPEC §12.1 metrics against the fixture", () => {
  it.each(ids)("%s matches its known value", (id) => {
    const v = analyticsMetricValue(id, ANALYTICS_FIXTURE, words);
    const expected = ANALYTICS_EXPECTED[id];
    if (expected.value === null) expect(v.value).toBeNull();
    else expect(v.value).toBeCloseTo(expected.value, 6);
    expect(v.display).toBe(expected.display);
    expect(v.hidden).toBe(false);
    expect(v.caption).not.toMatch(/NaN|undefined|\{period\}/);
  });

  it("every analytics metric has an expected fixture value", () => {
    expect(Object.keys(ANALYTICS_EXPECTED).sort()).toEqual([...ids].sort());
  });

  it("the SQL fixture test asserts exactly these payload values", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/tests/015_analytics.test.sql"), "utf8");
    const block = sql
      .split("-- @fixture:analytics_stats:begin")[1]!
      .split("-- @fixture:analytics_stats:end")[0]!;
    const pairs = [...block.matchAll(/\('([a-z0-9_]+)', '([^']*)'\)/g)].map((m) => [m[1]!, m[2]!]);
    const fromSql = Object.fromEntries(pairs);
    const fromTs = Object.fromEntries(
      Object.entries(ANALYTICS_FIXTURE_PAYLOAD).map(([k, v]) => [k, String(v)]),
    );
    expect(fromSql).toEqual(fromTs);
  });

  it("parses the RPC payload it is fed", () => {
    expect(parseAnalyticsStats(ANALYTICS_FIXTURE)).toEqual(ANALYTICS_FIXTURE);
  });
});

describe("empty company (production starts empty)", () => {
  it.each(ids)("%s shows a clean zero or —, never NaN", (id) => {
    const v = analyticsMetricValue(id, EMPTY_ANALYTICS_STATS, words);
    expect(v.display).not.toMatch(/NaN|Infinity|undefined/);
    expect(v.caption).not.toMatch(/NaN|Infinity|undefined/);
    if (v.unit === "percent" || v.unit === "duration") expect(v.display).toBe("—");
  });

  it("malformed payloads read as empty", () => {
    expect(parseAnalyticsStats(null)).toEqual(EMPTY_ANALYTICS_STATS);
    expect(parseAnalyticsStats("nope")).toEqual(EMPTY_ANALYTICS_STATS);
    expect(parseAnalyticsStats({ leads_created: -3, sold_cents: "x" }).leads_created).toBe(0);
  });

  it("breakdowns are empty arrays or zero rows", () => {
    const s = EMPTY_ANALYTICS_STATS;
    expect(pipelineByStage(s).every((r) => r.jobs === 0 && r.valueCents === null)).toBe(true);
    expect(analyticsFunnel(s).map((r) => r.ofTotal)).toEqual([null, null, null, null, null]);
    expect(cityPerformance(s)).toEqual([]);
    expect(leadSourcePerformance(s)).toEqual([]);
    expect(analyticsAging(s).every((r) => r.cents === null)).toBe(true);
    expect(executiveAlerts(s).every((r) => r.open === 0)).toBe(true);
  });
});

describe("permissions", () => {
  const noMoney = { ...ANALYTICS_FIXTURE, can_see_money: false, can_see_costs: false };
  it("money metrics are hidden without financials:read", () => {
    for (const id of ids) {
      const m = ANALYTICS_METRICS[id];
      const v = analyticsMetricValue(id, noMoney, words);
      if ((m.requires as readonly string[]).includes("financials:read")) {
        expect(v.hidden, id).toBe(true);
        expect(v.display, id).toBe("—");
        expect(v.caption).toBe("Amounts hidden for your role");
      }
    }
  });
  it("gross margin is owner-only (job_costing:read)", () => {
    const v = analyticsMetricValue("kpi.gross_margin_completed", {
      ...ANALYTICS_FIXTURE,
      can_see_costs: false,
    });
    expect(v.hidden).toBe(true);
    expect(v.caption).toBe("Owners and the bookkeeper only");
    expect(ANALYTICS_METRICS["kpi.gross_margin_completed"].ownerOnly).toBe(true);
  });
});

describe("formula captions", () => {
  it("fill in the period and the live numbers", () => {
    expect(analyticsMetricValue("kpi.close_rate", ANALYTICS_FIXTURE, words).caption).toBe(
      "2 accepted ÷ 3 sent · first sent in March",
    );
    expect(analyticsMetricValue("kpi.pipeline_value", ANALYTICS_FIXTURE, words).caption).toBe(
      "1 open estimates $2,000 + 4 sold $8,000 · right now",
    );
    expect(analyticsMetricValue("kpi.sla_24h", ANALYTICS_FIXTURE, words).caption).toBe(
      "1 of 2 sent within 24h · in March",
    );
    expect(analyticsMetricValue("kpi.leads_created", ANALYTICS_FIXTURE, words).caption).toBe(
      "Leads created in March",
    );
  });
  it("cost per lead explains when spend can't apply", () => {
    const filtered = { ...ANALYTICS_FIXTURE, spend_applies: false };
    const v = analyticsMetricValue("kpi.cost_per_lead", filtered, words);
    expect(v.display).toBe("—");
    expect(v.caption).toBe("Spend isn't split by work type, city or owner");
    const none = analyticsMetricValue("kpi.cac", { ...ANALYTICS_FIXTURE, spend_cents: 0 }, words);
    expect(none.caption).toBe("No spend entered (Admin → Marketing Spend)");
  });
});

describe("projected revenue (run-rate)", () => {
  it("projects month-to-date pace over the whole period", () => {
    expect(
      projectedRevenue({
        ...ANALYTICS_FIXTURE,
        sold_cents: 1_000_000,
        elapsed_days: 10,
        period_days: 30,
      }),
    ).toBe(3_000_000);
  });
  it("is what sold once the period is over, and — before it starts", () => {
    expect(projectedRevenue(ANALYTICS_FIXTURE)).toBe(1_500_000);
    expect(projectedRevenue({ ...ANALYTICS_FIXTURE, elapsed_days: 0 })).toBeNull();
    expect(projectedRevenue({ ...ANALYTICS_FIXTURE, sold_cents: null })).toBeNull();
  });
});

describe("breakdowns on the fixture", () => {
  it("pipeline by stage lists every open stage with values", () => {
    const rows = pipelineByStage(ANALYTICS_FIXTURE);
    expect(rows.find((r) => r.stage === "scheduled")).toMatchObject({
      jobs: 2,
      valueCents: 500_000,
    });
    expect(rows.find((r) => r.stage === "walkthrough_scheduled")).toMatchObject({
      jobs: 0,
      valueCents: 0,
    });
    expect(rows.some((r) => r.stage === "closed_won" || r.stage === "closed_lost")).toBe(false);
  });
  it("lead funnel conversion from step to step", () => {
    const f = analyticsFunnel(ANALYTICS_FIXTURE);
    expect(f.map((r) => r.count)).toEqual([5, 3, 3, 1, 1]);
    expect(f[1]!.fromPrevious).toBeCloseTo(0.6);
    expect(f[3]!.fromPrevious).toBeCloseTo(1 / 3);
    expect(f[4]!.ofTotal).toBeCloseTo(0.2);
  });
  it("city heat ranking: sold $ first, inactive cities unranked", () => {
    const rows = cityPerformance(ANALYTICS_FIXTURE);
    expect(rows.map((r) => [r.city, r.rank])).toEqual([
      ["Bellevue", 1],
      ["Kirkland", 2],
      ["Redmond", 3],
      ["Sammamish", null],
      ["Issaquah", null],
      ["Outside service area", null],
      ["Unknown", 4],
    ]);
    expect(rows[0]!.heat).toBe(1);
    expect(rows[1]!.heat).toBe(0.5);
  });
  it("estimator leaderboard close rates", () => {
    expect(
      estimatorLeaderboard(ANALYTICS_FIXTURE).map((r) => [r.name, r.soldCents, r.closeRate]),
    ).toEqual([
      ["Avery Estimator", 1_000_000, 0.5],
      ["Blake Estimator", 500_000, 1],
    ]);
  });
  it("lead source performance with cost per lead and mix", () => {
    const rows = leadSourcePerformance(ANALYTICS_FIXTURE, { google_ads: "Google Ads" });
    expect(rows[0]).toMatchObject({
      label: "Google Ads",
      leads: 2,
      costPerLead: 31_000,
      share: 0.4,
    });
    expect(rows[1]).toMatchObject({ label: "website", conversion: 0.5, costPerLead: 15_500 });
    expect(rows[2]!.costPerLead).toBeNull();
  });
  it("aging, backlog by work type and alerts", () => {
    expect(analyticsAging(ANALYTICS_FIXTURE).map((r) => r.cents)).toEqual([0, 0, 0, 0, 600_000]);
    expect(backlogByWorkType(ANALYTICS_FIXTURE)).toEqual([
      { workType: "interior", hours: 48, crewDays: 6 },
    ]);
    const alerts = executiveAlerts(ANALYTICS_FIXTURE);
    expect(alerts.find((a) => a.key === "untouched_lead")).toMatchObject({
      open: 2,
      href: "/attention?type=untouched_lead",
    });
  });
});

describe("revenue forecast", () => {
  const monthly = parseAnalyticsMonthly({
    can_see_money: true,
    months: [
      {
        month: "2026-07-01",
        sold_jobs: 1,
        sold_cents: 300_000,
        completed_jobs: 0,
        completed_cents: 0,
        collected_cents: 0,
        goal_cents: null,
      },
      {
        month: "2026-08-01",
        sold_jobs: 1,
        sold_cents: 600_000,
        completed_jobs: 0,
        completed_cents: 0,
        collected_cents: 0,
        goal_cents: null,
      },
      {
        month: "2026-09-01",
        sold_jobs: 1,
        sold_cents: 900_000,
        completed_jobs: 0,
        completed_cents: 0,
        collected_cents: 0,
        goal_cents: null,
      },
      {
        month: "2026-10-01",
        sold_jobs: 1,
        sold_cents: 500_000,
        completed_jobs: 0,
        completed_cents: 0,
        collected_cents: 0,
        goal_cents: 2_000_000,
      },
      {
        month: "2026-11-01",
        sold_jobs: 0,
        sold_cents: 0,
        completed_jobs: 0,
        completed_cents: 0,
        collected_cents: 0,
        goal_cents: null,
      },
    ],
  });
  it("actuals, this month's run-rate and the trailing average for later months", () => {
    const rows = revenueForecast(monthly, "2026-10-10", 10, 31);
    expect(rows.map((r) => r.kind)).toEqual(["past", "past", "past", "current", "future"]);
    expect(rows[3]).toMatchObject({
      actualCents: 500_000,
      projectedCents: 1_550_000,
      goalCents: 2_000_000,
    });
    expect(rows[4]).toMatchObject({ actualCents: null, projectedCents: 600_000 });
    expect(rows[0]!.label).toBe("Jul 2026");
    expect(hasRevenueGoal(rows)).toBe(true);
  });
  it("no goal configured, and hidden money", () => {
    const none = revenueForecast(
      parseAnalyticsMonthly({ can_see_money: true, months: [] }),
      "2026-10-10",
      10,
      31,
    );
    expect(hasRevenueGoal(none)).toBe(false);
    const hidden = revenueForecast({ ...monthly, can_see_money: false }, "2026-10-10", 10, 31);
    expect(hidden.every((r) => r.actualCents === null && r.projectedCents === null)).toBe(true);
  });
});

describe("season backlog", () => {
  it("booked vs capacity per month and totals (the SQL fixture's 2027 season)", () => {
    const s = parseSeasonBacklog({
      season_start: "2027-06-01",
      season_end: "2027-09-30",
      crews: 1,
      months: [
        { month: "2027-06-01", capacity_crew_days: 22, booked_crew_days: 0 },
        { month: "2027-07-01", capacity_crew_days: 22, booked_crew_days: 5 },
        { month: "2027-08-01", capacity_crew_days: 22, booked_crew_days: 0 },
        { month: "2027-09-01", capacity_crew_days: 22, booked_crew_days: 0 },
      ],
      unscheduled_jobs: 1,
      unscheduled_crew_days: 7,
    });
    expect(seasonBacklogRows(s)[1]).toMatchObject({ label: "Jul 2027", booked: 5, capacity: 22 });
    expect(seasonTotals(s)).toMatchObject({ booked: 5, capacity: 88, unscheduledCrewDays: 7 });
    expect(seasonTotals(parseSeasonBacklog(null)).utilization).toBeNull();
  });
});

describe("My Numbers", () => {
  it("each card on its own date field, values from the fixture", () => {
    const s = parseMyNumbers(MY_NUMBERS_FIXTURE);
    expect(myNumbersValue("mine.sold_value", s).display).toBe("$10,000");
    expect(myNumbersValue("mine.leads_issued", s).value).toBe(2);
    const dateFields = Object.values(MY_NUMBERS_METRICS).map((m) => m.dateField);
    expect(new Set(dateFields).size).toBeGreaterThan(5);
  });
});

describe("registry completeness (SPEC §12.1)", () => {
  it("every metric resolves to a full spec: source RPC, date field, filters, unit, caption", () => {
    for (const id of allMetricIds()) {
      const spec = metricSpec(id);
      expect(spec.rpc, id).not.toBe("");
      expect(spec.dateField === null || spec.dateField.length > 0, id).toBe(true);
      expect(Array.isArray(spec.filters), id).toBe(true);
      expect(spec.caption.length, id).toBeGreaterThan(0);
      expect(typeof spec.ownerOnly).toBe("boolean");
    }
    expect(Object.keys(METRICS).length).toBeGreaterThan(150);
  });
  it("the §12.1 minimum list is covered", () => {
    const need: string[] = [
      "kpi.leads_created",
      "kpi.lead_source_performance",
      "kpi.speed_to_lead_median",
      "kpi.speed_to_lead_p90",
      "kpi.contact_rate",
      "kpi.walkthrough_set_rate",
      "kpi.walkthrough_show_rate",
      "kpi.estimates_sent",
      "kpi.sla_24h",
      "kpi.close_rate",
      "kpi.close_rate_value",
      "kpi.avg_job_value",
      "kpi.sales_velocity",
      "kpi.pipeline_open_estimates",
      "kpi.pipeline_sold_not_started",
      "kpi.backlog_crew_days",
      "kpi.backlog_by_work_type",
      "kpi.season_backlog",
      "kpi.projected_revenue",
      "kpi.revenue_sold",
      "kpi.revenue_completed",
      "kpi.revenue_collected",
      "kpi.gross_margin_completed",
      "kpi.labor_hours_estimated",
      "kpi.labor_hours_actual",
      "kpi.daily_update_compliance",
      "kpi.on_time_start",
      "kpi.rain_delay_days",
      "kpi.punch_per_job",
      "kpi.days_completed_to_paid",
      "kpi.ar_aging",
      "kpi.collection_rate",
      "kpi.review_rate",
      "kpi.referral_conversions",
      "kpi.city_performance",
      "kpi.estimator_leaderboard",
      "kpi.cost_per_lead",
      "kpi.cac",
    ];
    const known = new Set<string>([...ids, ...Object.keys(ANALYTICS_BREAKDOWNS)]);
    expect(need.filter((id) => !known.has(id))).toEqual([]);
  });
  it("analytics metrics name their date field and filters explicitly", () => {
    for (const id of ids) {
      const m = ANALYTICS_METRICS[id];
      expect(m.dateField === null || m.dateField.includes("."), id).toBe(true);
      expect(m.keywords.length, id).toBeGreaterThan(0);
    }
  });
});
