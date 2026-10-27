import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { downloadDocument } from "@/lib/estimating/documents";
import { logError } from "@/lib/log";

/**
 * A subcontractor compliance file (COI, L&I, W-9…): crews:manage and a row
 * the person can see (row security), then the server streams it. Always a
 * download; the bucket stays private.
 */

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404 });
  if (!z.uuid().safeParse(id).success) return notFound();
  const state = await getViewerState();
  if (state.status !== "ok") return new NextResponse("Sign in first", { status: 401 });
  if (!state.viewer.can("crews:manage")) return notFound();
  const supabase = await createSupabaseServerClient();
  const { data: doc } = await supabase
    .from("subcontractor_documents")
    .select("storage_path, file_name, mime_type")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return notFound();
  try {
    const service = await createSupabaseServiceClient({ actorId: state.viewer.id });
    const bytes = await downloadDocument(service, doc.storage_path);
    if (!bytes) return notFound();
    const ascii = doc.file_name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.mime_type,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    logError("subcontractors.file", e);
    return new NextResponse("We couldn't open that file. Try again.", { status: 500 });
  }
}
