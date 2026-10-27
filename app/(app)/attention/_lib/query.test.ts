import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  attentionFilterOps,
  attentionHref,
  escapeLike,
  hasNarrowingFilters,
  parseAttentionQuery,
  priorityPageSlices,
  prioritiesFor,
  ruleLabel,
  sortByUrgency,
  type RankableItem,
} from "./query";

const NOW = new Date("2026-10-27T17:00:00Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe("parseAttentionQuery", () => {
  it("falls back to defaults for missing or unknown values", () => {
    expect(parseAttentionQuery({})).toEqual(DEFAULT_QUERY);
    expect(
      parseAttentionQuery({
        status: "bogus",
        priority: "urgentish",
        type: "drop_tables",
        category: "nope",
        page: "-3",
        sort: "random",
      }),
    ).toEqual(DEFAULT_QUERY);
  });

  it("reads every filter", () => {
    expect(
      parseAttentionQuery({
        status: "snoozed",
        priority: "urgent",
        type: "aging_lead",
        category: "tasks",
        due: "overdue",
        q: "  Smith  ",
        mine: "1",
        sort: "urgency",
        page: "3",
      }),
    ).toEqual({
      status: "snoozed",
      priority: "urgent",
      rule: "aging_lead",
      category: "tasks",
      overdue: true,
      q: "Smith",
      mine: true,
      sort: "urgency",
      page: 3,
    });
  });

  it("takes the first of repeated params and caps the search", () => {
    const q = parseAttentionQuery({ status: ["resolved", "open"], q: "x".repeat(300) });
    expect(q.status).toBe("resolved");
    expect(q.q).toHaveLength(100);
  });
});

describe("attentionHref", () => {
  it("leaves defaults out of the URL", () => {
    expect(attentionHref(DEFAULT_QUERY)).toBe("/attention");
  });

  it("round-trips through the parser", () => {
    const q = parseAttentionQuery({
      status: "pending",
      priority: "high",
      type: "start_date_missed",
      q: "a&b",
      mine: "1",
      sort: "urgency",
      page: "2",
    });
    const href = attentionHref(q, { page: 2 });
    const params = Object.fromEntries(new URL(`http://x${href}`).searchParams);
    expect(parseAttentionQuery(params)).toEqual(q);
  });

  it("goes back to page 1 on any change but paging", () => {
    const q = { ...DEFAULT_QUERY, page: 4 };
    expect(attentionHref(q, { mine: true })).toBe("/attention?mine=1");
    expect(attentionHref(q, { page: 5 })).toBe("/attention?page=5");
  });
});

describe("hasNarrowingFilters", () => {
  it("ignores status, mine, sort and page", () => {
    expect(
      hasNarrowingFilters({
        ...DEFAULT_QUERY,
        status: "snoozed",
        mine: true,
        sort: "urgency",
        page: 2,
      }),
    ).toBe(false);
    expect(hasNarrowingFilters({ ...DEFAULT_QUERY, q: "x" })).toBe(true);
    expect(hasNarrowingFilters({ ...DEFAULT_QUERY, overdue: true })).toBe(true);
  });
});

describe("attentionFilterOps", () => {
  it("open = pending + in progress", () => {
    expect(attentionFilterOps(DEFAULT_QUERY, "u1", NOW)).toEqual([
      { column: "status", op: "in", value: "(pending,in_progress)" },
    ]);
  });

  it("resolved looks back 7 days", () => {
    expect(attentionFilterOps({ ...DEFAULT_QUERY, status: "resolved" }, "u1", NOW)).toEqual([
      { column: "status", op: "eq", value: "resolved" },
      { column: "resolved_at", op: "gte", value: "2026-10-20T17:00:00.000Z" },
    ]);
  });

  it("adds type, category, overdue, search and mine", () => {
    const ops = attentionFilterOps(
      {
        ...DEFAULT_QUERY,
        status: "pending",
        rule: "aging_lead",
        category: "tasks",
        overdue: true,
        q: "50%_off",
        mine: true,
      },
      "u1",
      NOW,
    );
    expect(ops).toEqual([
      { column: "status", op: "eq", value: "pending" },
      { column: "rule_key", op: "eq", value: "aging_lead" },
      { column: "category", op: "eq", value: "tasks" },
      { column: "due_at", op: "lt", value: NOW.toISOString() },
      { column: "title", op: "ilike", value: "%50\\%\\_off%" },
      { column: "owner_id", op: "eq", value: "u1" },
    ]);
  });

  it("escapes LIKE wildcards", () => {
    expect(escapeLike("a\\b%c_d")).toBe("a\\\\b\\%c\\_d");
  });
});

