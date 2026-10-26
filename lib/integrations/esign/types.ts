import { type NotConnected, type RelatedRecord, type SendStatus } from "@/lib/integrations/core";

export type ESignSigner = { name: string; email: string; role: string };

export type CreateEnvelopeInput = {
  documentName: string;
  /** PDF bytes, base64 (no data: prefix). */
  documentBase64: string;
  signers: readonly ESignSigner[];
  subject: string;
  message?: string;
  related?: RelatedRecord | null;
};

export type CreateEnvelopeResult = {
  status: SendStatus;
  envelopeId?: string;
  outboxId?: string;
  error?: string;
};

export type EnvelopeState = "sent" | "delivered" | "completed" | "declined" | "voided" | "unknown";

export type EnvelopeStatusResult =
  | NotConnected
  | {
      connected: true;
      state: EnvelopeState;
      /** The provider's own status string, for display/debugging. */
      providerStatus?: string;
      completedAt?: string;
      error?: string;
    };

export interface ESignProvider {
  readonly provider: string;
  createEnvelope(input: CreateEnvelopeInput): Promise<CreateEnvelopeResult>;
  getStatus(envelopeId: string): Promise<EnvelopeStatusResult>;
}
