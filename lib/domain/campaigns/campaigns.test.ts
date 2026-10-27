import { describe, expect, it } from "vitest";
import type { Recipient } from "@/lib/domain/workflows/types";
import {
  allowedTransitions,
  campaignChecks,
  canSend,
  planRecipients,
  unavailableFields,
  type AudienceMember,
} from "./index";

const QH = { enabled: true, start: "20:00", end: "08:00" };
const base = {
  channel: "sms" as const,
  subject: null,
  body: "Hi {{contact.first_name}}, exterior dates are open. - {{company.name}}",
  audienceCount: 10,
  reachableCount: 8,
  scheduledAt: null,
  quietHours: QH,
  templateStatus: "approved" as const,
  sample: { contact: { first_name: "Sam" }, company: { name: "Brushy Bear Painters" } },
};

function member(id: string, r: Partial<Recipient>): AudienceMember {
  return {
    subjectType: "contact",
    subjectId: id,
    name: "Sam",
    firstName: "Sam",
    recipient: {
      kind: "contact",
      id,
      name: "Sam",
      mobile: "+14255550100",
      email: "sam@example.com",
      doNotContact: false,
      smsOptedOut: false,
      emailOptedOut: false,
      smsOptIn: true,
      emailOptIn: true,
      ...r,
    },
  };
}

describe("campaign checks", () => {
  it("passes a good text and says the STOP line is added", () => {
    const c = campaignChecks(base);
    expect(canSend(c)).toBe(true);
    expect(c.some((x) => x.message.includes("Reply STOP"))).toBe(true);
    expect(c.some((x) => x.message.includes("2 of 10 will be skipped"))).toBe(true);
  });

  it("blocks job fields, an empty audience and an email without a subject", () => {
    expect(unavailableFields("{{job.name}} {{contact.first_name}}")).toEqual(["job.name"]);
    expect(canSend(campaignChecks({ ...base, body: "Your job {{job.name}}" }))).toBe(false);
    expect(canSend(campaignChecks({ ...base, audienceCount: 0, reachableCount: 0 }))).toBe(false);
    expect(canSend(campaignChecks({ ...base, channel: "email", subject: "" }))).toBe(false);
  });

  it("warns about placeholders, draft wording and quiet hours", () => {
    const c = campaignChecks({
      ...base,
      body: "Save [REFERRAL_REWARD] this spring.",
      templateStatus: "draft",
      // 22:00 Pacific
      scheduledAt: new Date("2026-11-03T06:00:00Z"),
    });
    expect(canSend(c)).toBe(true);
    const text = c.map((x) => x.message).join(" ");
    expect(text).toContain("[REFERRAL_REWARD]");
    expect(text).toContain("Draft – owner to approve");
    expect(text).toContain("quiet hours");
  });
});

describe("campaign recipients", () => {
  it("needs marketing consent, honors opt-outs and DNC, and sends once per address", () => {
    const planned = planRecipients(
      [
        member("a", {}),
        member("b", { smsOptIn: false }),
        member("c", { smsOptedOut: true }),
        member("d", { doNotContact: true }),
        member("e", { mobile: "(425) 555-0100" }),
        member("f", { mobile: null }),
      ],
      "sms",
    );
    expect(planned.map((p) => p.excluded === null)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(planned[4]?.excluded).toContain("Same phone");
  });

  it("emails leads with no opt-in record until they unsubscribe", () => {
    const lead = (id: string, r: Partial<Recipient>) => ({
      ...member(id, {
        kind: "lead",
        smsOptIn: null,
        emailOptIn: null,
        email: `${id}@example.com`,
        ...r,
      }),
      subjectType: "lead" as const,
    });
    const planned = planRecipients([lead("x", {}), lead("y", { emailOptedOut: true })], "email");
    expect(planned[0]?.excluded).toBeNull();
    expect(planned[1]?.excluded).toContain("unsubscribed");
  });
});

describe("campaign status", () => {
  it("follows the same transitions as the database guard", () => {
    expect(allowedTransitions("draft")).toEqual(["scheduled", "canceled"]);
    expect(allowedTransitions("sending")).toEqual(["paused", "canceled"]);
    expect(allowedTransitions("sent")).toEqual([]);
  });
});
