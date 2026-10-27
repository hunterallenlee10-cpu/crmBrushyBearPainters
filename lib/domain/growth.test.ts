import { describe, expect, it } from "vitest";
import { toBusinessHours } from "@/lib/domain/company-settings";
import { caseAttentionPriority, caseSlaDue, isOpenCase } from "@/lib/domain/cases";
import {
  describeDripStep,
  dripExitReason,
  nextDripStep,
  validateDripSteps,
} from "@/lib/domain/drips";
import { DEFAULT_DRIPS } from "@/lib/domain/drips/defaults";
import {
  callbackDue,
  DEFAULT_DISPOSITIONS,
  FOLLOW_UP_LISTS,
  groupDispositions,
  isResting,
  nextInQueue,
} from "@/lib/domain/follow-ups";
import {
  isCustomerInitiated,
  isUnread,
  keywordEffect,
  phoneKey,
  routeInbound,
} from "@/lib/domain/messaging";
import { effectiveChoice, NOTIFICATION_TYPES } from "@/lib/domain/notifications/catalog";
import {
  championTotals,
  isPayable,
  normalizeReferralCode,
  referralLink,
  referralStatus,
  type ReferralFacts,
} from "@/lib/domain/referrals";

const at = (iso: string) => new Date(iso);

describe("drips", () => {
  const preseason = DEFAULT_DRIPS.find((d) => d.key === "exterior_pre_season")?.steps ?? [];
  const nurture = DEFAULT_DRIPS.find((d) => d.key === "just_planning_nurture")?.steps ?? [];

  it("delay steps go out N days later at 10:00 am Pacific", () => {
    const next = nextDripStep(nurture, 0, at("2026-10-27T22:00:00Z"));
    expect(next).toEqual({ index: 0, at: at("2026-10-30T17:00:00.000Z") });
  });
  it("calendar steps: enrolled in the fall, the drip starts next February", () => {
    const next = nextDripStep(preseason, 0, at("2026-10-27T17:00:00Z"));
    expect(next?.index).toBe(0);
    expect(next?.at.toISOString()).toBe("2027-02-01T18:00:00.000Z");
  });
  it("calendar steps: enrolled mid-March skips February and gets April", () => {
    const next = nextDripStep(preseason, 0, at("2027-03-15T17:00:00Z"));
    expect(next?.index).toBe(2);
    expect(next?.at.toISOString()).toBe("2027-04-01T17:00:00.000Z");
  });
  it("finishes after the last step", () => {
    expect(nextDripStep(nurture, 3, at("2026-10-27T17:00:00Z"))).toBeNull();
  });
  it("validates steps", () => {
    expect(validateDripSteps(nurture).errors).toEqual([]);
    expect(validateDripSteps([{ channel: "sms", template_key: "x" }]).errors[0]).toMatch(
      /either a delay/,
    );
    expect(
      validateDripSteps([{ on_date: "13-01", channel: "fax", template_key: "x" }]).errors,
    ).toHaveLength(2);
    expect(validateDripSteps("nope").errors).toEqual(["Steps must be a list."]);
    expect(validateDripSteps([]).errors).toEqual(["Add at least one step."]);
  });
  it("exits on the first matching condition it watches", () => {
    const facts = {
      repliedSinceEnrolled: false,
      walkthroughBooked: true,
      converted: true,
      sold: false,
      lost: false,
      optedOut: false,
    };
    expect(dripExitReason(["replied", "booked"], facts)).toBe("A walkthrough is booked");
    expect(dripExitReason(["replied", "sold"], facts)).toBeNull();
  });
  it("describes steps", () => {
    expect(describeDripStep(nurture[0] as never)).toBe(
      "After 3 days: email (else text) “nurture_just_planning_1”",
    );
    expect(describeDripStep(preseason[0] as never)).toBe(
      "On February 1: email (else text) “exterior_preseason_feb”",
    );
  });
});

