import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { formatRange } from "@/lib/domain/scheduling/dates";
import { getStage, isJobStageId } from "@/lib/domain/stages";
import { loadProductionJobs, type ProductionJobRow } from "@/lib/production/queues";
import { ClipboardCheck } from "lucide-react";

export const metadata: Metadata = { title: "Readiness Queue" };

type Status = "blocked" | "needs_review" | "complete" | "scheduled";
const STATUS: Record<
  Status,
  { label: string; variant: "danger" | "warning" | "success" | "info" }
> = {
  blocked: { label: "Blocked", variant: "danger" },
  needs_review: { label: "Needs review", variant: "warning" },
  complete: { label: "Complete", variant: "success" },
  scheduled: { label: "Scheduled", variant: "info" },
};

function status(j: ProductionJobRow): Status {
  if (j.blockingHolds.length || j.blocks.some((b) => b.code !== "non_production_day"))
    return "blocked";
  if (j.stage === "scheduled" || j.published) return "scheduled";
  if (j.stage === "onboarding" || (j.readiness.percent ?? 0) < 100) return "needs_review";
  return "complete";
}

function nextAction(j: ProductionJobRow, s: Status): string {
  if (j.blockingHolds.length) return `Release the ${j.blockingHolds[0]} hold.`;
  if (j.blocks[0]) return j.blocks[0].message;
  if (j.stage === "onboarding") return "Finish the onboarding checklist.";
  const fail = j.readiness.checks.find((c) => c.status === "fail");
  if (fail) return fail.detail;
  if (s === "complete") return "Drag it onto the Master Schedule and publish.";
  return "Ready. Watch the start day.";
}

/** Readiness Queue (SPEC §8.6): every job heading to production with its readiness and next action. */
export default async function ReadinessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await requirePermission("schedule:read");
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const { jobs } = await loadProductionJobs(
    { supabase, service },
    { orgId: viewer.orgId, stages: ["onboarding", "ready_to_schedule", "scheduled"] },
  );
  const rows = jobs.map((j) => ({ j, s: status(j) }));
  const filter = (Object.keys(STATUS) as Status[]).find((k) => k === sp.status) ?? null;
  const shown = filter ? rows.filter((r) => r.s === filter) : rows;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Readiness Queue"
        description="Jobs on their way to production: readiness, what blocks them and the next step."
      />
      <nav aria-label="Readiness filters" className="flex flex-wrap gap-2">
        <Link
          href="/schedule/readiness"
          aria-current={!filter ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-sm ${!filter ? "bg-bb-forest text-white" : "bg-card"}`}
        >
          All ({rows.length})
        </Link>
        {(Object.keys(STATUS) as Status[]).map((k) => (
          <Link
            key={k}
            href={`/schedule/readiness?status=${k}`}
            aria-current={filter === k ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${filter === k ? "bg-bb-forest text-white" : "bg-card"}`}
          >
            {STATUS[k].label} ({rows.filter((r) => r.s === k).length})
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nothing in this queue">
          <p>
            Sold jobs show up here once they&apos;re in Onboarding. Clear their checklists to make
            them Ready to Schedule.
          </p>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Job</th>
                <th className="p-3 font-medium">Stage</th>
                <th className="p-3 font-medium">Dates</th>
                <th className="p-3 font-medium">Crew</th>
                <th className="p-3 font-medium">Readiness</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ j, s }) => (
                <tr key={j.id} className="border-b align-top last:border-0">
                  <td className="p-3">
                    <Link
                      href={`/jobs/${j.id}?section=schedule`}
                      className="font-medium text-bb-forest hover:underline"
                    >
                      {j.label}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{j.city ?? "—"}</span>
                  </td>
                  <td className="p-3">
                    {isJobStageId(j.stage) ? getStage(j.stage).label : j.stage}
                  </td>
                  <td className="p-3">
                    {j.planned ? formatRange(j.planned.startsOn, j.planned.endsOn) : "Not planned"}
                    {j.draftPending ? " (draft)" : ""}
                  </td>
                  <td className="p-3">{j.crewName ?? "—"}</td>
                  <td className="p-3 tabular-nums">
                    {j.readiness.percent === null ? "—" : `${j.readiness.percent}%`}
                  </td>
                  <td className="p-3">
                    <Badge variant={STATUS[s].variant}>{STATUS[s].label}</Badge>
                  </td>
                  <td className="p-3 text-xs">{nextAction(j, s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
