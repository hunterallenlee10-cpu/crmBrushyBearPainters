import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import { hasAll, hasAny, hasPermission, isPermission, toPermissionMap } from "@/lib/permissions";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function sqlCatalog(): { key: string; label: string; category: string; scoped: boolean }[] {
  const rows: { key: string; label: string; category: string; scoped: boolean }[] = [];
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const block of sql.split("-- @permissions:begin").slice(1)) {
      const body = block.split("-- @permissions:end")[0] ?? "";
      for (const m of body.matchAll(
        /\('([a-z_]+:[a-z_]+)', '((?:[^']|'')*)', '([a-z_]+)', (true|false), \d+\)/g,
      )) {
        rows.push({
          key: m[1]!,
          label: m[2]!.replace(/''/g, "'"),
          category: m[3]!,
          scoped: m[4] === "true",
        });
      }
    }
  }
  return rows;
}

describe("permission catalog", () => {
  it("matches the SQL seed exactly (keys, labels, categories, scope support)", () => {
    const sql = sqlCatalog();
    expect(sql.length).toBeGreaterThan(80);
    const ts = PERMISSIONS.map((p) => ({
      key: p.key,
      label: p.label,
      category: p.category,
      scoped: p.scoped,
    }));
    expect([...ts].sort((a, b) => a.key.localeCompare(b.key))).toEqual(
      [...sql].sort((a, b) => a.key.localeCompare(b.key)),
    );
  });

  it("keys are unique and resource:action shaped", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  it("includes the actions the spec names", () => {
    for (const k of [
      "leads:export",
      "jobs:advance_stage",
      "estimates:approve_discount",
      "invoices:edit",
      "payments:record",
      "reports:build",
      "data:export",
      "users:manage",
      "roles:manage",
      "workflows:manage",
      "templates:manage",
      "job_admin:override",
      "records:restore",
      "records:merge",
      "bulk:update",
    ]) {
      expect(isPermission(k), k).toBe(true);
    }
  });
});

describe("permission map helpers", () => {
  const map = toPermissionMap({
    "leads:read": "own",
    "users:read": "all",
    "bogus:key": "all",
    "jobs:read": "nope",
  });

  it("drops unknown keys and bad scopes", () => {
    expect(map).toEqual({ "leads:read": "own", "users:read": "all" });
    expect(toPermissionMap(null)).toEqual({});
  });

  it("checks scope rank", () => {
    expect(hasPermission(map, "leads:read")).toBe(true);
    expect(hasPermission(map, "leads:read", "all")).toBe(false);
    expect(hasPermission(map, "users:read", "team")).toBe(true);
    expect(hasPermission(map, "jobs:read")).toBe(false);
  });

  it("hasAll / hasAny", () => {
    expect(hasAll(map, ["leads:read", "users:read"])).toBe(true);
    expect(hasAll(map, ["leads:read", "jobs:read"])).toBe(false);
    expect(hasAny(map, ["jobs:read", "users:read"])).toBe(true);
    expect(hasAny(map, [])).toBe(false);
  });
});
