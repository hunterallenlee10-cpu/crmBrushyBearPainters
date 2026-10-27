import { downloadDocument } from "@/lib/estimating/documents";
import { servePdf } from "@/lib/estimating/pdf-route";

type Ctx = { params: Promise<{ id: string; documentId: string }> };

/** A stored document (e.g. the signed proposal), after the person's row-security check. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, documentId } = await params;
  let path: string | null = null;
  let fileName = "document.pdf";
  return servePdf({
    name: "document",
    ids: [id, documentId],
    permission: "documents:read",
    visible: async (db) => {
      const { data } = await db
        .from("documents")
        .select("id, job_id, storage_path, file_name, mime_type")
        .eq("id", documentId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!data || data.job_id !== id || data.mime_type !== "application/pdf") return false;
      path = data.storage_path;
      fileName = data.file_name;
      return true;
    },
    render: async (service) => {
      if (!path) return null;
      const bytes = await downloadDocument(service, path);
      return bytes ? { bytes, fileName } : null;
    },
  });
}
