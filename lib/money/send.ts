import "server-only";
import type { ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { invoicePdf } from "@/lib/estimating/pdfs";
import { storeGeneratedDocument } from "@/lib/estimating/documents";
import { checkChannels, type Channel } from "@/lib/estimating/send";
import { loadMessagingJob, sendJobMessage } from "@/lib/jobs/send";
import { logError } from "@/lib/log";
import { previewInvoiceSync } from "./accounting";
import { afterMoneyChange } from "./automation";
import { INVOICE_TEMPLATE_KEY } from "./messages";

/**
 * Sending an invoice (SPEC §10, §8.5 #5): mark it sent (the database checks
 * the closed-month lock and permission again), store the PDF in the job's
 * Documents, text and/or email the customer through the outbox (simulated,
 * the PDF goes with the email), record the "would sync" accounting preview,
 * then let the money gates move the job (Completed → Invoiced → Paid in Full).
 */
export async function sendInvoice(
  ctx: ActionContext,
  input: {
    invoiceId: string;
    issueDate: string;
    dueDate: string;
    channels: readonly Channel[];
    smsBody: string | null;
    emailSubject: string | null;
    emailBody: string | null;
    overrideReason: string | null;
  },
): Promise<{ documentId: string | null; stageMoves: number }> {
  const inv = check(
    await ctx.supabase
      .from("invoices")
      .select("id, job_id, org_id, invoice_number, status, total_cents")
      .eq("id", input.invoiceId)
      .maybeSingle(),
  );
  if (!inv) throw new ActionFailure(actionError("not_found", "That invoice isn't available."));
  if (inv.status === "void") {
    throw new ActionFailure(actionError("validation", "A void invoice can't be sent."));
  }
  if (input.channels.length) {
    checkChannels(await loadMessagingJob(ctx, inv.job_id), input.channels);
  }
  if (input.channels.includes("sms") && !input.smsBody) {
    throw new ActionFailure(actionError("validation", "Write the text message."));
  }
  if (input.channels.includes("email") && !input.emailBody) {
    throw new ActionFailure(actionError("validation", "Write the email."));
  }

  const service = await ctx.service();
  const { error } = await service.rpc("mark_invoice_sent", {
    p_invoice: inv.id,
    p_issue_date: input.issueDate,
    p_due_date: input.dueDate,
    p_override_reason: input.overrideReason ?? undefined,
  });
  if (error) throw new ActionFailure(mapDbError(error));

  // The PDF (now marked sent) goes to Documents → Invoices & Receipts.
  let documentId: string | null = null;
  try {
    const pdf = await invoicePdf(service, inv.id);
    if (pdf) {
      const doc = await storeGeneratedDocument(service, {
        orgId: inv.org_id,
        jobId: inv.job_id,
        category: "invoice",
        title: `Invoice ${inv.invoice_number}`,
        fileName: pdf.fileName,
        bytes: pdf.bytes,
        relatedType: "invoice",
        relatedId: inv.id,
        customerVisible: true,
      });
      documentId = doc.id;
      await service.from("invoices").update({ pdf_document_id: doc.id }).eq("id", inv.id);
    }
  } catch (e) {
    logError("money.send.pdf", e);
  }

  for (const channel of input.channels) {
    await sendJobMessage(ctx, inv.job_id, {
      channel,
      subject: channel === "email" ? (input.emailSubject ?? undefined) : undefined,
      body: (channel === "sms" ? input.smsBody : input.emailBody) ?? "",
      templateKey: INVOICE_TEMPLATE_KEY,
      attachments:
        channel === "email" && documentId
          ? [
              {
                fileName: `${inv.invoice_number}.pdf`,
                documentId,
                contentType: "application/pdf",
              },
            ]
          : undefined,
    });
  }

  await previewInvoiceSync(service, inv.id, ctx.viewer.id);
  const before = check(
    await service.from("jobs").select("stage").eq("id", inv.job_id).maybeSingle(),
  );
  await afterMoneyChange(service, inv.job_id);
  const after = check(
    await service.from("jobs").select("stage").eq("id", inv.job_id).maybeSingle(),
  );
  return { documentId, stageMoves: before?.stage !== after?.stage ? 1 : 0 };
}
