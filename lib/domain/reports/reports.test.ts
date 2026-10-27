import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  columnsToRead,
  moneyFiltersToCents,
  reportConfigSchema,
  summaryLabel,
  validateReportConfig,
  type ReportConfig,
} from "@/lib/domain/reports/config";
import { REPORT_MODULES, visibleColumns } from "@/lib/domain/reports/modules";
import { REPORT_TEMPLATES } from "@/lib/domain/reports/templates";
import {
  bucketOf,
  formatCell,
  formatSummary,
  pacificDay,
  sortRows,
  summarize,
  summarizeReport,
} from "@/lib/domain/reports/summarize";
import { csvCell, csvFileName, toCsv } from "@/lib/domain/reports/csv";
import { describeSchedule, nextRunAt } from "@/lib/domain/reports/schedule";

describe("report templates (SPEC §8.14)", () => {
  it("are the ten seeded templates, each valid for its module", () => {
    expect(REPORT_TEMPLATES.map((t) => t.name)).toEqual([
      "Sold by month",
      "Leads by source",
      "Estimates sent vs accepted",
      "A/R aging",
      "Jobs missing daily logs",
      "Sold – no deposit",
      "Gross margin by job",
      "Speed to lead",
      "24h SLA misses",
      "On-time start misses",
    ]);
    for (const t of REPORT_TEMPLATES) {
      const parsed = reportConfigSchema.parse(t.config);
      expect(validateReportConfig(REPORT_MODULES[t.module], parsed), t.key).toEqual([]);
    }
  });

  it("match the seed migration exactly", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261030000200_analytics_seed.sql"),
      "utf8",
    );
    const block = sql.split("-- @report-templates:begin")[1]!.split("-- @report-templates:end")[0]!;
    const rows = [
      ...block.matchAll(
        /\('([a-z0-9_]+)', '((?:[^']|'')*)', '((?:[^']|'')*)', '([a-z]+)', '([a-z]+)',\s*'(\{.*?\})'\)/gs,
      ),
    ];
    expect(rows.length).toBe(10);
    for (const m of rows) {
      const t = REPORT_TEMPLATES.find((x) => x.key === m[1]);
      expect(t, m[1]).toBeDefined();
      expect(m[2]!.replaceAll("''", "'")).toBe(t!.name);
      expect(m[3]!.replaceAll("''", "'")).toBe(t!.description);
      expect(m[4]).toBe(t!.category);
      expect(m[5]).toBe(t!.module);
      expect(JSON.parse(m[6]!)).toEqual(t!.config);
    }
  });
});

const jobs = REPORT_MODULES.jobs;
const base: ReportConfig = reportConfigSchema.parse({
  columns: ["job_number", "name", "contract_cents"],
  filter: { match: "all", rules: [] },
});

