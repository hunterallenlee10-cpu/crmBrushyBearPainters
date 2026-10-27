import type { Metadata } from "next";
import Link from "next/link";
import { Sun } from "lucide-react";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { SyncIndicator } from "@/components/offline/sync-indicator";
import { FieldJobCard } from "@/components/production/field-job-card";
import { formatDay } from "@/lib/domain/scheduling/dates";
import { loadFieldJobs } from "@/lib/production/field";

export const metadata: Metadata = { title: "Today" };

/**
 * Today (SPEC §16 crew tab bar): the jobs on the schedule today for the
 * person (crew see only their own), then what's coming up next.
 */
export default async function FieldTodayPage() {
  const viewer = await requirePermission("work_orders:read");
  const supabase = await createSupabaseServerClient();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const { jobs, today } = await loadFieldJobs(
    { supabase, service },
    {
      orgId: viewer.orgId,
      viewerId: viewer.id,
      onlyMine: viewer.isCrew,
      stages: ["scheduled", "in_progress", "final_walkthrough"],
    },
  );
  const onToday = jobs.filter((j) => j.onToday);
  const upcoming = jobs
    .filter((j) => !j.onToday && j.firstDay && j.firstDay > today)
    .sort((a, b) => (a.firstDay ?? "").localeCompare(b.firstDay ?? ""))
    .slice(0, 5);
  const cardProps = {
    today,
    canLog: viewer.can("daily_logs:create"),
    canStart: viewer.can("daily_logs:create") || viewer.can("schedule:manage"),
    canPhoto: viewer.can("photos:upload"),
    readOnly: viewer.impersonating,
  };
  return (
    <PageContainer className="flex max-w-xl flex-col gap-4">
      <PageHeader
        title="Today"
        description={
          <>
            {formatDay(today)} · <SyncIndicator />
          </>
        }
      />
      {onToday.length === 0 ? (
        <EmptyState icon={Sun} title="Nothing on the schedule today">
          <p>Jobs you&apos;re on show here on their production days.</p>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {onToday.map((j) => (
            <FieldJobCard key={j.id} job={j} {...cardProps} />
          ))}
        </div>
      )}
      {upcoming.length > 0 && (
        <section aria-label="Coming up" className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Coming up</h2>
          <ul className="flex flex-col divide-y rounded-2xl border bg-card">
            {upcoming.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <Link
                  href={`/schedule/my-projects?job=${j.id}`}
                  className="min-w-0 truncate font-medium text-bb-forest underline-offset-2 hover:underline"
                >
                  {j.label}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {j.firstDay ? formatDay(j.firstDay) : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
