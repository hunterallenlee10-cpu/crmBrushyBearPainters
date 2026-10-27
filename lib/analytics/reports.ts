import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { filterToOps } from "@/lib/lists/filters";
import { applyOps, withOptions } from "@/lib/lists/server";
import type { Permission } from "@/lib/permissions";
import {
  columnsToRead,
  moneyFiltersToCents,
  reportConfigSchema,
  type ReportConfig,
} from "@/lib/domain/reports/config";
import { moduleColumn, type ReportModule } from "@/lib/domain/reports/modules";
import {
  formatCell,
  sortRows,
  summarizeReport,
  type LabelMaps,
  type ReportRow,
  type ReportSummaryTable,
} from "@/lib/domain/reports/summarize";
import type { AnalyticsOptions } from "@/lib/analytics/server";

/**
 * Runs a report on the server. Rows come from the module's security_invoker
 * view with the caller's client (so row security decides what's in it), read
 * in chunks of 1,000 (PostgREST's page size) up to REPORT_ROW_CAP. Grouping
 * and summaries are computed over that whole set, never over one page.
 */

type Db = SupabaseClient<Database>;

/** Far above this company's volume; the screen says when a report hits it. */
export const REPORT_ROW_CAP = 10_000;
const CHUNK = 1000;

export type ReportResult = {
  rows: ReportRow[];
  summary: ReportSummaryTable;
  truncated: boolean;
  error: string | null;
};

/** Parses a stored config (invalid → null). */
export function parseConfig(raw: unknown): ReportConfig | null {
  const parsed = reportConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Drops columns the viewer may not see (money / costs) before querying. */
export function configFor(
  mod: ReportModule,
  config: ReportConfig,
  can: (p: Permission) => boolean,
): ReportConfig {
  const ok = (id: string) => (moduleColumn(mod, id)?.requires ?? []).every(can);
  const columns = config.columns.filter(ok);
  return {
    ...config,
    columns: columns.length ? columns : [mod.titleColumn],
    summaries: config.summaries.filter((s) => !s.field || ok(s.field)),
    groupBy: config.groupBy && ok(config.groupBy.field) ? config.groupBy : null,
    sort: config.sort && ok(config.sort.column) ? config.sort : null,
    filter: {
      ...config.filter,
      rules: config.filter.rules.filter((r) => ok(r.field)),
    },
  };
}

export async function runReport(
  db: Db,
  mod: ReportModule,
  config: ReportConfig,
  options: AnalyticsOptions,
  labels: LabelMaps,
  now: Date = new Date(),
  /** Required with the service client (the worker), which has no row security. */
  orgId?: string,
): Promise<ReportResult> {
  const fields = withOptions(mod.fields, {
    picklists: {
      work_type: options.workTypes,
      lead_source: options.sources,
      lead_sub_source: options.subSources,
    },
    users: options.users,
    territories: options.territories,
  });
  const ops = [
    ...filterToOps(moneyFiltersToCents(config.filter), fields, now),
    ...(orgId ? [{ kind: "filter" as const, column: "org_id", op: "eq", value: orgId }] : []),
  ];
  const select = columnsToRead(mod, config).join(", ");
  const rows: ReportRow[] = [];
  let truncated = false;
  for (let from = 0; from < REPORT_ROW_CAP + 1; from += CHUNK) {
    let q = applyOps(db.from(mod.view).select(select), ops);
    q = config.sort
      ? q.order(config.sort.column, { ascending: config.sort.dir === "asc", nullsFirst: false })
      : q;
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + CHUNK - 1);
    if (error)
      return {
        rows: [],
        summary: summarizeReport(mod, config, [], labels),
        truncated: false,
        error: error.message,
      };
    const chunk = (data ?? []) as unknown as ReportRow[];
    rows.push(...chunk);
    if (chunk.length < CHUNK) break;
    if (rows.length > REPORT_ROW_CAP) {
      truncated = true;
      rows.length = REPORT_ROW_CAP;
      break;
    }
  }
  const sorted = config.sort ? sortRows(rows, config.sort.column, config.sort.dir) : rows;
  return {
    rows: sorted,
    summary: summarizeReport(mod, config, sorted, labels),
    truncated,
    error: null,
  };
}

/** Rows as display strings for the table and the CSV. */
export function reportCells(
  mod: ReportModule,
  config: ReportConfig,
  rows: readonly ReportRow[],
  labels: LabelMaps,
): string[][] {
  return rows.map((r) => config.columns.map((c) => formatCell(moduleColumn(mod, c), r[c], labels)));
}

/** CSV header and raw-ish rows: money in dollars with cents, dates in Pacific. */
export function reportCsvRows(
  mod: ReportModule,
  config: ReportConfig,
  rows: readonly ReportRow[],
  labels: LabelMaps,
): { header: string[]; body: string[][] } {
  const cols = config.columns.map((c) => moduleColumn(mod, c));
  return {
    header: cols.map((c, i) => c?.label ?? config.columns[i]!),
    body: rows.map((r) =>
      config.columns.map((id, i) => {
        const col = cols[i];
        const v = r[id];
        if (col?.kind === "money") {
          const n = typeof v === "number" ? v : Number(v);
          return v === null || v === undefined || !Number.isFinite(n) ? "" : (n / 100).toFixed(2);
        }
        return formatCell(col, v, labels);
      }),
    ),
  };
}