describe("config validation", () => {
  it("defaults and accepted shapes", () => {
    expect(base).toMatchObject({
      groupBy: null,
      summaries: [{ fn: "count" }],
      chart: "table",
      sort: null,
    });
  });
  it("refuses unknown columns, bad groupings and summaries", () => {
    const bad = reportConfigSchema.parse({
      columns: ["job_number", "secret_column", "job_number"],
      filter: { match: "all", rules: [{ field: "nope", op: "equals", value: "x" }] },
      groupBy: { field: "contract_cents", bucket: "month" },
      summaries: [{ fn: "sum", field: "name" }, { fn: "avg" }],
      chart: "bar",
      sort: { column: "zzz", dir: "asc" },
    });
    const paths = validateReportConfig(jobs, bad).map((p) => p.path);
    expect(paths).toEqual([
      "columns.1",
      "columns.2",
      "filter.rules.0",
      "groupBy.field",
      "summaries.0",
      "summaries.1",
      "sort.column",
    ]);
    const chartNoGroup = validateReportConfig(jobs, { ...base, chart: "bar" });
    expect(chartNoGroup.map((p) => p.message)).toEqual(["Charts need a grouping."]);
    const dateBucketOnText = validateReportConfig(jobs, {
      ...base,
      groupBy: { field: "stage", bucket: "month" },
    });
    expect(dateBucketOnText[0]!.path).toBe("groupBy.bucket");
  });
  it("money filters are typed in dollars", () => {
    const f = moneyFiltersToCents({
      match: "all",
      rules: [
        { field: "contract_cents", op: "between", value: "100", value2: "2500.5" },
        { field: "missed_daily_logs", op: "gt", value: "2" },
      ],
    });
    expect(f.rules).toEqual([
      { field: "contract_cents", op: "between", value: "10000", value2: "250050" },
      { field: "missed_daily_logs", op: "gt", value: "2" },
    ]);
  });
  it("reads only the columns it needs", () => {
    expect(
      columnsToRead(jobs, {
        ...base,
        groupBy: { field: "stage" },
        summaries: [{ fn: "sum", field: "margin_cents" }],
      }),
    ).toEqual(["id", "job_number", "name", "contract_cents", "stage", "margin_cents"]);
    expect(
      columnsToRead(
        REPORT_MODULES.invoices,
        reportConfigSchema.parse({
          columns: ["invoice_number"],
          filter: { match: "all", rules: [] },
        }),
      ),
    ).toEqual(["id", "job_id", "invoice_number"]);
  });
  it("money and cost columns need their permissions", () => {
    const crewish = visibleColumns(jobs, () => false).map((c) => c.id);
    expect(crewish).not.toContain("contract_cents");
    expect(crewish).not.toContain("margin_cents");
    const office = visibleColumns(jobs, (p) => p === "financials:read").map((c) => c.id);
    expect(office).toContain("contract_cents");
    expect(office).not.toContain("cost_cents");
  });
  it("summary labels", () => {
    expect(summaryLabel(jobs, { fn: "count" })).toBe("Rows");
    expect(summaryLabel(jobs, { fn: "sum", field: "contract_cents" })).toBe("Sum of contract");
    expect(summaryLabel(REPORT_MODULES.estimates, { fn: "count_of", field: "accepted_at" })).toBe(
      "With accepted",
    );
  });
});

