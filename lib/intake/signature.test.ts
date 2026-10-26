import { describe, expect, it } from "vitest";
import {
  bodyHash,
  computeSignature,
  signatureHeader,
  verifySignature,
} from "@/lib/intake/signature";
import { safeFileName, websiteLeadSchema } from "@/lib/validation/intake";

const SECRET = "test-secret-test-secret-test-secret-1234";
const BODY = JSON.stringify({ name: "Jane Smith", phone: "425-555-0100" });
const NOW = new Date("2026-10-26T18:00:00Z");

describe("intake signature", () => {
  it("accepts a fresh, correct signature", () => {
    expect(verifySignature(signatureHeader(SECRET, BODY, NOW), BODY, SECRET, NOW)).toEqual({
      ok: true,
    });
  });

  it("rejects a changed body", () => {
    const header = signatureHeader(SECRET, BODY, NOW);
    expect(verifySignature(header, BODY.replace("Jane", "John"), SECRET, NOW)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects the wrong secret", () => {
    const header = signatureHeader("another-secret-another-secret-12345", BODY, NOW);
    expect(verifySignature(header, BODY, SECRET, NOW)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects old signatures (replay protection)", () => {
    const old = new Date(NOW.getTime() - 6 * 60 * 1000);
    expect(verifySignature(signatureHeader(SECRET, BODY, old), BODY, SECRET, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it.each([
    [null, "missing"],
    ["", "missing"],
    ["v1=abc", "malformed"],
    ["t=abc,v1=" + "0".repeat(64), "malformed"],
    [`t=${Math.floor(NOW.getTime() / 1000)},v1=xyz`, "malformed"],
  ])("rejects header %j as %s", (header, reason) => {
    expect(verifySignature(header, BODY, SECRET, NOW)).toEqual({ ok: false, reason });
  });

  it("signs '<t>.<body>' with HMAC-SHA256 (vector from openssl)", () => {
    // printf '%s' '1700000000.{"a":1}' | openssl dgst -sha256 -hmac secret
    expect(computeSignature("secret", 1700000000, '{"a":1}')).toBe(
      "49f24e537407743fa4a0242bb63b94b9a47ee99cbbe071ccd8a22550ae411686",
    );
  });

  it("hashes bodies consistently", () => {
    expect(bodyHash(BODY)).toBe(bodyHash(BODY));
    expect(bodyHash(BODY)).not.toBe(bodyHash(BODY + " "));
  });
});

describe("website lead payload", () => {
  it("accepts the website form fields and trims them", () => {
    const parsed = websiteLeadSchema.parse({
      name: "  Jane Smith ",
      phone: "(425) 555-0100",
      services: ["Interior"],
      timeline: "As soon as possible",
      page_path: "/painters/kirkland-wa",
    });
    expect(parsed.name).toBe("Jane Smith");
    expect(parsed.email).toBeNull();
    expect(parsed.photos).toEqual([]);
  });

  it("rejects unknown fields (strict contract)", () => {
    expect(websiteLeadSchema.safeParse({ name: "Jane", phone: "x", is_admin: true }).success).toBe(
      false,
    );
  });

  it("rejects photo paths that didn't come from the upload endpoint", () => {
    const res = websiteLeadSchema.safeParse({
      name: "Jane",
      email: "j@example.com",
      photos: [
        {
          path: "../../etc/passwd",
          file_name: "a.jpg",
          content_type: "image/jpeg",
          size_bytes: 10,
        },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("makes file names storage-safe", () => {
    expect(safeFileName("My Kitchen (1).JPG")).toBe("My-Kitchen-1-.JPG");
    expect(safeFileName("../../evil.png")).toBe("evil.png");
    expect(safeFileName("...")).toBe("upload");
  });
});
