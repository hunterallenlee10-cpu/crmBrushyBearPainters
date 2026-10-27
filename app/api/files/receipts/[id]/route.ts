import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { logError } from "@/lib/log";

/**
 * A job expense's receipt: job_costing:read and a row the person can see
 * (row security), then the server streams it from the private bucket.
 */

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404 });
  if (!z.uuid().safeParse(id).success) return notFound();
  const state = await getViewerState();
  if (state.status !== "ok") return new NextResponse("Sign in first", { status: 401 });
  if (!state.viewer.can("job_costing:read")) return notFound();
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("job_expenses")
    .select("receipt_path, receipt_mime, description")
    .eq("id", id)
    .maybeSingle();
  if (!row?.receipt_path || !row.receipt_mime) return notFound();
  try {
    const service = await createSupabaseServiceClient({ actorId: state.viewer.id });
    const { data, error } = await service.storage.from("receipts").download(row.receipt_path);
    if (error || !data) return notFound();
    const bytes = Buffer.from(await data.arrayBuffer());
    const ext = row.receipt_mime === "application/pdf" ? "pdf" : "jpg";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.receipt_mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="receipt-${id.slice(0, 8)}.${ext}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    logError("receipts.file", e);
    return new NextResponse("We couldn't open that receipt. Try again.", { status: 500 });
  }
}
