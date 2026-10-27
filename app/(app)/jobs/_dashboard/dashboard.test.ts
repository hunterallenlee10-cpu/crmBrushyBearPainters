import { describe, expect, it } from "vitest";
import { decodeFilter } from "@/lib/lists/filters";
import { parseJobPeriod, periodRange } from "./periods";
import { closedHref, jobListHref, pipelineHealthHref, soldHref, stageHref } from "./links";

// Mid-afternoon Pacific on Oct 27, 2026 (PDT, UTC-7).
const NOW = new Date("2026-10-27T22:00:00Z");

describe("periods", () => {
  it("parses the period from the URL, defaulting to This Month", () => {
    expect(parseJobPeriod(undefined)).toBe("this_month");
    expect(parseJobPeriod("ytd")).toBe("ytd");
    expect(parseJobPeriod(["qtd", "ytd"])).toBe("qtd");
    expect(parseJobPeriod("forever")).toBe("this_month");
  });

  it("This Month runs from the 1st (Pacific) and compares with last month", () => {
    const r = periodRange("this_month", NOW);
    expect(r.from).toBe("2026-10-01T07:00:00.000Z");
    expect(r.to).toBe("2026-11-01T07:00:00.000Z");
    expect(r.prevFrom).toBe("2026-09-01T07:00:00.000Z");
    expect(r.firstDay).toBe("2026-10-01");
    expect(r.lastDay).toBe("2026-10-27");
    expect(r.words).toEqual({ period: "this month", prior: "last month", start: "Oct 1" });
  });

  it("Last Month is the whole previous month", () => {
    const r = periodRange("last_month", NOW);
    expect(r.from).toBe("2026-09-01T07:00:00.000Z");
    expect(r.to).toBe("2026-10-01T07:00:00.000Z");
    expect(r.prevFrom).toBe("2026-08-01T07:00:00.000Z");
    expect(r.lastDay).toBe("2026-09-30");
  });

  it("QTD and YTD start at the quarter / year (standard time in winter)", () => {
    const q = periodRange("qtd", NOW);
    expect(q.firstDay).toBe("2026-10-01");
    expect(q.to).toBe("2027-01-01T08:00:00.000Z");
    expect(q.prevFrom).toBe("2026-07-01T07:00:00.000Z");
    const y = periodRange("ytd", NOW);
    expect(y.from).toBe("2026-01-01T08:00:00.000Z");
    expect(y.prevFrom).toBe("2025-01-01T08:00:00.000Z");
    expect(y.words.prior).toBe("last year");
  });

  it("Rolling 90 days covers today and the 89 days before", () => {
    const r = periodRange("rolling_90d", NOW);
    expect(r.firstDay).toBe("2026-07-30");
    expect(r.lastDay).toBe("2026-10-27");
    expect(r.to).toBe("2026-10-28T07:00:00.000Z");
    expect(r.prevFrom).toBe("2026-05-01T07:00:00.000Z");
  });

  it("uses the Pacific day, not the UTC day, late in the evening", () => {
    // 11:30 PM Pacific on Oct 31 is already Nov 1 in UTC.
    const r = periodRange("this_month", new Date("2026-11-01T06:30:00Z"));
    expect(r.firstDay).toBe("2026-10-01");
    expect(r.lastDay).toBe("2026-10-31");
  });

  it("January's prior month is last December", () => {
    const r = periodRange("this_month", new Date("2027-01-15T20:00:00Z"));
    expect(r.prevFrom).toBe("2026-12-01T08:00:00.000Z");
    const q = periodRange("qtd", new Date("2027-01-15T20:00:00Z"));
    expect(q.prevFrom).toBe("2026-10-01T07:00:00.000Z");
  });
});

describe("drill-down links", () => {
  const range = periodRange("this_month", NOW);
  const filterOf = (href: string) => decodeFilter(new URL(href, "http://x").searchParams.get("f"));

  it("builds Job List URLs from tab, chips and filter", () => {
    expect(jobListHref()).toBe("/jobs/list");
    expect(jobListHref({ tab: "active" })).toBe("/jobs/list");
    expect(jobListHref({ tab: "all", chips: ["sold"] })).toBe("/jobs/list?tab=all&chips=sold");
  });

  it("stage links open closed stages on All", () => {
    expect(stageHref("in_progress")).toBe("/jobs/list?chips=in_progress");
    expect(stageHref("closed_won")).toBe("/jobs/list?tab=all&chips=closed_won");
  });

  it("closed and sold links filter by the period's days", () => {
    const won = closedHref("closed_won", range);
    expect(won).toContain("tab=all");
    expect(won).toContain("chips=closed_won");
    expect(filterOf(won).rules).toEqual([
      { field: "closed", op: "between", value: "2026-10-01", value2: "2026-10-27" },
    ]);
    expect(filterOf(soldHref(range)).rules[0]).toMatchObject({ field: "sold", op: "between" });
  });

  it("pipeline health rows link to the matching list", () => {
    expect(pipelineHealthHref("open", range)).toBe("/jobs/list");
    expect(pipelineHealthHref("in_progress", range)).toBe("/jobs/list?chips=in_progress");
    expect(pipelineHealthHref("closed_lost", range)).toContain("chips=closed_lost");
  });
});
