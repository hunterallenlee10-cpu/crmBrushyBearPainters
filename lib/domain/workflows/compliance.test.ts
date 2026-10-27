import { describe, expect, it } from "vitest";
import {
  inQuietHours,
  quietHoursUntil,
  sendBlockReason,
  withEmailFooter,
  withSmsOptOut,
} from "./compliance";
import { describeCondition, evaluateCondition, firstFailing } from "./conditions";
import { CUSTOMER } from "./fixtures";
import { waitUntil } from "./plan";
import { getWorkflow } from "./catalog";
import { FIXTURE_SETTINGS } from "./fixtures";

const Q = { enabled: true, start: "20:00", end: "08:00" };
const at = (iso: string) => new Date(iso);

describe("quiet hours (8 pm – 8 am Pacific)", () => {
  it("holds texts at night until 8:00 am the next morning", () => {
    // 9:30 pm PDT Oct 27 → 8:00 am PDT Oct 28.
    expect(quietHoursUntil(at("2026-10-28T04:30:00Z"), Q)?.toISOString()).toBe(
      "2026-10-28T15:00:00.000Z",
    );
  });
  it("holds early-morning texts until 8:00 am the same day", () => {
    // 6:00 am PDT → 8:00 am PDT.
    expect(quietHoursUntil(at("2026-10-27T13:00:00Z"), Q)?.toISOString()).toBe(
      "2026-10-27T15:00:00.000Z",
    );
  });
  it("lets daytime texts go now", () => {
    expect(quietHoursUntil(at("2026-10-27T17:00:00Z"), Q)).toBeNull();
    expect(inQuietHours(at("2026-10-28T02:59:00Z"), Q)).toBe(false); // 7:59 pm
    expect(inQuietHours(at("2026-10-28T03:00:00Z"), Q)).toBe(true); // 8:00 pm
  });
  it("is DST-safe (8:00 am PST after the November change)", () => {
    // 11 pm PST Nov 1 → 8:00 am PST Nov 2 = 16:00Z.
    expect(quietHoursUntil(at("2026-11-02T07:00:00Z"), Q)?.toISOString()).toBe(
      "2026-11-02T16:00:00.000Z",
    );
  });
  it("doesn't hold replies in a customer-initiated thread, or when turned off", () => {
    expect(quietHoursUntil(at("2026-10-28T04:30:00Z"), Q, { customerInitiated: true })).toBeNull();
    expect(quietHoursUntil(at("2026-10-28T04:30:00Z"), { ...Q, enabled: false })).toBeNull();
  });
  it("supports a window that doesn't cross midnight", () => {
    const q = { enabled: true, start: "12:00", end: "13:00" };
    expect(quietHoursUntil(at("2026-10-27T19:30:00Z"), q)?.toISOString()).toBe(
      "2026-10-27T20:00:00.000Z",
    );
  });
});

