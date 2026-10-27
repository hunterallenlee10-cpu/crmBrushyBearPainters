import { describe, expect, it } from "vitest";
import { buildCsp, makeNonce, wantsPageCsp } from "@/lib/security/csp";

describe("CSP", () => {
  it("is nonce-based and strict for scripts", () => {
    const csp = buildCsp({ nonce: "abc123", supabaseUrl: "https://xyz.supabase.co/rest/v1" });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("connect-src 'self' https://xyz.supabase.co wss://xyz.supabase.co");
    expect(csp).toContain("img-src 'self' data: blob: https://xyz.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp.endsWith("upgrade-insecure-requests")).toBe(true);
  });

  it("dev allows eval and the dev websocket; local Supabase over http", () => {
    const csp = buildCsp({ nonce: "n", supabaseUrl: "http://127.0.0.1:54321", dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws://127.0.0.1:54321");
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(buildCsp({ nonce: "n", supabaseUrl: "http://127.0.0.1:54321" })).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  it("ignores a bad Supabase URL", () => {
    expect(buildCsp({ nonce: "n", supabaseUrl: "not a url" })).toContain("connect-src 'self';");
  });

  it("makes a fresh base64 nonce each time", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(makeNonce()).not.toBe(a);
  });

  it("applies to pages, not API routes", () => {
    expect(wantsPageCsp("/jobs/1")).toBe(true);
    expect(wantsPageCsp("/p/token")).toBe(true);
    expect(wantsPageCsp("/api/files/x")).toBe(false);
  });
});
