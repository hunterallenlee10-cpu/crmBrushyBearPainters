import {
  ATTENTION_CATEGORIES,
  ATTENTION_PRIORITIES,
  ATTENTION_RULES,
  isAttentionRuleKey,
  urgencyScore,
  type AttentionCategory,
  type AttentionPriority,
  type AttentionRuleKey,
} from "@/lib/domain/attention/rules";

/**
 * Attention Center list state (pure, unit-tested): URL params ⇄ typed state,
 * the PostgREST filters it turns into, priority-ordered paging and the
 * deterministic "Prioritize" order.
 */

export const PAGE_SIZE = 50;
/** Items "Resolved (last 7 days)" looks back over. */
export const RESOLVED_LOOKBACK_DAYS = 7;
/** Most open items the urgency sort ranks (scores depend on "now", so they're ranked on the server). */
export const URGENCY_CAP = 2000;
export const SEARCH_MAX = 100;

export const STATUS_VIEWS = ["open", "pending", "in_progress", "snoozed", "resolved"] as const;
export type StatusView = (typeof STATUS_VIEWS)[number];
export const STATUS_VIEW_LABELS: Record<StatusView, string> = {
  open: "Open (pending + in progress)",
  pending: "Pending",
  in_progress: "In progress",
  snoozed: "Snoozed",
  resolved: "Resolved (last 7 days)",
};