describe("consent", () => {
  it("allows transactional texts and email to a reachable customer", () => {
    expect(sendBlockReason(CUSTOMER, "sms", "transactional")).toBeNull();
    expect(sendBlockReason(CUSTOMER, "email", "transactional")).toBeNull();
  });
  it("Do Not Contact blocks every channel and type", () => {
    const r = { ...CUSTOMER, doNotContact: true };
    for (const ch of ["sms", "email"] as const)
      for (const t of ["transactional", "marketing"] as const)
        expect(sendBlockReason(r, ch, t)).toMatch(/not to be contacted/);
  });
  it("a STOP reply blocks texts but not email", () => {
    const r = { ...CUSTOMER, smsOptedOut: true };
    expect(sendBlockReason(r, "sms", "transactional")).toMatch(/STOP/);
    expect(sendBlockReason(r, "email", "transactional")).toBeNull();
  });
  it("marketing texts need an explicit opt-in; marketing email stops at unsubscribe", () => {
    expect(sendBlockReason({ ...CUSTOMER, smsOptIn: false }, "sms", "marketing")).toMatch(/opt-in/);
    expect(sendBlockReason({ ...CUSTOMER, smsOptIn: null }, "sms", "marketing")).toMatch(/opt-in/);
    expect(sendBlockReason({ ...CUSTOMER, smsOptIn: false }, "sms", "transactional")).toBeNull();
    expect(sendBlockReason({ ...CUSTOMER, emailOptedOut: true }, "email", "marketing")).toMatch(
      /unsubscribed/,
    );
    expect(
      sendBlockReason({ ...CUSTOMER, emailOptedOut: true }, "email", "transactional"),
    ).toBeNull();
    expect(sendBlockReason({ ...CUSTOMER, emailOptIn: false }, "email", "marketing")).toMatch(
      /opt-in/,
    );
    // A lead (no opt-in record) can get marketing email until they unsubscribe.
    expect(
      sendBlockReason({ ...CUSTOMER, kind: "lead", emailOptIn: null }, "email", "marketing"),
    ).toBeNull();
  });
  it("needs an address", () => {
    expect(sendBlockReason({ ...CUSTOMER, mobile: null }, "sms", "transactional")).toMatch(
      /mobile/,
    );
    expect(sendBlockReason({ ...CUSTOMER, email: null }, "email", "transactional")).toMatch(
      /email/,
    );
    expect(sendBlockReason(null, "sms", "transactional")).toMatch(/no one/);
  });
  it("adds the STOP line and the unsubscribe footer to marketing", () => {
    expect(withSmsOptOut("Exterior dates are filling up.", "Reply STOP to opt out.")).toBe(
      "Exterior dates are filling up. Reply STOP to opt out.",
    );
    expect(withSmsOptOut("Hi. Reply STOP to opt out.", "Reply STOP to opt out.")).toBe(
      "Hi. Reply STOP to opt out.",
    );
    expect(
      withEmailFooter("Hello", "Brushy Bear Painters · [MAILING_ADDRESS]", "https://x/u/1"),
    ).toBe("Hello\n\n—\nBrushy Bear Painters · [MAILING_ADDRESS]\nUnsubscribe: https://x/u/1");
  });
});

describe("conditions", () => {
  const facts = {
    lead: { status: "new", services: ["exterior", "interior"], score: 72 },
    event: { payload: {} },
  };
  it("evaluates every operator", () => {
    const t = (c: Parameters<typeof evaluateCondition>[0]) => evaluateCondition(c, facts);
    expect(t({ field: "lead.status", op: "eq", value: "new" })).toBe(true);
    expect(t({ field: "lead.status", op: "neq", value: "new" })).toBe(false);
    expect(t({ field: "lead.status", op: "in", value: ["new", "contacted"] })).toBe(true);
    expect(t({ field: "lead.status", op: "not_in", value: ["lost"] })).toBe(true);
    expect(t({ field: "lead.owner_id", op: "missing" })).toBe(true);
    expect(t({ field: "lead.status", op: "exists" })).toBe(true);
    expect(t({ field: "lead.services", op: "includes", value: ["deck_fence", "exterior"] })).toBe(
      true,
    );
    expect(t({ field: "lead.services", op: "excludes", value: "cabinets" })).toBe(true);
    expect(t({ field: "lead.score", op: "gte", value: 70 })).toBe(true);
    expect(t({ field: "lead.score", op: "lte", value: 70 })).toBe(false);
    expect(t({ field: "lead.services", op: "truthy" })).toBe(true);
    expect(t({ field: "event.payload.to", op: "falsy" })).toBe(true);
  });
  it("names the failing condition", () => {
    const c = firstFailing([{ field: "lead.status", op: "eq", value: "lost" }], facts);
    expect(c && describeCondition(c)).toBe("lead.status is lost");
  });
});

describe("waits", () => {
  it("read their length from a setting", () => {
    const def = getWorkflow("paid_in_full");
    const w = def?.actions.find((a) => a.id === "wait_review");
    if (w?.kind !== "wait") throw new Error();
    const d = waitUntil(w, {}, at("2026-10-27T17:00:00Z"), {
      ...FIXTURE_SETTINGS,
      reviewDelayDays: 5,
    });
    expect(d.kind === "until" && d.until.toISOString()).toBe("2026-11-01T17:00:00.000Z");
  });
  it("report a missing time instead of waiting forever", () => {
    const def = getWorkflow("walkthrough_booked");
    const w = def?.actions.find((a) => a.id === "wait_24h");
    if (w?.kind !== "wait") throw new Error();
    expect(waitUntil(w, {}, new Date(), FIXTURE_SETTINGS).kind).toBe("missing");
  });
});
