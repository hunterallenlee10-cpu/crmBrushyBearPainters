import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { logError } from "@/lib/log";
import { processPhoto, UnreadablePhotoError } from "@/lib/photos/process";
import { expenseSchema } from "@/lib/validation/money";

/**
 * A job expense with its receipt (SPEC §5.6 job costs: "other expenses
 * (receipts with photo)"). Owners and the bookkeeper (job_costing:read).
 * Receipt photos are re-encoded (EXIF incl. GPS dropped) and stored in the
 * private "receipts" bucket; PDFs are stored as they are. The row is inserted
 * with the person's own client, so row security proves they may add it.
 */

export const dynamic = "force-dynamic";

const RECEIPTS_BUCKET = "receipts";
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BYTES = 4 * 1024 * 1024;

const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!z.uuid().safeParse(jobId).success) return json(404, { error: "That job isn't available." });
  const state = await getViewerState();
  if (state.status !== "ok") return json(401, { error: "Sign in again." });
  const viewer = state.viewer;
  if (viewer.impersonating) {
    return json(403, { error: "You're viewing as another user. Exit View as user first." });
  }
  if (!viewer.can("job_costing:read")) {
    return json(403, { error: "Only owners and the bookkeeper record job costs." });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "The upload was incomplete. Try again." });
  }
  const parsed = expenseSchema.safeParse({
    jobId,
    category: field(form, "category"),
    description: field(form, "description"),
    vendor: field(form, "vendor"),
    amount: field(form, "amount"),
    spentOn: field(form, "spentOn"),
  });
  if (!parsed.success) {
    return json(400, { error: parsed.error.issues[0]?.message ?? "Some details aren't valid." });
  }
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, org_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return json(404, { error: "That job isn't available." });

  const file = form.get("receipt");
  let receipt: { bytes: Buffer; mime: "image/jpeg" | "application/pdf" } | null = null;
  if (file instanceof Blob && file.size > 0) {
    if (file.size > MAX_BYTES) return json(413, { error: "That receipt is too large (4 MB max)." });
    const raw = Buffer.from(await file.arrayBuffer());
    if (file.type === "application/pdf") {
      if (raw.subarray(0, 5).toString("latin1") !== "%PDF-") {
        return json(415, { error: "That file isn't a readable PDF." });
      }
      receipt = { bytes: raw, mime: "application/pdf" };
    } else if (PHOTO_TYPES.includes(file.type)) {
      try {
        receipt = { bytes: (await processPhoto(raw)).display, mime: "image/jpeg" };
      } catch (e) {
        if (e instanceof UnreadablePhotoError) {
          return json(415, { error: "We couldn't read that photo. Try another one." });
        }
        throw e;
      }
    } else {
      return json(415, { error: "Upload a photo (JPEG, PNG, WebP) or a PDF." });
    }
  }

  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const expenseId = randomUUID();
  let path: string | null = null;
  if (receipt) {
    path = `${job.org_id}/${jobId}/${expenseId}.${receipt.mime === "application/pdf" ? "pdf" : "jpg"}`;
    const up = await service.storage
      .from(RECEIPTS_BUCKET)
      .upload(path, receipt.bytes, { contentType: receipt.mime, upsert: false });
    if (up.error) {
      logError("expenses.upload", up.error);
      return json(500, { error: "We couldn't store the receipt. Try again." });
    }
  }
  const { error } = await supabase.from("job_expenses").insert({
    id: expenseId,
    org_id: job.org_id,
    job_id: jobId,
    category: v.category,
    description: v.description,
    vendor: v.vendor,
    amount_cents: v.amount,
    spent_on: v.spentOn,
    receipt_path: path,
    receipt_mime: receipt?.mime ?? null,
    receipt_bytes: receipt?.bytes.length ?? null,
  });
  if (error) {
    if (path) await service.storage.from(RECEIPTS_BUCKET).remove([path]);
    logError("expenses.insert", error);
    return json(error.code === "42501" ? 403 : 400, {
      error:
        error.code === "42501"
          ? "You can't add costs to this job."
          : "We couldn't save that expense.",
    });
  }
  return json(201, { ok: true, id: expenseId });
}
