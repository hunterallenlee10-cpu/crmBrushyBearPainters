import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { StageBadge } from "@/components/layout/stage-badge";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { findRecoveryIssues, stuckJobs, type RecoveryFacts } from "@/lib/domain/jobs/recovery";
import { isJobStageId } from "@/lib/domain/stages";
import { logError } from "@/lib/log";
import { RecoveryFixes } from "./recovery-fixes";

export const metadata: Metadata = { title: "Job Recovery" };

/**
 * Admin → Job Recovery (owners): jobs whose stage and records disagree, jobs
 * missing a milestone, and jobs sitting in a stage far longer than usual,
 * with a fix for each (owner override with a reason, or a milestone edit).
 */
export default async function JobRecoveryPage() {
  const viewer = await requirePermission("job_admin:override");
  if (!viewer.isOwner) {
    return (
      <EmptyState icon={LifeBuoy} title="Owners only">
        Job Recovery changes stages and dates with an override, so only owners can use it.
      </EmptyState>
    );
  }
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const { data, error } = await service.rpc("job_recovery_scan", {
    p_org: viewer.orgId,
    p_limit: 2000,
  });
  if (error) logError("job_recovery.scan", error);
  const facts: RecoveryFacts[] = (data ?? []).map((r) => ({
    jobId: r.job_id,
    jobNumber: r.job_number,
    name: r.name,
    stage: r.stage,
    status: r.status,
    stageEnteredAt: r.stage_entered_at,
    lastFromStage: r.last_from_stage,
    lastOverride: r.last_override,
    gatePasses: r.gate_passes,
    blockingHolds: r.blocking_holds ?? 0,
    milestones: (r.milestones ?? {}) as Record<string, string | null>,
    hasPublishedSchedule: r.has_published_schedule,
    hasAcceptedEstimate: r.has_accepted_estimate,
  }));
  const rows = stuckJobs(findRecoveryIssues(facts));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Job Recovery"
        description={`Checks ${facts.length.toLocaleString("en-US")} open jobs for stages that no longer match the records, missing milestone dates and unusually long stays. Every fix needs a reason and is recorded in the job's history.`}
      />
      {rows.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="Nothing stuck">
          Every open job&apos;s stage matches its records. Check back after a busy week.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.jobId} className="rounded-2xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/jobs/${r.jobId}`}
                  className="font-semibold text-bb-forest hover:underline"
                >
                  {r.jobNumber} · {r.name}
                </Link>
                {isJobStageId(r.stage) && <StageBadge stage={r.stage} />}
                {r.daysInStage !== null && (
                  <Badge variant="neutral">{r.daysInStage} days in stage</Badge>
                )}
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {r.issues.map((issue, i) => (
                  <li
                    key={`${issue.kind}-${i}`}
                    className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="text-sm">
                      <Badge
                        variant={issue.severity === "high" ? "danger" : "warning"}
                        className="mr-2"
                      >
                        {issue.severity === "high" ? "Fix soon" : "Check"}
                      </Badge>
                      {issue.message}
                    </p>
                    <RecoveryFixes
                      jobId={r.jobId}
                      fixes={issue.fixes}
                      readOnly={viewer.impersonating}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
