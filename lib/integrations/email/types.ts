import { type RelatedRecord, type SendResult } from "@/lib/integrations/core";

export type EmailSendInput = {
  to: string | readonly string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** "Name <address>" or a bare address. Falls back to the provider's configured default. */
  from?: string;
  related?: RelatedRecord | null;
  messageType?: "transactional" | "marketing";
  /**
   * Files that go with the email (e.g. the invoice PDF), by their stored
   * document. Recorded in the outbox; real providers attach them when connected.
   */
  attachments?: readonly EmailAttachment[];
};

export type EmailAttachment = { fileName: string; documentId: string; contentType: string };

export interface EmailProvider {
  readonly provider: string;
  send(input: EmailSendInput): Promise<SendResult>;
}

export function recipients(to: EmailSendInput["to"]): string[] {
  return typeof to === "string" ? [to] : [...to];
}

/** Split "Name <address>" into parts. */
export function parseAddress(value: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return { email: value.trim() };
  const name = match[1]?.replace(/^"|"$/g, "").trim();
  const email = match[2]?.trim() ?? value.trim();
  return name ? { email, name } : { email };
}