describe("prioritiesFor", () => {
  it("expands the filter, most urgent first", () => {
    expect(prioritiesFor(null)).toEqual(["critical", "high", "medium", "low"]);
    expect(prioritiesFor("urgent")).toEqual(["critical", "high"]);
    expect(prioritiesFor("medium")).toEqual(["medium"]);
  });
});

describe("priorityPageSlices", () => {
  const counts = { critical: 3, high: 60, medium: 10, low: 0 };

  it("fills the first page from critical, then high", () => {
    expect(priorityPageSlices(counts, 0, 50)).toEqual([
      { priority: "critical", from: 0, to: 2 },
      { priority: "high", from: 0, to: 46 },
    ]);
  });

  it("continues where the last page stopped", () => {
    expect(priorityPageSlices(counts, 50, 50)).toEqual([
      { priority: "high", from: 47, to: 59 },
      { priority: "medium", from: 0, to: 9 },
    ]);
  });

  it("is empty past the end and skips empty priorities", () => {
    expect(priorityPageSlices(counts, 100, 50)).toEqual([]);
    expect(priorityPageSlices({ low: 2 }, 0, 50)).toEqual([{ priority: "low", from: 0, to: 1 }]);
  });

  it("covers every row exactly once across pages", () => {
    const c = { critical: 7, high: 0, medium: 23, low: 5 };
    const seen: string[] = [];
    for (let offset = 0; offset < 40; offset += 6) {
      for (const s of priorityPageSlices(c, offset, 6)) {
        for (let i = s.from; i <= s.to; i++) seen.push(`${s.priority}:${i}`);
      }
    }
    expect(seen).toHaveLength(35);
    expect(new Set(seen).size).toBe(35);
  });
});

describe("sortByUrgency", () => {
  const item = (id: string, over: Partial<RankableItem>): RankableItem => ({
    id,
    priority: "medium",
    dueAt: null,
    openedAt: iso(-HOUR),
    ...over,
  });

  it("puts priority first, then how overdue, then age", () => {
    const sorted = sortByUrgency(
      [
        item("medium-old", { openedAt: iso(-10 * 24 * HOUR) }),
        item("high-not-due", { priority: "high", dueAt: iso(48 * HOUR) }),
        item("high-overdue", { priority: "high", dueAt: iso(-5 * HOUR) }),
        item("critical", { priority: "critical" }),
        item("medium-new", {}),
      ],
      NOW,
    );
    expect(sorted.map((s) => s.id)).toEqual([
      "critical",
      "high-overdue",
      "high-not-due",
      "medium-old",
      "medium-new",
    ]);
    expect(sorted[0]?.urgency ?? 0).toBeGreaterThan(sorted[1]?.urgency ?? 0);
  });

  it("is deterministic for ties", () => {
    const a = item("b", {});
    const b = item("a", {});
    expect(sortByUrgency([a, b], NOW).map((s) => s.id)).toEqual(["a", "b"]);
    expect(sortByUrgency([b, a], NOW).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("ruleLabel", () => {
  it("uses the rule's label", () => {
    expect(ruleLabel("aging_lead")).toBe("Aging lead");
    expect(ruleLabel("future_rule")).toBe("future rule");
  });
});
