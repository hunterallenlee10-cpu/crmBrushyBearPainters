import Link from "next/link";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  CircleDashed,
  CircleX,
  CloudRain,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StartJobButton } from "@/components/production/start-job-button";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { ON_TIME_STATUS_LABELS } from "@/lib/domain/jobs/constants";
import { formatDay, formatRange, isIsoDate } from "@/lib/domain/scheduling/dates";
import { materialsStatus } from "@/lib/domain/scheduling/readiness";
import { formatCents } from "@/lib/format/money";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { loadScheduleSection } from "@/lib/production/job";
import { AssignCrew } from "@/app/(app)/schedule/(center)/assign-crew";
import { RainDelayForm } from "@/app/(app)/schedule/(center)/weather/rain-delay-form";
import { AppointmentsCard } from "../appointments-card";
import type { JobDetailData } from "../types";
import { CreditDecision } from "./schedule-client";

const ORDER: Record<string, number> = {
  onboarding: 0,
  ready_to_schedule: 1,
  scheduled: 2,
  in_progress: 3,
  final_walkthrough: 4,
  completed: 5,
  invoiced: 6,
  paid_in_full: 6,
  closed_won: 6,
};

const CREDIT_STATUS: Record<string, string> = {
  pending_approval: "Pending owner approval",
  approved: "Approved (goes on the final invoice)",
  waived: "Waived",
  applied: "Applied to invoice",
};

