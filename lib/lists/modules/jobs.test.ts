import { describe, expect, it } from "vitest";
import { filterToOps, renderExpr, ruleToExpr, validateRules } from "@/lib/lists/filters";
import {
  listOps,
  listStateToQuery,
  parseListState,
  resolveColumns,
  type ListDefaults,
} from "@/lib/lists/params";
import {
  JOB_CHIPS,
  JOB_FIELDS,
  JOBS_LIST,
  ON_HOLD_CHIP,
  OPEN_JOBS_OP,
  chipsForTab,
  cleanJobSearch,
  jobColumnsFor,
  jobsListFor,
  myJobsOp,
  stageListQuery,
} from "@/lib/lists/modules/jobs";
import { JOB_STAGES } from "@/lib/domain/stages";

const NOW = new Date("2026-10-26T18:00:00Z");
const ME = "11111111-1111-4111-8111-111111111111";
const ctx = { userId: ME, now: NOW };
const field = (key: string) => JOB_FIELDS.find((f) => f.key === key)!;
const defaults: ListDefaults = {
  defaultTab: JOBS_LIST.defaultTab,
  defaultSort: JOBS_LIST.defaultSort,
};

describe("jobs list: tabs", () => {
  it("defaults to Active, newest first", () => {
    const s = parseListState({}, JOBS_LIST);
    expect(s).toMatchObject({ tab: "active", sort: "created_at", dir: "desc", chips: [] });
    expect(listOps(s, JOBS_LIST, ctx, [])).toEqual([OPEN_JOBS_OP]);
  });

  it("Active hides closed jobs; My Jobs adds the team rule; All has no filter", () => {
    expect(OPEN_JOBS_OP).toEqual({
      kind: "filter",
      column: "stage",
      op: "not.in",
      value: "(closed_won,closed_lost)",
    });
    expect(JOBS_LIST.tabOps("mine", ctx)).toEqual([
      OPEN_JOBS_OP,
      { kind: "filter", column: "team_user_ids", op: "cs", value: `{${ME}}` },
    ]);
    expect(myJobsOp(ME)).toEqual(JOBS_LIST.tabOps("mine", ctx)[1]);
    expect(JOBS_LIST.tabOps("all", ctx)).toEqual([]);
    expect(JOBS_LIST.tabOps("bogus", ctx)).toEqual([]);
  });

  it("tab count keys match job_status_counts", () => {
    expect(JOBS_LIST.tabs.map((t) => [t.id, t.countKey])).toEqual([
      ["active", "active"],
      ["mine", "mine"],
      ["all", "total"],
    ]);
  });

  it("ignores unknown tabs, chips and sort columns from the URL", () => {
    const s = parseListState(
      { tab: "nope", chips: "sold,bogus,on_hold", sort: "contract_baseline_cents" },
      JOBS_LIST,
    );
    expect(s.tab).toBe("active");
    expect(s.chips).toEqual(["sold", "on_hold"]);
    expect(s.sort).toBe("created_at");
  });
});

describe("jobs list: chips", () => {
  it("has one either/or chip per stage in pipeline order, plus On hold", () => {
    const stageChips = JOB_CHIPS.filter((c) => c.group === "stage");
    expect(stageChips.map((c) => c.id)).toEqual(JOB_STAGES.map((s) => s.id));
    expect(stageChips.map((c) => c.label)).toEqual(JOB_STAGES.map((s) => s.label));
    expect(JOB_CHIPS.at(-1)).toEqual({ id: ON_HOLD_CHIP, label: "On hold" });
  });

  it("covers every stage the spec lists", () => {
    const labels = JOB_CHIPS.map((c) => c.label);
    for (const l of [
      "Walkthrough Scheduled",
      "Estimate Sent",
      "Sold",
      "Onboarding",
      "Ready to Schedule",
      "Scheduled",
      "In Progress",
      "Final Walkthrough",
      "Invoiced",
      "Completed",
      "Closed Won",
      "Closed Lost",
    ]) {
      expect(labels).toContain(l);
    }
  });

  it("maps chips to stage / status filters", () => {
    expect(JOBS_LIST.chipOps("in_progress", ctx)).toEqual([
      { kind: "filter", column: "stage", op: "eq", value: "in_progress" },
    ]);
    expect(JOBS_LIST.chipOps(ON_HOLD_CHIP, ctx)).toEqual([
      { kind: "filter", column: "status", op: "eq", value: "on_hold" },
    ]);
    expect(JOBS_LIST.chipOps("bogus", ctx)).toEqual([]);
  });

  it("shows closed-stage chips only on All (or when already selected)", () => {
    const ids = (tab: string, sel?: string[]) => chipsForTab(tab, sel).map((c) => c.id);
    expect(ids("active")).not.toContain("closed_won");
    expect(ids("mine")).not.toContain("closed_lost");
    expect(ids("active")).toContain(ON_HOLD_CHIP);
    expect(ids("all")).toContain("closed_won");
    expect(ids("active", ["closed_won"])).toContain("closed_won");
    expect(ids("all")).toHaveLength(JOB_CHIPS.length);
  });

  it("stage drill-downs open All for closed stages", () => {
    expect(stageListQuery("sold")).toEqual({ chips: ["sold"] });
    expect(stageListQuery("closed_lost")).toEqual({ tab: "all", chips: ["closed_lost"] });
  });
});