/** "urgent" = critical and high (the "Needs Attention Now" card). */
export type PriorityFilter = AttentionPriority | "urgent";
export const PRIORITY_FILTER_LABELS: Record<PriorityFilter, string> = {
  urgent: "Critical & high",
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export type AttentionQuery = {
  status: StatusView;
  priority: PriorityFilter | null;
  rule: AttentionRuleKey | null;
  category: AttentionCategory | null;
  /** Only items past their due time. */
  overdue: boolean;
  q: string;
  mine: boolean;
  sort: "default" | "urgency";
  page: number;
};

export const DEFAULT_QUERY: AttentionQuery = {
  status: "open",
  priority: null,
  rule: null,
  category: null,
  overdue: false,
  q: "",
  mine: false,
  sort: "default",
  page: 1,
};

type RawParams = Record<string, string | string[] | undefined>;

function one(raw: RawParams, key: string): string {
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

function pick<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseAttentionQuery(raw: RawParams): AttentionQuery {
  const rule = one(raw, "type");
  const page = Number.parseInt(one(raw, "page"), 10);
  return {
    status: pick(one(raw, "status"), STATUS_VIEWS) ?? "open",
    priority: pick(one(raw, "priority"), ["urgent", ...ATTENTION_PRIORITIES] as const),
    rule: isAttentionRuleKey(rule) ? rule : null,
    category: pick(one(raw, "category"), ATTENTION_CATEGORIES),
    overdue: one(raw, "due") === "overdue",
    q: one(raw, "q").slice(0, SEARCH_MAX),
    mine: one(raw, "mine") === "1",
    sort: one(raw, "sort") === "urgency" ? "urgency" : "default",
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 10_000) : 1,
  };
}

/** URL for a list state; any change other than the page goes back to page 1. */
export function attentionHref(base: AttentionQuery, patch: Partial<AttentionQuery> = {}): string {
  const next: AttentionQuery = { ...base, ...patch };
  if (!("page" in patch)) next.page = 1;
  const p = new URLSearchParams();
  if (next.status !== DEFAULT_QUERY.status) p.set("status", next.status);
  if (next.priority) p.set("priority", next.priority);
  if (next.rule) p.set("type", next.rule);
  if (next.category) p.set("category", next.category);
  if (next.overdue) p.set("due", "overdue");
  if (next.q) p.set("q", next.q);
  if (next.mine) p.set("mine", "1");
  if (next.sort === "urgency") p.set("sort", "urgency");
  if (next.page > 1) p.set("page", String(next.page));
  const qs = p.toString();
  return qs ? `/attention?${qs}` : "/attention";
}

/** True when anything narrows the list beyond the status view and "Only mine". */
export function hasNarrowingFilters(q: AttentionQuery): boolean {
  return Boolean(q.priority || q.rule || q.category || q.overdue || q.q);
}

export type FilterOp = { column: string; op: string; value: string };

/** `%`, `_` and `\` are wildcards in ILIKE; search for them literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * PostgREST filters for a list state (row security narrows further). The
 * priority filter is left to the caller, which pages one priority at a time.
 */
export function attentionFilterOps(q: AttentionQuery, viewerId: string, now: Date): FilterOp[] {
  const ops: FilterOp[] = [];
  if (q.status === "open") ops.push({ column: "status", op: "in", value: "(pending,in_progress)" });
  else ops.push({ column: "status", op: "eq", value: q.status });
  if (q.status === "resolved") {
    const since = new Date(now.getTime() - RESOLVED_LOOKBACK_DAYS * 24 * 3_600_000);
    ops.push({ column: "resolved_at", op: "gte", value: since.toISOString() });
  }
  if (q.rule) ops.push({ column: "rule_key", op: "eq", value: q.rule });
  if (q.category) ops.push({ column: "category", op: "eq", value: q.category });
  if (q.overdue) ops.push({ column: "due_at", op: "lt", value: now.toISOString() });
  if (q.q) ops.push({ column: "title", op: "ilike", value: `%${escapeLike(q.q)}%` });
  if (q.mine) ops.push({ column: "owner_id", op: "eq", value: viewerId });
  return ops;
}

/** Priorities a list state includes, most urgent first. */
export function prioritiesFor(filter: PriorityFilter | null): AttentionPriority[] {
  if (!filter) return [...ATTENTION_PRIORITIES];
  if (filter === "urgent") return ["critical", "high"];
  return [filter];
}

export type PrioritySlice = { priority: AttentionPriority; from: number; to: number };

/**
 * Default order is priority, then due time. Priority is stored as text, so the
 * page is read one priority at a time: given the count per priority, which
 * rows (inclusive ranges) of which priority make up rows [offset, offset+limit).
 */
export function priorityPageSlices(
  counts: Partial<Record<AttentionPriority, number>>,
  offset: number,
  limit: number,
): PrioritySlice[] {
  const slices: PrioritySlice[] = [];
  let start = 0;
  const end = offset + limit;
  for (const priority of ATTENTION_PRIORITIES) {
    const count = counts[priority] ?? 0;
    const bucketEnd = start + count;
    if (count > 0 && bucketEnd > offset && start < end) {
      const from = Math.max(0, offset - start);
      const to = Math.min(count, end - start) - 1;
      slices.push({ priority, from, to });
    }
    start = bucketEnd;
    if (start >= end) break;
  }
  return slices;
}

export type RankableItem = {
  id: string;
  priority: AttentionPriority;
  dueAt: string | null;
  openedAt: string;
};

function time(v: string | null): number {
  return v === null ? Number.POSITIVE_INFINITY : new Date(v).getTime();
}

/**
 * "Prioritize": highest urgency score first (lib/domain/attention/rules.ts:
 * priority, then how overdue, then age). Ties: earlier due, older, then id,
 * so the order never changes between two loads at the same moment.
 */
export function sortByUrgency<T extends RankableItem>(
  items: readonly T[],
  now: Date,
): (T & { urgency: number })[] {
  return items
    .map((i) => ({ ...i, urgency: urgencyScore(i, now) }))
    .sort(
      (a, b) =>
        b.urgency - a.urgency ||
        time(a.dueAt) - time(b.dueAt) ||
        time(a.openedAt) - time(b.openedAt) ||
        a.id.localeCompare(b.id),
    );
}

export function isPriority(v: string): v is AttentionPriority {
  return (ATTENTION_PRIORITIES as readonly string[]).includes(v);
}

export function isCategory(v: string): v is AttentionCategory {
  return (ATTENTION_CATEGORIES as readonly string[]).includes(v);
}

/** Plain-English name of a rule ("Aging lead"), falling back to the stored key. */
export function ruleLabel(key: string): string {
  return isAttentionRuleKey(key) ? ATTENTION_RULES[key].label : key.replace(/_/g, " ");
}