/** Job → Schedule (SPEC §8.5 #3). */
export async function ScheduleSection({ data }: { data: JobDetailData }) {
  const viewer = await requireViewer();
  const { job, can } = data;
  const supabase = await createSupabaseServerClient();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const s = await loadScheduleSection(
    { supabase, service },
    { orgId: viewer.orgId, jobId: job.id, canSeeMoney: can.readFinancials },
  );
  const row = s.row;
  const today = s.config.context.today;
  const writable = !data.readOnly;
  const canManage = writable && viewer.can("schedule:manage");
  const canField = writable && viewer.can("daily_logs:create");
  const crewById = new Map(s.crews.map((c) => [c.id, c.name]));
  const materials = materialsStatus(row?.paintStatuses ?? []);
  const stageOrder = ORDER[job.stage] ?? 0;

  // Action queue: the next things to do for this job, in order.
  const actions: { label: string; href?: string }[] = [];
  if (row) {
    if (job.stage === "onboarding")
      actions.push({ label: "Finish onboarding", href: `/jobs/${job.id}?section=onboarding` });
    if (!row.crewId && stageOrder <= 2) actions.push({ label: "Assign a crew" });
    if (!row.published && stageOrder <= 1)
      actions.push({ label: "Put it on the Master Schedule", href: "/schedule/master" });
    if (row.draftPending)
      actions.push({ label: "Publish the schedule changes", href: "/schedule/master" });
    if ((materials === "not_ordered" || materials === "none") && stageOrder <= 2)
      actions.push({ label: "Order paint", href: `/jobs/${job.id}?section=work-orders` });
    if (job.stage === "scheduled" && row.published && row.published.startsOn <= today)
      actions.push({ label: "Start the job (crew lead)" });
    for (const b of row.blocks) actions.push({ label: b.message });
    for (const h of row.blockingHolds) actions.push({ label: `Release the ${h} hold` });
  }

  const steps = [
    { label: "Ready to schedule", at: job.milestones.ready_to_schedule_at, order: 1 },
    { label: "Scheduled", at: job.milestones.scheduled_at, order: 2 },
    { label: "Started", at: job.actualStartDate, order: 3 },
    { label: "Work completed", at: job.milestones.work_completed_at, order: 4 },
    { label: "Final walkthrough", at: job.milestones.final_walkthrough_at, order: 5 },
    { label: "Completed", at: job.milestones.completed_at, order: 6 },
  ];
  const ranked = row?.ranking ?? [];
  const crewOptions = [
    ...ranked.map((r) => ({ id: r.crewId, label: `${r.crewName} · ${r.score} pts` })),
    ...s.crews
      .filter((c) => c.active && !ranked.some((r) => r.crewId === c.id))
      .map((c) => ({ id: c.id, label: c.name })),
  ];

  return (
    <div className="flex flex-col gap-4">
      {row === null ? (
        <section className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          <CalendarRange className="mr-1 inline size-4" aria-hidden />
          Production scheduling starts once the job is in Onboarding. Book walkthroughs and color
          consultations below.
        </section>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <section aria-label="Action queue" className="rounded-2xl border bg-card p-4">
              <h3 className="mb-2 text-base font-semibold">Next steps</h3>
              {actions.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="size-4" aria-hidden /> Nothing waiting on the office.
                </p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                      {a.href ? (
                        <Link href={a.href} className="underline">
                          {a.label}
                        </Link>
                      ) : (
                        <span>{a.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {job.stage === "scheduled" && (canField || canManage) ? (
                  <StartJobButton
                    jobId={job.id}
                    disabledReason={
                      !row.published
                        ? "Publish the schedule first."
                        : row.published.startsOn > today
                          ? `Starts ${formatDay(row.published.startsOn)}.`
                          : null
                    }
                  />
                ) : null}
                {viewer.can("schedule:read") && (
                  <Button asChild variant="outline">
                    <Link href={"/schedule/master"}>Open Master Schedule</Link>
                  </Button>
                )}
              </div>
            </section>

            <section aria-label="Production timeline" className="rounded-2xl border bg-card p-4">
              <h3 className="mb-2 text-base font-semibold">Production timeline</h3>
              <ol className="flex flex-col gap-2 text-sm">
                {steps.map((st) => {
                  const done = stageOrder >= st.order || !!st.at;
                  return (
                    <li key={st.label} className="flex items-center gap-2">
                      {done ? (
                        <CheckCircle2 className="size-4 text-success" aria-hidden />
                      ) : (
                        <CircleDashed className="size-4 text-muted-foreground" aria-hidden />
                      )}
                      <span className={done ? "font-medium" : "text-muted-foreground"}>
                        {st.label}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {st.at ? (isIsoDate(st.at) ? formatDay(st.at) : formatDate(st.at)) : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-xs text-muted-foreground">
                {row.published
                  ? `On the schedule ${formatRange(row.published.startsOn, row.published.endsOn)} · ${row.workingDays} working day${row.workingDays === 1 ? "" : "s"}`
                  : row.planned
                    ? `Planned ${formatRange(row.planned.startsOn, row.planned.endsOn)} (not published)`
                    : `About ${row.workingDays} working day${row.workingDays === 1 ? "" : "s"}; no dates yet`}
                {job.estimatedCompletionDate
                  ? ` · Est. completion ${formatDay(job.estimatedCompletionDate)}`
                  : ""}
              </p>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <section aria-label="Dispatch readiness" className="rounded-2xl border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-base font-semibold">Dispatch readiness</h3>
                <span className="text-2xl font-bold tabular-nums">
                  {row.readiness.percent === null ? "—" : `${row.readiness.percent}%`}
                </span>
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {row.readiness.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    {c.status === "pass" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    ) : c.status === "fail" ? (
                      <CircleX className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                    ) : (
                      <CircleDashed
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <span>
                      <span className="font-medium">{c.label}</span>
                      <span className="text-muted-foreground"> · {c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Crew" className="rounded-2xl border bg-card p-4">
              <h3 className="mb-2 text-base font-semibold">Crew</h3>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{row.crewName ?? "No crew assigned"}</span>
                {canManage && (
                  <div className="w-64">
                    <AssignCrew
                      jobId={job.id}
                      jobLabel={`${job.number} · ${job.name}`}
                      crewId={row.crewId}
                      options={crewOptions}
                    />
                  </div>
                )}
              </div>
              <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Recommended crews
              </h4>
              {ranked.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active crews yet. Add crews in Production Center → Resources.
                </p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {ranked.map((r) => (
                    <li key={r.crewId} className="rounded-xl border p-2">
                      <p className="flex items-center justify-between font-medium">
                        {r.crewName}
                        <span className="tabular-nums">{r.score} pts</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.reasons.map((x) => `${x.label} ${x.points}/${x.max}`).join(" · ")}
                      </p>
                      {!r.eligible && r.conflicts[0] && (
                        <p className="text-xs text-danger">{r.conflicts[0].message}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section aria-label="Schedule entries" className="rounded-2xl border bg-card p-4">
            <h3 className="mb-2 text-base font-semibold">On the schedule</h3>
            {row.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not on the schedule yet. Drag it from the tray on the Master Schedule, then Publish.
              </p>
            ) : (
              <ul className="flex flex-col divide-y text-sm">
                {row.entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {e.startsOn && e.endsOn ? formatRange(e.startsOn, e.endsOn) : "No dates"}
                      {" · "}
                      {e.crewId ? (crewById.get(e.crewId) ?? "Crew") : "No crew"}
                      {e.draftAction && (
                        <span className="text-muted-foreground">
                          {" → draft: "}
                          {e.draftAction === "cancel"
                            ? "remove"
                            : `${e.draftStartsOn && e.draftEndsOn ? formatRange(e.draftStartsOn, e.draftEndsOn) : ""} ${e.draftCrewId ? (crewById.get(e.draftCrewId) ?? "") : ""}`}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {e.status === "published" && !e.draftAction ? (
                        <Badge variant="outline">Published</Badge>
                      ) : (
                        <Badge variant="secondary">Draft – not sent</Badge>
                      )}
                      {e.publishedAt && (
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(e.publishedAt)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <section
              aria-label="On-time start guarantee"
              className="rounded-2xl border bg-card p-4"
            >
              <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
                <ShieldCheck className="size-4" aria-hidden /> On-time start guarantee
              </h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Guaranteed start</dt>
                <dd>
                  {s.guaranteeStartDate
                    ? formatDay(s.guaranteeStartDate)
                    : "Set when first published"}
                </dd>
                <dt className="text-muted-foreground">Promised start</dt>
                <dd>{job.promisedStartDate ? formatDay(job.promisedStartDate) : "—"}</dd>
                <dt className="text-muted-foreground">Actual start</dt>
                <dd>{job.actualStartDate ? formatDay(job.actualStartDate) : "—"}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{ON_TIME_STATUS_LABELS[job.onTimeStatus]}</dd>
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                Weather and customer moves shift the guaranteed date; company moves don&apos;t. A
                missed start drafts the credit from Company Settings for an owner to approve.
              </p>
              {s.credits === null ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Credit amounts are visible to people who can see financials.
                </p>
              ) : (
                s.credits.map((c) => (
                  <div key={c.id} className="mt-3 rounded-xl border p-3 text-sm">
                    <p className="font-medium">
                      {formatCents(c.amountCents)} credit · {CREDIT_STATUS[c.status] ?? c.status}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Promised {formatDay(c.promisedDate)}
                      {c.actualStartDate ? `, started ${formatDay(c.actualStartDate)}` : ""} ·{" "}
                      {c.reason}
                      {c.decisionNote ? ` · ${c.decisionNote}` : ""}
                    </p>
                    {c.status === "pending_approval" &&
                      writable &&
                      viewer.can("credits:approve") && (
                        <div className="mt-2">
                          <CreditDecision creditId={c.id} amount={formatCents(c.amountCents)} />
                        </div>
                      )}
                  </div>
                ))
              )}
            </section>

            <section aria-label="Rain delays" className="rounded-2xl border bg-card p-4">
              <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
                <CloudRain className="size-4" aria-hidden /> Rain delays
                {s.isPriorityReschedule && <Badge variant="outline">Priority reschedule</Badge>}
              </h3>
              {s.rainDelays.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rain days on this job.</p>
              ) : (
                <ul className="mb-3 flex flex-col gap-1 text-sm">
                  {s.rainDelays.map((r) => (
                    <li key={r.id}>
                      {formatDay(r.date)}
                      <span className="text-muted-foreground">
                        {r.customerNotified ? " · customer texted (simulated)" : ""}
                        {r.note ? ` · ${r.note}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mb-2 text-xs text-muted-foreground">
                Rain days never cost the customer anything. The job goes to the top of the tray.
              </p>
              {(canManage || canField) && ["scheduled", "in_progress"].includes(job.stage) && (
                <RainDelayForm
                  jobId={job.id}
                  label={`${job.number} · ${job.name}`}
                  defaultDate={today}
                />
              )}
            </section>
          </div>
        </>
      )}
      {can.readAppointments && (
        <AppointmentsCard
          jobId={job.id}
          appointments={data.appointments}
          users={data.options.users}
          defaultAssignee={job.ownerId ?? data.viewerId}
          canManage={can.manageAppointments}
          readOnly={data.readOnly}
        />
      )}
    </div>
  );
}
