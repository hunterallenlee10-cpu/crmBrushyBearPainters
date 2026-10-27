import { estimatePdf } from "@/lib/estimating/pdfs";
import { servePdf } from "@/lib/estimating/pdf-route";

type Ctx = { params: Promise<{ id: string; versionId: string }> };

/** The proposal PDF: a preview of a draft, or the version as it was sent. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, versionId } = await params;
  return servePdf({
    name: "estimate",
    ids: [id, versionId],
    permission: "estimates:read",
    visible: async (db) => {
      const { data } = await db
        .from("estimate_versions")
        .select("id, estimates!estimate_versions_estimate_id_fkey!inner(job_id)")
        .eq("id", versionId)
        .maybeSingle();
      return data?.estimates.job_id === id;
    },
    render: (service) => estimatePdf(service, versionId),
  });
}
