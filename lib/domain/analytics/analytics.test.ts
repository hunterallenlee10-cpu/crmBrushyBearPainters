import { describe, expect, it } from "vitest";
import {
  MY_NUMBERS_PRESETS,
  OVERVIEW_PRESETS,
  monthStart,
  parsePeriodParams,
  periodQuery,
  resolvePeriod,
} from "@/lib/domain/analytics/periods";
import {
  NO_FILTERS,
  describeFilters,
  filtersToRpc,
  hasFilters,
  parseFilters,
} from "@/lib/domain/analytics/filters";
import {
  ASK_EXAMPLES,
  closestReport,
  composeAnswer,
  filtersFromQuestion,
  periodFromQuestion,
  planQuestion,
  type AskContext,
} from "@/lib/domain/analytics/ask";
import { onPace, summarizeDay } from "@/lib/domain/analytics/brief";
import { countsLine, greeting, readyScore } from "@/lib/domain/analytics/ready-score";
import {
  PREBUILT_DASHBOARDS,
  splitWidgets,
  widgetCatalog,
} from "@/lib/domain/analytics/dashboards";
import {
  ANALYTICS_BREAKDOWNS,
  ANALYTICS_METRICS,
  EMPTY_DAILY_BRIEF,
  EMPTY_WORKSPACE_SUMMARY,
  parseDailyBrief,
} from "@/lib/metrics/registry";
import type { Permission } from "@/lib/permissions";

// 10:00 Pacific on Tue Oct 27, 2026 (PDT, UTC−7).
const NOW = new Date("2026-10-27T17:00:00Z");

describe("periods", () => {
  it("resolves every overview preset to Pacific days", () => {
    expect(resolvePeriod("today", NOW)).toMatchObject({
      firstDay: "2026-10-27",
      lastDay: "2026-10-27",
      from: "2026-10-27T07:00:00.000Z",
      to: "2026-10-28T07:00:00.000Z",
    });
    expect(resolvePeriod("this_week", NOW)).toMatchObject({
      firstDay: "2026-10-26",
      lastDay: "2026-10-27",
    });
    expect(resolvePeriod("this_month", NOW)).toMatchObject({
      firstDay: "2026-10-01",
      lastDay: "2026-10-27",
    });
    expect(resolvePeriod("last_month", NOW)).toMatchObject({
      firstDay: "2026-09-01",
      lastDay: "2026-09-30",
    });
    expect(resolvePeriod("qtd", NOW).firstDay).toBe("2026-10-01");
    expect(resolvePeriod("ytd", NOW).firstDay).toBe("2026-01-01");
    expect(resolvePeriod("rolling_90d", NOW).firstDay).toBe("2026-07-30");
    expect(resolvePeriod("all_time", NOW).firstDay).toBe("2020-01-01");
  });
  it("custom ranges are inclusive and fall back when invalid", () => {
    const r = resolvePeriod("custom", NOW, { from: "2026-03-01", to: "2026-03-31" });
    expect(r).toMatchObject({ preset: "custom", firstDay: "2026-03-01", lastDay: "2026-03-31" });
    expect(r.from).toBe("2026-03-01T08:00:00.000Z");
    expect(r.to).toBe("2026-04-01T07:00:00.000Z");
    expect(periodQuery(r)).toEqual({ period: "custom", from: "2026-03-01", to: "2026-03-31" });
    expect(resolvePeriod("custom", NOW, { from: "2026-04-01", to: "2026-03-01" }).preset).toBe(
      "this_month",
    );
    expect(resolvePeriod("custom", NOW, { from: "2026-02-30", to: "2026-03-01" }).preset).toBe(
      "this_month",
    );
  });
  it("reads only the presets a screen allows", () => {
    expect(
      parsePeriodParams({ period: "today" }, MY_NUMBERS_PRESETS, "this_month", NOW).preset,
    ).toBe("this_month");
    expect(parsePeriodParams({ period: "ytd" }, OVERVIEW_PRESETS, "this_month", NOW).preset).toBe(
      "ytd",
    );
  });
  it("month starts", () => {
    expect(monthStart("2026-10-27")).toBe("2026-10-01");
    expect(monthStart("2026-01-15", -2)).toBe("2025-11-01");
  });
});

