import { describe, expect, it } from "vitest";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import { createOutboxSmsProvider } from "@/lib/integrations/sms_voice/outbox";
import { ActionFailure } from "@/lib/actions/errors";
import {
  contactBlockReason,
  countSms,
  describeSmsCount,
  plainTextToHtml,
  sendLeadSms,
  smsRecipient,
  type MessagingLead,
} from "@/lib/leads/messaging";

describe("countSms", () => {
  it("counts an empty message as zero segments", () => {
    expect(countSms("")).toEqual({
      encoding: "GSM-7",
      units: 0,
      segments: 0,
      perSegment: 160,
      remaining: 160,
    });
  });

  it("fits 160 plain characters in one text", () => {
    const c = countSms("a".repeat(160));
    expect(c).toMatchObject({ encoding: "GSM-7", units: 160, segments: 1, remaining: 0 });
  });

  it("splits at 161 characters into 153-character segments", () => {
    expect(countSms("a".repeat(161))).toMatchObject({
      segments: 2,
      perSegment: 153,
      remaining: 145,
    });
    expect(countSms("a".repeat(306))).toMatchObject({ segments: 2, remaining: 0 });
    expect(countSms("a".repeat(307))).toMatchObject({ segments: 3 });
  });

  it("counts extended GSM characters as two", () => {
    const c = countSms("Price: €100 [approx]");
    expect(c.encoding).toBe("GSM-7");
    expect(c.units).toBe(20 + 3); // €, [ and ] take an escape each
  });

  it("switches to UCS-2 for emoji and counts UTF-16 units", () => {
    const c = countSms("See you Tuesday 🐻");
    expect(c.encoding).toBe("UCS-2");
    expect(c.units).toBe(18); // the bear is a surrogate pair
    expect(c.perSegment).toBe(70);
    expect(countSms("🐻".repeat(36))).toMatchObject({ units: 72, segments: 2, perSegment: 67 });
  });

  it("describes the count in plain words", () => {
    expect(describeSmsCount(countSms("Hi there"))).toBe("8 / 160 · 1 text");
    expect(describeSmsCount(countSms("a".repeat(200)))).toBe(
      "200 characters · 2 texts (106 left in the last one)",
    );
    expect(describeSmsCount(countSms("Hi 👋"))).toContain("emoji");
  });
});

describe("contactBlockReason", () => {
  const lead = { mobile: "+14255550101", phone: null, email: "a@example.com", disposition: null };

  it("allows reachable leads", () => {
    expect(contactBlockReason(lead, "sms")).toBeNull();
    expect(contactBlockReason(lead, "email")).toBeNull();
    expect(contactBlockReason(lead, "call")).toBeNull();
  });

  it("blocks every channel for Do not contact", () => {
    const dnc = { ...lead, disposition: "do_not_contact" };
    for (const ch of ["sms", "email", "call"] as const) {
      expect(contactBlockReason(dnc, ch)).toMatch(/asked not to be contacted/);
    }
  });

  it("explains a missing number or email", () => {
    expect(contactBlockReason({ ...lead, mobile: null }, "sms")).toMatch(/mobile number/);
    expect(contactBlockReason({ ...lead, mobile: null }, "call")).toMatch(/phone number/);
    expect(contactBlockReason({ ...lead, email: null }, "email")).toMatch(/email address/);
  });

  it("texts the mobile first, then the phone", () => {
    expect(smsRecipient({ mobile: "+14255550101", phone: "+14255550102" })).toBe("+14255550101");
    expect(smsRecipient({ mobile: null, phone: "+14255550102" })).toBe("+14255550102");
  });
});

describe("plainTextToHtml", () => {
  it("escapes HTML and keeps paragraphs and line breaks", () => {
    expect(plainTextToHtml("Hi <b>Sam</b>,\n\nSee you at 9 & bring\nphotos.")).toBe(
      "<p>Hi &lt;b&gt;Sam&lt;/b&gt;,</p><p>See you at 9 &amp; bring<br>photos.</p>",
    );
  });
});

describe("sendLeadSms", () => {
  const lead: MessagingLead = {
    id: "00000000-0000-4000-8000-000000000001",
    orgId: "00000000-0000-4000-8000-000000000002",
    mobile: "+14255550101",
    phone: null,
    email: null,
    disposition: null,
  };

  type Insert = Record<string, unknown>;
  function fakeDb(inserted: Insert[]) {
    return {
      from: (table: string) => ({
        insert: (row: Insert) => {
          inserted.push({ table, ...row });
          return {
            select: () => ({
              single: async () => ({ data: { id: "message-1" }, error: null }),
            }),
          };
        },
      }),
    } as unknown as Parameters<typeof sendLeadSms>[0];
  }

  it("records the text in the outbox and logs it with the outbox id", async () => {
    const sink = createMemoryOutboxSink();
    const provider = createOutboxSmsProvider({ orgId: lead.orgId, actorId: "u1", sink });
    const inserted: Insert[] = [];
    const result = await sendLeadSms(fakeDb(inserted), provider, lead, "Hi from Brushy Bear");
    expect(result).toEqual({ messageId: "message-1", outboxId: "outbox-1" });
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({
      domain: "sms_voice",
      provider: "outbox",
      recipient: "+14255550101",
      related: { type: "lead", id: lead.id },
    });
    expect(inserted[0]).toMatchObject({
      table: "messages",
      channel: "sms",
      status: "simulated",
      outbox_id: "outbox-1",
      to_address: "+14255550101",
    });
  });

  it("refuses Do not contact leads before anything is recorded", async () => {
    const sink = createMemoryOutboxSink();
    const provider = createOutboxSmsProvider({ orgId: lead.orgId, sink });
    const inserted: Insert[] = [];
    await expect(
      sendLeadSms(fakeDb(inserted), provider, { ...lead, disposition: "do_not_contact" }, "Hi"),
    ).rejects.toBeInstanceOf(ActionFailure);
    expect(sink.entries).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it("refuses any provider other than the outbox", async () => {
    const real = { provider: "twilio", send: async () => ({ status: "sent" as const }) };
    await expect(sendLeadSms(fakeDb([]), real, lead, "Hi")).rejects.toBeInstanceOf(ActionFailure);
  });
});

describe("STOP replies on leads (Phase 8)", () => {
  it("blocks texts but not email or calls", () => {
    const lead = {
      mobile: "+14255550100",
      phone: null,
      email: "a@b.co",
      disposition: null,
      smsOptedOutAt: "2026-10-27T10:00:00Z",
    };
    expect(contactBlockReason(lead, "sms")).toMatch(/replied STOP/);
    expect(contactBlockReason(lead, "email")).toBeNull();
    expect(contactBlockReason(lead, "call")).toBeNull();
  });
});
