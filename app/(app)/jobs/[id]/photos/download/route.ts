import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { PHOTO_CATEGORY_LABELS, isPhotoCategory } from "@/lib/domain/photos";
import { logError } from "@/lib/log";
import { downloadPhoto } from "@/lib/photos/storage";
import { buildZip, uniqueNames } from "@/lib/zip";

/** Download selected photos as one zip (SPEC §8.5 #6), after the person's row-security check. */

export const dynamic = "force-dynamic";
const MAX = 100;

const notFound = () => new NextResponse("Not found", { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ids = (request.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (!z.uuid().safeParse(id).success || !ids.length || ids.length > MAX) return notFound();
  if (!ids.every((x) => z.uuid().safeParse(x).success)) return notFound();
  const state = await getViewerState();
  if (state.status !== "ok") return new NextResponse("Sign in first", { status: 401 });
  if (!state.viewer.can("photos:read")) return notFound();
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("job_photos")
    .select("id, category, area, storage_path, created_at, job:jobs(job_number)")
    .eq("job_id", id)
    .in("id", ids)
    .order("created_at");
  if (!rows?.length) return notFound();
  try {
    const service = await createSupabaseServiceClient({ actorId: state.viewer.id });
    const files = await Promise.all(rows.map((r) => downloadPhoto(service, r.storage_path)));
    const names = uniqueNames(
      rows.map((r) => {
        const cat = isPhotoCategory(r.category) ? PHOTO_CATEGORY_LABELS[r.category] : "Photo";
        return `${[cat, r.area].filter(Boolean).join(" - ")}.jpg`;
      }),
    );
    const zip = buildZip(
      rows.flatMap((r, i) => {
        const data = files[i];
        return data
          ? [{ name: names[i] ?? `photo-${i + 1}.jpg`, data, date: new Date(r.created_at) }]
          : [];
      }),
    );
    const jobNumber = rows[0]?.job?.job_number ?? "job";
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${jobNumber}-photos.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    logError("photos.zip", e);
    return new NextResponse("We couldn't build that download. Try again.", { status: 500 });
  }
}
