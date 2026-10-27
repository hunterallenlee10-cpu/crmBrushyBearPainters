import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { logError } from "@/lib/log";
import { appUrl, recordOutbound } from "@/lib/messaging/core";
import { analyticsLabels, loadAnalyticsOptions } from "@/lib/analytics/server";
import { configFor, parseConfig, reportCsvRows, runReport } from "@/lib/analytics/reports";
import { REPORT_MODULES, isReportModuleId } from "@/lib/domain/reports/modules";
import { formatSummary } from "@/lib/domain/reports/summarize";
import {
  deliveryAccess,
  deliveryEmail,
  describeSchedule,
  nextRunAt,
  type Frequency,
} from "@/lib/domain/reports/schedule";

/**
 * Scheduled report deliveries (SPEC §8.14 "Schedules"), run by the worker
 * every minute. Each due schedule is claimed by moving its next run forward
 * (only one worker run wins), the report runs for the schedule owner's company
 * with the owner's permissions re-checked, and one email per recipient goes
 * through recordOutbound() → email adapter → integration_outbox (simulated).
 * Each delivery is written to the export log.
 */

type Db = SupabaseClient<Database>;
const PREVIEW_ROWS = 20;

export async function sweepReportSchedules(
  service: Db,
  now: Date = new Date(),
): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const { data: due, error } = await service
    .from("report_schedules")
    .select(
      "id, org_id, report_id, frequency, weekday, month_day, hour, recipient_ids, next_run_at, created_by",
    )
    .eq("active", true)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at")
    .limit(20);
  if (error) {
    logError("schedules.load", error);
    return out;
  }
  for (const s of due ?? []) {
    const rule = {
      frequency: s.frequency as Frequency,
      weekday: s.weekday,
      monthDay: s.month_day,
      hour: s.hour,
    };
    const next = nextRunAt(rule, now).toISOString();
    // Claim: only the run that moves next_run_at from the value it read goes on.
    const { data: claimed } = await service
      .from("report_schedules")
      .update({ next_run_at: next })
      .eq("id", s.id)
      .eq("next_run_at", s.next_run_at)
      .select("id");
    if (!claimed?.length) continue;
    const finish = async (status: "sent" | "skipped" | "failed", note: string | null) => {
      await service
        .from("report_schedules")
        .update({
          last_run_at: now.toISOString(),
          last_status: status,
          last_note: note?.slice(0, 500) ?? null,
        })
        .eq("id", s.id);
      out[status === "sent" ? "sent" : status === "skipped" ? "skipped" : "failed"]++;
    };
    try {
      const { data: report } = await service
        .from("reports")
        .select("id, name, module, config, template_key")
        .eq("id", s.report_id)
        .eq("org_id", s.org_id)
        .maybeSingle();
      if (!report || !isReportModuleId(report.module) || !s.created_by) {
        await finish("skipped", "The report no longer exists.");
        continue;
      }
      const mod = REPORT_MODULES[report.module];
      const { data: scopesRaw } = await service.rpc("user_permission_scopes", {
        p_user: s.created_by,
        p_permissions: ["reports:build", mod.requires, "financials:read", "job_costing:read"],
      });
      const scopes = (scopesRaw ?? {}) as Record<string, string | null>;
      const access = deliveryAccess(scopes, mod.requires, mod.label);
      if (!access.ok) {
        await finish("skipped", access.note);
        continue;
      }
      const config = parseConfig(report.config);
      if (!config) {
        await finish("skipped", "The report's setup is no longer valid.");
        continue;
      }
      const cfg = configFor(mod, config, (p) => !!scopes[p]);
      const options = await loadAnalyticsOptions(service, s.org_id);
      const labels = analyticsLabels(options);
      const result = await runReport(service, mod, cfg, options, labels, now, s.org_id);
      if (result.error) {
        await finish("failed", "The report couldn't run.");
        continue;
      }
      const { header, body } = reportCsvRows(mod, cfg, result.rows.slice(0, PREVIEW_ROWS), labels);
      const email = deliveryEmail({
        reportName: report.name,
        rowCount: result.rows.length,
        truncated: result.truncated,
        totals: result.summary.labels.map((l, i) => ({
          label: l,
          value: formatSummary(
            result.summary.kinds[i] ?? "number",
            result.summary.totals[i] ?? null,
          ),
        })),
        preview: { header, rows: body },
        link: appUrl(`/analytics/reports/${report.id}`),
        schedule: describeSchedule(rule),
      });
      const { data: people } = await service
        .from("profiles")
        .select("id, email")
        .eq("org_id", s.org_id)
        .eq("is_active", true)
        .in("id", s.recipient_ids);
      let sent = 0;
      for (const p of people ?? []) {
        if (!p.email) continue;
        await recordOutbound(service, {
          orgId: s.org_id,
          channel: "email",
          to: p.email,
          subject: email.subject,
          body: email.body,
          messageType: "transactional",
          related: { type: "report_schedule", id: s.id },
          actorId: s.created_by,
        });
        sent++;
      }
      await service.from("export_log").insert({
        org_id: s.org_id,
        user_id: s.created_by,
        kind: "report_schedule",
        dataset: `report:${report.template_key ?? report.id}`,
        title: report.name,
        row_count: result.rows.length,
        filters: { schedule_id: s.id, recipients: String(sent) },
      });
      await finish(
        sent ? "sent" : "skipped",
        sent ? `Emailed ${sent} (simulated)` : "No active recipients with an email address.",
      );
    } catch (e) {
      logError("schedules.deliver", e);
      await finish("failed", "Delivery failed; it will run again at the next time.");
    }
  }
  return out;
}