describe("filters", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  it("keeps valid filters, drops junk", () => {
    const f = parseFilters({
      work_type: "exterior",
      territory_id: T,
      owner_id: "nope",
      source: "Bad Source!",
    });
    expect(f).toEqual({ ...NO_FILTERS, work_type: "exterior", territory_id: T });
    expect(filtersToRpc(f)).toEqual({ work_type: "exterior", territory_id: T });
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });
  it("checks values against option lists and the filters a screen allows", () => {
    expect(
      parseFilters({ work_type: "spaceship" }, { workTypes: ["interior"] }).work_type,
    ).toBeNull();
    expect(parseFilters({ source: "website" }, {}, ["work_type"]).source).toBeNull();
    expect(parseFilters({ work_type: "all" }).work_type).toBeNull();
  });
  it("describes filters in words", () => {
    expect(describeFilters(NO_FILTERS)).toBe("All work types, cities, owners and sources");
    expect(
      describeFilters(
        { ...NO_FILTERS, work_type: "exterior", territory_id: T },
        {
          workTypes: { exterior: "Exterior" },
          territories: { [T]: "Bellevue" },
        },
      ),
    ).toBe("Exterior · Bellevue");
  });
});

const allowAll = () => true;
function ctx(can: (p: Permission) => boolean = allowAll, isOwner = true): AskContext {
  return {
    can,
    isOwner,
    territories: [
      { value: "t-bellevue", label: "Bellevue" },
      { value: "t-kirkland", label: "Kirkland" },
    ],
    sources: [
      { value: "website", label: "Website" },
      { value: "google_ads", label: "Google Ads" },
    ],
    workTypes: [
      { value: "interior", label: "Interior" },
      { value: "exterior", label: "Exterior" },
      { value: "deck_fence", label: "Deck & Fence" },
    ],
    reports: [
      {
        key: "ar_aging",
        name: "A/R aging",
        description: "Sent invoices with money owed, by how far past due.",
        href: "/analytics/reports/a",
      },
      {
        key: "jobs_missing_daily_logs",
        name: "Jobs missing daily logs",
        description: "Production days with no daily log.",
        href: "/analytics/reports/b",
      },
    ],
  };
}

