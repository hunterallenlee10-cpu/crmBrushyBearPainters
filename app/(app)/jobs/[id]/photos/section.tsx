import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { requiredShots } from "@/lib/domain/photos";
import { signPhotoPaths } from "@/lib/photos/storage";
import { NoAccess } from "../_sections/section-card";
import { PhotosClient, type PhotoItem } from "./photos-client";

/** Photos the gallery shows at once; older ones page in with "Show more". */
const PAGE = 120;

/**
 * Job → Photos (SPEC §8.5 #6): gallery, required-shot checklist and
 * before/after compare. Photos are read with the person's own client (row
 * security); the server then signs short-lived links for those files only.
 */
export async function PhotosSection({
  jobId,
  workTypes,
  viewerId,
  contactFirstName,
  can,
  limit,
}: {
  jobId: string;
  workTypes: readonly string[];
  viewerId: string;
  contactFirstName: string | null;
  can: { read: boolean; upload: boolean; delete: boolean; share: boolean; edit: boolean };
  limit?: number;
}) {
  if (!can.read) {
    return <NoAccess>Your role can&apos;t see this job&apos;s photos.</NoAccess>;
  }
  const supabase = await createSupabaseServerClient();
  const take = Math.min(Math.max(limit ?? PAGE, PAGE), 1000);
  const [photos, summary, estimate] = await Promise.all([
    supabase
      .from("job_photos")
      .select(
        "id, category, area, caption, checklist_key, storage_path, thumb_path, width, height, created_at, taken_at, uploaded_by, customer_visible, shared_at, source",
        { count: "exact" },
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(take),
    supabase.rpc("job_photo_summary", { p_job: jobId }),
    supabase.from("jobs").select("accepted_estimate_id").eq("id", jobId).maybeSingle(),
  ]);
  const rows = photos.data ?? [];

  const service = await createSupabaseServiceClient({ actorId: viewerId });
  const urls = await signPhotoPaths(
    service,
    rows.flatMap((r) => [r.thumb_path, r.storage_path]),
  );

  // Areas of the accepted scope (names only) for the per-area shots.
  const areasByWorkType: Record<string, string[]> = {};
  if (estimate.data?.accepted_estimate_id) {
    const { data: est } = await service
      .from("estimates")
      .select("accepted_version_id, accepted_option_id")
      .eq("id", estimate.data.accepted_estimate_id)
      .maybeSingle();
    if (est?.accepted_version_id && est.accepted_option_id) {
      const { data: areas } = await service
        .from("estimate_areas")
        .select("name, work_type, sort_order")
        .eq("version_id", est.accepted_version_id)
        .eq("option_id", est.accepted_option_id)
        .order("sort_order");
      for (const a of areas ?? []) {
        if (!a.work_type) continue;
        (areasByWorkType[a.work_type] ??= []).push(a.name);
      }
    }
  }

  const names = new Map<string, string>();
  const uploaderIds = [...new Set(rows.map((r) => r.uploaded_by).filter((u): u is string => !!u))];
  if (uploaderIds.length) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", uploaderIds);
    for (const p of people ?? []) names.set(p.id, p.full_name);
  }

  const items: PhotoItem[] = rows.map((r) => ({
    id: r.id,
    category: r.category,
    area: r.area,
    caption: r.caption,
    checklistKey: r.checklist_key,
    thumbUrl: urls.get(r.thumb_path) ?? null,
    url: urls.get(r.storage_path) ?? null,
    width: r.width,
    height: r.height,
    createdAt: r.created_at,
    takenAt: r.taken_at,
    uploadedByName: r.uploaded_by ? (names.get(r.uploaded_by) ?? null) : null,
    mine: r.uploaded_by === viewerId,
    shared: r.customer_visible,
  }));

  const s = (summary.data ?? {}) as {
    total?: number;
    today?: number;
    this_week?: number;
    shared?: number;
  };

  return (
    <PhotosClient
      key={jobId}
      jobId={jobId}
      photos={items}
      total={photos.count ?? items.length}
      summary={{
        total: s.total ?? items.length,
        today: s.today ?? 0,
        thisWeek: s.this_week ?? 0,
        shared: s.shared ?? 0,
      }}
      shots={requiredShots(workTypes, areasByWorkType)}
      areaSuggestions={Object.values(areasByWorkType).flat()}
      contactFirstName={contactFirstName}
      can={can}
      limit={take}
    />
  );
}
