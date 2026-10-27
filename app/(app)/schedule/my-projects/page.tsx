import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/forms/native-select";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { StageBadge } from "@/components/layout/stage-badge";
import { SyncIndicator } from "@/components/offline/sync-indicator";
import { FieldJobCard } from "@/components/production/field-job-card";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { addDays, formatRange, isIsoDate } from "@/lib/domain/scheduling/dates";
import {
  dayCounts,
  filterProjects,
  isProjectRange,
  monthEnd,
  monthGrid,
  monthStart,
  PROJECT_RANGES,
  type ProjectRange,
} from "@/lib/domain/scheduling/projects";
import { getStage, isJobStageId } from "@/lib/domain/stages";
import { loadFieldJobs, PRODUCTION_STEPS } from "@/lib/production/field";
import { loadPhotoThumbs } from "@/lib/photos/thumbs";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My Projects" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const STAGES = [
  "ready_to_schedule",
  "scheduled",
  "in_progress",
  "final_walkthrough",
  "completed",
] as const;
const RANGE_LABEL: Record<ProjectRange, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  all: "All",
};
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * My Projects (SPEC §8.8): the PM / crew-lead portal. Crew always see only
 * the jobs they're on; office people see every production job, or only
 * their own with "Only mine".
 */
export default async function MyProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("work_orders:read");
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const mine = viewer.isCrew || one(sp.mine) === "1";
  const { jobs, today, workdays } = await loadFieldJobs(
    { supabase, service },
    { orgId: viewer.orgId, viewerId: viewer.id, onlyMine: mine, stages: STAGES },
  );
  const rawDate = one(sp.date);
  const anchor = isIsoDate(rawDate) ? rawDate : today;
  const range: ProjectRange = isProjectRange(one(sp.range))
    ? (one(sp.range) as ProjectRange)
    : "all";
  const f = { q: one(sp.q) ?? "", stage: one(sp.stage) ?? "", city: one(sp.city) ?? "" };
  const list = filterProjects(jobs, { ...f, range, anchor }).sort(
    (a, b) =>
      (a.firstDay ?? "9999").localeCompare(b.firstDay ?? "9999") || a.label.localeCompare(b.label),
  );
  const wanted = one(sp.job);
  const selected =
    list.find((j) => j.id === wanted) ?? jobs.find((j) => j.id === wanted) ?? list[0] ?? null;
  const photos = selected
    ? await loadPhotoThumbs({ supabase, service }, { jobId: selected.id, limit: 6 })
    : [];
  const counts = dayCounts(
    filterProjects(jobs, { ...f, range: "all", anchor }),
    monthGrid(anchor)
      .flat()
      .filter((d): d is string => d !== null),
    workdays,
  );
  const cities = [...new Set(jobs.map((j) => j.city).filter((c): c is string => !!c))].sort();
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = {
      q: f.q || null,
      stage: f.stage || null,
      city: f.city || null,
      range: range === "all" ? null : range,
      date: anchor === today ? null : anchor,
      mine: mine && !viewer.isCrew ? "1" : null,
      job: selected?.id ?? null,
      ...patch,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return `/schedule/my-projects${s ? `?${s}` : ""}`;
  };
  const [y, m] = anchor.split("-").map(Number);

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="My Projects"
        description={
          <>
            Today&apos;s work, scope, colors and the daily log for your jobs. <SyncIndicator />
          </>
        }
      />
      {jobs.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline" size="touch">
                <Link href="/field/today">Today&apos;s jobs</Link>
              </Button>
              {viewer.can("schedule:manage") && (
                <Button asChild variant="cta" size="touch">
                  <Link href="/schedule/master">Open the Master Schedule</Link>
                </Button>
              )}
            </div>
          }
        >
          <p>
            Jobs you&apos;re on (as project manager, point of contact or on the crew) show up here
            once they&apos;re ready to schedule.
          </p>
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
          <aside className="flex flex-col gap-3" aria-label="Projects">
            <form method="get" className="flex flex-col gap-2 rounded-2xl border bg-card p-3">
              <label htmlFor="mp-q" className="sr-only">
                Search projects
              </label>
              <Input
                id="mp-q"
                name="q"
                defaultValue={f.q}
                placeholder="Search name or job #"
                className="h-11"
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="mp-stage" className="text-xs font-medium">
                    Status
                  </label>
                  <NativeSelect id="mp-stage" name="stage" defaultValue={f.stage}>
                    <option value="">All</option>
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {getStage(s).label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="mp-city" className="text-xs font-medium">
                    City
                  </label>
                  <NativeSelect id="mp-city" name="city" defaultValue={f.city}>
                    <option value="">All</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              {range !== "all" && <input type="hidden" name="range" value={range} />}
              {anchor !== today && <input type="hidden" name="date" value={anchor} />}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {!viewer.isCrew && (
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="mine"
                      value="1"
                      defaultChecked={mine}
                      className="size-5 accent-bb-forest"
                    />
                    Only mine
                  </label>
                )}
                <Button type="submit" variant="outline" className="h-11">
                  Apply
                </Button>
              </div>
            </form>

            <nav
              aria-label="Date range"
              className="grid grid-cols-4 gap-1 rounded-2xl border bg-card p-1"
            >
              {PROJECT_RANGES.map((r) => (
                <Link
                  key={r}
                  href={href({ range: r === "all" ? null : r })}
                  aria-current={r === range ? "page" : undefined}
                  className={cn(
                    "grid min-h-11 place-items-center rounded-xl text-sm font-medium",
                    r === range ? "bg-bb-forest text-white" : "hover:bg-muted",
                  )}
                >
                  {RANGE_LABEL[r]}
                </Link>
              ))}
            </nav>

            <section aria-label="Mini calendar" className="rounded-2xl border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <Link
                  href={href({ date: addDays(monthStart(anchor), -1) })}
                  aria-label="Previous month"
                  className="grid size-11 place-items-center rounded-xl hover:bg-muted"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Link>
                <h2 className="text-sm font-semibold">
                  {MONTHS[(m ?? 1) - 1]} {y}
                </h2>
                <Link
                  href={href({ date: addDays(monthEnd(anchor), 1) })}
                  aria-label="Next month"
                  className="grid size-11 place-items-center rounded-xl hover:bg-muted"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </Link>
              </div>
              <table className="w-full table-fixed text-center text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                      <th key={i} scope="col" className="pb-1 font-medium">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthGrid(anchor).map((week, wi) => (
                    <tr key={wi}>
                      {week.map((d, di) => (
                        <td key={di} className="p-0.5">
                          {d && (
                            <Link
                              href={href({ date: d, range: "day", job: null })}
                              aria-label={`${d}: ${counts[d] ?? 0} job${counts[d] === 1 ? "" : "s"}`}
                              className={cn(
                                "flex h-10 flex-col items-center justify-center rounded-lg hover:bg-muted",
                                d === today && "ring-1 ring-bb-forest",
                                d === anchor &&
                                  range === "day" &&
                                  "bg-bb-forest text-white hover:bg-bb-forest",
                              )}
                            >
                              <span>{Number(d.slice(8))}</span>
                              {(counts[d] ?? 0) > 0 && (
                                <span className="text-[10px] leading-none font-semibold">
                                  {counts[d]}
                                </span>
                              )}
                            </Link>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <ul
              className="flex flex-col divide-y rounded-2xl border bg-card"
              aria-label="Project list"
            >
              {list.length === 0 ? (
                <li className="p-4 text-sm text-muted-foreground">
                  No projects match. Clear the filters or pick All.
                </li>
              ) : (
                list.map((j) => (
                  <li key={j.id}>
                    <Link
                      href={href({ job: j.id })}
                      aria-current={selected?.id === j.id ? "true" : undefined}
                      className={cn(
                        "flex flex-col gap-1 p-3 text-sm hover:bg-muted/60",
                        selected?.id === j.id && "bg-bb-honey/15",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{j.name}</span>
                        {isJobStageId(j.stage) && <StageBadge stage={j.stage} />}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {[
                          j.jobNumber,
                          j.city ?? "No city",
                          j.firstDay && j.lastDay
                            ? formatRange(j.firstDay, j.lastDay)
                            : "Not scheduled",
                          `${j.stepsDone}/${PRODUCTION_STEPS.length} stages complete`,
                        ].join(" · ")}
                      </span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </aside>

          <section aria-label="Selected project" className="flex flex-col gap-3 max-lg:order-first">
            {selected ? (
              <>
                <FieldJobCard
                  job={selected}
                  today={today}
                  canLog={viewer.can("daily_logs:create")}
                  canStart={viewer.can("daily_logs:create") || viewer.can("schedule:manage")}
                  canPhoto={viewer.can("photos:upload")}
                  readOnly={viewer.impersonating}
                />
                <div className="rounded-2xl border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Photos</h2>
                    <Link
                      href={`/jobs/${selected.id}?section=photos`}
                      className="text-sm underline"
                    >
                      All photos
                    </Link>
                  </div>
                  {photos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No photos yet.</p>
                  ) : (
                    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {photos.map((p) => (
                        <li key={p.id}>
                          {p.thumbUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link
                            <img
                              src={p.thumbUrl}
                              alt={p.caption ?? "Job photo"}
                              className="aspect-square w-full rounded-lg object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="aspect-square w-full rounded-lg bg-muted" />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
                Pick a project.
              </p>
            )}
          </section>
        </div>
      )}
    </PageContainer>
  );
}
