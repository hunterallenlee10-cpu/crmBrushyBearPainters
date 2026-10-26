import { type RelatedRecord, type SendResult } from "@/lib/integrations/core";

/**
 * SMS & voice (SPEC §2.1). Consent, quiet hours and the DNC flag (SPEC §13.2)
 * are checked in the domain layer BEFORE a provider is called; providers only send.
 */

export type MessageType = "transactional" | "marketing";

export type SmsSendInput = {
  /** E.164, e.g. +14255550100. */
  to: string;
  body: string;
  from?: string;
  mediaUrls?: readonly string[];
  related?: RelatedRecord | null;
  messageType?: MessageType;
};

export interface SmsProvider {
  readonly provider: string;
  send(input: SmsSendInput): Promise<SendResult>;
}

export type PlaceCallInput = {
  to: string;
  from?: string;
  related?: RelatedRecord | null;
};

export interface VoiceProvider {
  readonly provider: string;
  placeCall(input: PlaceCallInput): Promise<SendResult>;
}

export type InboundKeyword = "opt_out" | "opt_in" | "help";
