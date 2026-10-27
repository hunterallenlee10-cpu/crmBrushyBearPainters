import { z } from "zod";
import { filterSchema, validateRules, type FilterSpec, type Rule } from "@/lib/lists/filters";
import { MONEY_FILTER_KEYS, moduleColumn, type ReportModule } from "@/lib/domain/reports/modules";

/**
 * A saved report's definition (SPEC §8.14 report builder: module, columns,
 * filters, grouping, summary, chart type). Stored as `reports.config`.
 */

export const GROUP_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export type GroupBucket = (typeof GROUP_BUCKETS)[number];
export const SUMMARY_FNS = ["count", "count_of", "sum", "avg", "min", "max"] as const;
export type SummaryFn = (typeof SUMMARY_FNS)[number];
export const CHART_TYPES = ["bar", "line", "donut", "table"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const SUMMARY_LABELS: Record<SummaryFn, string> = {
  count: "Count of rows",
  count_of: "Count with a value",
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
};
export const CHART_LABELS: Record<ChartType, string> = {
  bar: "Bar chart",
  line: "Line chart",
  donut: "Donut",
  table: "Table only",
};
export const BUCKET_LABELS: Record<GroupBucket, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

export const summarySchema = z.object({
  fn: z.enum(SUMMARY_FNS),
  field: z.string().max(60).optional(),
});
export type ReportSummary = z.infer<typeof summarySchema>;

export const reportConfigSchema = z.object({
  columns: z.array(z.string().min(1).max(60)).min(1).max(30),
  filter: filterSchema,
  groupBy: z
    .object({ field: z.string().min(1).max(60), bucket: z.enum(GROUP_BUCKETS).optional() })
    .nullable()
    .default(null),
  summaries: z
    .array(summarySchema)
    .max(6)
    .default([{ fn: "count" }]),
  chart: z.enum(CHART_TYPES).default("table"),
  sort: z
    .object({ column: z.string().min(1).max(60), dir: z.enum(["asc", "desc"]) })
    .nullable()
    .default(null),
});
export type ReportConfig = z.infer<typeof reportConfigSchema>;

export type ConfigProblem = { path: string; message: string };

const DATE_KINDS = new Set(["timestamp", "day"]);

/** Checks a config against its module: every name must be one of the module's. */
export function validateReportConfig(mod: ReportModule, config: ReportConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const seen = new Set<string>();
  config.columns.forEach((c, i) => {
    if (!moduleColumn(mod, c))
      problems.push({ path: `columns.${i}`, message: `Unknown column “${c}”.` });
    if (seen.has(c)) problems.push({ path: `columns.${i}`, message: `“${c}” is listed twice.` });
    seen.add(c);
  });
  for (const e of validateRules(config.filter, mod.fields)) {
    problems.push({ path: `filter.rules.${e.index}`, message: e.message });
  }
  if (config.groupBy) {
    const col = moduleColumn(mod, config.groupBy.field);
    if (!col || !col.groupable) {
      problems.push({ path: "groupBy.field", message: "Pick a column you can group by." });
    } else if (config.groupBy.bucket && !DATE_KINDS.has(col.kind)) {
      problems.push({
        path: "groupBy.bucket",
        message: "Only date columns group by day, week or month.",
      });
    }
  }
  config.summaries.forEach((s, i) => {
    if (s.fn === "count") return;
    const col = s.field ? moduleColumn(mod, s.field) : undefined;
    if (!col)
      return problems.push({ path: `summaries.${i}`, message: "Pick a column to summarize." });
    if (s.fn !== "count_of" && !col.numeric) {
      problems.push({ path: `summaries.${i}`, message: `“${col.label}” isn't a number.` });
    }
  });
  if (config.sort && !moduleColumn(mod, config.sort.column)) {
    problems.push({ path: "sort.column", message: "Pick a column to sort by." });
  }
  if (config.chart !== "table" && !config.groupBy) {
    problems.push({ path: "chart", message: "Charts need a grouping." });
  }
  return problems;
}

/** Money filters are typed in dollars; the views store cents. */
export function moneyFiltersToCents(filter: FilterSpec): FilterSpec {
  const toCents = (v: string | undefined) =>
    v !== undefined && v.trim() !== "" && Number.isFinite(Number(v))
      ? String(Math.round(Number(v) * 100))
      : v;
  return {
    ...filter,
    rules: filter.rules.map((r): Rule => {
      if (!MONEY_FILTER_KEYS.has(r.field) || Array.isArray(r.value)) return r;
      return { ...r, value: toCents(r.value), value2: toCents(r.value2) };
    }),
  };
}

/** The columns the query has to read: shown, grouped, summarized and sorted ones (+ id). */
export function columnsToRead(mod: ReportModule, config: ReportConfig): string[] {
  const out = new Set<string>(["id"]);
  if (mod.id === "estimates" || mod.id === "invoices") out.add("job_id");
  for (const c of config.columns) out.add(c);
  if (config.groupBy) out.add(config.groupBy.field);
  for (const s of config.summaries) if (s.field) out.add(s.field);
  if (config.sort) out.add(config.sort.column);
  return [...out].filter((c) => c === "id" || c === "job_id" || moduleColumn(mod, c));
}

export function summaryLabel(mod: ReportModule, s: ReportSummary): string {
  if (s.fn === "count") return "Rows";
  const col = s.field ? moduleColumn(mod, s.field) : undefined;
  const name = col?.label ?? s.field ?? "";
  if (s.fn === "count_of") return `With ${name.toLowerCase()}`;
  return `${SUMMARY_LABELS[s.fn]} of ${name.toLowerCase()}`;
}
