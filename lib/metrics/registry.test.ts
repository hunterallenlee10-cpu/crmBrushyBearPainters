import { describe, expect, it } from "vitest";
import { JOB_STAGES } from "@/lib/domain/stages";
import {
  APPROVAL_METRICS,
  ATTENTION_METRICS,
  EMPTY_PRODUCTION_STATS,
  EMPTY_SCHEDULE_BOARD,
  PRODUCTION_METRICS,
  SCHEDULE_BOARD_METRICS,
  parseProductionStats,
  productionMetricValue,
  scheduleBoardMetricValue,
  EMPTY_ATTENTION_SUMMARY,
  approvalMetricValue,
  attentionMetricValue,
  parseApprovalCounts,
  parseAttentionSummary,
  EMPTY_JOB_STATS,
  EMPTY_JOB_STATUS_COUNTS,
  EMPTY_LEAD_STATS,
  JOB_METRICS,
  formatMoney,
  jobCaption,
  jobCountValue,
  jobMetricValue,
  jobPipelineHealth,
  jobPipelineSnapshot,
  jobSoldByDay,
  metricDelta,
  parseJobStats,
  parseJobStatusCounts,
  type JobMetricId,
  type JobStats,
  LEAD_METRICS,
  METRICS,
  formatMetricValue,
  formatPercent,
  getMetric,
  ESTIMATE_METRICS,
  EMPTY_ESTIMATE_STATS,
  estimateMetricValue,
  parseEstimateStats,
  leadAging,
  leadCities,
  leadFunnel,
  leadMetricValue,
  leadSources,
  leadStatusDistribution,
  parseLeadStats,
  ratio,
  type LeadMetricId,
  type LeadStats,
  BOARD_METRICS,
  DOCUMENT_METRICS,
  EMPTY_BOARD_STATS,
  EMPTY_DOCUMENT_STATS,
  boardMetricValue,
  documentMetricValue,
  parseBoardStats,
  parseDocumentStats,
} from "@/lib/metrics/registry";

/** A known fixture (shape of `public.lead_stats()`) with hand-computed expectations. */
const FIXTURE = {
  total: 40,
  open: 30,
  by_status: {
    new: 12,
    contacted: 8,
    walkthrough_scheduled: 6,
    nurture: 4,
    unqualified: 2,
    converted: 5,
    lost: 3,
  },
  reached_contacted: 22,
  reached_walkthrough: 11,
  converted: 5,
  unassigned: 7,
  hot: 4,
  stale: 3,
  new_last_7_days: 9,
  aging: { "0_3": 10, "4_7": 6, "8_14": 5, "15_30": 4, "30_plus": 5 },
  by_source: [
    { source: "website", leads: 20, converted: 3 },
    { source: "customer_referral", leads: 8, converted: 2 },
    { source: "nextdoor", leads: 0, converted: 0 },
  ],
  by_city: [
    { city: "Bellevue", leads: 18 },
    { city: "Outside service area", leads: 2 },
  ],
  speed_to_lead_median_seconds: 372.5,
};

const stats = parseLeadStats(FIXTURE);
const value = (id: LeadMetricId, s: LeadStats = stats) => leadMetricValue(id, s);

describe("parseLeadStats", () => {
  it("parses the RPC payload", () => {
    expect(stats.total).toBe(40);
    expect(stats.by_status.new).toBe(12);
    expect(stats.aging["30_plus"]).toBe(5);
    expect(stats.by_source).toHaveLength(3);
    expect(stats.speed_to_lead_median_seconds).toBe(372.5);
  });

  it("turns null, empty and malformed payloads into zeros instead of throwing", () => {
    for (const raw of [null, undefined, {}, "nope", 42, []]) {
      const s = parseLeadStats(raw);
      expect(s.total).toBe(0);
      expect(s.by_status).toEqual({});
      expect(s.by_source).toEqual([]);
      expect(s.aging).toEqual({ "0_3": 0, "4_7": 0, "8_14": 0, "15_30": 0, "30_plus": 0 });
      expect(s.speed_to_lead_median_seconds).toBeNull();
    }
    const bad = parseLeadStats({ total: -3, hot: "x", by_source: "nope", aging: null });
    expect(bad.total).toBe(0);
    expect(bad.hot).toBe(0);
    expect(bad.by_source).toEqual([]);
    expect(bad.aging["0_3"]).toBe(0);
  });

  it("EMPTY_LEAD_STATS is all zeros", () => {
    expect(EMPTY_LEAD_STATS.total).toBe(0);
    expect(EMPTY_LEAD_STATS.by_city).toEqual([]);
  });
});

