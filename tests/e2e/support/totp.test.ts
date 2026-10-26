import { describe, expect, it } from "vitest";
import { base32Decode, totp } from "./totp";

// RFC 6238 Appendix B test vectors (SHA-1, secret "12345678901234567890").
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  it("decodes base32", () => {
    expect(base32Decode(SECRET).toString("ascii")).toBe("12345678901234567890");
  });

  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (seconds, code) => {
    expect(totp(SECRET, seconds * 1000)).toBe(code);
  });
});
