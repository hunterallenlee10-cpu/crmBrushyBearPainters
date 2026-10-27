import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import {
  DocuSignProvider,
  DropboxSignProvider,
  createBuiltinESignProvider,
  getESignProvider,
} from "@/lib/integrations/esign";
import { createFakeFetch, jsonBody } from "@/lib/integrations/testing";

const pdf = Buffer.from("%PDF-1.7 sample");
const envelope = {
  documentName: "Proposal 1001",
  documentBase64: pdf.toString("base64"),
  signers: [{ name: "Sample Customer", email: "customer@example.com", role: "customer" }],
  subject: "Please sign your proposal",
  message: "Thanks!",
};

describe("builtin (BearSign) provider", () => {
  it("records esign.create_envelope without the raw PDF", async () => {
    const sink = createMemoryOutboxSink();
    const provider = createBuiltinESignProvider({ orgId: "org-1", sink });
    expect(provider.provider).toBe("builtin");
    const result = await provider.createEnvelope({
      ...envelope,
      related: { type: "estimate", id: "e1" },
    });
    expect(result).toEqual({ status: "simulated", outboxId: "outbox-1" });
    expect(sink.entries).toHaveLength(1);
    const entry = sink.entries[0];
    expect(entry).toMatchObject({
      domain: "esign",
      provider: "builtin",
      operation: "esign.create_envelope",
      recipient: "customer@example.com",
      subject: "Please sign your proposal",
      related: { type: "estimate", id: "e1" },
      payload: {
        documentName: "Proposal 1001",
        signers: envelope.signers,
        documentBytes: pdf.length,
        documentSha256: createHash("sha256").update(pdf).digest("hex"),
      },
    });
    expect(entry?.payload).not.toHaveProperty("documentBase64");
    expect(entry?.renderedBody).toContain("Sample Customer <customer@example.com> (customer)");
  });

  it("getStatus is not connected (no real e-signature provider)", async () => {
    const provider = createBuiltinESignProvider({ orgId: "o", sink: createMemoryOutboxSink() });
    expect(await provider.getStatus("x")).toMatchObject({ connected: false });
  });
});

describe("DocuSignProvider (disabled stub)", () => {
  const config = {
    accessToken: "ds-token",
    accountId: "acc-guid",
    basePath: "https://demo.docusign.net/restapi/",
  };

  it("creates and sends an envelope", async () => {
    const fetch = createFakeFetch({
      status: 201,
      json: { envelopeId: "env-1", status: "sent", uri: "/envelopes/env-1" },
    });
    const result = await new DocuSignProvider({ fetch, config }).createEnvelope(envelope);
    expect(result).toEqual({ status: "sent", envelopeId: "env-1" });
    const req = fetch.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe("https://demo.docusign.net/restapi/v2.1/accounts/acc-guid/envelopes");
    expect(req?.headers.get("authorization")).toBe("Bearer ds-token");
    expect(jsonBody(req)).toEqual({
      emailSubject: "Please sign your proposal",
      emailBlurb: "Thanks!",
      documents: [
        {
          documentId: "1",
          name: "Proposal 1001",
          fileExtension: "pdf",
          documentBase64: envelope.documentBase64,
        },
      ],
      recipients: {
        signers: [
          {
            recipientId: "1",
            routingOrder: "1",
            name: "Sample Customer",
            email: "customer@example.com",
            roleName: "customer",
          },
        ],
      },
      status: "sent",
    });
  });

  it("parses envelope status", async () => {
    const fetch = createFakeFetch({
      json: { envelopeId: "env-1", status: "completed", completedDateTime: "2026-11-02T18:00:00Z" },
    });
    const result = await new DocuSignProvider({ fetch, config }).getStatus("env-1");
    expect(result).toEqual({
      connected: true,
      state: "completed",
      providerStatus: "completed",
      completedAt: "2026-11-02T18:00:00Z",
    });
    expect(fetch.requests[0]?.method).toBe("GET");
    expect(fetch.requests[0]?.url).toBe(
      "https://demo.docusign.net/restapi/v2.1/accounts/acc-guid/envelopes/env-1",
    );
  });

  it("maps errors", async () => {
    const fetch = createFakeFetch({
      status: 400,
      json: {
        errorCode: "INVALID_EMAIL_ADDRESS_FOR_RECIPIENT",
        message: "The email address for the recipient is invalid.",
      },
    });
    const ds = new DocuSignProvider({ fetch, config });
    expect(await ds.createEnvelope(envelope)).toEqual({
      status: "failed",
      error: "HTTP 400: The email address for the recipient is invalid.",
    });
    expect(await ds.getStatus("env-1")).toMatchObject({ connected: true, state: "unknown" });
  });
});

