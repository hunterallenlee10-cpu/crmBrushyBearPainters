import { describe, expect, it } from "vitest";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import { createOutboxSmsProvider } from "@/lib/integrations/sms_voice/outbox";
import { createOutboxEmailProvider } from "@/lib/integrations/email/outbox";
import { ActionFailure } from "@/lib/actions/errors";
import {
  jobCallRecipient,
  jobContactBlockReason,
  jobSmsRecipient,
  logJobCall,
  sendJobEmail,
  sendJobSms,
  type JobRecipient,
  type MessagingJob,
} from "@/lib/jobs/messaging";

const contact: JobRecipient = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "Sam Sample",
  mobile: "+14255550101",
  phone: "+14255550102",
  email: "sam@example.com",
  doNotContact: false,
  optedOutAt: null,
};

describe("jobContactBlockReason", () => {
  it("allows a reachable contact on every channel", () => {
    for (const ch of ["sms", "email", "call"] as const) {
      expect(jobContactBlockReason(contact, ch)).toBeNull();
    }
  });

  it("needs a primary contact", () => {
    expect(jobContactBlockReason(null, "sms")).toMatch(/no primary contact/);
  });

  it("blocks every channel for Do Not Contact (contact flag or the lead's disposition)", () => {
    for (const ch of ["sms", "email", "call"] as const) {
      expect(jobContactBlockReason({ ...contact, doNotContact: true }, ch)).toMatch(
        /asked not to be contacted/,
      );
      expect(jobContactBlockReason(contact, ch, { leadDisposition: "do_not_contact" })).toMatch(
        /asked not to be contacted/,
      );
    }
  });

  it("blocks only texts after a STOP reply", () => {
    const stopped = { ...contact, optedOutAt: "2026-10-01T00:00:00Z" };
    expect(jobContactBlockReason(stopped, "sms")).toMatch(/replied STOP/);
    expect(jobContactBlockReason(stopped, "email")).toBeNull();
    expect(jobContactBlockReason(stopped, "call")).toBeNull();
  });

  it("explains a missing mobile, email or phone", () => {
    expect(jobContactBlockReason({ ...contact, mobile: null }, "sms")).toBe(
      "Add a mobile number before sending SMS.",
    );
    expect(jobContactBlockReason({ ...contact, email: null }, "email")).toMatch(/email address/);
    expect(jobContactBlockReason({ ...contact, mobile: null, phone: null }, "call")).toMatch(
      /phone number/,
    );
  });

  it("texts the mobile only and calls the mobile, then the phone", () => {
    expect(jobSmsRecipient({ mobile: null })).toBeNull();
    expect(jobSmsRecipient(contact)).toBe("+14255550101");
    expect(jobCallRecipient({ mobile: null, phone: "+14255550102" })).toBe("+14255550102");
    expect(jobCallRecipient(null)).toBeNull();
  });
});

describe("job sends", () => {
  const job: MessagingJob = {
    id: "00000000-0000-4000-8000-000000000001",
    orgId: "00000000-0000-4000-8000-000000000002",
    contact,
    leadDisposition: null,
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
    } as unknown as Parameters<typeof sendJobSms>[0];
  }

  it("records a text in the outbox and logs it on the job with the contact", async () => {
    const sink = createMemoryOutboxSink();
    const provider = createOutboxSmsProvider({ orgId: job.orgId, actorId: "u1", sink });
    const inserted: Insert[] = [];
    const result = await sendJobSms(fakeDb(inserted), provider, job, "Crew arrives at 8");
    expect(result).toEqual({ messageId: "message-1", outboxId: "outbox-1" });
    expect(sink.entries[0]).toMatchObject({
      domain: "sms_voice",
      provider: "outbox",
      recipient: "+14255550101",
      related: { type: "job", id: job.id },
    });
    expect(inserted[0]).toMatchObject({
      table: "messages",
      channel: "sms",
      subject_type: "job",
      subject_id: job.id,
      contact_id: contact.id,
      status: "simulated",
      outbox_id: "outbox-1",
    });
  });

  it("records an email in the outbox", async () => {
    const sink = createMemoryOutboxSink();
    const provider = createOutboxEmailProvider({ orgId: job.orgId, sink });
    const inserted: Insert[] = [];
    await sendJobEmail(fakeDb(inserted), provider, job, { subject: "Colors", body: "Hi\n\nSam" });
    expect(sink.entries[0]).toMatchObject({ domain: "email", recipient: "sam@example.com" });
    expect(inserted[0]).toMatchObject({
      channel: "email",
      email_subject: "Colors",
      subject_type: "job",
    });
  });

  it("refuses Do Not Contact and STOP before anything is recorded", async () => {
    const sink = createMemoryOutboxSink();
    const provider = createOutboxSmsProvider({ orgId: job.orgId, sink });
    const inserted: Insert[] = [];
    await expect(
      sendJobSms(
        fakeDb(inserted),
        provider,
        { ...job, contact: { ...contact, doNotContact: true } },
        "Hi",
      ),
    ).rejects.toBeInstanceOf(ActionFailure);
    await expect(
      sendJobSms(
        fakeDb(inserted),
        provider,
        { ...job, contact: { ...contact, optedOutAt: "2026-10-01T00:00:00Z" } },
        "Hi",
      ),
    ).rejects.toBeInstanceOf(ActionFailure);
    expect(sink.entries).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it("refuses any provider other than the outbox", async () => {
    const real = { provider: "twilio", send: async () => ({ status: "sent" as const }) };
    await expect(sendJobSms(fakeDb([]), real, job, "Hi")).rejects.toBeInstanceOf(ActionFailure);
  });

  it("logs a call without placing one", async () => {
    const inserted: Insert[] = [];
    await logJobCall(fakeDb(inserted), job, {
      outcome: "left_voicemail",
      durationSeconds: 120,
      notes: null,
    });
    expect(inserted[0]).toMatchObject({
      channel: "call",
      status: "logged",
      simulated: false,
      to_address: "+14255550101",
      call_outcome: "left_voicemail",
    });
  });
});