describe("grouping and summaries (server-side, every matching row)", () => {
  const rows = [
    {
      id: "1",
      stage: "sold",
      sold_at: "2026-03-12T17:00:00Z",
      contract_cents: 1_000_000,
      missed_daily_logs: 0,
    },
    {
      id: "2",
      stage: "scheduled",
      sold_at: "2026-03-20T17:00:00Z",
      contract_cents: 500_000,
      missed_daily_logs: 2,
    },
    {
      id: "3",
      stage: "sold",
      sold_at: "2026-02-01T18:00:00Z",
      contract_cents: 300_000,
      missed_daily_logs: null,
    },
    { id: "4", stage: "sold", sold_at: null, contract_cents: null, missed_daily_logs: 1 },
  ];
  it("sold by month", () => {
    const t = summarizeReport(
      jobs,
      {
        ...base,
        groupBy: { field: "sold_at", bucket: "month" },
        summaries: [{ fn: "count" }, { fn: "sum", field: "contract_cents" }],
      },
      rows,
    );
    expect(t.labels).toEqual(["Rows", "Sum of contract"]);
    expect(t.kinds).toEqual(["count", "money"]);
    expect(t.groups.map((g) => [g.label, ...g.values])).toEqual([
      ["Feb 2026", 1, 300_000],
      ["Mar 2026", 2, 1_500_000],
      ["No date", 1, 0],
    ]);
    expect(t.totals).toEqual([4, 1_800_000]);
  });
  it("group by an enum, largest first, with labels", () => {
    const t = summarizeReport(jobs, { ...base, groupBy: { field: "stage" } }, rows);
    expect(t.groups.map((g) => [g.label, g.values[0]])).toEqual([
      ["Sold", 3],
      ["Scheduled", 1],
    ]);
  });
  it("summaries skip empty values; averages of nothing are —", () => {
    expect(summarize(rows, { fn: "avg", field: "missed_daily_logs" })).toBe(1);
    expect(summarize(rows, { fn: "count_of", field: "sold_at" })).toBe(3);
    expect(summarize([], { fn: "avg", field: "contract_cents" })).toBeNull();
    expect(summarize([], { fn: "sum", field: "contract_cents" })).toBe(0);
    expect(formatSummary("number", null)).toBe("—");
    expect(formatSummary("money", 123_456)).toBe("$1,235");
  });
  it("Pacific days and buckets", () => {
    expect(pacificDay("2026-03-01T06:00:00Z")).toBe("2026-02-28");
    expect(pacificDay("2026-03-05")).toBe("2026-03-05");
    expect(bucketOf("2026-10-28", "week")).toEqual({
      key: "2026-10-26",
      label: "Week of Oct 26, 2026",
    });
    expect(bucketOf("2026-11-02", "quarter")).toEqual({ key: "2026-Q4", label: "Q4 2026" });
  });
  it("cells format by kind", () => {
    const col = (id: string) => jobs.columns.find((c) => c.id === id);
    expect(formatCell(col("contract_cents"), 1_234_500)).toBe("$12,345");
    expect(formatCell(col("stage"), "ready_to_schedule")).toBe("Ready to Schedule");
    expect(formatCell(col("started_late"), true)).toBe("Yes");
    expect(
      formatCell(col("work_types"), ["interior", "exterior"], {
        "picklist:work_type": { interior: "Interior" },
      }),
    ).toBe("Interior, exterior");
    expect(formatCell(col("sold_at"), "2026-03-12T17:00:00Z")).toBe("Mar 12, 2026 10:00 AM");
    expect(formatCell(col("promised_start_date"), "2026-03-16")).toBe("Mar 16, 2026");
    expect(formatCell(col("margin_percent"), 90)).toBe("90%");
    expect(formatCell(col("name"), null)).toBe("");
  });
  it("sorts with empties last", () => {
    expect(sortRows(rows, "contract_cents", "desc").map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
    expect(sortRows(rows, "contract_cents", "asc").map((r) => r.id)).toEqual(["3", "2", "1", "4"]);
  });
});

describe("CSV", () => {
  it("quotes, escapes and guards against formula injection", () => {
    expect(csvCell('Say "hi", ok')).toBe('"Say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell(null)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
    expect(
      toCsv(
        ["A", "B"],
        [
          [1, "x"],
          [null, "line\nbreak"],
        ],
      ),
    ).toBe('﻿A,B\r\n1,x\r\n,"line\nbreak"\r\n');
    expect(csvFileName("Lead Funnel – This Month", "2026-10-27")).toBe(
      "lead-funnel-this-month-2026-10-27.csv",
    );
  });
});

describe("delivery schedules", () => {
  // Tue Oct 27, 2026, 10:00 Pacific.
  const now = new Date("2026-10-27T17:00:00Z");
  it("daily, weekly and monthly next runs at a Pacific hour", () => {
    expect(
      nextRunAt({ frequency: "daily", weekday: null, monthDay: null, hour: 7 }, now).toISOString(),
    ).toBe("2026-10-28T14:00:00.000Z");
    expect(
      nextRunAt({ frequency: "daily", weekday: null, monthDay: null, hour: 11 }, now).toISOString(),
    ).toBe("2026-10-27T18:00:00.000Z");
    expect(
      nextRunAt({ frequency: "weekly", weekday: 1, monthDay: null, hour: 7 }, now).toISOString(),
    ).toBe("2026-11-02T15:00:00.000Z");
    expect(
      nextRunAt({ frequency: "monthly", weekday: null, monthDay: 1, hour: 7 }, now).toISOString(),
    ).toBe("2026-11-01T15:00:00.000Z"); // PST from Nov 1
  });
  it("describes itself", () => {
    expect(describeSchedule({ frequency: "weekly", weekday: 1, monthDay: null, hour: 7 })).toBe(
      "Every Monday at 7:00 AM",
    );
    expect(describeSchedule({ frequency: "monthly", weekday: null, monthDay: 15, hour: 13 })).toBe(
      "Monthly on day 15 at 1:00 PM",
    );
  });
});
