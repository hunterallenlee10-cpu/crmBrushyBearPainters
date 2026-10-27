import { formatInTimeZone } from "date-fns-tz";
import { DISPLAY_TZ } from "@/lib/format/dates";
import { formatMoney } from "@/lib/metrics/registry";
import {
  summaryLabel,
  type GroupBucket,
  type ReportConfig,
  type ReportSummary,
} from "@/lib/domain/reports/config";
import { moduleColumn, type ReportColumn, type ReportModule } from "@/lib/domain/reports/modules";

/**
 * Grouping and summaries for the report builder. Runs on the server over
 * every row the report's filters match (the whole set, read with the
 * person's row security; see lib/analytics/reports.ts), never over one page
 * of a list. Pure and unit-tested.
 */

export type ReportRow = Record<string, unknown>;
export type LabelMaps = Readonly<Record<string, Readonly<Record<string, string>>>>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Pacific calendar day of a timestamp or date value (null when empty / invalid). */
export function pacificDay(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  if (ISO_DAY.test(v)) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : formatInTimeZone(d, DISPLAY_TZ, "yyyy-MM-dd");
}

/** Sortable key + label of a day in a bucket. Weeks start on Monday. */
export function bucketOf(day: string, bucket: GroupBucket): { key: string; label: string } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  switch (bucket) {
    case "day":
      return { key: day, label: `${MONTHS[m - 1]} ${d}, ${y}` };
    case "week": {
      const t = new Date(Date.UTC(y, m - 1, d));
      const dow = (t.getUTCDay() + 6) % 7;
      t.setUTCDate(t.getUTCDate() - dow);
      const key = t.toISOString().slice(0, 10);
      return {
        key,
        label: `Week of ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`,
      };
    }
    case "month":
      return { key: day.slice(0, 7), label: `${MONTHS[m - 1]} ${y}` };
    case "quarter": {
      const q = Math.floor((m - 1) / 3) + 1;
      return { key: `${y}-Q${q}`, label: `Q${q} ${y}` };
    }
    case "year":
      return { key: String(y), label: String(y) };
  }
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** One summary over a set of rows (null when nothing to average / no values). */
export function summarize(rows: readonly ReportRow[], s: ReportSummary): number | null {
  if (s.fn === "count") return rows.length;
  const field = s.field ?? "";
  if (s.fn === "count_of")
    return rows.filter((r) => !isEmpty(r[field]) && r[field] !== false).length;
  const nums = rows.map((r) => toNumber(r[field])).filter((n): n is number => n !== null);
  if (nums.length === 0) return s.fn === "sum" ? 0 : null;
  switch (s.fn) {
    case "sum":
      return nums.reduce((t, n) => t + n, 0);
    case "avg":
      return nums.reduce((t, n) => t + n, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
}

export type ReportGroup = { key: string; label: string; values: (number | null)[]; rows: number };
export type ReportSummaryTable = {
  labels: string[];
  /** Units per summary column (money columns show dollars). */
  kinds: ("count" | "money" | "number")[];
  groups: ReportGroup[];
  totals: (number | null)[];
  rowCount: number;
};

/** A cell's text for display and CSV. */
export function formatCell(
  col: ReportColumn | undefined,
  v: unknown,
  labels: LabelMaps = {},
): string {
  if (isEmpty(v)) return "";
  const map = col?.labels ?? (col?.labelSource ? labels[col.labelSource] : undefined);
  switch (col?.kind) {
    case "money": {
      const n = toNumber(v);
      return n === null ? "" : formatMoney(n);
    }
    case "timestamp": {
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? "" : formatInTimeZone(d, DISPLAY_TZ, "MMM d, yyyy h:mm a");
    }
    case "day": {
      const day = pacificDay(v);
      return day ? bucketOf(day, "day").label : "";
    }
    case "boolean":
      return v === true || v === "true" ? "Yes" : "No";
    case "enum":
      return map?.[String(v)] ?? String(v).replaceAll("_", " ");
    case "array":
      return Array.isArray(v) ? v.map((x) => map?.[String(x)] ?? String(x)).join(", ") : String(v);
    case "percent_number": {
      const n = toNumber(v);
      return n === null ? "" : `${Math.round(n * 10) / 10}%`;
    }
    case "number": {
      const n = toNumber(v);
      return n === null ? "" : (Math.round(n * 10) / 10).toLocaleString("en-US");
    }
    default:
      return String(v);
  }
}

/** Groups (when the config has a grouping) and totals for the summaries. */
export function summarizeReport(
  mod: ReportModule,
  config: ReportConfig,
  rows: readonly ReportRow[],
  labelMaps: LabelMaps = {},
): ReportSummaryTable {
  const summaries = config.summaries.length ? config.summaries : [{ fn: "count" as const }];
  const labels = summaries.map((s) => summaryLabel(mod, s));
  const kinds = summaries.map((s) => {
    if (s.fn === "count" || s.fn === "count_of") return "count" as const;
    const col = s.field ? moduleColumn(mod, s.field) : undefined;
    return col?.kind === "money" ? ("money" as const) : ("number" as const);
  });
  const totals = summaries.map((s) => summarize(rows, s));
  if (!config.groupBy) return { labels, kinds, groups: [], totals, rowCount: rows.length };

  const col = moduleColumn(mod, config.groupBy.field);
  const isDate = col?.kind === "timestamp" || col?.kind === "day";
  const bucket = config.groupBy.bucket ?? (isDate ? "month" : undefined);
  const buckets = new Map<string, { label: string; rows: ReportRow[] }>();
  for (const r of rows) {
    const raw = r[config.groupBy.field];
    let key: string;
    let label: string;
    if (isDate) {
      const day = pacificDay(raw);
      if (!day || !bucket) {
        key = "~none";
        label = "No date";
      } else {
        ({ key, label } = bucketOf(day, bucket));
      }
    } else if (isEmpty(raw)) {
      key = "~none";
      label = "None";
    } else {
      key = String(raw);
      label = formatCell(col, raw, labelMaps) || key;
    }
    const b = buckets.get(key) ?? { label, rows: [] };
    b.rows.push(r);
    buckets.set(key, b);
  }
  const groups: ReportGroup[] = [...buckets.entries()].map(([key, b]) => ({
    key,
    label: b.label,
    rows: b.rows.length,
    values: summaries.map((s) => summarize(b.rows, s)),
  }));
  groups.sort((a, b) => {
    if (a.key === "~none") return 1;
    if (b.key === "~none") return -1;
    if (isDate) return a.key.localeCompare(b.key);
    return (b.values[0] ?? 0) - (a.values[0] ?? 0) || a.label.localeCompare(b.label);
  });
  return { labels, kinds, groups, totals, rowCount: rows.length };
}

/** A summary value for display. */
export function formatSummary(kind: "count" | "money" | "number", v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (kind === "money") return formatMoney(v);
  if (kind === "count") return Math.round(v).toLocaleString("en-US");
  return (Math.round(v * 10) / 10).toLocaleString("en-US");
}

/** Sorts rows in memory (used after the query's own order when grouping). */
export function sortRows(
  rows: readonly ReportRow[],
  column: string,
  dir: "asc" | "desc",
): ReportRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[column];
    const y = b[column];
    if (isEmpty(x) && isEmpty(y)) return 0;
    if (isEmpty(x)) return 1;
    if (isEmpty(y)) return -1;
    const nx = toNumber(x);
    const ny = toNumber(y);
    if (nx !== null && ny !== null) return (nx - ny) * sign;
    return String(x).localeCompare(String(y)) * sign;
  });
}
