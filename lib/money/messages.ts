import { format } from "date-fns";
import { formatCents } from "@/lib/format/money";
import { INVOICE_TYPE_LABELS, type InvoiceType } from "@/lib/domain/ledger/types";

/**
 * Default customer wording for invoices and reminders (SPEC §11.3 voice:
 * plain, friendly, specific, short sentences, signed by a person). Draft
 * wording – owner to approve; Phase 8 templates replace it. How to pay is a
 * business fact the owners haven't given yet, so it stays a placeholder.
 */

export const INVOICE_TEMPLATE_KEY = "invoice";
export const REMINDER_TEMPLATE_KEY = "invoice_reminder";
export const PAYMENT_INSTRUCTIONS_PLACEHOLDER = "[HOW_TO_PAY — owner to provide]";

export type InvoiceMessageContext = {
  customerFirstName: string | null;
  senderName: string;
  companyName: string;
  invoiceNumber: string;
  invoiceType: InvoiceType;
  totalCents: number;
  dueDate: string;
};

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function day(iso: string): string {
  return format(new Date(`${iso}T12:00:00Z`), "MMMM d");
}

function what(type: InvoiceType): string {
  return type === "final" ? "final invoice" : `${INVOICE_TYPE_LABELS[type].toLowerCase()} invoice`;
}

export function defaultInvoiceMessages(c: InvoiceMessageContext): {
  sms: string;
  emailSubject: string;
  emailBody: string;
} {
  const hi = c.customerFirstName ? `Hi ${c.customerFirstName}` : "Hi";
  const me = firstName(c.senderName);
  const amount = formatCents(c.totalCents);
  return {
    sms: `${hi}, it's ${me} with ${c.companyName}. Your ${what(c.invoiceType)} ${c.invoiceNumber} for ${amount} is in your email. It's due ${day(c.dueDate)}. ${PAYMENT_INSTRUCTIONS_PLACEHOLDER}`,
    emailSubject: `${c.companyName} invoice ${c.invoiceNumber}`,
    emailBody: [
      `${hi},`,
      "",
      `Your ${what(c.invoiceType)} ${c.invoiceNumber} for ${amount} is attached. It's due ${day(c.dueDate)}.`,
      "",
      PAYMENT_INSTRUCTIONS_PLACEHOLDER,
      "",
      "Questions about it? Just reply here.",
      "",
      c.senderName,
      c.companyName,
    ].join("\n"),
  };
}

export function reminderMessage(c: {
  customerFirstName: string | null;
  senderName: string;
  companyName: string;
  invoiceNumber: string;
  balanceCents: number;
  daysPastDue: number;
}): { sms: string; emailSubject: string; emailBody: string } {
  const hi = c.customerFirstName ? `Hi ${c.customerFirstName}` : "Hi";
  const amount = formatCents(c.balanceCents);
  return {
    sms: `${hi}, a friendly note from ${c.companyName}: invoice ${c.invoiceNumber} has ${amount} still open. ${PAYMENT_INSTRUCTIONS_PLACEHOLDER} Already paid? Thank you, and ignore this.`,
    emailSubject: `Reminder: invoice ${c.invoiceNumber}`,
    emailBody: [
      `${hi},`,
      "",
      `A friendly reminder that invoice ${c.invoiceNumber} has ${amount} still open (${c.daysPastDue} days past due).`,
      "",
      PAYMENT_INSTRUCTIONS_PLACEHOLDER,
      "",
      "If you've already paid, thank you, and please ignore this. If something's not right with the invoice, reply and we'll sort it out.",
      "",
      c.senderName,
      c.companyName,
    ].join("\n"),
  };
}
