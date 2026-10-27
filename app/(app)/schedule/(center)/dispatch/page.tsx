import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Ban, CalendarCheck, HardHat, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi/kpi-card";
import { NativeSelect } from "@/components/forms/native-select";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { formatDay, formatRange } from "@/lib/domain/scheduling/dates";
import { getStage, isJobStageId } from "@/lib/domain/stages";
import { loadProductionJobs } from "@/lib/production/queues";

export const metadata: Metadata = { title: "Field Dispatch" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const WORK_TYPE_LABELS: Record<string, string> = {
  interior: "Interior",
  exterior: "Exterior",
  cabinets: "Cabinets",
  deck_fence: "Deck & Fence",
  add_on_only: "Add-on only",
};

/**
 * Field Dispatch (SPEC §8.6): today's crews and jobs. The map needs the maps
 * integration (GeoProvider, not connected), so jobs are listed by city.
 */
export default async function DispatchPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("schedule:read");
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const { jobs, crews, config } = await loadProductionJobs(
    { supabase, service },
    {
      orgId: viewer.orgId,
      stages: ["ready_to_schedule", "scheduled", "in_progress", "final_walkthrough"],
    },
  );
  const today = config.context.today;
  const f = {
    crew: one(sp.crew) ?? "",
    skill: one(sp.skill) ?? "",
    city: one(sp.city) ?? "",
    status: one(sp.status) ?? "",
    workType: one(sp.workType) ?? "",
  };
  const crewSkills = new Map(crews.map((c) => [c.id, c.skills.map((s) => s.key)]));
  const todayJob = (j: (typeof jobs)[number]) =>
    !!j.published && j.published.startsOn <= today && today <= j.published.endsOn;
  const filtered = jobs.filter(
    (j) =>
      (!f.crew || j.crewId === f.crew) &&
      (!f.skill || (j.crewId && crewSkills.get(j.crewId)?.includes(f.skill))) &&
      (!f.city || j.city === f.city) &&
      (!f.status || j.stage === f.status) &&
      (!f.workType || j.workTypes.includes(f.workType)),
  );
  const tiles = [
    {
      label: "Blocked",
      value: jobs.filter((j) => j.blocks.length || j.blockingHolds.length).length,
      icon: Ban,
      tone: "danger" as const,
      caption: "A hold or a rule blocks it",
    },
    {
      label: "Ready to schedule",
      value: jobs.filter((j) => j.stage === "ready_to_schedule").length,
      icon: CalendarCheck,
      tone: "brand" as const,
      caption: "Onboarding cleared",
    },
    {
      label: "At risk",
      value: jobs.filter(
        (j) =>
          j.stage === "scheduled" &&
          (j.daysToStart ?? 99) <= 7 &&
          (j.readiness.percent ?? 100) < 100,
      ).length,
      icon: AlertTriangle,
      tone: "warning" as const,
      caption: "Starts ≤ 7 days, not fully ready",
    },
    {
      label: "Today's production",
      value: jobs.filter(todayJob).length,
      icon: HardHat,
      tone: "info" as const,
      caption: `On the schedule ${formatDay(today)}`,
    },
  ];
  const byCity = new Map<string, typeof filtered>();
  for (const j of filtered)
    byCity.set(j.city ?? "No city", [...(byCity.get(j.city ?? "No city") ?? []), j]);
  const cities = [...new Set(jobs.map((j) => j.city).filter((c): c is string => !!c))].sort();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Field Dispatch"
        description="Today's crews and the jobs in production, grouped by city."
      />
      <section aria-label="Dispatch tiles" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map((t) => (
          <KpiCard
            key={t.label}
            label={t.label}
            value={t.value}
            caption={t.caption}
            icon={t.icon}
            tone={t.tone}
          />
        ))}
      </section>
      <div className="rounded-2xl border border-dashed bg-card p-3 text-sm text-muted-foreground">
        <MapPin className="mr-1 inline size-4" aria-hidden />
        Map view needs the maps integration (Admin → Integrations, not connected). Until then jobs
        are listed by city.
      </div>
      <form className="flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3" method="get">
        {[
          {
            name: "crew",
            label: "Crew",
            options: crews.filter((c) => c.active).map((c) => [c.id, c.name] as const),
          },
          { name: "skill", label: "Skill", options: Object.entries(config.context.skillLabels) },
          { name: "city", label: "City", options: cities.map((c) => [c, c] as const) },
          {
            name: "status",
            label: "Status",
            options: ["ready_to_schedule", "scheduled", "in_progress", "final_walkthrough"].map(
              (s) => [s, isJobStageId(s) ? getStage(s).label : s] as const,
            ),
          },
          { name: "workType", label: "Work type", options: Object.entries(WORK_TYPE_LABELS) },
        ].map((sel) => (
          <div key={sel.name} className="flex w-40 flex-col gap-1">
            <label htmlFor={`f-${sel.name}`} className="text-xs font-medium">
              {sel.label}
            </label>
            <NativeSelect
              id={`f-${sel.name}`}
              name={sel.name}
              defaultValue={f[sel.name as keyof typeof f]}
            >
              <option value="">All</option>
              {sel.options.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {filtered.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          No jobs match. Clear the filters or schedule jobs on the Master Schedule.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {[...byCity.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([city, list]) => (
              <section key={city} aria-label={city} className="rounded-2xl border bg-card p-4">
                <h2 className="mb-2 text-base font-semibold">
                  {city}{" "}
                  <span className="text-sm font-normal text-muted-foreground">({list.length})</span>
                </h2>
                <ul className="flex flex-col divide-y">
                  {list.map((j) => (
                    <li
                      key={j.id}
                      className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/jobs/${j.id}?section=schedule`}
                          className="font-medium text-bb-forest hover:underline"
                        >
                          {j.label}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {[
                            isJobStageId(j.stage) ? getStage(j.stage).label : j.stage,
                            j.crewName ?? "No crew",
                            j.published
                              ? formatRange(j.published.startsOn, j.published.endsOn)
                              : "Not published",
                          ].join(" · ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {todayJob(j) && <Badge variant="info">Today</Badge>}
                        {(j.blocks.length > 0 || j.blockingHolds.length > 0) && (
                          <Badge variant="danger">Blocked</Badge>
                        )}
                        {j.readiness.percent !== null && (
                          <Badge variant="neutral">Ready {j.readiness.percent}%</Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
