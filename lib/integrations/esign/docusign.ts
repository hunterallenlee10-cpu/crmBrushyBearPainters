// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import {
  type CreateEnvelopeInput,
  type CreateEnvelopeResult,
  type ESignProvider,
  type EnvelopeState,
  type EnvelopeStatusResult,
} from "@/lib/integrations/esign/types";
import { getString, requestJson } from "@/lib/integrations/http";

export type DocuSignConfig = {
  /** OAuth access token (JWT grant or auth-code). Obtaining it is the connect flow's job. */
  accessToken: string;
  /** API account id (GUID) from /oauth/userinfo. */
  accountId: string;
  /** e.g. https://demo.docusign.net/restapi (developer) or the account's base_uri + /restapi. */
  basePath: string;
};

function mapState(status: string | undefined): EnvelopeState {
  switch (status) {
    case "sent":
    case "delivered":
    case "completed":
    case "declined":
    case "voided":
      return status;
    default:
      return "unknown";
  }
}

export class DocuSignProvider implements ESignProvider {
  readonly provider = "docusign";
  private readonly fetch: typeof fetch;
  private readonly config: DocuSignConfig;

  constructor(options: { fetch: typeof fetch; config: DocuSignConfig }) {
    const { accessToken, accountId, basePath } = options.config;
    if (!accessToken || !accountId || !basePath) {
      throw new Error("DocuSign needs accessToken, accountId and basePath.");
    }
    this.fetch = options.fetch;
    this.config = { ...options.config, basePath: basePath.replace(/\/+$/, "") };
  }

  private envelopesUrl(envelopeId?: string): string {
    const base = `${this.config.basePath}/v2.1/accounts/${encodeURIComponent(this.config.accountId)}/envelopes`;
    return envelopeId ? `${base}/${encodeURIComponent(envelopeId)}` : base;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async createEnvelope(input: CreateEnvelopeInput): Promise<CreateEnvelopeResult> {
    // Tab placement (anchor strings) comes with the Phase 4 contract templates.
    const body = {
      emailSubject: input.subject,
      ...(input.message ? { emailBlurb: input.message } : {}),
      documents: [
        {
          documentId: "1",
          name: input.documentName,
          fileExtension: "pdf",
          documentBase64: input.documentBase64,
        },
      ],
      recipients: {
        signers: input.signers.map((s, i) => ({
          recipientId: String(i + 1),
          routingOrder: String(i + 1),
          name: s.name,
          email: s.email,
          roleName: s.role,
        })),
      },
      status: "sent",
    };
    const res = await requestJson(this.fetch, this.envelopesUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return { status: "failed", error: res.error };
    return { status: "sent", envelopeId: getString(res.data, "envelopeId") };
  }

  async getStatus(envelopeId: string): Promise<EnvelopeStatusResult> {
    const res = await requestJson(this.fetch, this.envelopesUrl(envelopeId), {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) return { connected: true, state: "unknown", error: res.error };
    const status = getString(res.data, "status");
    const completedAt = getString(res.data, "completedDateTime");
    return {
      connected: true,
      state: mapState(status),
      providerStatus: status,
      ...(completedAt ? { completedAt } : {}),
    };
  }
}
