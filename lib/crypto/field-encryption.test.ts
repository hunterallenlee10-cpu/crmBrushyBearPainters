import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { decryptField, encryptField, FieldEncryptionError } =
  await import("@/lib/crypto/field-encryption");

const KEY = randomBytes(32).toString("base64");

describe("field encryption", () => {
  it("round-trips and never repeats ciphertext for the same value", () => {
    const a = encryptField("Gate 4521#", KEY);
    const b = encryptField("Gate 4521#", KEY);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(a).not.toContain("4521");
    expect(decryptField(a, KEY)).toBe("Gate 4521#");
    expect(decryptField(encryptField("lockbox 🔑 0912", KEY), KEY)).toBe("lockbox 🔑 0912");
  });

  it("refuses the wrong key and tampered data", () => {
    const enc = encryptField("1234", KEY);
    expect(() => decryptField(enc, randomBytes(32).toString("base64"))).toThrow(
      FieldEncryptionError,
    );
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptField(parts.join(":"), KEY)).toThrow(FieldEncryptionError);
    expect(() => decryptField("v2:a:b:c", KEY)).toThrow(FieldEncryptionError);
  });

  it("requires a 32-byte key", () => {
    expect(() => encryptField("x", undefined)).toThrow(/not set/);
    expect(() => encryptField("x", Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
  });
});