describe("Ask Brushy Bear", () => {
  it("answers each example prompt from registry metrics", () => {
    const plans = ASK_EXAMPLES.map((q) => planQuestion(q, ctx()));
    expect(plans.every((p) => p.kind === "metrics")).toBe(true);
    const [sales, collect, ready, dq, compare] = plans as Extract<
      (typeof plans)[number],
      { kind: "metrics" }
    >[];
    expect(sales!.metricIds).toContain("kpi.revenue_sold");
    expect(sales!.period).toBe("this_month");
    expect(collect!.metricIds[0]).toBe("kpi.revenue_collected");
    expect(ready!.metricIds).toEqual(["production.ready", "production.unscheduled"]);
    expect(ready!.link?.href).toBe("/jobs/list?chips=ready_to_schedule");
    expect(dq!.metricIds).toContain("kpi.dq_jobs_no_poc");
    expect(compare!.compare).toBe("last_month");
    expect(compare!.period).toBe("this_month");
  });
  it("reads the period and filters from the question", () => {
    expect(periodFromQuestion("How many leads last month?")).toBe("last_month");
    expect(periodFromQuestion("leads ytd")).toBe("ytd");
    expect(periodFromQuestion("Speed to lead today")).toBe("today");
    expect(periodFromQuestion("leads")).toBe("this_month");
    expect(filtersFromQuestion("exterior sales in Bellevue from google ads", ctx())).toEqual({
      ...NO_FILTERS,
      work_type: "exterior",
      territory_id: "t-bellevue",
      source: "google_ads",
    });
    expect(filtersFromQuestion("How many fence jobs?", ctx()).work_type).toBe("deck_fence");
  });
  it("matches metrics by keyword when no intent fits", () => {
    const p = planQuestion("What's our speed to lead?", ctx());
    expect(p.kind === "metrics" && p.metricIds[0]).toBe("kpi.speed_to_lead_median");
    const sla = planQuestion("How is the 24 hour estimate SLA doing this quarter?", ctx());
    expect(sla.kind === "metrics" && sla.metricIds[0]).toBe("kpi.sla_24h");
    expect(sla.kind === "metrics" && sla.period).toBe("qtd");
  });
  it("respects permissions: no revenue for roles without money", () => {
    const noMoney = (p: Permission) => p !== "financials:read" && p !== "job_costing:read";
    const p = planQuestion("How much did we collect this month?", ctx(noMoney, false));
    // Collected and A/R are money; collection % too → nothing left to show.
    expect(p.kind).toBe("forbidden");
    if (p.kind === "forbidden") expect(p.reason).toMatch(/revenue or money/);
    const margin = planQuestion(
      "What is our gross margin?",
      ctx((x) => x !== "job_costing:read", false),
    );
    expect(margin.kind).toBe("forbidden");
    // Sales with no money: the close rate (not money) still answers.
    const sales = planQuestion("How are sales this month?", ctx(noMoney, false));
    expect(sales.kind === "metrics" && sales.metricIds).toEqual([
      "kpi.sold_jobs",
      "kpi.close_rate",
      "kpi.avg_job_value",
    ]);
  });
  it("says so when a question maps to nothing, and suggests the closest report", () => {
    const p = planQuestion("Which invoices are past due?", ctx());
    expect(p.kind === "metrics" && p.metricIds[0]).toBe("kpi.ar_overdue");
    const none = planQuestion("What's the weather on Mars?", ctx());
    expect(none).toEqual({ kind: "unmapped", suggestion: null });
    const near = planQuestion("Show production days without logs", ctx());
    expect(near.kind).toBe("unmapped");
    if (near.kind === "unmapped") expect(near.suggestion?.key).toBe("jobs_missing_daily_logs");
    expect(closestReport("money owed on invoices", ctx().reports)?.key).toBe("ar_aging");
  });
  it("composes answers from computed values and cites metric ids and filters", () => {
    const plan = planQuestion("How are sales in Bellevue this month?", ctx());
    if (plan.kind !== "metrics") throw new Error("expected metrics");
    const a = composeAnswer({
      question: "How are sales in Bellevue this month?",
      plan,
      metrics: [
        {
          id: "kpi.revenue_sold",
          label: "Revenue sold",
          display: "$15,000",
          caption: "2 jobs sold this month",
        },
        {
          id: "kpi.sold_jobs",
          label: "Jobs sold",
          display: "2",
          caption: "Estimate accepted this month",
        },
      ],
      periodLabel: "This Month",
      compareLabel: null,
      filtersLabel: "Bellevue",
    });
    expect(a.text).toBe("This month for Bellevue: Revenue sold: $15,000. Jobs sold: 2.");
    expect(a.citations).toEqual([
      "kpi.revenue_sold",
      "kpi.sold_jobs",
      "period=this_month",
      "territory_id=t-bellevue",
    ]);
    expect(a.note).toBe("computed");
  });
  it("every analytics metric has Ask keywords", () => {
    for (const m of Object.values(ANALYTICS_METRICS)) expect(m.keywords.length).toBeGreaterThan(0);
  });
});

describe("Daily Brief", () => {
  it("summarizes a day deterministically and cites metric ids", () => {
    const b = parseDailyBrief({
      ...EMPTY_DAILY_BRIEF,
      day: "2026-10-26",
      can_see_money: true,
      leads_created: 3,
      estimates_sent: 2,
      estimates_accepted: 1,
      accepted_value_cents: 1_200_000,
      daily_logs: 1,
      overdue_invoices: 2,
      approvals_pending: 1,
    });
    const s = summarizeDay(b, "Mon, Oct 26");
    expect(s.changed.map((l) => l.text)).toEqual([
      "3 new leads came in.",
      "2 estimates sent. 1 estimate accepted ($12,000).",
      "1 daily log submitted.",
    ]);
    expect(s.attention.map((l) => l.text)).toEqual([
      "2 invoices past due.",
      "1 approval waiting for an owner.",
    ]);
    expect(s.citations).toContain("brief.accepted_value");
    expect(summarizeDay(b, "Mon, Oct 26")).toEqual(s);
  });
  it("empty day, and no money for roles without it", () => {
    const s = summarizeDay(EMPTY_DAILY_BRIEF, "Mon, Oct 26");
    expect(s.headline).toBe("Nothing changed on Mon, Oct 26.");
    expect(s.attention[0]!.text).toBe("Nothing needs attention right now.");
    const hidden = summarizeDay(
      { ...EMPTY_DAILY_BRIEF, estimates_accepted: 1, accepted_value_cents: 5000 },
      "x",
    );
    expect(hidden.changed[0]!.text).not.toMatch(/\$/);
  });
});

