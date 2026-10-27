import { createElement } from "react";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { downloadDocument } from "@/lib/estimating/documents";
import { loadChangeOrderView, loadEstimateView, resolveToken } from "@/lib/estimating/proposal";
import { logError } from "@/lib/log";
import { ProposalDocument } from "@/lib/pdf/proposal-document";
import { pdfHeaders, renderPdf } from "@/lib/pdf/render";
import { consumeProposalLimit, PROPOSAL_LIMITS } from "../limits";

type Ctx = { params: Promise<{ token: string }> };

const notFound = () => new NextResponse("Not found", { status: 404 });

/**
 * The customer's PDF: the signed copy once accepted, otherwise the proposal as
 * sent. The link token is the credential; rate limited per address.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { token } = await params;
  try {
    const service = await createSupabaseServiceClient();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!(await consumeProposalLimit(service, `pdf:ip:${ip}`, PROPOSAL_LIMITS.pdfPerIp))) {
      return new NextResponse("Too many requests", { status: 429 });
    }
    const t = await resolveToken(service, token);
    if (!t || t.revoked) return notFound();
    const data = t.estimate_version_id
      ? await loadEstimateView(service, t.estimate_version_id)
      : t.change_order_id
        ? await loadChangeOrderView(service, t.change_order_id)
        : null;
    if (!data) return notFound();
    const name =
      "estimate" in data
        ? `${data.estimate.estimate_number}-v${data.version.version_no}`
        : data.changeOrder.change_order_number;
    if (data.signatureDocumentId) {
      const { data: doc } = await service
        .from("documents")
        .select("storage_path")
        .eq("id", data.signatureDocumentId)
        .maybeSingle();
      const bytes = doc ? await downloadDocument(service, doc.storage_path) : null;
      if (bytes) {
        return new NextResponse(new Uint8Array(bytes), {
          headers: pdfHeaders(`${name}-signed.pdf`, "attachment"),
        });
      }
    }
    const bytes = await renderPdf(
      createElement(ProposalDocument, { view: { ...data.view, contract: null } }),
    );
    return new NextResponse(new Uint8Array(bytes), { headers: pdfHeaders(`${name}.pdf`) });
  } catch (e) {
    logError("proposal.pdf", e);
    return new NextResponse("We couldn't build that PDF. Try again.", { status: 500 });
  }
}
