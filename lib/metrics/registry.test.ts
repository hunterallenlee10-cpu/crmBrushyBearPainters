import { describe, expect, it } from "vitest";
import {
  EMPTY_LEAD_STATS,
  LEAD_METRICS,
  METRICS,
  formatMetricValue,
  formatPercent,
  getMetric,
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
      expect(["count", "percent", "duration"]).toContain(m.unit);
      expect(m.source).toBe("lead_stats");
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
