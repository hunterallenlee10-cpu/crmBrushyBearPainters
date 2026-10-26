import { describe, expect, it } from "vitest";
import {
  SIMULATED_LABEL,
  isHtmlBody,
  maskContactsInText,
  maskEmail,
  maskPayload,
  maskPhone,
  maskRecipient,
  outboxStatusLabel,
  payloadJson,
} from "@/lib/admin/outbox-format";

describe("masking", () => {
  it("masks emails to the first letter and domain", () => {
    expect(maskEmail("jane@example.com")).toBe("j***@example.com");
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });

  it("masks phones to the last four digits", () => {
    expect(maskPhone("+15555550100")).toBe("+1 ••• ••• 0100");
    expect(maskPhone("(425) 555-0199")).toBe("••• ••• 0199");
    expect(maskPhone("+442071234567")).toBe("••• 4567");
    expect(maskPhone("123")).toBe("123");
  });

  it("masks every recipient in a list and keeps display names", () => {
    expect(maskRecipient("jane@example.com, bob@test.co")).toBe("j***@example.com, b***@test.co");
    expect(maskRecipient("Jane Doe <jane@example.com>")).toBe("Jane Doe <j***@example.com>");
    expect(maskRecipient("+15555550100")).toBe("+1 ••• ••• 0100");
    expect(maskRecipient(null)).toBe("—");
    expect(maskRecipient("  ")).toBe("—");
    expect(maskRecipient("calendar:primary")).toBe("calendar:primary");
  });

  it("masks contacts inside text and payloads, leaving dates alone", () => {
    expect(maskContactsInText("Call +1 425 555 0100 or email jane@example.com on 2026-10-26")).toBe(
      "Call +1 ••• ••• 0100 or email j***@example.com on 2026-10-26",
    );
    expect(
      maskPayload({
        to: ["jane@example.com"],
        body: "hi",
        nested: { phone: "+15555550100" },
        n: 5,
      }),
    ).toEqual({ to: ["j***@example.com"], body: "hi", nested: { phone: "+1 ••• ••• 0100" }, n: 5 });
  });

  it("pretty-prints masked payload JSON", () => {
    const json = payloadJson({ to: "jane@example.com" });
    expect(json).toContain('"to": "j***@example.com"');
    expect(json).not.toContain("jane@");
    expect(payloadJson(null)).toBe("{}");
  });
});

describe("bodies and statuses", () => {
  it("detects HTML bodies", () => {
    expect(isHtmlBody("<p>Hello</p>")).toBe(true);
    expect(isHtmlBody("Hello there")).toBe(false);
    expect(isHtmlBody(null)).toBe(false);
  });

  it("labels simulated rows", () => {
    expect(outboxStatusLabel("simulated")).toBe(SIMULATED_LABEL);
    expect(SIMULATED_LABEL).toBe("Simulated – not sent");
    expect(outboxStatusLabel("failed")).toBe("Failed");
  });
});
