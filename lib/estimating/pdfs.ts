import "server-only";
import { createElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ColorSheetDocument, InvoiceDocument } from "@/lib/pdf/other-documents";
import { ProposalDocument } from "@/lib/pdf/proposal-document";
import { renderPdf } from "@/lib/pdf/render";
import { loadChangeOrderView, loadEstimateView, loadJobContext } from "./proposal";
import { companyHeader, formatAddress } from "./proposal-view";

type Db = SupabaseClient<Database>;

/**
 * PDFs the office downloads (SPEC §7.6): the proposal (a draft preview or the
 * sent version), the color sheet and invoices. Callers check the person can
 * see the record with their own client first; these read with the service
 * client because the PDFs pull company settings and templates.
 */

export type RenderedPdf = { bytes: Buffer; fileName: string };

export async function estimatePdf(service: Db, versionId: string): Promise<RenderedPdf | null> {
  const data = await loadEstimateView(service, versionId, { previewDraft: true });
  if (!data) return null;
  const draft = data.version.status === "draft";
  const bytes = await renderPdf(createElement(ProposalDocument, { view: data.view }));
  const name = `${data.estimate.estimate_number}-v${data.version.version_no}${draft ? "-preview" : ""}.pdf`;
  return { bytes, fileName: name };
}

export async function changeOrderPdf(service: Db, coId: string): Promise<RenderedPdf | null> {
  const data = await loadChangeOrderView(service, coId);
  if (!data) return null;
  const bytes = await renderPdf(createElement(ProposalDocument, { view: data.view }));
  return { bytes, fileName: `${data.changeOrder.change_order_number}.pdf` };
}

function customerName(ctx: NonNullable<Awaited<ReturnType<typeof loadJobContext>>>): string {
  return (
    [ctx.customer.firstName, ctx.customer.lastName].filter(Boolean).join(" ") ||
    ctx.customer.accountName ||
    "Customer"
  );
}

export async function colorSheetPdf(service: Db, jobId: string): Promise<RenderedPdf | null> {
  const ctx = await loadJobContext(service, jobId);
  if (!ctx) return null;
  const [{ data: rows }, { data: products }, { data: brands }, { data: sheens }] =
    await Promise.all([
      service
        .from("color_selections")
        .select("*")
        .eq("job_id", jobId)
        .is("deleted_at", null)
        .order("sort_order"),
      service.from("paint_products").select("id, product").eq("org_id", ctx.job.org_id),
      service
        .from("picklist_values")
        .select("value, label, picklists!inner(key, org_id)")
        .eq("picklists.key", "paint_brand")
        .eq("picklists.org_id", ctx.job.org_id),
      service
        .from("picklist_values")
        .select("value, label, picklists!inner(key, org_id)")
        .eq("picklists.key", "sheen")
        .eq("picklists.org_id", ctx.job.org_id),
    ]);
  const productName = new Map((products ?? []).map((p) => [p.id, p.product]));
  const brandLabel = new Map((brands ?? []).map((b) => [b.value, b.label]));
  const sheenLabel = new Map((sheens ?? []).map((s) => [s.value, s.label]));
  const bytes = await renderPdf(
    createElement(ColorSheetDocument, {
      company: companyHeader(ctx.company),
      customerName: customerName(ctx),
      address: formatAddress(ctx.property),
      jobNumber: ctx.job.job_number,
      generatedAt: new Date().toISOString(),
      rows: (rows ?? []).map((r) => ({
        area: r.area,
        surface: r.surface,
        brand: r.brand ? (brandLabel.get(r.brand) ?? r.brand) : null,
        colorName: r.color_name,
        colorCode: r.color_code,
        sheen: r.sheen ? (sheenLabel.get(r.sheen) ?? r.sheen) : null,
        product: r.paint_product_id ? (productName.get(r.paint_product_id) ?? null) : null,
        notes: r.finish_notes,
        confirmed: r.status === "confirmed",
      })),
    }),
  );
  return { bytes, fileName: `${ctx.job.job_number}-color-sheet.pdf` };
}

export async function invoicePdf(service: Db, invoiceId: string): Promise<RenderedPdf | null> {
  const { data: inv } = await service
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return null;
  const ctx = await loadJobContext(service, inv.job_id);
  if (!ctx) return null;
  const { data: lines } = await service
    .from("invoice_lines")
    .select("description, quantity, amount_cents, sort_order")
    .eq("invoice_id", invoiceId)
    .order("sort_order");
  const bytes = await renderPdf(
    createElement(InvoiceDocument, {
      company: companyHeader(ctx.company),
      customerName: customerName(ctx),
      address: formatAddress(ctx.property),
      invoiceNumber: inv.invoice_number,
      invoiceType: inv.invoice_type,
      status: inv.status,
      issueDate: inv.issue_date,
      dueDate: inv.due_date,
      terms: inv.terms,
      jobNumber: ctx.job.job_number,
      lines: (lines ?? []).map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        amountCents: l.amount_cents,
      })),
      subtotalCents: inv.subtotal_cents,
      taxCents: inv.tax_cents,
      totalCents: inv.total_cents,
    }),
  );
  return { bytes, fileName: `${inv.invoice_number}.pdf` };
}