describe("follow-up lists", () => {
  it("has the 8 SPEC §11.4 lists and grouped dispositions", () => {
    expect(FOLLOW_UP_LISTS).toHaveLength(8);
    expect(
      groupDispositions(DEFAULT_DISPOSITIONS.map((d) => ({ ...d, active: true }))).map(
        (g) => g.label,
      ),
    ).toEqual(["Positive", "Negative", "Callback", "No Contact", "Won"]);
  });
  it("rests a record after a disposition, until the callback time when one is set", () => {
    const now = at("2026-10-27T17:00:00Z");
    const recent = [
      { listKey: "hot_new_leads", createdAt: "2026-10-27T15:00:00Z", callbackAt: null },
    ];
    expect(isResting("hot_new_leads", 4, recent, now)).toBe(true);
    expect(isResting("hot_new_leads", 1, recent, now)).toBe(false);
    expect(isResting("estimates_awaiting_reply", 48, recent, now)).toBe(false);
    const cb = [
      {
        listKey: "hot_new_leads",
        createdAt: "2026-10-27T15:00:00Z",
        callbackAt: "2026-10-28T17:00:00Z",
      },
    ];
    expect(isResting("hot_new_leads", 0, cb, now)).toBe(true);
    expect(isResting("hot_new_leads", 0, cb, at("2026-10-28T18:00:00Z"))).toBe(false);
  });
  it("callbacks due by the end of today come from the latest attempt", () => {
    const end = at("2026-10-28T07:00:00Z");
    const a = [
      { listKey: "x", createdAt: "2026-10-26T10:00:00Z", callbackAt: "2026-10-27T18:00:00Z" },
      { listKey: "x", createdAt: "2026-10-27T10:00:00Z", callbackAt: null },
    ];
    expect(callbackDue(a, end)).toBeNull();
    expect(callbackDue(a.slice(0, 1), end)?.callbackAt).toBe("2026-10-27T18:00:00Z");
  });
  it("auto-advances through the queue", () => {
    const q = [{ id: "a" }, { id: "b" }];
    expect(nextInQueue(q, null)?.id).toBe("a");
    expect(nextInQueue(q, "a")?.id).toBe("b");
    expect(nextInQueue(q, "b")).toBeNull();
    expect(nextInQueue(q, "gone")?.id).toBe("a");
    expect(nextInQueue([], "a")).toBeNull();
  });
});

describe("referrals", () => {
  const base: ReferralFacts = {
    ineligibleReason: null,
    paidAt: null,
    leadStatus: "new",
    jobStage: null,
    estimateAcceptedAt: null,
    paidInFullAt: null,
  };
  it("normalizes codes", () => {
    expect(normalizeReferralCode(" bear-7kq2 ")).toBe("BEAR-7KQ2");
    expect(normalizeReferralCode("hello")).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });
  it("derives status from the lead and job", () => {
    expect(referralStatus(base, "paid_in_full")).toBe("referred");
    expect(
      referralStatus(
        { ...base, leadStatus: "converted", jobStage: "estimate_sent" },
        "paid_in_full",
      ),
    ).toBe("walkthrough");
    expect(
      referralStatus({ ...base, jobStage: "onboarding", estimateAcceptedAt: "x" }, "paid_in_full"),
    ).toBe("sold");
    expect(referralStatus({ ...base, jobStage: "paid_in_full" }, "paid_in_full")).toBe("payable");
    expect(referralStatus({ ...base, jobStage: "paid_in_full", paidAt: "x" }, "paid_in_full")).toBe(
      "paid",
    );
    expect(referralStatus({ ...base, jobStage: "closed_lost" }, "paid_in_full")).toBe("lost");
    expect(referralStatus({ ...base, ineligibleReason: "self" }, "paid_in_full")).toBe(
      "ineligible",
    );
  });
  it("payable when sold under the 'sold' rule", () => {
    expect(isPayable({ ...base, jobStage: "onboarding" }, "sold")).toBe(true);
    expect(isPayable({ ...base, jobStage: "onboarding" }, "paid_in_full")).toBe(false);
  });
  it("totals a champion's referrals", () => {
    expect(
      championTotals([
        { status: "paid", rewardCents: 10000 },
        { status: "payable", rewardCents: 10000 },
        { status: "referred", rewardCents: 10000 },
      ]),
    ).toEqual({ referrals: 3, sold: 2, paidCents: 10000, payableCents: 10000 });
  });
  it("builds the website ?ref= link", () => {
    expect(referralLink("brushybear.vercel.app", "BEAR-7KQ2")).toBe(
      "https://brushybear.vercel.app/estimate?ref=BEAR-7KQ2",
    );
    expect(referralLink(null, "BEAR-7KQ2")).toBe(
      "https://brushybear.vercel.app/estimate?ref=BEAR-7KQ2",
    );
  });
});

