import { describe, expect, it } from "vitest";
import {
  generateProposalToken,
  hashProposalToken,
  isProposalToken,
  proposalUrl,
  signatureHash,
} from "./tokens";

describe("proposal tokens", () => {
  it("generates url-safe tokens and stores only their hash", () => {
    const a = generateProposalToken();
    const b = generateProposalToken();
    expect(isProposalToken(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashProposalToken(a.token)).toBe(a.hash);
    expect(isProposalToken("short")).toBe(false);
    expect(isProposalToken(`${a.token.slice(0, 42)}/`)).toBe(false);
  });

  it("builds the public link and hashes signature images", () => {
    expect(proposalUrl("https://crm.example.com/", "abc")).toBe("https://crm.example.com/p/abc");
    expect(signatureHash("data:image/png;base64,iVBORw0KGgo=")).toMatch(/^[0-9a-f]{64}$/);
  });
});
