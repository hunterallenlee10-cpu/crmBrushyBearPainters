import { describe, expect, it } from "vitest";
import { LEADS_LIST } from "@/lib/lists/modules/leads";
import { validateRules } from "@/lib/lists/filters";
import { parseListState } from "@/lib/lists/params";
import { agingHref, cityHref, funnelHref, leadListHref, sourceHref, statusHref } from "./links";

const state = (href: string) => {
  const url = new URL(href, "http://localhost");
  expect(url.pathname).toBe("/leads/list");
  return parseListState(url.searchParams, LEADS_LIST);
};
const valid = (href: string) => {
  const s = state(href);
  expect(validateRules(s.filter, LEADS_LIST.fields)).toEqual([]);
  return s;
};

describe("lead dashboard drill-down links", () => {
  it("KPI tabs and chips", () => {
    expect(leadListHref()).toBe("/leads/list");
    expect(state(leadListHref({ tab: "all" })).tab).toBe("all");
    expect(state(statusHref("walkthrough_scheduled")).tab).toBe("walkthrough_scheduled");
    const stale = state(leadListHref({ chips: ["stale"] }));
    expect(stale).toMatchObject({ tab: "active", chips: ["stale"] });
  });

  it("end states filter the All tab by status", () => {
    const s = valid(statusHref("lost"));
    expect(s.tab).toBe("all");
    expect(s.filter.rules).toEqual([{ field: "status", op: "equals", value: "lost" }]);
  });

  it("funnel steps match the lead_stats definitions", () => {
    const c = valid(funnelHref("contacted"));
    expect(c.filter.match).toBe("any");
    expect(c.filter.rules).toHaveLength(2);
    expect(valid(funnelHref("walkthrough")).filter.rules[0]).toMatchObject({
      field: "walkthrough",
      op: "is_not_empty",
    });
    expect(valid(funnelHref("converted")).filter.rules[0]).toMatchObject({ value: "converted" });
    expect(state(funnelHref("leads")).tab).toBe("all");
  });

  it("sources and cities", () => {
    expect(valid(sourceHref("website")).filter.rules[0]).toMatchObject({
      field: "source",
      value: "website",
    });
    const territories = [{ value: "3f0e7c1a-3b4b-4c1e-9a55-0d6f3e2b1a11", label: "Bellevue" }];
    expect(valid(cityHref("Bellevue", territories)!).filter.rules[0]).toMatchObject({
      field: "territory",
      value: territories[0]!.value,
    });
    expect(valid(cityHref("Outside service area", territories)!).filter.rules[0]).toMatchObject({
      field: "out_of_area",
      value: "true",
    });
    expect(valid(cityHref("Unknown", territories)!).filter.rules).toHaveLength(2);
    expect(cityHref("Atlantis", territories)).toBeUndefined();
  });

  it("aging buckets stay on open leads and use valid date rules", () => {
    const now = new Date("2026-10-26T18:00:00Z");
    expect(valid(agingHref("0_3", now)).filter.rules[0]).toEqual({
      field: "created",
      op: "in_last_days",
      value: "3",
    });
    const mid = valid(agingHref("4_7", now));
    expect(mid.tab).toBe("active");
    expect(mid.filter.rules[0]).toEqual({
      field: "created",
      op: "between",
      value: "2026-10-20",
      value2: "2026-10-23",
    });
    expect(valid(agingHref("30_plus", now)).filter.rules[0]).toEqual({
      field: "created",
      op: "lt",
      value: "2026-09-27",
    });
    for (const b of ["8_14", "15_30"] as const) valid(agingHref(b, now));
  });
});
