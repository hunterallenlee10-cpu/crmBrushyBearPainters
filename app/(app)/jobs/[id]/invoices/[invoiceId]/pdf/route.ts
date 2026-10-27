import { invoicePdf } from "@/lib/estimating/pdfs";
import { servePdf } from "@/lib/estimating/pdf-route";

type Ctx = { params: Promise<{ id: string; invoiceId: string }> };

/** An invoice as a PDF (the deposit invoice in this phase). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, invoiceId } = await params;
  return servePdf({
    name: "invoice",
    ids: [id, invoiceId],
    permission: "invoices:read",
    visible: async (db) => {
      const { data } = await db
        .from("invoices")
        .select("id, job_id")
        .eq("id", invoiceId)
        .maybeSingle();
      return data?.job_id === id;
    },
    render: (service) => invoicePdf(service, invoiceId),
  });
}
