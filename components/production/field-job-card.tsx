import Link from "next/link";
import {
  Camera,
  CircleCheck,
  KeyRound,
  ListTodo,
  MapPin,
  NotebookPen,
  PawPrint,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/layout/stage-badge";
import { isJobStageId } from "@/lib/domain/stages";
import { formatRange } from "@/lib/domain/scheduling/dates";
import type { FieldJob } from "@/lib/production/field";
import { PRODUCTION_STEPS } from "@/lib/production/field";
import { StartJobButton } from "./start-job-button";

const WO_STATUS: Record<string, string> = {
  new: "New",
  scheduled: "Scheduled",
  in_progress: "In progress",
  pending_approval: "Pending approval",
  completed: "Completed",
};

/**
 * One job as the crew sees it (SPEC §8.8 selected project summary): where to
 * go, how to get in, today's work order, scope, colors, open punch items and
 * the daily log. Big tap targets for phones.
 */
export function FieldJobCard({
  job,
  today,
  canLog,
  canStart,
  canPhoto,
  readOnly,
}: {
  job: FieldJob;
  today: string;
  canLog: boolean;
  canStart: boolean;
  canPhoto: boolean;
  readOnly: boolean;
}) {
  const current =
    job.workOrders.find((w) => w.status === "in_progress") ??
    job.workOrders.find((w) => w.status !== "completed") ??
    null;
  const startable =
    job.stage === "scheduled" && job.firstDay !== null && job.firstDay <= today && canStart;
  const mapsHref = job.address
    ? `https://maps.google.com/?q=${encodeURIComponent(job.address)}`
    : null;
  return (
    <article
      aria-label={job.label}
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/jobs/${job.id}?section=schedule`}
            className="text-base font-semibold text-bb-forest hover:underline"
          >
            {job.label}
          </Link>
          <p className="text-xs text-muted-foreground">
            {[
              job.crewName ?? "No crew",
              job.firstDay && job.lastDay
                ? formatRange(job.firstDay, job.lastDay)
                : "Not on the schedule",
              `${job.stepsDone}/${PRODUCTION_STEPS.length} stages`,
            ].join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {isJobStageId(job.stage) && <StageBadge stage={job.stage} />}
          {job.isPriorityReschedule && <Badge variant="outline">Rain priority</Badge>}
          {job.onToday && <Badge>Today</Badge>}
        </div>
      </header>

      {job.address && (
        <p className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          {mapsHref ? (
            <a href={mapsHref} target="_blank" rel="noreferrer" className="underline">
              {job.address}
            </a>
          ) : (
            job.address
          )}
        </p>
      )}
      {(job.accessNotes || job.parking || job.pets) && (
        <dl className="grid gap-1 rounded-xl bg-muted/50 p-3 text-sm">
          {job.accessNotes && (
            <div className="flex gap-2">
              <dt className="flex items-center gap-1 font-medium">
                <KeyRound className="size-4" aria-hidden /> Access
              </dt>
              <dd className="min-w-0">{job.accessNotes}</dd>
            </div>
          )}
          {job.parking && (
            <div className="flex gap-2">
              <dt className="font-medium">Parking</dt>
              <dd className="min-w-0">{job.parking}</dd>
            </div>
          )}
          {job.pets && (
            <div className="flex gap-2">
              <dt className="flex items-center gap-1 font-medium">
                <PawPrint className="size-4" aria-hidden /> Pets
              </dt>
              <dd className="min-w-0">{job.pets}</dd>
            </div>
          )}
        </dl>
      )}

      <section aria-label="Today's work order" className="text-sm">
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Work order
        </h3>
        {current ? (
          <div>
            <p className="font-medium">
              {current.label}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({WO_STATUS[current.status] ?? current.status})
              </span>
            </p>
            {current.scope && (
              <p className="whitespace-pre-line text-muted-foreground">{current.scope}</p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">
            {job.workOrders.length ? "All work orders are done." : "No work orders yet."}
          </p>
        )}
      </section>

      {job.colors.length > 0 && (
        <section aria-label="Colors" className="text-sm">
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Colors
          </h3>
          <ul className="grid gap-1">
            {job.colors.map((c, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="font-medium">
                  {c.area} · {c.surface}
                </span>
                <span className="text-muted-foreground">
                  {[c.color, c.code, c.sheen].filter(Boolean).join(" · ") || "Color to confirm"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="flex items-center gap-2 text-sm">
        <ListTodo className="size-4 text-muted-foreground" aria-hidden />
        {job.openPunch ? (
          <Link href={`/jobs/${job.id}?section=punch-list`} className="underline">
            {job.openPunch} open punch item{job.openPunch === 1 ? "" : "s"}
          </Link>
        ) : (
          <span className="text-muted-foreground">No open punch items</span>
        )}
      </p>

      <footer className="flex flex-wrap gap-2">
        {startable && !readOnly && <StartJobButton jobId={job.id} className="h-11" />}
        {canLog &&
          !readOnly &&
          ["scheduled", "in_progress", "final_walkthrough"].includes(job.stage) &&
          (job.loggedToday ? (
            <span className="inline-flex h-11 items-center gap-1 rounded-md border px-3 text-sm text-success">
              <CircleCheck className="size-4" aria-hidden /> Today&apos;s log is in
            </span>
          ) : (
            <Button asChild className="h-11 bg-bb-honey text-bb-ink hover:bg-bb-honey/90">
              <Link href={`/field/daily-log?job=${job.id}`}>
                <NotebookPen aria-hidden /> Daily log
              </Link>
            </Button>
          ))}
        {canPhoto && (
          <Button asChild variant="outline" className="h-11">
            <Link href={`/field/camera?job=${job.id}`}>
              <Camera aria-hidden /> Photos
            </Link>
          </Button>
        )}
      </footer>
    </article>
  );
}
