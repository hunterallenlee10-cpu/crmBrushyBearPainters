import Link from "next/link";
import { CheckCircle2, Clock, Lock, NotebookPen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptySection } from "@/components/jobs/empty-section";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { formatDay } from "@/lib/domain/scheduling/dates";
import { formatDateTime } from "@/lib/format/dates";
import { loadFieldJobs } from "@/lib/production/field";
import { loadDailyLogsSection } from "@/lib/production/job";
import type { JobDetailData } from "../types";
import { NewDailyLogButton } from "./daily-log-dialog";

const CUSTOMER_UPDATE: Record<string, { label: string; tone: "outline" | "secondary" }> = {
  draft: { label: "Customer update queued", tone: "secondary" },
  queued: { label: "Customer update queued", tone: "secondary" },
  sent: { label: "Customer update sent", tone: "outline" },
  simulated: { label: "Customer update sent (simulated)", tone: "outline" },
  skipped: { label: "No customer update", tone: "secondary" },
};

/** Job → Daily Logs (SPEC §8.5 #9): the timeline, and a New Daily Log for the crew. */
export async function DailyLogsSection({ data }: { data: JobDetailData }) {
  const viewer = await requireViewer();
  const { job } = data;
  if (!viewer.can("daily_logs:read") && !viewer.can("daily_logs:create")) {
    return (
      <EmptySection icon={Lock} title="Daily logs">
        <p>Your role can&apos;t see daily logs.</p>
      </EmptySection>
    );
  }
  const supabase = await createSupabaseServerClient();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const canLog =
    !data.readOnly &&
    viewer.can("daily_logs:create") &&
    ["scheduled", "in_progress", "final_walkthrough"].includes(job.stage);
  const [logs, field] = await Promise.all([
    loadDailyLogsSection({ supabase, service }, { jobId: job.id }),
    canLog
      ? loadFieldJobs(
          { supabase, service },
          {
            orgId: viewer.orgId,
            viewerId: viewer.id,
            onlyMine: false,
            jobIds: [job.id],
            stages: [job.stage],
          },
        )
      : Promise.resolve(null),
  ]);
  const fj = field?.jobs[0] ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          One log every production day by 7 pm: what got done, what&apos;s next, hours and the
          cleanup photo.
        </p>
        {canLog && fj && field && (
          <NewDailyLogButton
            today={field.today}
            job={{
              id: fj.id,
              label: fj.label,
              workOrders: fj.workOrders
                .filter((w) => w.status !== "completed")
                .map((w) => ({ id: w.id, label: w.label })),
              members: fj.members,
            }}
          />
        )}
      </div>
      {logs.length === 0 ? (
        <EmptySection icon={NotebookPen} title="No daily logs yet">
          <p>
            Crew leads post from{" "}
            <Link href="/field/daily-log" className="underline">
              Daily Log
            </Link>{" "}
            on their phone, even without signal.
          </p>
        </EmptySection>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Daily log timeline">
          {logs.map((l) => {
            const cu = CUSTOMER_UPDATE[l.customerUpdateStatus] ?? {
              label: l.customerUpdateStatus,
              tone: "secondary" as const,
            };
            const total = l.hours.reduce((a, h) => a + h.hours, 0);
            return (
              <li key={l.id} className="rounded-2xl border bg-card p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {formatDay(l.date)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {[
                        l.authorName,
                        l.workOrderLabel,
                        l.source === "offline" ? "posted offline" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </p>
                  <span className="flex flex-wrap items-center gap-1">
                    {l.cleanupDone && (
                      <Badge variant="outline" className="gap-1">
                        <CheckCircle2 className="size-3 text-success" aria-hidden /> Cleanup done
                      </Badge>
                    )}
                    <Badge variant={cu.tone} title={l.customerUpdateNote ?? undefined}>
                      {cu.label}
                    </Badge>
                  </span>
                </div>
                <dl className="grid gap-2 text-sm md:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Finished today
                    </dt>
                    <dd className="whitespace-pre-line">{l.finishedToday}</dd>
                  </div>
                  {l.nextUp && (
                    <div>
                      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        Next up
                      </dt>
                      <dd className="whitespace-pre-line">{l.nextUp}</dd>
                    </div>
                  )}
                  {l.issues && (
                    <div>
                      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        Issues (internal)
                      </dt>
                      <dd className="whitespace-pre-line">{l.issues}</dd>
                    </div>
                  )}
                  {l.weatherObserved && (
                    <div>
                      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        Weather
                      </dt>
                      <dd>{l.weatherObserved}</dd>
                    </div>
                  )}
                </dl>
                {l.hours.length > 0 && (
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm">
                    <Clock className="size-4 text-muted-foreground" aria-hidden />
                    {l.hours.map((h, i) => (
                      <span key={i}>
                        {h.name} {h.hours} h
                      </span>
                    ))}
                    <span className="font-medium">Total {Math.round(total * 100) / 100} h</span>
                  </p>
                )}
                {(l.cleanupPhoto || l.photos.length > 0) && (
                  <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8" aria-label="Photos">
                    {[
                      ...(l.cleanupPhoto ? [{ ...l.cleanupPhoto, cleanup: true }] : []),
                      ...l.photos.map((p) => ({ ...p, cleanup: false })),
                    ].map((p) => (
                      <li key={p.id} className="relative">
                        {p.thumbUrl ? (
                          <a href={p.url ?? p.thumbUrl} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link */}
                            <img
                              src={p.thumbUrl}
                              alt={p.cleanup ? "Cleanup photo" : (p.caption ?? "Progress photo")}
                              className="aspect-square w-full rounded-lg object-cover"
                              loading="lazy"
                            />
                          </a>
                        ) : (
                          <div className="aspect-square w-full rounded-lg bg-muted" />
                        )}
                        {p.cleanup && (
                          <span className="absolute bottom-1 left-1 rounded bg-bb-forest px-1 text-[10px] text-white">
                            Cleanup
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Posted {formatDateTime(l.createdAt)}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
