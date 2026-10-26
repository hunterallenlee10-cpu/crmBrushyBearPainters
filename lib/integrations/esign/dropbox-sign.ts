// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import {
  type CreateEnvelopeInput,
  type CreateEnvelopeResult,
  type ESignProvider,
  type EnvelopeState,
  type EnvelopeStatusResult,
} from "@/lib/integrations/esign/types";
import {
  asArray,
  basicAuth,
  getNumber,
  getRecord,
  getString,
  requestJson,
} from "@/lib/integrations/http";

export type DropboxSignConfig = {
  /** API key (DROPBOX_SIGN_API_KEY), sent as the Basic-auth username. */
  apiKey: string;
  /** Test mode requests are not legally binding and are free. Defaults to true. */
  testMode?: boolean;
};

const API = "https://api.hellosign.com/v3";

export class DropboxSignProvider implements ESignProvider {
  readonly provider = "dropbox_sign";
  private readonly fetch: typeof fetch;
  private readonly config: DropboxSignConfig;

  constructor(options: { fetch: typeof fetch; config: DropboxSignConfig }) {
    if (!options.config.apiKey) throw new Error("Dropbox Sign needs an apiKey.");
    this.fetch = options.fetch;
    this.config = options.config;
  }

  async createEnvelope(input: CreateEnvelopeInput): Promise<CreateEnvelopeResult> {
    // File uploads must be multipart/form-data; fetch sets the boundary header itself.
    const form = new FormData();
    form.set("title", input.documentName);
    form.set("subject", input.subject);
    if (input.message) form.set("message", input.message);
    form.set("test_mode", this.config.testMode === false ? "0" : "1");
    input.signers.forEach((s, i) => {
      form.set(`signers[${i}][name]`, s.name);
      form.set(`signers[${i}][email_address]`, s.email);
      form.set(`signers[${i}][order]`, String(i));
    });
    const bytes = Buffer.from(input.documentBase64, "base64");
    form.set(
      "files[0]",
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      input.documentName.endsWith(".pdf") ? input.documentName : `${input.documentName}.pdf`,
    );

    const res = await requestJson(this.fetch, `${API}/signature_request/send`, {
      method: "POST",
      headers: { Authorization: basicAuth(this.config.apiKey, ""), Accept: "application/json" },
      body: form,
    });
    if (!res.ok) return { status: "failed", error: res.error };
    const request = getRecord(res.data, "signature_request");
    return { status: "sent", envelopeId: getString(request, "signature_request_id") };
  }

  async getStatus(envelopeId: string): Promise<EnvelopeStatusResult> {
    const res = await requestJson(
      this.fetch,
      `${API}/signature_request/${encodeURIComponent(envelopeId)}`,
      {
        method: "GET",
        headers: { Authorization: basicAuth(this.config.apiKey, ""), Accept: "application/json" },
      },
    );
    if (!res.ok) return { connected: true, state: "unknown", error: res.error };
    const request = getRecord(res.data, "signature_request");
    const signatures = asArray(request?.["signatures"]);
    let state: EnvelopeState = "sent";
    if (request?.["is_complete"] === true) state = "completed";
    else if (request?.["is_declined"] === true) state = "declined";
    else if (signatures.some((s) => getNumber(s, "last_viewed_at") !== undefined))
      state = "delivered";
    return { connected: true, state, providerStatus: state };
  }
}