describe("jobs list: search and advanced filter", () => {
  it("searches the lowercased job number + name column", () => {
    expect(JOBS_LIST.searchOps("BB-2026 Smith")).toEqual([
      { kind: "filter", column: "search_text", op: "ilike", value: "*bb-2026 smith*" },
    ]);
    expect(JOBS_LIST.searchOps('  (*%")  ')).toEqual([]);
    expect(cleanJobSearch('Smith, "House" (2)')).toBe("smith house 2");
  });

  it("validates and translates job rules", () => {
    expect(
      renderExpr(ruleToExpr({ field: "stage", op: "equals", value: "sold" }, field("stage"), NOW)),
    ).toBe('stage.eq."sold"');
    expect(
      renderExpr(
        ruleToExpr(
          { field: "work_type", op: "contains", value: "exterior" },
          field("work_type"),
          NOW,
        ),
      ),
    ).toBe('work_types.cs."{exterior}"');
    expect(
      renderExpr(ruleToExpr({ field: "name", op: "contains", value: "Smith" }, field("name"), NOW)),
    ).toBe('search_text.ilike."*smith*"');
    expect(
      validateRules(
        {
          match: "all",
          rules: [
            { field: "stage", op: "equals", value: "not_a_stage" },
            { field: "priority", op: "in", value: ["high", "urgent"] },
            { field: "health", op: "lt", value: "60" },
            { field: "owner", op: "equals", value: "nope" },
          ],
        },
        JOB_FIELDS,
      ).map((e) => e.index),
    ).toEqual([0, 3]);
  });

  it("filters by stage through the list ops", () => {
    const s = parseListState({ tab: "all" }, JOBS_LIST);
    const ops = listOps(
      s,
      JOBS_LIST,
      ctx,
      filterToOps(
        { match: "all", rules: [{ field: "stage", op: "equals", value: "scheduled" }] },
        JOB_FIELDS,
        NOW,
      ),
    );
    expect(ops).toEqual([{ kind: "filter", column: "stage", op: "eq", value: "scheduled" }]);
  });

  it("only offers whitelisted columns (no money, no calendar-date start column)", () => {
    const cols = JOB_FIELDS.map((f) => f.column);
    expect(cols).not.toContain("contract_baseline_cents");
    expect(cols).not.toContain("promised_start_date");
    for (const f of JOB_FIELDS) expect(f.key).toMatch(/^[a-z_]+$/);
  });
});

describe("jobs list: columns", () => {
  it("has the spec's default columns, Name always shown", () => {
    const visible = resolveColumns(JOBS_LIST, null).map((c) => c.id);
    expect(visible).toEqual([
      "job_number",
      "priority",
      "name",
      "account",
      "amount",
      "stage",
      "work_types",
      "start",
      "point_of_contact",
      "owner",
      "health",
    ]);
  });

  it("drops Amount for people without financials", () => {
    expect(jobColumnsFor(false).map((c) => c.id)).not.toContain("amount");
    expect(jobColumnsFor(true).map((c) => c.id)).toContain("amount");
    const noMoney = jobsListFor(false);
    expect(resolveColumns(noMoney, ["amount", "stage"]).map((c) => c.id)).toEqual([
      "name",
      "stage",
    ]);
    expect(jobsListFor(true)).toBe(JOBS_LIST);
  });

  it("sorts only by real job columns", () => {
    for (const c of JOBS_LIST.columns) {
      if (c.sortColumn) expect(c.sortColumn).toMatch(/^[a-z_]+$/);
    }
    expect(JOBS_LIST.columns.find((c) => c.id === "amount")?.sortColumn).toBeUndefined();
  });

  it("round-trips list state through the URL", () => {
    const s = parseListState({ tab: "mine", chips: "sold", q: "smith", page: "2" }, JOBS_LIST);
    expect(listStateToQuery(s, defaults)).toBe("?q=smith&tab=mine&chips=sold&page=2");
  });
});
