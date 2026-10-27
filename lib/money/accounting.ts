import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { serverEnv } from "@/lib/env";
import { getAccountingProvider } from "@/lib/integrations/accounting";
import { createSupabaseOutboxSink } from "@/lib/integrations/outbox-sink";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

/**
 * Accounting sync (SPEC §10): QuickBooks is not connected, so every sent
 * invoice and recorded payment writes a "would sync" preview to the outbox
 * (status `simulated`) and the record keeps accounting status "Not
 * connected". No `fetch` is passed, so even a misconfigured real provider
 * couldn't call out. Best effort: a failed preview never blocks the money.
 */

async function context(service: Db, orgId: string, actorId: string | null) {
  const { data } = await service
    .from("integration_connections")
    .select("status")
    .eq("org_id", orgId)
    .eq("domain", "accounting")
    .maybeSingle();
  return getAccountingProvider(
    { orgId, actorId, sink: createSupabaseOutboxSink(service) },
    {
      connectionStatus: data?.status ?? null,
      envProvider: serverEnv().INTEGRATION_ACCOUNTING_PROVIDER,
    },
  );
}

export async function previewInvoiceSync(
  service: Db,
  invoiceId: string,
  actorId: string | null,
): Promise<string | null> {
  try {
    const { data: inv } = await service
      .from("invoices")
      .select(
        "id, org_id, invoice_number, issue_date, due_date, external_id, account:accounts(display_name), job:jobs!invoices_job_id_fkey(contact:contacts!jobs_primary_contact_id_fkey(email))",
      )
      .eq("id", invoiceId)
      .maybeSingle();
    if (!inv) return null;
    const { data: lines } = await service
      .from("invoice_lines")
      .select("description, amount_cents")
      .eq("invoice_id", invoiceId)
      .order("sort_order");
    const provider = await context(service, inv.org_id, actorId);
    const result = await provider.syncInvoice({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      customerName: inv.account?.display_name ?? "Customer",
      customerEmail: inv.job?.contact?.email ?? undefined,
      issueDate: inv.issue_date ?? new Date().toISOString().slice(0, 10),
      dueDate: inv.due_date ?? undefined,
      externalId: inv.external_id ?? undefined,
      lines: (lines ?? []).map((l) => ({
        description: l.description,
        amountCents: l.amount_cents,
      })),
      related: { type: "invoice", id: inv.id },
    });
    return result.outboxId ?? null;
  } catch (e) {
    logError("money.accounting.invoice", e);
    return null;
  }
}

export async function previewPaymentSync(
  service: Db,
  paymentId: string,
  actorId: string | null,
): Promise<number> {
  try {
    const { data: p } = await service
      .from("payments")
      .select("id, org_id, method, received_on, reference")
      .eq("id", paymentId)
      .maybeSingle();
    if (!p) return 0;
    const { data: apps } = await service
      .from("payment_applications")
      .select("invoice_id, amount_cents, invoice:invoices(external_id)")
      .eq("payment_id", paymentId);
    const provider = await context(service, p.org_id, actorId);
    let n = 0;
    for (const a of apps ?? []) {
      await provider.syncPayment({
        paymentId: p.id,
        invoiceId: a.invoice_id,
        invoiceExternalId: a.invoice?.external_id ?? undefined,
        amountCents: a.amount_cents,
        receivedDate: p.received_on,
        method: p.method,
        reference: p.reference ?? undefined,
        related: { type: "payment", id: p.id },
      });
      n++;
    }
    return n;
  } catch (e) {
    logError("money.accounting.payment", e);
    return 0;
  }
}
