import { describe, expect, it } from "vitest";
import {
  INTEGRATIONS,
  INTEGRATION_COUNT,
  connectedIntegrationCount,
} from "@/lib/integrations/registry";

describe("integration registry (SPEC §2.1)", () => {
  it("lists the 11 domains from the spec", () => {
    expect(INTEGRATION_COUNT).toBe(11);
    expect(INTEGRATIONS.map((i) => i.interfaces.join("+"))).toEqual([
      "SmsProvider+VoiceProvider",
      "EmailProvider",
      "CalendarProvider",
      "AccountingProvider",
      "PaymentsProvider",
      "ESignProvider",
      "GeoProvider",
      "WeatherProvider",
      "PhotoSyncProvider",
      "ReviewsProvider",
      "AiProvider",
    ]);
  });

  it("keys and env vars are unique", () => {
    const keys = INTEGRATIONS.map((i) => i.key);
    const envs = INTEGRATIONS.flatMap((i) => i.envVars);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(envs).size).toBe(envs.length);
  });

  it("nothing is connected and no default provider is a real one", () => {
    expect(connectedIntegrationCount()).toBe(0);
    for (const i of INTEGRATIONS) {
      expect(["outbox", "builtin", "disabled"]).toContain(i.defaultProvider);
      expect(i.realProviders as readonly string[]).not.toContain(i.defaultProvider);
      expect(i.realProviders.length).toBeGreaterThan(0);
    }
  });
});
