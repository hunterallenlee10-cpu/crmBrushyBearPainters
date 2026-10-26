import { afterEach, describe, expect, it, vi } from "vitest";
import { isSupabaseConfigured, parseServerEnv, requireSupabaseEnv } from "@/lib/env";
import { INTEGRATIONS } from "@/lib/integrations/registry";

describe("environment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("an empty environment is valid and every integration stays disconnected", () => {
    const env = parseServerEnv({});
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.DEMO_DATA).toBe(false);
    expect(env.INTEGRATION_SMS_PROVIDER).toBe("outbox");
    expect(env.INTEGRATION_ESIGN_PROVIDER).toBe("builtin");
    expect(env.INTEGRATION_AI_PROVIDER).toBe("disabled");
  });

  it("every integration env flag defaults to the registry's disconnected provider", () => {
    const env = parseServerEnv({}) as Record<string, unknown>;
    for (const integration of INTEGRATIONS) {
      for (const v of integration.envVars) {
        expect(env[v], v).toBe(integration.defaultProvider);
      }
    }
  });

  it("treats empty strings as unset", () => {
    expect(parseServerEnv({ APP_URL: "", CRON_SECRET: "" }).CRON_SECRET).toBeUndefined();
  });

  it("rejects unknown providers and short secrets with a readable message", () => {
    expect(() => parseServerEnv({ INTEGRATION_SMS_PROVIDER: "carrier-pigeon" })).toThrow(
      /INTEGRATION_SMS_PROVIDER/,
    );
    expect(() => parseServerEnv({ LEAD_INTAKE_HMAC_SECRET: "short" })).toThrow(
      /LEAD_INTAKE_HMAC_SECRET/,
    );
  });

  it("parses DEMO_DATA as a boolean", () => {
    expect(parseServerEnv({ DEMO_DATA: "true" }).DEMO_DATA).toBe(true);
  });

  it("requireSupabaseEnv explains how to fix a missing config", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(isSupabaseConfigured()).toBe(false);
    expect(() => requireSupabaseEnv()).toThrow(/pnpm supabase start/);
  });

  it("requireSupabaseEnv returns the public settings when present", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    expect(requireSupabaseEnv()).toEqual({ url: "http://127.0.0.1:54321", anonKey: "anon-key" });
  });
});
