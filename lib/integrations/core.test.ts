import { describe, expect, it } from "vitest";
import {
  REAL_PROVIDERS_LOCKED,
  centsToDecimal,
  createMemoryOutboxSink,
  formatUsd,
  recordSimulated,
  requireRealDeps,
  resolveDomainProvider,
  resolveProviderChoice,
} from "@/lib/integrations/core";
import { createFakeFetch } from "@/lib/integrations/testing";

describe("REAL_PROVIDERS_LOCKED (SPEC §2.1)", () => {
  it("is locked in this build", () => {
    expect(REAL_PROVIDERS_LOCKED).toBe(true);
  });
});

describe("resolveProviderChoice", () => {
  const base = { defaultProvider: "outbox", connectionStatus: "connected", locked: false };

  it("uses the default when the env flag is unset", () => {
    for (const envProvider of [undefined, null, "", "  "]) {
      const choice = resolveProviderChoice({ ...base, envProvider });
      expect(choice).toMatchObject({ provider: "outbox", real: false });
      expect(choice.reason).toMatch(/default provider/);
    }
  });

  it("uses the default when the env flag names the default", () => {
    expect(resolveProviderChoice({ ...base, envProvider: "outbox" })).toMatchObject({
      provider: "outbox",
      real: false,
    });
  });

  it("falls back for an unknown provider", () => {
    const choice = resolveProviderChoice({
      ...base,
      envProvider: "pigeon",
      knownProviders: ["twilio"],
    });
    expect(choice).toMatchObject({ provider: "outbox", real: false });
    expect(choice.reason).toMatch(/Unknown provider/);
  });

  it("falls back while locked, even when connected", () => {
    const choice = resolveProviderChoice({ ...base, envProvider: "twilio", locked: true });
    expect(choice).toMatchObject({ provider: "outbox", real: false });
    expect(choice.reason).toMatch(/locked/);
  });

  it("defaults `locked` to REAL_PROVIDERS_LOCKED", () => {
    const choice = resolveProviderChoice({
      defaultProvider: "outbox",
      envProvider: "twilio",
      connectionStatus: "connected",
    });
    expect(choice.real).toBe(false);
  });

  it("falls back when the connection row is not connected or missing", () => {
    for (const connectionStatus of ["not_connected", "error", "disabled", null, undefined]) {
      const choice = resolveProviderChoice({ ...base, envProvider: "twilio", connectionStatus });
      expect(choice).toMatchObject({ provider: "outbox", real: false });
      expect(choice.reason).toMatch(/not "connected"/);
    }
  });

  it("allows the real provider only when env + connected + unlocked all hold", () => {
    expect(
      resolveProviderChoice({ ...base, envProvider: "twilio", knownProviders: ["twilio"] }),
    ).toMatchObject({ provider: "twilio", real: true });
  });

  it("resolveDomainProvider reads the registry's default and known providers", () => {
    expect(
      resolveDomainProvider("esign", { envProvider: "docusign", connectionStatus: "connected" }),
    ).toMatchObject({ provider: "builtin", real: false });
    expect(
      resolveDomainProvider("esign", {
        envProvider: "docusign",
        connectionStatus: "connected",
        locked: false,
      }),
    ).toMatchObject({ provider: "docusign", real: true });
    expect(
      resolveDomainProvider("email", {
        envProvider: "twilio",
        connectionStatus: "connected",
        locked: false,
      }),
    ).toMatchObject({ provider: "outbox", real: false });
  });
});

describe("outbox helpers", () => {
  it("memory sink keeps entries and returns ids", async () => {
    const sink = createMemoryOutboxSink();
    const result = await recordSimulated(
      { orgId: "org-1", actorId: "user-1", sink },
      { domain: "sms_voice", provider: "outbox", operation: "sms.send", payload: { a: 1 } },
    );
    expect(result).toEqual({ status: "simulated", outboxId: "outbox-1" });
    expect(sink.entries).toEqual([
      {
        id: "outbox-1",
        orgId: "org-1",
        createdBy: "user-1",
        domain: "sms_voice",
        provider: "outbox",
        operation: "sms.send",
        payload: { a: 1 },
      },
    ]);
  });

  it("requireRealDeps throws for missing fetch or credentials", () => {
    expect(() => requireRealDeps("twilio", undefined, {})).toThrow(/fetch/);
    expect(() => requireRealDeps("twilio", createFakeFetch({}), undefined)).toThrow(/credentials/);
  });
});

describe("money helpers", () => {
  it("converts integer cents to decimal dollars", () => {
    expect(centsToDecimal(123456)).toBe(1234.56);
    expect(centsToDecimal(1999)).toBe(19.99);
    expect(centsToDecimal(5)).toBe(0.05);
    expect(centsToDecimal(0)).toBe(0);
    expect(() => centsToDecimal(10.5)).toThrow(/integer/);
  });

  it("formats cents as USD", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(-250)).toBe("-$2.50");
  });
});
