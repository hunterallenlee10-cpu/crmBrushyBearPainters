import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { StageBadge } from "@/components/layout/stage-badge";
import { HealthBadge, HoldPill, JobStatusBadge, PriorityBadge } from "@/components/jobs/job-badges";
import type { JobStageId } from "@/lib/domain/stages";
import type { JobPriority, JobStatus } from "@/lib/domain/jobs/constants";
import { cn } from "@/lib/utils";

/** Job card for the Job List's card layout (SPEC §8.5 list/card toggle). */

export type JobCardHold = { label: string; blocks: boolean };

export type JobCardData = {
  id: string;
  jobNumber: string;
  name: string;
  accountName: string | null;
  /** Work type labels. */
  workTypes: readonly string[];
  stage: JobStageId;
  status: JobStatus;
  priority: JobPriority;
  holds: readonly JobCardHold[];
  /** Target/start date, a calendar day "YYYY-MM-DD". */
  startDate: string | null;
  /** Contract amount in cents. Leave undefined when the viewer can't see money. */
  amountCents?: number | null;
  healthScore: number | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 30, 2026" for a calendar day (no time zone shift: it's already a local day). */
export function formatJobDay(day: string | null | undefined): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return "—";
  const [y, m, d] = day.slice(0, 10).split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "$12,345.00" */
export function formatJobAmount(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** Holds labels from the picklist already end in "Hold"; the pill adds it back. */
export function holdPillLabel(label: string): string {
  return label.replace(/\s*hold$/i, "");
}

export function JobCard({ job, className }: { job: JobCardData; className?: string }) {
  return (
    <article
      aria-label={`${job.jobNumber} ${job.name}`}
      className={cn("flex h-full flex-col gap-3 rounded-2xl border bg-card p-4", className)}
    >
      {/* Right padding leaves room for the select / preview buttons the list adds. */}
      <div className="min-w-0 pr-20">
        <p className="text-xs text-muted-foreground tabular-nums">{job.jobNumber}</p>
        <Link
          href={`/jobs/${job.id}`}
          className="line-clamp-2 font-semibold text-bb-forest hover:underline"
        >
          {job.name}
        </Link>
        <p className="truncate text-sm text-foreground/80">
          {job.accountName ?? "No customer yet"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StageBadge stage={job.stage} />
        {job.status !== "open" && job.status !== "on_hold" && (
          <JobStatusBadge status={job.status} />
        )}
        {job.holds.map((h, i) => (
          <HoldPill key={`${h.label}-${i}`} label={holdPillLabel(h.label)} blocks={h.blocks} />
        ))}
        <PriorityBadge priority={job.priority} />
      </div>

      <p className="text-xs text-muted-foreground">
        {job.workTypes.length ? job.workTypes.join(", ") : "No work types yet"}
      </p>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-2 border-t pt-3">
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <CalendarDays className="size-3.5" aria-hidden />
            Start {formatJobDay(job.startDate)}
          </span>
          {job.amountCents !== undefined && (
            <span className="text-sm font-semibold text-bb-ink tabular-nums">
              {formatJobAmount(job.amountCents)}
            </span>
          )}
        </div>
        <HealthBadge score={job.healthScore} />
      </div>
    </article>
  );
}
