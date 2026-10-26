// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import {
  type AccountingInvoiceInput,
  type AccountingPaymentInput,
  type AccountingProvider,
  type AccountingSyncResult,
} from "@/lib/integrations/accounting/types";
import { centsToDecimal } from "@/lib/integrations/core";
import { getRecord, getString, requestJson } from "@/lib/integrations/http";

export type QuickBooksOnlineConfig = {
  /** OAuth 2.0 access token (com.intuit.quickbooks.accounting scope). */
  accessToken: string;
  /** Company id ("realmId") returned by the OAuth connect flow. */
  realmId: string;
  environment: "sandbox" | "production";
  /** API minor version. Defaults to 75. */
  minorVersion?: number;
  /** Item used for lines without an itemExternalId (e.g. a "Painting services" item). */
  defaultItemId?: string;
};

const HOSTS = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
  production: "https://quickbooks.api.intuit.com",
} as const;

export class QuickBooksOnlineProvider implements AccountingProvider {
  readonly provider = "quickbooks_online";
  private readonly fetch: typeof fetch;
  private readonly config: QuickBooksOnlineConfig;

  constructor(options: { fetch: typeof fetch; config: QuickBooksOnlineConfig }) {
    if (!options.config.accessToken || !options.config.realmId) {
      throw new Error("QuickBooks Online needs accessToken and realmId.");
    }
    this.fetch = options.fetch;
    this.config = options.config;
  }

  private url(entity: "invoice" | "payment"): string {
    const host = HOSTS[this.config.environment];
    const minor = this.config.minorVersion ?? 75;
    return `${host}/v3/company/${encodeURIComponent(this.config.realmId)}/${entity}?minorversion=${minor}`;
  }

  private async post(
    entity: "invoice" | "payment",
    responseKey: "Invoice" | "Payment",
    body: Record<string, unknown>,
  ): Promise<AccountingSyncResult> {
    const res = await requestJson(this.fetch, this.url(entity), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { status: "failed", error: res.error };
    const record = getRecord(res.data, responseKey);
    return {
      status: "sent",
      externalId: getString(record, "Id"),
      syncToken: getString(record, "SyncToken"),
    };
  }

  async syncInvoice(invoice: AccountingInvoiceInput): Promise<AccountingSyncResult> {
    if (!invoice.customerExternalId) {
      return { status: "failed", error: "Customer is not linked to QuickBooks yet." };
    }
    if (invoice.externalId && !invoice.syncToken) {
      return { status: "failed", error: "syncToken is required to update a QuickBooks invoice." };
    }
    const lines = invoice.lines.map((line) => {
      const itemId = line.itemExternalId ?? this.config.defaultItemId;
      return {
        DetailType: "SalesItemLineDetail",
        Amount: centsToDecimal(line.amountCents),
        Description: line.description,
        SalesItemLineDetail: itemId ? { ItemRef: { value: itemId } } : {},
      };
    });
    const body: Record<string, unknown> = {
      CustomerRef: { value: invoice.customerExternalId },
      DocNumber: invoice.invoiceNumber,
      TxnDate: invoice.issueDate,
      Line: lines,
      PrivateNote: `Brushy Bear CRM invoice ${invoice.invoiceId}`,
    };
    if (invoice.dueDate) body.DueDate = invoice.dueDate;
    if (invoice.customerEmail) body.BillEmail = { Address: invoice.customerEmail };
    if (invoice.externalId) {
      body.Id = invoice.externalId;
      body.SyncToken = invoice.syncToken;
      body.sparse = true;
    }
    return this.post("invoice", "Invoice", body);
  }

  async syncPayment(payment: AccountingPaymentInput): Promise<AccountingSyncResult> {
    if (!payment.customerExternalId) {
      return { status: "failed", error: "Customer is not linked to QuickBooks yet." };
    }
    const amount = centsToDecimal(payment.amountCents);
    const body: Record<string, unknown> = {
      CustomerRef: { value: payment.customerExternalId },
      TotalAmt: amount,
      TxnDate: payment.receivedDate,
    };
    if (payment.reference) body.PaymentRefNum = payment.reference;
    if (payment.invoiceExternalId) {
      body.Line = [
        { Amount: amount, LinkedTxn: [{ TxnId: payment.invoiceExternalId, TxnType: "Invoice" }] },
      ];
    }
    return this.post("payment", "Payment", body);
  }
}