describe("On Pace", () => {
  it("compares month-to-date sold with the pro-rated goal", () => {
    expect(
      onPace({ soldCents: 1_000_000, goalCents: 3_000_000, dayOfMonth: 10, daysInMonth: 30 })
        .status,
    ).toBe("on_pace");
    expect(
      onPace({ soldCents: 2_000_000, goalCents: 3_000_000, dayOfMonth: 10, daysInMonth: 30 })
        .status,
    ).toBe("ahead");
    const behind = onPace({
      soldCents: 500_000,
      goalCents: 3_000_000,
      dayOfMonth: 15,
      daysInMonth: 30,
    });
    expect(behind.status).toBe("behind");
    expect(behind.text).toBe(
      "$5,000 sold · 17% of the $30,000 goal with 50% of the month gone · behind pace",
    );
  });
  it("no goal and hidden money", () => {
    expect(onPace({ soldCents: 0, goalCents: null, dayOfMonth: 1, daysInMonth: 31 }).status).toBe(
      "no_goal",
    );
    expect(onPace({ soldCents: null, goalCents: 100, dayOfMonth: 1, daysInMonth: 31 }).status).toBe(
      "hidden",
    );
  });
});

describe("Ready Score", () => {
  it("is 100 with nothing waiting", () => {
    expect(readyScore(EMPTY_WORKSPACE_SUMMARY)).toMatchObject({
      score: 100,
      grade: "ready",
      factors: [],
    });
  });
  it("loses capped points per kind of backlog, with reasons", () => {
    const r = readyScore({
      ...EMPTY_WORKSPACE_SUMMARY,
      tasks_overdue: 5,
      attention_urgent: 1,
      leads_awaiting_contact: 2,
      unread_sms: 1,
    });
    expect(r.score).toBe(100 - 30 - 10 - 10 - 2);
    expect(r.grade).toBe("behind");
    expect(r.factors.map((f) => f.label)).toEqual([
      "5 overdue tasks",
      "1 critical or high Attention item",
      "2 new leads not reached yet",
      "1 unread customer conversation",
    ]);
  });
  it("counts line and greeting", () => {
    expect(
      countsLine({
        ...EMPTY_WORKSPACE_SUMMARY,
        appointments_today: 2,
        jobs_active: 3,
        leads_new: 5,
        approvals_pending: 1,
        estimates_awaiting_reply: 2,
      }),
    ).toBe("2 appts today · 3 jobs · 5 new leads · 1 approval · 2 awaiting reply · 0 at risk");
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(13)).toBe("Good afternoon");
    expect(greeting(19)).toBe("Good evening");
  });
});

describe("dashboards", () => {
  it("the six prebuilt dashboards use only registry ids", () => {
    expect(PREBUILT_DASHBOARDS.map((d) => d.key)).toEqual([
      "executive",
      "sales",
      "production",
      "marketing",
      "ar",
      "seasonality",
    ]);
    for (const d of PREBUILT_DASHBOARDS) {
      for (const k of d.kpis) expect(ANALYTICS_METRICS[k], k).toBeDefined();
      for (const c of d.charts) expect(ANALYTICS_BREAKDOWNS[c], c).toBeDefined();
    }
  });
  it("custom widgets split into tiles and charts; unknown ids dropped", () => {
    expect(
      splitWidgets(["kpi.revenue_sold", "kpi.lead_funnel", "nope", "kpi.revenue_sold"]),
    ).toEqual({
      kpis: ["kpi.revenue_sold"],
      charts: ["kpi.lead_funnel"],
    });
    expect(widgetCatalog().length).toBe(
      Object.keys(ANALYTICS_METRICS).length + Object.keys(ANALYTICS_BREAKDOWNS).length,
    );
  });
});
