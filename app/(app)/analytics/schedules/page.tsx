import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDateTime } from "@/lib/format/dates";
import { describeSchedule, type Frequency } from "@/lib/domain/reports/schedule";
import { REPORT_MODULES, isReportModuleId } from "@/lib/domain/reports/modules";
import { ScheduleForm, ScheduleRowActions } from "./schedule-form";

export const metadata: Metadata = { title: "Schedules" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Analytics → Schedules (SPEC §8.14): report deliveries. The worker runs each
 * one at its Pacific hour and emails the CSV summary to the recipients
 * through the email adapter → integration_outbox (status simulated); nothing
 * is really sent in this build.
 */
export default async function SchedulesPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("reports:build");
  const sp = await searchParams;
  const preselect = typeof sp.report === "string" ? sp.report : null;
  const db = await createSupabaseServerClient();
  const [schedRes, reportsRes, peopleRes] = await Promise.all([
    db
      .from("report_schedules")
      .select(
        "id, report_id, frequency, weekday, month_day, hour, recipient_ids, active, next_run_at, last_run_at, last_status, last_note, created_by",
      )
      .order("next_run_at"),
    db.from("reports").select("id, name, module").order("name"),
    db.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
  ]);
  const reports = (reportsRes.data ?? []).filter(
    (r) => isReportModuleId(r.module) && viewer.can(REPORT_MODULES[r.module].requires),
  );
  const reportName = new Map((reportsRes.data ?? []).map((r) => [r.id, r.name]));
  const people = peopleRes.data ?? [];
  const personName = new Map(people.map((p) => [p.id, p.full_name]));
  const schedules = schedRes.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Schedules"
        description="Reports delivered by email on a schedule. While email isn't connected, each delivery is recorded in the outbox as simulated."
      />
      <ScheduleForm
        reports={reports.map((r) => ({ value: r.id, label: r.name }))}
        people={people.map((p) => ({ value: p.id, label: p.full_name }))}
        defaultReport={preselect && reports.some((r) => r.id === preselect) ? preselect : null}
        defaultRecipient={viewer.id}
        readOnly={viewer.impersonating}
      />
      <section aria-labelledby="sched-title" className="flex flex-col gap-2">
        <h2 id="sched-title" className="text-base font-semibold">
          Scheduled deliveries
        </h2>
        {schedules.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No scheduled reports yet. Pick a report above to have it emailed every day, week or
            month.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">Scheduled deliveries</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Report
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Recipients
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Next run
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Last run
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b last:border-0" data-testid="schedule-row">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      <Link
                        href={`/analytics/reports/${s.report_id}`}
                        className="inline-flex items-center gap-2 hover:underline"
                      >
                        <CalendarClock className="size-4 text-bb-forest" aria-hidden />
                        {reportName.get(s.report_id) ?? "Report"}
                      </Link>
                    </th>
                    <td className="px-3 py-2">
                      {describeSchedule({
                        frequency: s.frequency as Frequency,
                        weekday: s.weekday,
                        monthDay: s.month_day,
                        hour: s.hour,
                      })}
                      {!s.active && (
                        <span className="ml-1 rounded-full bg-muted px-2 text-xs">Paused</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {s.recipient_ids.map((r) => personName.get(r) ?? "Former user").join(", ")}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {s.active ? formatDateTime(s.next_run_at) : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {s.last_run_at
                        ? `${formatDateTime(s.last_run_at)} · ${s.last_status ?? ""}`
                        : "Never"}
                      {s.last_note && <span className="block text-xs">{s.last_note}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <ScheduleRowActions
                        schedule={{
                          id: s.id,
                          report_id: s.report_id,
                          frequency: s.frequency as Frequency,
                          weekday: s.weekday,
                          month_day: s.month_day,
                          hour: s.hour,
                          recipient_ids: s.recipient_ids,
                          active: s.active,
                        }}
                        readOnly={viewer.impersonating}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
