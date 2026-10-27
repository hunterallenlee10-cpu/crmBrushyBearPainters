import type { OnboardingKey } from "@/lib/domain/estimating/outputs";
import { REQUESTABLE } from "@/lib/domain/onboarding/checklist";

/**
 * Draft customer messages for "Request from customer" on an onboarding item
 * (SPEC §6.4) and the prep instructions (SPEC §6.4 Customer Prep, §11.2 #5).
 * Plain, friendly, specific, short sentences, signed by a person (SPEC §11.3).
 * Draft wording – owner to approve; workflow templates replace these in Phase 8.
 */

export const PREP_TEMPLATE_KEY = "prep_instructions";

export type RequestContext = {
  customerFirstName: string | null;
  senderName: string;
  companyName: string;
  workTypes: readonly string[];
};

export type RequestDraft = {
  templateKey: string;
  sms: string;
  emailSubject: string;
  emailBody: string;
};

function first(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Prep checklist lines for the work in scope. */
export function prepLines(workTypes: readonly string[]): string[] {
  const lines: string[] = [];
  const has = (w: string) => workTypes.includes(w);
  if (has("interior") || has("cabinets")) {
    lines.push(
      "Move small furniture, decor and valuables out of the rooms we're painting. We'll move and cover the big pieces.",
      "Take down wall hangings, curtains and anything on the walls.",
    );
  }
  if (has("cabinets")) {
    lines.push("Empty the cabinets and drawers we're painting, and clear the counters.");
  }
  if (has("exterior") || has("deck_fence")) {
    lines.push(
      "Clear about 3 feet around the house (or the deck and fence): planters, hoses, furniture and grills.",
      "Make sure we can use an outside water spigot and a power outlet.",
      "Keep pets inside or away from the work area while we're there.",
    );
  }
  if (!lines.length) lines.push("Clear the work area so we can get set up quickly.");
  lines.push("Let us know about gate codes, alarms or parking we should know about.");
  return lines;
}

/** The draft for an item, or null when it has nothing to ask the customer. */
export function requestDraft(key: OnboardingKey, c: RequestContext): RequestDraft | null {
  const what = REQUESTABLE[key];
  if (!what) return null;
  const hi = c.customerFirstName ? `Hi ${c.customerFirstName}` : "Hi";
  const me = first(c.senderName);
  const sign = ["", c.senderName, c.companyName].join("\n");
  switch (what) {
    case "prep": {
      const lines = prepLines(c.workTypes);
      return {
        templateKey: PREP_TEMPLATE_KEY,
        sms: `${hi}, it's ${me} with ${c.companyName}. Before we start: ${lines[0]} I've emailed the full list. Questions? Just reply.`,
        emailSubject: `Getting ready for your paint project`,
        emailBody: [
          `${hi},`,
          "",
          "A few things that help us start on time and keep your home clean:",
          "",
          ...lines.map((l) => `- ${l}`),
          "",
          "If any of this is hard to do, tell us and we'll work it out.",
          sign,
        ].join("\n"),
      };
    }
    case "contact":
      return {
        templateKey: "onboarding_contact",
        sms: `${hi}, it's ${me} with ${c.companyName}. What's the best mobile number and email for updates during your project?`,
        emailSubject: "Best way to reach you during the project",
        emailBody: [
          `${hi},`,
          "",
          "We send a short photo update each day we're working. What's the best mobile number and email to use?",
          sign,
        ].join("\n"),
      };
    case "access":
      return {
        templateKey: "onboarding_access",
        sms: `${hi}, it's ${me} with ${c.companyName}. Quick questions before we start: how do we get in, any pets, where should the crew park, and will anyone be home?`,
        emailSubject: "A few questions before we start",
        emailBody: [
          `${hi},`,
          "",
          "So the crew shows up ready, could you tell us:",
          "- How we get in (gate, lockbox, someone home)",
          "- Any pets we should know about",
          "- Where the crew should park",
          "- Whether the home will be occupied while we work",
          sign,
        ].join("\n"),
      };
    case "colors":
      return {
        templateKey: "onboarding_colors",
        sms: `${hi}, it's ${me} with ${c.companyName}. We still need your color choices for a few surfaces. Want to go over them by phone, or send them over?`,
        emailSubject: "Your color choices",
        emailBody: [
          `${hi},`,
          "",
          "We still need colors for a few surfaces on your color sheet. Send the color names (and brand if you know it), or reply and we'll set up a quick call.",
          sign,
        ].join("\n"),
      };
    case "hoa":
      return {
        templateKey: "onboarding_hoa",
        sms: `${hi}, it's ${me} with ${c.companyName}. Has your HOA approved the exterior colors yet? When you have the approval, reply with a photo or forward the email.`,
        emailSubject: "HOA color approval",
        emailBody: [
          `${hi},`,
          "",
          "Your HOA needs to approve exterior color changes before we can schedule. When you have the approval letter or email, please forward it to us.",
          sign,
        ].join("\n"),
      };
    case "lead_safe":
      return {
        templateKey: "onboarding_lead_safe",
        sms: `${hi}, it's ${me} with ${c.companyName}. Because your home was built before 1978, we follow lead-safe practices. I've emailed the pamphlet to read and sign.`,
        emailSubject: "Lead-safe work at your home",
        emailBody: [
          `${hi},`,
          "",
          "Homes built before 1978 may have lead paint, so we follow lead-safe work practices. Before we start, please read the “Renovate Right” pamphlet and sign the acknowledgment. Reply if you have any questions.",
          sign,
        ].join("\n"),
      };
    default:
      return null;
  }
}
