import { describe, expect, it } from "vitest";
import { isPublicPath, loginRedirectPath } from "@/lib/auth/paths";

describe("isPublicPath", () => {
  it.each([
    ["/login", true],
    ["/auth/callback", true],
    ["/auth/confirm", true],
    ["/api/health", true],
    ["/api/public/leads", true],
    ["/p/abc123", true],
    ["/dev/ui", true],
    ["/", false],
    ["/leads", false],
    ["/admin/users", false],
    ["/loginx", false],
    ["/api/cron/worker", false],
  ])("%s → %s", (path, expected) => {
    expect(isPublicPath(path)).toBe(expected);
  });
});

describe("loginRedirectPath", () => {
  it.each([
    ["/admin/users?tab=invite", "/admin/users?tab=invite"],
    ["/", null],
    ["//evil.example.com", null],
    ["/\\evil.example.com", null],
    ["https://evil.example.com", null],
    ["/login?next=/x", null],
    ["/auth/callback", null],
    [null, null],
  ])("%j → %j", (input, expected) => {
    expect(loginRedirectPath(input)).toBe(expected);
  });
});
