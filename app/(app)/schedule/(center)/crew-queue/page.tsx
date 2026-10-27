import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { formatRange } from "@/lib/domain/scheduling/dates";
import { rankCrews } from "@/lib/domain/scheduling/recommend";
import { defaultEntryWorkType, loadEntries, loadJobFacts, toBars } from "@/lib/production/context";
import { loadProductionJobs, type ProductionJobRow } from "@/lib/production/queues";
import { AssignCrew } from "../assign-crew";

export const metadata: Metadata = { title: "Crew Queue" };

type Status = "no_crew" | "assigned" | "scheduled" | "at_risk";
const LABELS: Record<
  Status,
  { label: string; variant: "danger" | "warning" | "success" | "info" }
> = {
  no_crew: { label: "No crew", variant: "warning" },
  assigned: { label: "Assigned", variant: "info" },
  scheduled: { label: "Scheduled", variant: "success" },
  at_risk: { label: "At risk", variant: "danger" },
};

function status(j: ProductionJobRow): Status {
  if (!j.crewId) return j.daysToStart !== null && j.daysToStart <= 5 ? "at_risk" : "no_crew";
  if (
    j.readiness.checks.some(
      (c) => (c.key === "skills" || c.key === "crew_available") && c.status === "fail",
    )
  )
    return "at_risk";
  return j.published ? "scheduled" : "assigned";
}

/** Crew Queue (SPEC §8.6): jobs that need a crew, with ranked suggestions. */
export default async function CrewQueuePage() {
  const viewer = await requirePermission("schedule:read");
  const supabase = await createSupabaseServerClient();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const { jobs, crews, config } = await loadProductionJobs(
    { supabase, service },
    { orgId: viewer.orgId, stages: ["onboarding", "ready_to_schedule", "scheduled"] },
  );
  const entries = await loadEntries(service, { orgId: viewer.orgId });
  const facts = await loadJobFacts(service, [
    ...new Set([...jobs.map((j) => j.id), ...entries.map((e) => e.job_id)]),
  ]);
  const bars = toBars(entries, facts);
  const active = crews.filter((c) => c.active);
  const canAssign = viewer.can("schedule:manage") && !viewer.impersonating;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Crew Queue"
        description="Jobs that need a crew, with crews ranked by skills, availability, workload and territory."
      />
      {jobs.length === 0 ? (
        <EmptyState icon={Users} title="No jobs waiting for a crew">
          <p>Jobs in Onboarding, Ready to Schedule and Scheduled show here.</p>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {jobs.map((j) => {
            const s = status(j);
            const job = facts.get(j.id);
            const ranked =
              job && j.planned
                ? rankCrews(
                    {
                      job,
                      workType: defaultEntryWorkType(job.workTypes),
                      startsOn:
                        j.planned.startsOn < config.context.today
                          ? config.context.today
                          : j.planned.startsOn,
                      endsOn:
                        j.planned.endsOn < config.context.today
                          ? config.context.today
                          : j.planned.endsOn,
                    },
                    active,
                    bars.filter((b) => b.jobId !== j.id),
                    config.context,
                  )
                : [];
            const options = ranked.length
              ? ranked.map((r) => ({
                  id: r.crewId,
                  label: `${r.crewName} · ${r.score}${r.eligible ? "" : " (conflict)"}`,
                }))
              : active.map((c) => ({ id: c.id, label: c.name }));
            if (j.crewId && !options.some((o) => o.id === j.crewId))
              options.push({ id: j.crewId, label: j.crewName ?? "Current crew" });
            return (
              <li key={j.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/jobs/${j.id}?section=schedule`}
                      className="font-semibold text-bb-forest hover:underline"
                    >
                      {j.label}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {[
                        j.city,
                        j.planned
                          ? formatRange(j.planned.startsOn, j.planned.endsOn)
                          : "No dates yet",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Badge variant={LABELS[s].variant}>{LABELS[s].label}</Badge>
                </div>
                <AssignCrew
                  jobId={j.id}
                  jobLabel={j.label}
                  crewId={j.crewId}
                  options={options}
                  disabled={!canAssign}
                />
                {ranked[0] && (
                  <p className="text-xs text-muted-foreground">
                    Best fit: {ranked[0].crewName} ({ranked[0].score}/100):{" "}
                    {ranked[0].reasons.map((r) => r.label).join(" · ")}
                  </p>
                )}
                {j.readiness.checks
                  .filter(
                    (c) =>
                      (c.key === "skills" || c.key === "crew_available") && c.status === "fail",
                  )
                  .map((c) => (
                    <p key={c.key} className="text-xs text-danger">
                      {c.detail}
                    </p>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
