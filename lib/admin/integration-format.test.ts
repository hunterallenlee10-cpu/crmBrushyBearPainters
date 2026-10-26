import { describe, expect, it } from "vitest";
import {
  CONNECT_LOCKED_REASON,
  buildIntegrationCards,
  connectedSummary,
  connectionStatusDisplay,
  envVarsFor,
  providerLabel,
  supportsTestSend,
  type ConnectionRow,
} from "@/lib/admin/integration-format";
import { INTEGRATIONS, UNLOCK_STEP } from "@/lib/integrations/registry";

const seeded: ConnectionRow[] = INTEGRATIONS.map((d) => ({
  domain: d.key,
  provider: d.defaultProvider,
  status: "not_connected",
  last_sync_at: null,
  last_error: null,
}));

describe("buildIntegrationCards", () => {
  it("builds 11 Not connected cards in registry order", () => {
    const cards = buildIntegrationCards(seeded);
    expect(cards).toHaveLength(11);
    expect(cards.map((c) => c.key)).toEqual(INTEGRATIONS.map((d) => d.key));
    expect(
      cards.every((c) => c.statusLabel === "Not connected" && c.statusTone === "neutral"),
    ).toBe(true);
    expect(connectedSummary(cards).label).toBe("0 of 11 connected");
  });

  it("shows the provider in use and the real providers available", () => {
    const cards = buildIntegrationCards(seeded);
    const sms = cards.find((c) => c.key === "sms_voice");
    expect(sms?.providerInUse).toBe("Outbox (simulated)");
    expect(sms?.realProviders).toEqual(["Twilio"]);
    expect(cards.find((c) => c.key === "esign")?.providerInUse).toBe("Built-in (BearSign)");
    expect(cards.find((c) => c.key === "ai")?.providerInUse).toBe("Disabled");
    expect(cards.find((c) => c.key === "email")?.realProviders).toEqual(["Resend", "SendGrid"]);
  });

  it("treats a missing row as not connected and keeps the default provider while disconnected", () => {
    const rows = seeded
      .filter((r) => r.domain !== "weather")
      .map((r) =>
        r.domain === "email"
          ? { ...r, provider: "resend", status: "error", last_error: "Bad key" }
          : r,
      );
    const cards = buildIntegrationCards(rows);
    expect(cards.find((c) => c.key === "weather")?.status).toBe("not_connected");
    const email = cards.find((c) => c.key === "email");
    expect(email?.statusLabel).toBe("Error");
    expect(email?.statusTone).toBe("danger");
    expect(email?.providerInUse).toBe("Outbox (simulated)");
    expect(email?.lastError).toBe("Bad key");
  });

  it("offers a simulated test only for Email and SMS", () => {
    const cards = buildIntegrationCards(seeded);
    expect(cards.filter((c) => c.canTestSend).map((c) => c.key)).toEqual(["sms_voice", "email"]);
    expect(supportsTestSend("calendar")).toBe(false);
  });

  it("keeps the setup checklist ending with the unlock step", () => {
    for (const card of buildIntegrationCards(seeded)) {
      expect(card.setupSteps.at(-1)).toBe(UNLOCK_STEP);
    }
  });
});

describe("helpers", () => {
  it("collects env vars from flags and checklist text", () => {
    const sms = INTEGRATIONS.find((d) => d.key === "sms_voice");
    if (!sms) throw new Error("missing sms_voice");
    expect(envVarsFor(sms)).toEqual([
      "INTEGRATION_SMS_PROVIDER",
      "INTEGRATION_VOICE_PROVIDER",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_NUMBER",
    ]);
  });

  it("labels statuses and providers", () => {
    expect(connectionStatusDisplay("disabled")).toEqual({ label: "Disabled", tone: "warning" });
    expect(connectionStatusDisplay("connected").tone).toBe("success");
    expect(providerLabel("quickbooks_online")).toBe("QuickBooks Online");
    expect(providerLabel("some_new_thing")).toBe("Some New Thing");
  });

  it("explains the lock with a pointer to the docs", () => {
    expect(CONNECT_LOCKED_REASON).toContain("docs/INTEGRATIONS.md → How the lock works");
  });
});