describe("ratio / formatting", () => {
  it("returns null for a zero, negative or non-finite denominator", () => {
    expect(ratio(3, 0)).toBeNull();
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, -1)).toBeNull();
    expect(ratio(Number.NaN, 4)).toBeNull();
    expect(ratio(1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("clamps to 0–1 (never over 100%)", () => {
    expect(ratio(5, 4)).toBe(1);
    expect(ratio(-1, 4)).toBe(0);
    expect(ratio(1, 4)).toBe(0.25);
  });

  it("formats values, with — for missing ones", () => {
    expect(formatMetricValue("count", 1204)).toBe("1,204");
    expect(formatMetricValue("count", null)).toBe("—");
    expect(formatMetricValue("percent", 0.55)).toBe("55%");
    expect(formatMetricValue("percent", null)).toBe("—");
    expect(formatMetricValue("duration", 372.5)).toBe("6 min");
    expect(formatMetricValue("duration", null)).toBe("—");
    expect(formatMetricValue("count", Number.NaN)).toBe("—");
    expect(formatPercent(0.035)).toBe("3.5%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(2)).toBe("100%");
  });
});

describe("lead metrics (fixture)", () => {
  it.each<[LeadMetricId, number | null, string]>([
    ["leads.total", 40, "40"],
    ["leads.new", 12, "12"],
    ["leads.contacted", 8, "8"],
    ["leads.walkthrough_scheduled", 6, "6"],
    ["leads.contact_rate", 22 / 40, "55%"],
    ["leads.walkthrough_rate", 11 / 40, "28%"],
    ["leads.conversion_rate", 5 / 40, "13%"],
    ["leads.unassigned", 7, "7"],
    ["leads.hot", 4, "4"],
    ["leads.stale", 3, "3"],
    ["leads.new_last_7_days", 9, "9"],
    ["leads.speed_to_lead_median", 372.5, "6 min"],
  ])("%s = %s", (id, expected, display) => {
    const v = value(id);
    if (expected === null) expect(v.value).toBeNull();
    else expect(v.value).toBeCloseTo(expected, 10);
    expect(v.display).toBe(display);
    expect(v.caption.length).toBeGreaterThan(0);
  });
});

describe("lead metrics (no leads)", () => {
  const empty = parseLeadStats({});
  it.each<[LeadMetricId, number | null, string]>([
    ["leads.total", 0, "0"],
    ["leads.new", 0, "0"],
    ["leads.contacted", 0, "0"],
    ["leads.walkthrough_scheduled", 0, "0"],
    ["leads.contact_rate", null, "—"],
    ["leads.walkthrough_rate", null, "—"],
    ["leads.conversion_rate", null, "—"],
    ["leads.unassigned", 0, "0"],
    ["leads.hot", 0, "0"],
    ["leads.stale", 0, "0"],
    ["leads.new_last_7_days", 0, "0"],
    ["leads.speed_to_lead_median", null, "—"],
  ])("%s = %s", (id, expected, display) => {
    const v = value(id, empty);
    expect(v.value).toBe(expected);
    expect(v.display).toBe(display);
    expect(v.display).not.toMatch(/NaN|Infinity/);
  });

  it("missing statuses count as zero", () => {
    expect(
      value("leads.new", parseLeadStats({ total: 3, by_status: { contacted: 3 } })).value,
    ).toBe(0);
  });

  it("rates never exceed 100% even with inconsistent inputs", () => {
    const odd = parseLeadStats({
      total: 2,
      reached_contacted: 5,
      reached_walkthrough: 3,
      converted: 9,
    });
    expect(value("leads.contact_rate", odd).value).toBe(1);
    expect(value("leads.walkthrough_rate", odd).value).toBe(1);
    expect(value("leads.conversion_rate", odd).display).toBe("100%");
  });
});

describe("registry shape", () => {
  it("every metric has a matching id, label, caption and unit", () => {
    for (const [id, m] of Object.entries(METRICS)) {
      expect(m.id).toBe(id);
      expect(m.label).not.toBe("");
      expect(m.caption).not.toBe("");
      expect([
        "count",
        "percent",
        "duration",
        "money",
        "bytes",
        "days",
        "hours",
        "number",
      ]).toContain(m.unit);
      expect([
        "lead_stats",
        "job_stats",
        "job_status_counts",
        "attention_summary",
        "approval_counts",
        "estimate_stats",
        "document_stats",
        "onboarding_board",
        "production_stats",
        "schedule_board",
      ]).toContain(m.source);
      if (id.startsWith("production.")) expect(m.source).toBe("production_stats");
      if (id.startsWith("schedule.")) expect(m.source).toBe("schedule_board");
      if (id.startsWith("documents.")) expect(m.source).toBe("document_stats");
      if (id.startsWith("board.")) expect(m.source).toBe("onboarding_board");
      if (id.startsWith("estimates.")) expect(m.source).toBe("estimate_stats");
      if (id.startsWith("attention.")) expect(m.source).toBe("attention_summary");
      if (id.startsWith("approvals.")) expect(m.source).toBe("approval_counts");
      if (id.startsWith("leads.")) expect(m.source).toBe("lead_stats");
      if (id.startsWith("jobs.")) expect(m.source).toMatch(/^job_/);
    }
    expect(getMetric("leads.hot")).toBe(LEAD_METRICS["leads.hot"]);
  });

  it("has every lead metric the dashboard needs", () => {
    expect(Object.keys(LEAD_METRICS).sort()).toEqual(
      [
        "leads.contact_rate",
        "leads.contacted",
        "leads.conversion_rate",
        "leads.hot",
        "leads.new",
        "leads.new_last_7_days",
        "leads.speed_to_lead_median",
        "leads.stale",
        "leads.total",
        "leads.unassigned",
        "leads.walkthrough_rate",
        "leads.walkthrough_scheduled",
      ].sort(),
    );
  });
});

describe("breakdowns", () => {
  it("status distribution lists every status in order, zeros included", () => {
    const rows = leadStatusDistribution(stats);
    expect(rows.map((r) => r.status)).toEqual([
      "new",
      "contacted",
      "walkthrough_scheduled",
      "nurture",
      "unqualified",
      "converted",
      "lost",
    ]);
    expect(rows.find((r) => r.status === "walkthrough_scheduled")).toMatchObject({
      label: "Walkthrough Scheduled",
      leads: 6,
    });
    expect(leadStatusDistribution(EMPTY_LEAD_STATS).every((r) => r.leads === 0)).toBe(true);
  });

  it("funnel has % of all leads and step-to-step %", () => {
    const f = leadFunnel(stats);
    expect(f.map((s) => s.leads)).toEqual([40, 22, 11, 5]);
    expect(f[0]).toMatchObject({ ofTotal: 1, fromPrevious: null });
    expect(f[1]!.ofTotal).toBeCloseTo(0.55);
    expect(f[2]!.fromPrevious).toBeCloseTo(0.5);
    expect(f[3]!.fromPrevious).toBeCloseTo(5 / 11);
    expect(f[3]!.metricId).toBe("leads.conversion_rate");
  });

  it("funnel with no leads has no rates", () => {
    const f = leadFunnel(EMPTY_LEAD_STATS);
    expect(f.every((s) => s.ofTotal === null && s.fromPrevious === null)).toBe(true);
  });

  it("funnel steps never exceed 100% of the previous step", () => {
    const f = leadFunnel(
      parseLeadStats({ total: 4, reached_contacted: 1, reached_walkthrough: 3 }),
    );
    expect(f[2]!.fromPrevious).toBe(1);
  });

  it("sources carry conversion rates; a source with no leads has none", () => {
    const rows = leadSources(stats);
    expect(rows[0]).toEqual({
      source: "website",
      leads: 20,
      converted: 3,
      notConverted: 17,
      conversion: 0.15,
    });
    expect(rows[1]!.conversion).toBeCloseTo(0.25);
    expect(rows[2]!.conversion).toBeNull();
    expect(leadSources(EMPTY_LEAD_STATS)).toEqual([]);
  });

  it("cities carry their share of all leads", () => {
    const rows = leadCities(stats);
    expect(rows[0]).toEqual({ city: "Bellevue", leads: 18, share: 0.45 });
    expect(
      leadCities(parseLeadStats({ by_city: [{ city: "Kirkland", leads: 0 }] }))[0]!.share,
    ).toBe(null);
  });

  it("aging uses the five buckets in order", () => {
    expect(leadAging(stats).map((r) => [r.label, r.leads])).toEqual([
      ["0–3 days", 10],
      ["4–7 days", 6],
      ["8–14 days", 5],
      ["15–30 days", 4],
      ["30+ days", 5],
    ]);
    expect(leadAging(EMPTY_LEAD_STATS).every((r) => r.leads === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// JOBS (Phase 3)
// ---------------------------------------------------------------------------

/** A known `public.job_stats()` payload for someone with financials:read. */
const JOB_FIXTURE = {
  can_see_money: true,
  open_jobs: 10,
  open_jobs_prev: 8,
  pipeline_value_cents: 5_000_000,
  in_progress: 2,
  on_hold: 1,
  closed_won: 3,
  closed_won_prev: 5,
  closed_lost: 1,
  sold_count: 4,
  sold_value_cents: 2_400_000,
  sold_value_prev_cents: 1_800_000,
  closing_this_period: 2,
  by_stage: [
    { stage: "sold", jobs: 4, value_cents: 2_000_000 },
    { stage: "in_progress", jobs: 2, value_cents: null },
    { stage: "closed_won", jobs: 6, value_cents: 3_000_000 },
    { stage: "walkthrough_scheduled", jobs: 4, value_cents: 0 },
  ],
  sold_by_day: [
    { day: "2026-10-02", jobs: 1, value_cents: 600_000 },
    { day: "2026-10-05", jobs: 3, value_cents: 1_800_000 },
  ],
};
const WORDS = { period: "this month", prior: "last month", start: "Oct 1" };
const jobStats = parseJobStats(JOB_FIXTURE);
const noMoney = parseJobStats({ ...JOB_FIXTURE, can_see_money: false });
const jv = (id: JobMetricId, s: JobStats = jobStats) => jobMetricValue(id, s, WORDS);

describe("parseJobStats", () => {
  it("keeps money for financials:read and turns empty sums into 0", () => {
    expect(jobStats.pipeline_value_cents).toBe(5_000_000);
    expect(jobStats.by_stage.find((r) => r.stage === "in_progress")?.value_cents).toBe(0);
    expect(parseJobStats({ can_see_money: true }).sold_value_cents).toBe(0);
  });

  it("drops every money value without financials:read, even if the payload had some", () => {
    expect(noMoney.pipeline_value_cents).toBeNull();
    expect(noMoney.sold_value_cents).toBeNull();
    expect(noMoney.sold_value_prev_cents).toBeNull();
    expect(noMoney.by_stage.every((r) => r.value_cents === null)).toBe(true);
    expect(noMoney.sold_by_day.every((r) => r.value_cents === null)).toBe(true);
    expect(noMoney.open_jobs).toBe(10);
  });

  it("never crashes on garbage", () => {
    expect(parseJobStats(null)).toEqual(EMPTY_JOB_STATS);
    expect(parseJobStats({ open_jobs: -3, by_stage: "x" }).open_jobs).toBe(0);
    expect(EMPTY_JOB_STATS.can_see_money).toBe(false);
    expect(parseJobStatusCounts(undefined)).toEqual(EMPTY_JOB_STATUS_COUNTS);
    expect(
      parseJobStatusCounts({ active: 3, mine: 1, total: 5, on_hold: 1, by_stage: { sold: 2 } }),
    ).toEqual({ active: 3, mine: 1, total: 5, on_hold: 1, by_stage: { sold: 2 } });
  });
});

describe("job metrics (fixture)", () => {
  it.each<[JobMetricId, number | null, string]>([
    ["jobs.total", 16, "16"],
    ["jobs.pipeline_value", 5_000_000, "$50,000"],
    ["jobs.open", 10, "10"],
    ["jobs.in_progress", 2, "2"],
    ["jobs.on_hold", 1, "1"],
    ["jobs.closed_won", 3, "3"],
    ["jobs.closed_lost", 1, "1"],
    ["jobs.sold_value", 2_400_000, "$24,000"],
    ["jobs.sold_count", 4, "4"],
    ["jobs.avg_job_size", 600_000, "$6,000"],
    ["jobs.win_rate", 0.75, "75%"],
    ["jobs.closing_this_month", 2, "2"],
  ])("%s = %s (%s)", (id, expected, display) => {
    expect(jv(id).value).toBe(expected);
    expect(jv(id).display).toBe(display);
  });

  it("explains each number in its caption", () => {
    expect(jv("jobs.pipeline_value").caption).toBe("10 open jobs × $5,000 avg · right now");
    expect(jv("jobs.open").caption).toBe("Not closed won or lost · vs open on Oct 1");
    expect(jv("jobs.closed_won").caption).toBe("Closed won this month · vs last month");
    expect(jv("jobs.sold_value").caption).toBe("4 jobs sold this month · vs last month");
    expect(jv("jobs.win_rate").caption).toBe("3 won ÷ 4 closed this month");
    expect(jv("jobs.avg_job_size").caption).toBe("Sold value ÷ jobs sold this month");
  });

  it("gives prior-period deltas where the source has them", () => {
    expect(jv("jobs.open").delta).toMatchObject({ change: 2, direction: "up", display: "+2" });
    expect(jv("jobs.closed_won").delta).toMatchObject({
      change: -2,
      direction: "down",
      display: "−2",
      previousDisplay: "5",
    });
    expect(jv("jobs.sold_value").delta).toMatchObject({ display: "+$6,000" });
    expect(jv("jobs.in_progress").delta).toBeNull();
    expect(jv("jobs.pipeline_value").delta).toBeNull();
  });

  it("hides money (value, delta) without financials:read but keeps counts", () => {
    for (const id of ["jobs.pipeline_value", "jobs.sold_value", "jobs.avg_job_size"] as const) {
      const v = jv(id, noMoney);
      expect(v.hidden).toBe(true);
      expect(v.value).toBeNull();
      expect(v.display).toBe("—");
      expect(v.delta).toBeNull();
      expect(v.caption).not.toMatch(/\$/);
    }
    expect(jv("jobs.pipeline_value", noMoney).caption).toBe(
      "10 open jobs · amounts hidden for your role",
    );
    expect(jv("jobs.open", noMoney).value).toBe(10);
    expect(jv("jobs.win_rate", noMoney).display).toBe("75%");
  });
});

describe("job metrics (no jobs)", () => {
  const empty = parseJobStats({ can_see_money: true });
  it("is zero or — and never NaN", () => {
    expect(jv("jobs.total", empty).value).toBe(0);
    expect(jv("jobs.avg_job_size", empty).display).toBe("—");
    expect(jv("jobs.win_rate", empty).display).toBe("—");
    expect(jv("jobs.pipeline_value", empty).display).toBe("$0");
    expect(jv("jobs.pipeline_value", empty).caption).toBe("0 open jobs × — avg · right now");
    expect(jv("jobs.open", empty).delta).toMatchObject({ direction: "flat", display: "No change" });
  });
});

describe("job breakdowns", () => {
  it("pipeline snapshot lists every stage in order with totals and shares", () => {
    const s = jobPipelineSnapshot(jobStats);
    expect(s.rows.map((r) => r.stage)).toEqual(JOB_STAGES.map((x) => x.id));
    expect(s.totalJobs).toBe(16);
    expect(s.totalValueCents).toBe(5_000_000);
    expect(s.rows.find((r) => r.stage === "sold")).toMatchObject({ jobs: 4, share: 0.25 });
    expect(s.rows.find((r) => r.stage === "onboarding")).toMatchObject({
      jobs: 0,
      valueCents: 0,
      share: 0,
    });
    const hidden = jobPipelineSnapshot(noMoney);
    expect(hidden.totalValueCents).toBeNull();
    expect(hidden.rows.every((r) => r.valueCents === null)).toBe(true);
    expect(jobPipelineSnapshot(EMPTY_JOB_STATS).rows.every((r) => r.share === null)).toBe(true);
  });

  it("pipeline health has Open, In Progress, Closed Won, Closed Lost", () => {
    expect(jobPipelineHealth(jobStats)).toEqual([
      { key: "open", label: "Open", jobs: 10 },
      { key: "in_progress", label: "In Progress", jobs: 2 },
      { key: "closed_won", label: "Closed Won", jobs: 3 },
      { key: "closed_lost", label: "Closed Lost", jobs: 1 },
    ]);
  });

  it("sold by day fills every day of the range with zeros", () => {
    const days = jobSoldByDay(jobStats, "2026-10-01", "2026-10-06");
    expect(days.map((d) => d.day)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
    ]);
    expect(days[1]).toEqual({ day: "2026-10-02", label: "Oct 2", jobs: 1, valueCents: 600_000 });
    expect(days[0]).toMatchObject({ jobs: 0, valueCents: 0 });
    expect(jobSoldByDay(noMoney, "2026-10-05", "2026-10-05")[0]).toMatchObject({
      jobs: 3,
      valueCents: null,
    });
    expect(jobSoldByDay(jobStats, "2026-10-06", "2026-10-01")).toEqual([]);
    expect(jobSoldByDay(jobStats, "nope", "2026-10-01")).toEqual([]);
    // Crosses month and year ends correctly.
    expect(jobSoldByDay(jobStats, "2026-12-31", "2027-01-01").map((d) => d.label)).toEqual([
      "Dec 31",
      "Jan 1",
    ]);
  });

  it("fills period words into breakdown captions", () => {
    expect(jobCaption("health", WORDS)).toBe(
      "Open and In Progress right now · closed won and lost this month",
    );
  });
});

describe("job list counts and money format", () => {
  it("reads tab counts from job_status_counts", () => {
    const c = parseJobStatusCounts({ active: 7, mine: 2, total: 9, on_hold: 1 });
    expect(jobCountValue("jobs.list_active", c)).toBe(7);
    expect(jobCountValue("jobs.list_mine", c)).toBe(2);
    expect(jobCountValue("jobs.list_total", c)).toBe(9);
    expect(jobCountValue("jobs.list_on_hold", c)).toBe(1);
  });

  it("formats money in whole dollars and deltas per unit", () => {
    expect(formatMoney(123_456)).toBe("$1,235");
    expect(formatMoney(null)).toBe("—");
    expect(formatMetricValue("money", 99)).toBe("$1");
    expect(metricDelta("percent", 0.5, 0.25)).toMatchObject({ display: "+25 pts" });
    expect(metricDelta("count", null, 3)).toBeNull();
    expect(getMetric("jobs.win_rate")).toBe(JOB_METRICS["jobs.win_rate"]);
  });
});

describe("attention and approval metrics", () => {
  it("parses attention_summary() and falls back to zeros on bad input", () => {
    const s = parseAttentionSummary({ open: 9, now: 3, overdue: 2, awaiting_response: 1 });
    expect(attentionMetricValue("attention.now", s)).toBe(3);
    expect(attentionMetricValue("attention.overdue", s)).toBe(2);
    expect(attentionMetricValue("attention.open", s)).toBe(9);
    expect(attentionMetricValue("attention.in_progress", s)).toBe(0);
    expect(parseAttentionSummary(null)).toEqual(EMPTY_ATTENTION_SUMMARY);
    expect(parseAttentionSummary({ now: -4, overdue: "x" })).toMatchObject({ now: 0, overdue: 0 });
  });

  it("reads approval counts", () => {
    const c = parseApprovalCounts({
      total: 10,
      pending: 4,
      approved_30d: 3,
      rejected_30d: 1,
      overrides_pending: 4,
    });
    for (const id of Object.keys(APPROVAL_METRICS) as (keyof typeof APPROVAL_METRICS)[]) {
      expect(approvalMetricValue(id, c)).toBeGreaterThanOrEqual(0);
    }
    expect(approvalMetricValue("approvals.pending", c)).toBe(4);
    expect(approvalMetricValue("approvals.rejected_30d", parseApprovalCounts(undefined))).toBe(0);
  });

  it("are in the global registry", () => {
    expect(getMetric("attention.now")).toBe(ATTENTION_METRICS["attention.now"]);
    expect(getMetric("approvals.total")).toBe(APPROVAL_METRICS["approvals.total"]);
  });
});

describe("estimate metrics (Phase 4)", () => {
  const stats = parseEstimateStats({
    sent: 8,
    sent_value_cents: 4_000_000,
    sla_hours: 24,
    sla_measured: 6,
    sla_met: 5,
    cohort_accepted: 3,
    cohort_accepted_value_cents: 1_800_000,
    accepted: 4,
    accepted_value_cents: 2_200_000,
    open: 2,
    open_value_cents: 900_000,
    expiring_soon: 1,
    by_status: { sent: 2, accepted: 4 },
  });

  it("matches the fixture's expected values", () => {
    expect(estimateMetricValue("estimates.sent", stats, "this month")).toMatchObject({
      value: 8,
      caption: "First sent this month",
    });
    expect(estimateMetricValue("estimates.sla_24h", stats).value).toBeCloseTo(5 / 6);
    expect(estimateMetricValue("estimates.close_rate", stats).value).toBe(0.375);
    expect(estimateMetricValue("estimates.close_rate_value", stats).value).toBe(0.45);
    expect(estimateMetricValue("estimates.avg_job_value", stats).value).toBe(550_000);
    expect(estimateMetricValue("estimates.open_value", stats).value).toBe(900_000);
    expect(getMetric("estimates.sent")).toBe(ESTIMATE_METRICS["estimates.sent"]);
  });

  it("never shows impossible values", () => {
    const empty = parseEstimateStats({});
    expect(empty).toEqual(EMPTY_ESTIMATE_STATS);
    expect(estimateMetricValue("estimates.close_rate", empty)).toMatchObject({
      value: null,
      display: "—",
    });
    expect(estimateMetricValue("estimates.avg_job_value", empty).value).toBeNull();
    expect(estimateMetricValue("estimates.sla_24h", empty).value).toBeNull();
    expect(parseEstimateStats("garbage")).toEqual(EMPTY_ESTIMATE_STATS);
    expect(parseEstimateStats({ sent: -3 }).sent).toBe(0);
  });
});

describe("document metrics (Phase 5)", () => {
  const FIX = {
    total: 12,
    awaiting_signature: 1,
    linked_to_jobs: 10,
    storage_bytes: 5 * 1024 * 1024,
    recent: 3,
    needs_action: 2,
    by_category: { contract: 4, hoa: 2 },
  };
  it("reads the document_stats payload", () => {
    const s = parseDocumentStats(FIX);
    expect(documentMetricValue("documents.total", s)).toMatchObject({ value: 12, display: "12" });
    expect(documentMetricValue("documents.awaiting_signature", s).value).toBe(1);
    expect(documentMetricValue("documents.needs_action", s).value).toBe(2);
    expect(documentMetricValue("documents.linked_to_jobs", s).value).toBe(10);
    expect(documentMetricValue("documents.recent", s).value).toBe(3);
    expect(documentMetricValue("documents.storage_used", s).display).toBe("5 MB");
    expect(getMetric("documents.total")).toBe(DOCUMENT_METRICS["documents.total"]);
  });
  it("malformed payloads read as zero", () => {
    expect(parseDocumentStats(null)).toEqual(EMPTY_DOCUMENT_STATS);
    expect(parseDocumentStats({ total: "x" }).total).toBe(0);
  });
});

describe("onboarding board metrics (Phase 5)", () => {
  const FIX = {
    canSeeMoney: true,
    lanes: [
      { lane: "deposit_hold", count: 2, valueCents: 1_500_000, avgDays: 3, overdue: 1 },
      { lane: "needs_onboarding", count: 4, valueCents: 2_000_000, avgDays: 5, overdue: 0 },
      { lane: "on_hold", count: 1, valueCents: 400_000, avgDays: 1, overdue: 0 },
      { lane: "ready", count: 3, valueCents: 900_000, avgDays: null, overdue: 0 },
      { lane: "in_production", count: 2, valueCents: 0, avgDays: 2, overdue: 0 },
      { lane: "invoicing", count: 1, valueCents: 100, avgDays: 9, overdue: 0 },
      { lane: "paid", count: 5, valueCents: 0, avgDays: 1, overdue: 0 },
    ],
    activeJobs: 13,
    activeValueCents: 4_800_100,
    depositHeldCents: 450_000,
    outstandingCents: null,
  };
  it("reads the board summary", () => {
    const s = parseBoardStats(FIX);
    const v = (id: Parameters<typeof boardMetricValue>[0]) => boardMetricValue(id, s);
    expect(v("board.active_jobs").value).toBe(13);
    expect(v("board.active_value").display).toBe(formatMoney(4_800_100));
    expect(v("board.deposit_hold").value).toBe(2);
    expect(v("board.deposit_held").value).toBe(450_000);
    expect(v("board.needs_onboarding").value).toBe(4);
    expect(v("board.needs_onboarding_age").display).toBe("5 days");
    expect(v("board.on_hold").value).toBe(1);
    expect(v("board.on_hold_age").display).toBe("1 day");
    expect(v("board.ready").value).toBe(3);
    expect(v("board.ready_value").value).toBe(900_000);
    expect(v("board.in_production").value).toBe(2);
    expect(v("board.invoicing").value).toBe(1);
    expect(v("board.outstanding").display).toBe("—");
    expect(v("board.paid_month").value).toBe(5);
    expect(getMetric("board.ready")).toBe(BOARD_METRICS["board.ready"]);
  });
  it("missing lanes read as zero; malformed payloads as empty", () => {
    const s = parseBoardStats({ lanes: [] });
    expect(boardMetricValue("board.ready", s).value).toBe(0);
    expect(boardMetricValue("board.needs_onboarding_age", s).display).toBe("—");
    expect(parseBoardStats("junk")).toEqual(EMPTY_BOARD_STATS);
  });
});

describe("production metrics (Phase 6)", () => {
  const stats = parseProductionStats({
    ready_to_schedule: 4,
    unscheduled: 2,
    daily_update_due: 8,
    daily_update_logged: 6,
    on_time_met: 9,
    on_time_missed: 1,
    on_time_weather: 3,
    completed_jobs_90: 4,
    punch_items_90: 10,
    labor_budgeted_hours_90: 200,
    labor_actual_hours_90: 230,
    backlog_hours: 96,
    crew_day_hours: 8,
    scheduled_revenue_next_30_cents: 1_250_000,
    can_see_money: true,
  });
  it("computes the promise KPIs from the server payload", () => {
    expect(productionMetricValue("production.daily_update_compliance", stats).display).toBe("75%");
    expect(productionMetricValue("production.on_time_start", stats).display).toBe("90%");
    expect(productionMetricValue("production.punch_per_job", stats).display).toBe("2.5");
    expect(productionMetricValue("production.labor_variance", stats).value).toBe(115);
    expect(productionMetricValue("production.labor_actual", stats).display).toBe("230 h");
    expect(productionMetricValue("production.backlog_crew_days", stats).display).toBe("12 days");
    expect(productionMetricValue("production.scheduled_revenue_30", stats).display).toBe("$12,500");
  });
  it("shows — when there's nothing to divide by, and hides money without permission", () => {
    const empty = parseProductionStats({
      scheduled_revenue_next_30_cents: 500,
      can_see_money: false,
    });
    expect(productionMetricValue("production.daily_update_compliance", empty).display).toBe("—");
    expect(productionMetricValue("production.on_time_start", empty).display).toBe("—");
    expect(productionMetricValue("production.punch_per_job", empty).display).toBe("—");
    expect(productionMetricValue("production.labor_variance", empty).display).toBe("—");
    expect(productionMetricValue("production.scheduled_revenue_30", empty).display).toBe("—");
    expect(parseProductionStats("garbage")).toEqual(EMPTY_PRODUCTION_STATS);
  });
  it("reads the schedule board summary", () => {
    expect(
      scheduleBoardMetricValue("schedule.conflicts", { ...EMPTY_SCHEDULE_BOARD, conflicts: 3 })
        .display,
    ).toBe("3");
    expect(getMetric("production.ready")).toBe(PRODUCTION_METRICS["production.ready"]);
    expect(getMetric("schedule.tray")).toBe(SCHEDULE_BOARD_METRICS["schedule.tray"]);
  });
});
