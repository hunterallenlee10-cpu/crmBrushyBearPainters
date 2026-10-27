import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { DocumentItem } from "@/components/documents/document-list";

type Db = SupabaseClient<Database>;

/** Columns the document lists read (with the linked job and customer). */
export const DOCUMENT_COLUMNS =
  "id, title, file_name, category, mime_type, size_bytes, status, source, created_at, uploaded_by, job_id, account_id, job:jobs(job_number, name), account:accounts(display_name)";

type Row = {
  id: string;
  title: string;
  file_name: string;
  category: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  source: string;
  created_at: string;
  uploaded_by: string | null;
  job_id: string | null;
  account_id: string | null;
  job: { job_number: string; name: string } | null;
  account: { display_name: string } | null;
};

/** Rows → list items, with uploader names read through row security. */
export async function toDocumentItems(db: Db, rows: readonly Row[]): Promise<DocumentItem[]> {
  const ids = [...new Set(rows.map((r) => r.uploaded_by).filter((u): u is string => !!u))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await db.from("profiles").select("id, full_name").in("id", ids);
    for (const p of data ?? []) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    fileName: r.file_name,
    category: r.category,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    status: r.status,
    source: r.source,
    createdAt: r.created_at,
    uploadedByName: r.uploaded_by ? (names.get(r.uploaded_by) ?? null) : null,
    jobId: r.job_id,
    jobLabel: r.job ? `${r.job.job_number} · ${r.job.name}` : null,
    accountId: r.account_id,
    accountName: r.account?.display_name ?? null,
  }));
}
