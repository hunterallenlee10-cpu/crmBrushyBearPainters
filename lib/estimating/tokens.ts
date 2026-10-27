import { createHash, randomBytes } from "node:crypto";

/**
 * Proposal links (/p/<token>, SPEC §7.5): 32 random bytes, base64url. Only the
 * SHA-256 of a token is stored, so a database leak doesn't hand out live links.
 */

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateProposalToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashProposalToken(token) };
}

export function hashProposalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isProposalToken(v: string): boolean {
  return TOKEN_RE.test(v);
}

export function proposalUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/p/${token}`;
}

/** SHA-256 of a PNG data URL's bytes (stored with the signature). */
export function signatureHash(dataUrl: string): string {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
}
