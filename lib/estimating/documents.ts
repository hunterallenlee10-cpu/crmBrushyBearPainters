import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

type Db = SupabaseClient<Database>;
type Category = Database["public"]["Tables"]["documents"]["Row"]["category"];

/**
 * Documents in the private "documents" bucket (SPEC §8.5 #7, §13.1). Files are
 * written by trusted server code and read through short-lived signed URLs after
 * the person's row-security check on `documents`.
 */

export const DOCUMENTS_BUCKET = "documents";
export const SIGNED_URL_SECONDS = 60;

export function documentPath(orgId: string, jobId: string, fileName: string): string {
  const safe = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 120);
  return `${orgId}/jobs/${jobId}/${randomUUID()}-${safe}`;
}

export async function storeGeneratedDocument(
  service: Db,
  input: {
    orgId: string;
    jobId: string;
    category: Category;
    title: string;
    fileName: string;
    bytes: Buffer;
    status?: "active" | "awaiting_signature" | "signed" | "superseded";
    relatedType?: "estimate_version" | "change_order" | "invoice" | "signature";
    relatedId?: string;
    signatureId?: string | null;
    customerVisible?: boolean;
  },
): Promise<{ id: string; path: string }> {
  const path = documentPath(input.orgId, input.jobId, input.fileName);
  const upload = await service.storage.from(DOCUMENTS_BUCKET).upload(path, input.bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upload.error) throw upload.error;
  const { data, error } = await service
    .from("documents")
    .insert({
      org_id: input.orgId,
      job_id: input.jobId,
      category: input.category,
      title: input.title.slice(0, 200),
      file_name: input.fileName.slice(0, 200),
      storage_path: path,
      mime_type: "application/pdf",
      size_bytes: input.bytes.length,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      source: "generated",
      status: input.status ?? "active",
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
      signature_id: input.signatureId ?? null,
      customer_visible: input.customerVisible ?? false,
    })
    .select("id")
    .single();
  if (error) {
    await service.storage.from(DOCUMENTS_BUCKET).remove([path]);
    throw error;
  }
  return { id: data.id, path };
}

/** A short-lived link to a document's file (call only after a permission check). */
export async function signedDocumentUrl(
  service: Db,
  path: string,
  seconds = SIGNED_URL_SECONDS,
  download?: string,
): Promise<string | null> {
  const { data, error } = await service.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, seconds, download ? { download } : undefined);
  if (error) return null;
  return data.signedUrl;
}

export async function downloadDocument(service: Db, path: string): Promise<Buffer | null> {
  const { data, error } = await service.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
