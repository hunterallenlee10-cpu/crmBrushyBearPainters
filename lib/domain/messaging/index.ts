import { classifyInboundKeyword } from "@/lib/integrations/sms_voice/keywords";

/**
 * Two-way messaging (SPEC §5.7 threads, §13.2 STOP/UNSUBSCRIBE/START), pure:
 * which conversation an inbound text belongs to, what a keyword does to
 * consent, and the automatic compliance reply.
 */

export type InboundCandidate = {
  subjectType: "job" | "lead" | "contact";
  subjectId: string;
  contactId: string | null;
  /** Open job (not closed) or open lead (not converted / lost / unqualified). */
  open: boolean;
  lastActivityAt: string;
};

/** Pick the conversation for an inbound message: an open job, then an open lead, then the latest. */
export function routeInbound(candidates: readonly InboundCandidate[]): InboundCandidate | null {
  if (!candidates.length) return null;
  const rank = (c: InboundCandidate) =>
    (c.open ? 0 : 10) + (c.subjectType === "job" ? 0 : c.subjectType === "lead" ? 1 : 2);
  return (
    [...candidates].sort(
      (a, b) => rank(a) - rank(b) || (a.lastActivityAt < b.lastActivityAt ? 1 : -1),
    )[0] ?? null
  );
}

export type KeywordEffect =
  | { kind: "opt_out"; reply: string }
  | { kind: "opt_in"; reply: string }
  | { kind: "help"; reply: string }
  | { kind: "none" };

/**
 * What an inbound text's keyword does. STOP (and its synonyms) opts the
 * number out of all texts; START opts back in; HELP gets our contact line.
 * Replies are draft wording – owner to approve (carriers expect them).
 */
export function keywordEffect(
  body: string,
  company: { name: string; phone: string },
): KeywordEffect {
  const k = classifyInboundKeyword(body);
  if (k === "opt_out") {
    return {
      kind: "opt_out",
      reply: `${company.name}: you're unsubscribed and won't get more texts from us. Reply START to resubscribe.`,
    };
  }
  if (k === "opt_in") {
    return {
      kind: "opt_in",
      reply: `${company.name}: you're resubscribed to texts. Reply STOP to opt out.`,
    };
  }
  if (k === "help") {
    return {
      kind: "help",
      reply: `${company.name}: call us at ${company.phone}. Reply STOP to opt out.`,
    };
  }
  return { kind: "none" };
}

/** Is this thread "customer-initiated" right now (they wrote within the window)? */
export function isCustomerInitiated(
  lastInboundAt: string | null,
  now: Date,
  windowHours: number,
): boolean {
  if (!lastInboundAt || windowHours <= 0) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() <= windowHours * 3_600_000;
}

export type ThreadSummary = {
  unread: boolean;
  lastInboundAt: string | null;
  readAt: string | null;
};

export function isUnread(t: Pick<ThreadSummary, "lastInboundAt" | "readAt">): boolean {
  return !!t.lastInboundAt && (!t.readAt || t.lastInboundAt > t.readAt);
}

/** Digits of a US / E.164 phone number for matching (last 10 digits). */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}
