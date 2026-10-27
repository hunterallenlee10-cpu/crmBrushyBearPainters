import { NextResponse, type NextRequest } from "next/server";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { logError } from "@/lib/log";
import { analyticsLabels, loadAnalyticsOptions } from "@/lib/analytics/server";
import { reportCsvRows, runReport } from "@/lib/analytics/reports";
import { resolveReport } from "@/lib/analytics/report-page";
import { csvFileName, toCsv } from "@/lib/domain/reports/csv";
import { pacificIsoDate } from "@/lib/format/dates";

/**
 * Report "Export CSV" (SPEC §8.14): every matching row (up to the report cap),
 * read with the person's row security. Needs data:export; each download is
 * written to export_log through log_export() before the file is sent.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const state = await getViewerState();
  if (state.status !== "ok") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const viewer = state.viewer;
  if (!viewer.can("reports:read") || !viewer.can("data:export") || viewer.impersonating) {
    return NextResponse.json({ error: "Your role can't export data." }, { status: 403 });
  }
  const { id } = await params;
  const db = await createSupabaseServerClient();
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const report = await resolveReport(db, viewer, id, sp);
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  const options = await loadAnalyticsOptions(db);
  const labels = analyticsLabels(options);
  const result = await runReport(db, report.module, report.config, options, labels);
  if (result.error) {
    logError("reports.csv", result.error);
    return NextResponse.json({ error: "The report couldn't run." }, { status: 500 });
  }
  const { error } = await db.rpc("log_export", {
    p_kind: "report",
    p_dataset: report.id
      ? `report:${report.templateKey ?? report.id}`
      : `report:new:${report.module.id}`,
    p_title: report.name,
    p_row_count: result.rows.length,
    p_filters: { module: report.module.id, draft: String(report.draft) },
  });
  if (error) return NextResponse.json({ error: "Your role can't export data." }, { status: 403 });
  const { header, body } = reportCsvRows(report.module, report.config, result.rows, labels);
  const csv = toCsv(header, body);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(report.name, pacificIsoDate())}"`,
      "Cache-Control": "no-store",
    },
  });
}
