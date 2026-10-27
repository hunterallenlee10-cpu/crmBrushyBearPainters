import { changeOrderPdf } from "@/lib/estimating/pdfs";
import { servePdf } from "@/lib/estimating/pdf-route";

type Ctx = { params: Promise<{ id: string; coId: string }> };

/** A sent or signed change order as a PDF. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, coId } = await params;
  return servePdf({
    name: "change_order",
    ids: [id, coId],
    permission: "estimates:read",
    visible: async (db) => {
      const { data } = await db
        .from("change_orders")
        .select("id, job_id")
        .eq("id", coId)
        .maybeSingle();
      return data?.job_id === id;
    },
    render: (service) => changeOrderPdf(service, coId),
  });
}