describe("DropboxSignProvider (disabled stub)", () => {
  const config = { apiKey: "dbs-key" };

  it("sends a multipart signature request in test mode", async () => {
    const fetch = createFakeFetch({
      json: { signature_request: { signature_request_id: "sr-1", is_complete: false } },
    });
    const result = await new DropboxSignProvider({ fetch, config }).createEnvelope(envelope);
    expect(result).toEqual({ status: "sent", envelopeId: "sr-1" });
    const req = fetch.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe("https://api.hellosign.com/v3/signature_request/send");
    expect(req?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("dbs-key:").toString("base64")}`,
    );
    expect(req?.body).toBeInstanceOf(FormData);
    const form = req?.body as FormData;
    expect(form.get("title")).toBe("Proposal 1001");
    expect(form.get("subject")).toBe("Please sign your proposal");
    expect(form.get("test_mode")).toBe("1");
    expect(form.get("signers[0][name]")).toBe("Sample Customer");
    expect(form.get("signers[0][email_address]")).toBe("customer@example.com");
    const file = form.get("files[0]");
    expect(file).toBeInstanceOf(Blob);
    expect(Buffer.from(await (file as Blob).arrayBuffer()).equals(pdf)).toBe(true);
  });

  it("parses status", async () => {
    const complete = createFakeFetch({
      json: { signature_request: { is_complete: true, is_declined: false, signatures: [] } },
    });
    expect(
      await new DropboxSignProvider({ fetch: complete, config }).getStatus("sr-1"),
    ).toMatchObject({
      connected: true,
      state: "completed",
    });
    const viewed = createFakeFetch({
      json: {
        signature_request: {
          is_complete: false,
          is_declined: false,
          signatures: [{ last_viewed_at: 1790000000 }],
        },
      },
    });
    expect(
      await new DropboxSignProvider({ fetch: viewed, config }).getStatus("sr-1"),
    ).toMatchObject({
      state: "delivered",
    });
    expect(viewed.requests[0]?.url).toBe("https://api.hellosign.com/v3/signature_request/sr-1");
  });

  it("maps errors", async () => {
    const fetch = createFakeFetch({
      status: 401,
      json: { error: { error_msg: "Unauthorized api key", error_name: "unauthorized" } },
    });
    expect(await new DropboxSignProvider({ fetch, config }).createEnvelope(envelope)).toEqual({
      status: "failed",
      error: "HTTP 401: Unauthorized api key",
    });
  });
});

describe("getESignProvider", () => {
  it("defaults to builtin and only returns real providers when fully allowed", () => {
    const ctx = { orgId: "org-1", sink: createMemoryOutboxSink() };
    const base = {
      connectionStatus: "connected",
      fetch: createFakeFetch({}),
      credentials: {
        docusign: {
          accessToken: "t",
          accountId: "a",
          basePath: "https://demo.docusign.net/restapi",
        },
        dropbox_sign: { apiKey: "k" },
      },
    };
    expect(getESignProvider(ctx).provider).toBe("builtin");
    expect(getESignProvider(ctx, { ...base, envProvider: "docusign" }).provider).toBe("builtin");
    expect(
      getESignProvider(ctx, { ...base, envProvider: "docusign", locked: false }),
    ).toBeInstanceOf(DocuSignProvider);
    expect(
      getESignProvider(ctx, { ...base, envProvider: "dropbox_sign", locked: false }),
    ).toBeInstanceOf(DropboxSignProvider);
  });
});
