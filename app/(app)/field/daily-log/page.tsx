import type { Metadata } from "next";
import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { SyncIndicator } from "@/components/offline/sync-indicator";
import { DailyLogForm } from "@/components/production/daily-log-form";
import { loadFieldJobs } from "@/lib/production/field";

export const metadata: Metadata = { title: "Daily Log" };

/**
 * Daily Log (SPEC §8.5 #9, §16 crew tab bar): the evening update. Crew see
 * only the jobs they're on; jobs on the schedule today come first.
 */
export default async function FieldDailyLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requirePermission("daily_logs:create");
  const sp = await searchParams;
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
  const ordered = [...jobs].sort(
    (a, b) => Number(b.onToday) - Number(a.onToday) || a.label.localeCompare(b.label),
  );
  const wanted = typeof sp.job === "string" ? sp.job : null;
  const defaultJobId = ordered.some((j) => j.id === wanted) ? wanted : (ordered[0]?.id ?? null);
  return (
    <PageContainer className="flex max-w-xl flex-col gap-4">
      <PageHeader title="Daily Log" description={<SyncIndicator />} />
      {ordered.length === 0 ? (
        <EmptyState icon={NotebookPen} title="No jobs to log">
          <p>
            Jobs you&apos;re on show up here once they&apos;re on the schedule. See{" "}
            <Link href="/field/today" className="underline">
              Today
            </Link>
            .
          </p>
        </EmptyState>
      ) : viewer.impersonating ? (
        <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          Viewing as another person is read-only. Posting a daily log is turned off.
        </p>
      ) : (
        <DailyLogForm
          jobs={ordered.map((j) => ({
            id: j.id,
            label: j.onToday ? `${j.label} (today)` : j.label,
            workOrders: j.workOrders
              .filter((w) => w.status !== "completed")
              .map((w) => ({ id: w.id, label: w.label })),
            members: j.members,
          }))}
          defaultJobId={defaultJobId}
          today={today}
        />
      )}
    </PageContainer>
  );
}