describe("cases", () => {
  const hours = toBusinessHours({
    mon: { open: "08:00", close: "17:00" },
    tue: { open: "08:00", close: "17:00" },
    wed: { open: "08:00", close: "17:00" },
    thu: { open: "08:00", close: "17:00" },
    fri: { open: "08:00", close: "17:00" },
    sat: { by_appointment: true },
    sun: null,
  });
  it("SLA is 2 business days at the same time of day", () => {
    // Tue 10:00 am PDT → Thu 10:00 am PDT.
    expect(caseSlaDue(at("2026-10-27T17:00:00Z"), 2, hours).toISOString()).toBe(
      "2026-10-29T17:00:00.000Z",
    );
  });
  it("skips the weekend", () => {
    // Fri Oct 30 10:00 am PDT → Tue Nov 3 10:00 am PST.
    expect(caseSlaDue(at("2026-10-30T17:00:00Z"), 2, hours).toISOString()).toBe(
      "2026-11-03T18:00:00.000Z",
    );
  });
  it("a case opened after hours starts at the next opening", () => {
    // Tue 9 pm PDT → counts from Wed 8:00 am → Fri 8:00 am.
    expect(caseSlaDue(at("2026-10-28T04:00:00Z"), 2, hours).toISOString()).toBe(
      "2026-10-30T15:00:00.000Z",
    );
  });
  it("priority: high, critical past the SLA or when urgent", () => {
    const now = at("2026-10-29T00:00:00Z");
    expect(
      caseAttentionPriority({ priority: "normal", slaDueAt: "2026-10-30T00:00:00Z" }, now),
    ).toBe("high");
    expect(
      caseAttentionPriority({ priority: "normal", slaDueAt: "2026-10-28T00:00:00Z" }, now),
    ).toBe("critical");
    expect(
      caseAttentionPriority({ priority: "urgent", slaDueAt: "2026-10-30T00:00:00Z" }, now),
    ).toBe("critical");
    expect(isOpenCase("resolved")).toBe(false);
    expect(isOpenCase("scheduled")).toBe(true);
  });
});

describe("messaging", () => {
  it("routes inbound texts to the open job, then the open lead, then the latest", () => {
    const c = [
      {
        subjectType: "lead" as const,
        subjectId: "l",
        contactId: null,
        open: true,
        lastActivityAt: "2026-10-27",
      },
      {
        subjectType: "job" as const,
        subjectId: "j-old",
        contactId: "c",
        open: false,
        lastActivityAt: "2026-10-28",
      },
      {
        subjectType: "job" as const,
        subjectId: "j",
        contactId: "c",
        open: true,
        lastActivityAt: "2026-10-01",
      },
    ];
    expect(routeInbound(c)?.subjectId).toBe("j");
    expect(routeInbound(c.slice(0, 2))?.subjectId).toBe("l");
    expect(routeInbound([])).toBeNull();
  });
  it("STOP, START and HELP keywords", () => {
    const co = { name: "Brushy Bear Painters", phone: "[PHONE]" };
    expect(keywordEffect("STOP", co).kind).toBe("opt_out");
    expect(keywordEffect(" unsubscribe! ", co).kind).toBe("opt_out");
    expect(keywordEffect("Start", co).kind).toBe("opt_in");
    expect(keywordEffect("help", co)).toEqual({
      kind: "help",
      reply: "Brushy Bear Painters: call us at [PHONE]. Reply STOP to opt out.",
    });
    expect(keywordEffect("Please stop by Tuesday", co).kind).toBe("none");
  });
  it("customer-initiated window, unread, phone keys", () => {
    const now = at("2026-10-27T17:00:00Z");
    expect(isCustomerInitiated("2026-10-27T10:00:00Z", now, 24)).toBe(true);
    expect(isCustomerInitiated("2026-10-25T10:00:00Z", now, 24)).toBe(false);
    expect(isCustomerInitiated(null, now, 24)).toBe(false);
    expect(
      isUnread({ lastInboundAt: "2026-10-27T10:00:00Z", readAt: "2026-10-27T09:00:00Z" }),
    ).toBe(true);
    expect(
      isUnread({ lastInboundAt: "2026-10-27T10:00:00Z", readAt: "2026-10-27T11:00:00Z" }),
    ).toBe(false);
    expect(phoneKey("+1 (425) 555-0101")).toBe("4255550101");
    expect(phoneKey("555")).toBeNull();
  });
});

describe("notification choices", () => {
  it("a person's choice wins over the company default; locked keeps in-app on", () => {
    const mention = NOTIFICATION_TYPES.find((t) => t.type === "mention")?.defaults;
    if (!mention) throw new Error();
    expect(effectiveChoice({ ...mention }, { inApp: false, email: false, sms: true })).toEqual({
      inApp: true,
      email: false,
      sms: true,
      locked: true,
    });
    expect(
      effectiveChoice(
        { inApp: true, email: false, sms: false, locked: false },
        { inApp: false, email: true, sms: false },
      ),
    ).toEqual({
      inApp: false,
      email: true,
      sms: false,
      locked: false,
    });
    expect(effectiveChoice(null, null).inApp).toBe(true);
  });
});
