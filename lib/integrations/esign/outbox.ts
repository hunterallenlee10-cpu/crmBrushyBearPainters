import { createHash } from "node:crypto";
import { type IntegrationContext, notConnected, recordSimulated } from "@/lib/integrations/core";
import { type CreateEnvelopeInput, type ESignProvider } from "@/lib/integrations/esign/types";

/**
 * Default e-sign provider ("builtin"). The in-app BearSign click-to-sign flow
 * lives on the proposal page (/p/[token]); a request through this adapter is recorded to the outbox.
 *
 * The PDF itself is NOT copied into the outbox payload (it can be megabytes of
 * base64 in a jsonb column); the payload keeps its size and SHA-256 instead.
 * The document lives in Storage with the estimate/contract.
 */
export function createBuiltinESignProvider(ctx: IntegrationContext): ESignProvider {
  return {
    provider: "builtin",
    async createEnvelope(input: CreateEnvelopeInput) {
      const { documentBase64, ...rest } = input;
      const bytes = Buffer.from(documentBase64, "base64");
      const signerList = input.signers.map((s) => `${s.name} <${s.email}> (${s.role})`);
      return recordSimulated(ctx, {
        domain: "esign",
        provider: "builtin",
        operation: "esign.create_envelope",
        recipient: input.signers.map((s) => s.email).join(", "),
        subject: input.subject,
        renderedBody: [
          `Signature request: ${input.documentName}`,
          ...signerList.map((s) => `- ${s}`),
          ...(input.message ? ["", input.message] : []),
        ].join("\n"),
        payload: {
          ...rest,
          documentBytes: bytes.length,
          documentSha256: createHash("sha256").update(bytes).digest("hex"),
        },
        related: input.related ?? null,
      });
    },
    async getStatus() {
      return notConnected("BearSign signs on the proposal page; no outside provider is connected.");
    },
  };
}
