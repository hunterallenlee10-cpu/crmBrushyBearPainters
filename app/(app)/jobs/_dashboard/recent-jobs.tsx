import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ChartCard, ChartEmpty } from "@/components/kpi/chart-card";
import { StageBadge } from "@/components/layout/stage-badge";
import { formatJobAmount } from "@/components/jobs/job-card";
import { formatDate, formatRelative } from "@/lib/format/dates";
import type { JobStageId } from "@/lib/domain/stages";

export type RecentJob = {
  id: string;
  jobNumber: string;
  name: string;
  accountName: string | null;
  stage: JobStageId;
  /** undefined when money is hidden for the viewer. */
  amountCents?: number | null;
  createdAt: string;
};

/** Recent Jobs: the five newest jobs the viewer can see. */
export function RecentJobs({
  jobs,
  viewAllHref,
  now,
}: {
  jobs: readonly RecentJob[];
  viewAllHref: string;
  now: Date;
}) {
  return (
    <ChartCard
      id="recent-jobs"
      title="Recent Jobs"
      caption="The five newest jobs you can see"
      action={
        <Link
          href={viewAllHref}
          className="inline-flex items-center text-xs font-medium text-bb-forest hover:underline"
        >
          All jobs
          <ChevronRight className="size-3" aria-hidden />
        </Link>
      }
    >
      {jobs.length === 0 ? (
        <ChartEmpty>No jobs yet.</ChartEmpty>
      ) : (
        <ul className="-mx-1 flex flex-col divide-y">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-center gap-3 px-1 py-2">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/jobs/${j.id}`}
                  className="block truncate text-sm font-medium text-bb-forest hover:underline"
                >
                  {j.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="tabular-nums">{j.jobNumber}</span>
                  {j.accountName && ` · ${j.accountName}`} ·{" "}
                  <span title={formatDate(j.createdAt)}>{formatRelative(j.createdAt, now)}</span>
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StageBadge stage={j.stage} />
                {j.amountCents !== undefined && (
                  <span className="text-xs tabular-nums">{formatJobAmount(j.amountCents)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
