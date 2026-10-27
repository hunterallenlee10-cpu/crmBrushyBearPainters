import type { Metadata } from "next";
import { Camera } from "lucide-react";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { SyncIndicator } from "@/components/offline/sync-indicator";
import { CameraClient } from "./camera-client";

export const metadata: Metadata = { title: "Camera" };

/**
 * Camera (SPEC §16 mobile tab bar, §8.5 #6): pick one of your jobs and take
 * photos. Works without signal: photos wait on the phone and upload later.
 */
export default async function CameraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requirePermission("photos:upload");
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, job_number, name, stage, property:properties(city)")
    // Every open job: walkthrough photos count too (SPEC §15.1 Walkthrough checklist).
    .not("stage", "in", "(closed_won,closed_lost)")
    .order("updated_at", { ascending: false })
    .limit(50);
  const options = (jobs ?? []).map((j) => ({
    id: j.id,
    label: `${j.job_number} · ${j.name}`,
    city: j.property?.city ?? null,
  }));
  const wanted = typeof sp.job === "string" ? sp.job : null;
  return (
    <PageContainer className="flex max-w-xl flex-col gap-4">
      <PageHeader title="Camera" description={<SyncIndicator />} />
      {options.length === 0 ? (
        <EmptyState icon={Camera} title="No jobs to photograph">
          <p>Open jobs you&apos;re on show up here.</p>
        </EmptyState>
      ) : (
        <CameraClient
          jobs={options}
          initialJobId={options.some((o) => o.id === wanted) ? wanted : (options[0]?.id ?? null)}
          readOnly={viewer.impersonating}
        />
      )}
    </PageContainer>
  );
}
