import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ChartCard, ChartEmpty } from "@/components/kpi/chart-card";
import { ViewDataDialog } from "@/components/kpi/view-data-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { withOptions } from "@/lib/lists/server";
import { analyticsLabels, loadAnalyticsOptions } from "@/lib/analytics/server";
import { REPORT_ROW_CAP, reportCells, runReport } from "@/lib/analytics/reports";
import { encodeConfig, resolveReport } from "@/lib/analytics/report-page";
import {
  REPORT_MODULES,
  REPORT_MODULE_IDS,
  moduleColumn,
  visibleColumns,
} from "@/lib/domain/reports/modules";
import { formatSummary } from "@/lib/domain/reports/summarize";
import { FavoriteButton } from "../../_components/favorite-button";
import { DeleteReportButton } from "../_components/delete-report";
import { ReportBuilder } from "../_components/report-builder";
import { ReportChart } from "../_components/report-chart";

export const metadata: Metadata = { title: "Report" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PAGE = 100;

/** A report: builder, grouped summary (+ chart, View data), rows, Export CSV, Schedule. */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const viewer = await requirePermission("reports:read");
  const { id } = await params;
  const sp = await searchParams;
  if (id === "new" && !viewer.can("reports:build")) notFound();
  const db = await createSupabaseServerClient();
  const report = await resolveReport(db, viewer, id, sp);
  if (!report) notFound();
  const options = await loadAnalyticsOptions(db);
  const labels = analyticsLabels(options);
  const result = await runReport(db, report.module, report.config, options, labels);
  if (report.id && !report.draft) await db.rpc("note_report_run", { p_report: report.id });
  const { data: fav } = report.id
    ? await db
        .from("analytics_favorites")
        .select("id")
        .eq("item_type", "report")
        .eq("item_key", report.id)
        .maybeSingle()
    : { data: null };

  const mod = report.module;
  const cols = report.config.columns.map((c) => moduleColumn(mod, c));
  const pageRaw = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  const pages = Math.max(1, Math.ceil(result.rows.length / PAGE));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pages, Math.floor(pageRaw)) : 1;
  const slice = result.rows.slice((page - 1) * PAGE, page * PAGE);
  const cells = reportCells(mod, report.config, slice, labels);
  const s = result.summary;
  const canExport = viewer.can("data:export") && !viewer.impersonating;
  const canBuild = viewer.can("reports:build") && !viewer.impersonating;
  const qs = new URLSearchParams();
  if (!report.id) qs.set("module", mod.id);
  if (report.draft) qs.set("c", encodeConfig(report.config));
  const csvHref = `/analytics/reports/${report.id ?? "new"}/csv${qs.toString() ? `?${qs.toString()}` : ""}`;
  const pageHref = (p: number) => {
    const q = new URLSearchParams(qs);
    if (p > 1) q.set("page", String(p));
    return `/analytics/reports/${report.id ?? "new"}${q.toString() ? `?${q.toString()}` : ""}`;
  };
  const fields = withOptions(mod.fields, {
    picklists: {
      work_type: options.workTypes,
      lead_source: options.sources,
      lead_sub_source: options.subSources,
    },
    users: options.users,
    territories: options.territories,
  }).filter((f) => (moduleColumn(mod, f.key)?.requires ?? []).every((p) => viewer.can(p)));
  const chartable = report.config.groupBy && report.config.chart !== "table" && s.groups.length > 0;
  const firstKind = s.kinds[0] ?? "count";

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/analytics/reports"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Reports
      </Link>
      <PageHeader
        title={report.name}
        description={
          <>
            {report.description || `${mod.label} report`}
            {report.isTemplate && " · Template"}
            {report.draft && " · Unsaved changes"}
          </>
        }
        actions={
          <>
            {report.id && (
              <FavoriteButton
                itemType="report"
                itemKey={report.id}
                on={!!fav}
                name={report.name}
                disabled={viewer.impersonating}
              />
            )}
            {canExport ? (
              <Button asChild variant="outline" size="sm">
                <a href={csvHref} download data-testid="report-csv">
                  <Download aria-hidden />
                  Export CSV
                </a>
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex rounded-md">
                    <Button variant="outline" size="sm" disabled aria-disabled>
                      <Download aria-hidden />
                      Export CSV
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Your role can&apos;t export data. Ask an owner for export access.
                </TooltipContent>
              </Tooltip>
            )}
            {canBuild && report.id && !report.draft && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/analytics/schedules?report=${report.id}`}>
                  <CalendarClock aria-hidden />
                  Schedule
                </Link>
              </Button>
            )}
            {canBuild && report.id && report.mine && !report.isTemplate && (
              <DeleteReportButton id={report.id} name={report.name} />
            )}
          </>
        }
      />
      {report.problems.length > 0 && (
        <p role="alert" className="rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning">
          This report&apos;s saved setup doesn&apos;t fit the {mod.label.toLowerCase()} module any
          more ({report.problems[0]}). Showing the default columns.
        </p>
      )}
      <ReportBuilder
        reportId={report.id}
        moduleId={mod.id}
        modules={REPORT_MODULE_IDS.filter((m) => viewer.can(REPORT_MODULES[m].requires)).map(
          (m) => ({ id: m, label: REPORT_MODULES[m].label }),
        )}
        columns={visibleColumns(mod, (p) => viewer.can(p)).map((c) => ({
          id: c.id,
          label: c.label,
          groupable: !!c.groupable,
          numeric: !!c.numeric,
          date: c.kind === "timestamp" || c.kind === "day",
        }))}
        fields={fields}
        config={report.config}
        name={report.name}
        description={report.description}
        shared={report.shared}
        mine={report.mine}
        canSave={canBuild}
      />
      {result.error && (
        <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">
          The report couldn&apos;t run. Try removing a filter.
        </p>
      )}
      <ChartCard
        id="report-summary"
        title={
          report.config.groupBy
            ? `By ${moduleColumn(mod, report.config.groupBy.field)?.label.toLowerCase() ?? report.config.groupBy.field}`
            : "Summary"
        }
        caption={`${s.rowCount.toLocaleString("en-US")} matching row${s.rowCount === 1 ? "" : "s"} · summarized on the server${result.truncated ? ` · first ${REPORT_ROW_CAP.toLocaleString("en-US")} only` : ""}`}
        action={
          <ViewDataDialog
            title={`${report.name} – summary`}
            description="Grouped totals over every matching row."
            dataset={
              report.id
                ? `report:${report.templateKey ?? report.id}:summary`
                : `report:new:${mod.id}:summary`
            }
            filters={{ module: mod.id }}
            columns={[
              { key: "group", label: report.config.groupBy ? "Group" : "Total" },
              ...s.labels.map((l, i) => ({ key: `v${i}`, label: l, align: "right" as const })),
            ]}
            rows={[
              ...s.groups.map((g) => ({
                group: g.label,
                ...Object.fromEntries(
                  g.values.map((v, i) => [`v${i}`, formatSummary(s.kinds[i] ?? "number", v)]),
                ),
              })),
              {
                group: "Total",
                ...Object.fromEntries(
                  s.totals.map((v, i) => [`v${i}`, formatSummary(s.kinds[i] ?? "number", v)]),
                ),
              },
            ]}
          />
        }
      >
        <div className="flex flex-col gap-3">
          <dl className="flex flex-wrap gap-3">
            {s.labels.map((l, i) => (
              <div key={l} className="rounded-xl bg-muted/50 px-3 py-2">
                <dt className="text-xs text-muted-foreground">{l}</dt>
                <dd className="text-lg font-bold tabular-nums">
                  {formatSummary(s.kinds[i] ?? "number", s.totals[i] ?? null)}
                </dd>
              </div>
            ))}
          </dl>
          {s.rowCount === 0 ? (
            <ChartEmpty>No records match this report yet.</ChartEmpty>
          ) : chartable ? (
            <ReportChart
              type={report.config.chart as "bar" | "line" | "donut"}
              seriesLabel={s.labels[0] ?? "Rows"}
              ariaLabel={`${report.name}: ${s.groups.map((g) => `${g.label} ${formatSummary(firstKind, g.values[0] ?? null)}`).join(", ")}`}
              data={s.groups.map((g) => ({
                label: g.label,
                value: firstKind === "money" ? (g.values[0] ?? 0) / 100 : (g.values[0] ?? 0),
                display: formatSummary(firstKind, g.values[0] ?? null),
              }))}
            />
          ) : report.config.groupBy ? (
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {s.groups.map((g) => (
                <li
                  key={g.key}
                  className="flex justify-between gap-3 rounded-lg bg-muted/40 px-3 py-1.5"
                >
                  <span>{g.label}</span>
                  <span className="tabular-nums">
                    {g.values.map((v, i) => formatSummary(s.kinds[i] ?? "number", v)).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </ChartCard>
      <section aria-labelledby="rows-title" className="flex flex-col gap-2">
        <h2 id="rows-title" className="text-base font-semibold">
          Rows
        </h2>
        {result.rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing to show yet. Records appear here as soon as they match the filters.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">{report.name} rows</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {cols.map((c, i) => (
                    <th
                      key={report.config.columns[i]}
                      scope="col"
                      className={`px-3 py-2 font-medium whitespace-nowrap ${c?.numeric ? "text-right" : ""}`}
                    >
                      {c?.label ?? report.config.columns[i]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cells.map((row, r) => {
                  const href = mod.rowHref(slice[r]!);
                  return (
                    <tr key={String(slice[r]!.id ?? r)} className="border-b last:border-0">
                      {row.map((cell, i) => (
                        <td
                          key={i}
                          className={`px-3 py-1.5 whitespace-nowrap ${cols[i]?.numeric ? "text-right tabular-nums" : ""}`}
                        >
                          {i === 0 && href ? (
                            <Link
                              href={href}
                              className="font-medium text-bb-forest hover:underline"
                            >
                              {cell || "Open"}
                            </Link>
                          ) : (
                            cell || <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-end gap-2 text-sm">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className="rounded-md border px-3 py-1 hover:bg-muted"
              >
                Previous
              </Link>
            )}
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            {page < pages && (
              <Link
                href={pageHref(page + 1)}
                className="rounded-md border px-3 py-1 hover:bg-muted"
              >
                Next
              </Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
