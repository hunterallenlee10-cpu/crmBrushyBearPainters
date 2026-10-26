import { describe, expect, it } from "vitest";
import {
  QuickBooksOnlineProvider,
  createOutboxAccountingProvider,
  getAccountingProvider,
} from "@/lib/integrations/accounting";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import { createFakeFetch, jsonBody } from "@/lib/integrations/testing";

const invoice = {
  invoiceId: "inv-1",
  invoiceNumber: "1001",
  customerName: "Sample Customer",
  customerEmail: "customer@example.com",
  customerExternalId: "58",
  issueDate: "2026-11-01",
  dueDate: "2026-11-15",
  lines: [
    { description: "Interior walls – Sample", amountCents: 123456 },
    { description: "Trim – Sample", amountCents: 1999, itemExternalId: "7" },
  ],
};

const payment = {
  paymentId: "pay-1",
  invoiceId: "inv-1",
  invoiceExternalId: "130",
  customerExternalId: "58",
  amountCents: 50005,
  receivedDate: "2026-11-03",
  reference: "CHK-1",
};

describe("outbox accounting provider", () => {
  it("records accounting.sync_invoice with cents and a rendered summary", async () => {
    const sink = createMemoryOutboxSink();
    const result = await createOutboxAccountingProvider({ orgId: "org-1", sink }).syncInvoice(
      invoice,
    );
    expect(result).toEqual({ status: "simulated", outboxId: "outbox-1" });
    expect(sink.entries).toHaveLength(1);
    const entry = sink.entries[0];
    expect(entry).toMatchObject({
      domain: "accounting",
      operation: "accounting.sync_invoice",
      recipient: "customer@example.com",
      subject: "Invoice 1001",
      related: { type: "invoice", id: "inv-1" },
      payload: { invoiceId: "inv-1", totalCents: 125455 },
    });
    expect(entry?.renderedBody).toContain("Total: $1,254.55");
  });

  it("records accounting.sync_payment", async () => {
    const sink = createMemoryOutboxSink();
    const result = await createOutboxAccountingProvider({ orgId: "org-1", sink }).syncPayment(
      payment,
    );
    expect(result.status).toBe("simulated");
    expect(sink.entries[0]).toMatchObject({
      operation: "accounting.sync_payment",
      subject: "Payment $500.05",
      payload: { amountCents: 50005 },
      related: { type: "payment", id: "pay-1" },
    });
  });

  it("rejects non-integer cents", async () => {
    const provider = createOutboxAccountingProvider({ orgId: "o", sink: createMemoryOutboxSink() });
    await expect(provider.syncPayment({ ...payment, amountCents: 10.5 })).rejects.toThrow(/cents/);
  });
});

describe("QuickBooksOnlineProvider (disabled stub)", () => {
  const config = {
    accessToken: "qbo-token",
    realmId: "9130",
    environment: "sandbox" as const,
    defaultItemId: "1",
  };

  it("creates an invoice with decimal dollar amounts", async () => {
    const fetch = createFakeFetch({ json: { Invoice: { Id: "130", SyncToken: "0" }, time: "x" } });
    const result = await new QuickBooksOnlineProvider({ fetch, config }).syncInvoice(invoice);
    expect(result).toEqual({ status: "sent", externalId: "130", syncToken: "0" });
    const req = fetch.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/9130/invoice?minorversion=75",
    );
    expect(req?.headers.get("authorization")).toBe("Bearer qbo-token");
    expect(req?.headers.get("accept")).toBe("application/json");
    const body = jsonBody(req);
    expect(body).toMatchObject({
      CustomerRef: { value: "58" },
      DocNumber: "1001",
      TxnDate: "2026-11-01",
      DueDate: "2026-11-15",
      BillEmail: { Address: "customer@example.com" },
    });
    expect(body.Line).toEqual([
      {
        DetailType: "SalesItemLineDetail",
        Amount: 1234.56,
        Description: "Interior walls – Sample",
        SalesItemLineDetail: { ItemRef: { value: "1" } },
      },
      {
        DetailType: "SalesItemLineDetail",
        Amount: 19.99,
        Description: "Trim – Sample",
        SalesItemLineDetail: { ItemRef: { value: "7" } },
      },
    ]);
    expect(body).not.toHaveProperty("Id");
  });

  it("sends a sparse update when externalId and syncToken are set", async () => {
    const fetch = createFakeFetch({ json: { Invoice: { Id: "130", SyncToken: "1" } } });
    const qbo = new QuickBooksOnlineProvider({
      fetch,
      config: { ...config, environment: "production" },
    });
    const result = await qbo.syncInvoice({ ...invoice, externalId: "130", syncToken: "0" });
    expect(result.syncToken).toBe("1");
    expect(fetch.requests[0]?.url).toMatch(/^https:\/\/quickbooks\.api\.intuit\.com\//);
    expect(jsonBody(fetch.requests[0])).toMatchObject({ Id: "130", SyncToken: "0", sparse: true });
    expect(await qbo.syncInvoice({ ...invoice, externalId: "130" })).toMatchObject({
      status: "failed",
    });
  });

  it("creates a payment linked to the invoice", async () => {
    const fetch = createFakeFetch({ json: { Payment: { Id: "201", SyncToken: "0" } } });
    const result = await new QuickBooksOnlineProvider({ fetch, config }).syncPayment(payment);
    expect(result).toEqual({ status: "sent", externalId: "201", syncToken: "0" });
    expect(fetch.requests[0]?.url).toBe(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/9130/payment?minorversion=75",
    );
    expect(jsonBody(fetch.requests[0])).toEqual({
      CustomerRef: { value: "58" },
      TotalAmt: 500.05,
      TxnDate: "2026-11-03",
      PaymentRefNum: "CHK-1",
      Line: [{ Amount: 500.05, LinkedTxn: [{ TxnId: "130", TxnType: "Invoice" }] }],
    });
  });

  it("maps QuickBooks faults and unlinked customers to failed", async () => {
    const fetch = createFakeFetch({
      status: 400,
      json: {
        Fault: {
          Error: [
            {
              Message: "Object Not Found",
              Detail:
                "Object Not Found : Something you're trying to use has been made inactive or deleted.",
              code: "610",
            },
          ],
          type: "ValidationFault",
        },
      },
    });
    const qbo = new QuickBooksOnlineProvider({ fetch, config });
    const result = await qbo.syncInvoice(invoice);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/^HTTP 400: Object Not Found/);
    const unlinked = await qbo.syncInvoice({ ...invoice, customerExternalId: undefined });
    expect(unlinked).toEqual({
      status: "failed",
      error: "Customer is not linked to QuickBooks yet.",
    });
    expect(fetch.requests).toHaveLength(1);
  });
});

describe("getAccountingProvider", () => {
  it("only returns QuickBooks when fully allowed", () => {
    const ctx = { orgId: "org-1", sink: createMemoryOutboxSink() };
    const opts = {
      envProvider: "quickbooks_online",
      connectionStatus: "connected",
      fetch: createFakeFetch({}),
      credentials: {
        quickbooks_online: { accessToken: "t", realmId: "1", environment: "sandbox" as const },
      },
    };
    expect(getAccountingProvider(ctx).provider).toBe("outbox");
    expect(getAccountingProvider(ctx, opts).provider).toBe("outbox");
    expect(getAccountingProvider(ctx, { ...opts, locked: false })).toBeInstanceOf(
      QuickBooksOnlineProvider,
    );
  });
});
