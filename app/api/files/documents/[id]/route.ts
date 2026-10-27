import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { previewKind } from "@/lib/domain/documents";
import { downloadDocument } from "@/lib/estimating/documents";
import { logError } from "@/lib/log";

/**
 * A stored document's file (SPEC §8.5 #7, §13.1): signed in, documents:read,
 * and the person can see the row (row security, so crew never get money
 * documents); then the server streams it. PDFs and photos open inline for
 * preview (framable by our own pages only); everything else downloads.
 */

export const dynamic = "force-dynamic";

const notFound = () => new NextResponse("Not found", { status: 404 });

function disposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return notFound();
  const state = await getViewerState();
  if (state.status !== "ok") return new NextResponse("Sign in first", { status: 401 });
  if (!state.viewer.can("documents:read")) return notFound();
  const supabase = await createSupabaseServerClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path, file_name, mime_type")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return notFound();
  try {
    const service = await createSupabaseServiceClient({ actorId: state.viewer.id });
    const bytes = await downloadDocument(service, doc.storage_path);
    if (!bytes) return notFound();
    const inline =
      request.nextUrl.searchParams.get("download") !== "1" && previewKind(doc.mime_type) !== "none";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.mime_type,
        "Content-Length": String(bytes.length),
        "Content-Disposition": disposition(inline ? "inline" : "attachment", doc.file_name),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    logError("documents.file", e);
    return new NextResponse("We couldn't open that file. Try again.", { status: 500 });
  }
}
