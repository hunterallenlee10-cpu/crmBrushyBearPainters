import { colorSheetPdf } from "@/lib/estimating/pdfs";
import { servePdf } from "@/lib/estimating/pdf-route";

type Ctx = { params: Promise<{ id: string }> };

/** The job's color sheet for the crew and the paint store. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return servePdf({
    name: "color_sheet",
    ids: [id],
    permission: "jobs:read",
    visible: async (db) => {
      const { data } = await db.from("jobs").select("id").eq("id", id).maybeSingle();
      return !!data;
    },
    render: (service) => colorSheetPdf(service, id),
  });
}
