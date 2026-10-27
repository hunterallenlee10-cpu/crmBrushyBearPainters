import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

/**
 * Default customer messages for sending a proposal or change order (SPEC §7.5,
 * §11.3 voice: plain, friendly, specific, short sentences, signed by a person).
 * The Send dialog shows them for editing; workflow templates replace them in
 * Phase 8. `{{link}}` is filled in when the link is created.
 */

export const LINK_TOKEN = "{{link}}";

export type MessageContext = {
  customerFirstName: string | null;
  senderName: string;
  companyName: string;
  companyPhone: string | null;
  documentNumber: string;
  expiresAt: Date | null;
};

const TZ = "America/Los_Angeles";

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function expires(d: Date | null): string | null {
  return d ? format(toZonedTime(d, TZ), "MMMM d") : null;
}

export function defaultEstimateMessages(c: MessageContext): {
  sms: string;
  emailSubject: string;
  emailBody: string;
} {
  const hi = c.customerFirstName ? `Hi ${c.customerFirstName}` : "Hi";
  const me = firstName(c.senderName);
  const until = expires(c.expiresAt);
  return {
    sms: `${hi}, it's ${me} with ${c.companyName}. Your estimate is ready: ${LINK_TOKEN} Pick your option and sign right from your phone.`,
    emailSubject: `Your estimate from ${c.companyName} (${c.documentNumber})`,
    emailBody: [
      `${hi},`,
      "",
      `Thanks for having us out. Your written estimate is ready: ${LINK_TOKEN}`,
      "",
      "You'll see each option, the add-ons you can choose and what's included. When you're ready, pick your option and sign on the same page.",
      ...(until ? ["", `The prices hold until ${until}.`] : []),
      "",
      c.companyPhone
        ? `Questions? Reply here or call ${c.companyPhone}.`
        : "Questions? Just reply here.",
      "",
      c.senderName,
      c.companyName,
    ].join("\n"),
  };
}

export function defaultChangeOrderMessages(c: MessageContext & { title: string }): {
  sms: string;
  emailSubject: string;
  emailBody: string;
} {
  const hi = c.customerFirstName ? `Hi ${c.customerFirstName}` : "Hi";
  const me = firstName(c.senderName);
  return {
    sms: `${hi}, it's ${me} with ${c.companyName}. Here's the change order we talked about (${c.title}): ${LINK_TOKEN} You can review and sign it on your phone.`,
    emailSubject: `Change order ${c.documentNumber} from ${c.companyName}`,
    emailBody: [
      `${hi},`,
      "",
      `Here's the change order we talked about: ${c.title}.`,
      `Review it and sign here: ${LINK_TOKEN}`,
      "",
      "We won't start the extra work until it's signed.",
      "",
      c.senderName,
      c.companyName,
    ].join("\n"),
  };
}

/** Puts the link in; adds it at the end if someone deleted the placeholder. */
export function withLink(text: string, url: string): string {
  return text.includes(LINK_TOKEN) ? text.split(LINK_TOKEN).join(url) : `${text.trimEnd()} ${url}`;
}
