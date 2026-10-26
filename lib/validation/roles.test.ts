import { describe, expect, it } from "vitest";
import {
  withRandomSuffix,
  RECORD_KEY_PATTERN,
  createPackSchema,
  createTemplateSchema,
  deleteRecordSchema,
  diffIds,
  diffPackPermissions,
  keyFromName,
  normalizeScope,
  setTemplatePacksSchema,
} from "@/lib/validation/roles";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID2 = "9b2d5e1a-7c4f-4e8b-a1d2-6f3e8c9b0a11";

describe("withRandomSuffix", () => {
  it("adds a suffix and keeps the key valid and short", () => {
    expect(withRandomSuffix("field_crew_copy", () => "a1b2c3")).toBe("field_crew_copy_a1b2c3");
    const long = withRandomSuffix("x".repeat(60), () => "a1b2c3");
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long).toMatch(RECORD_KEY_PATTERN);
    expect(withRandomSuffix("field_crew")).toMatch(/^field_crew_[0-9a-f]{6}$/);
  });
});

describe("keyFromName", () => {
  it("slugs a display name", () => {
    expect(keyFromName("Painter (Crew Member)")).toBe("painter_crew_member");
    expect(keyFromName("  Lead Painter — Kirkland  ")).toBe("lead_painter_kirkland");
    expect(keyFromName("Sales & Estimates")).toBe("sales_and_estimates");
    expect(keyFromName("Café Crew")).toBe("cafe_crew");
  });

  it("always starts with a letter", () => {
    expect(keyFromName("2nd shift")).toBe("custom_2nd_shift");
    expect(keyFromName("!!!")).toBe("custom");
    expect(keyFromName("", [], "pack")).toBe("pack");
  });

  it("avoids keys already taken", () => {
    expect(keyFromName("Office Manager", ["office_manager"])).toBe("office_manager_2");
    expect(keyFromName("Office Manager", ["office_manager", "office_manager_2"])).toBe(
      "office_manager_3",
    );
  });

  it("caps the length and stays valid", () => {
    const long = keyFromName("a".repeat(120));
    expect(long.length).toBeLessThanOrEqual(48);
    const taken = keyFromName("a".repeat(120), [long]);
    expect(taken.length).toBeLessThanOrEqual(48);
    expect(taken.endsWith("_2")).toBe(true);
    for (const k of [long, taken, keyFromName("Ünïcödé — name ___ x")]) {
      expect(k).toMatch(RECORD_KEY_PATTERN);
    }
  });
});

describe("schemas", () => {
  it("requires a name and a template to clone", () => {
    const bad = createTemplateSchema.safeParse({ name: " ", description: "", clone_from_id: "x" });
    expect(bad.success).toBe(false);
    const ok = createTemplateSchema.parse({ name: " Lead ", description: "", clone_from_id: UUID });
    expect(ok).toEqual({ name: "Lead", description: null, clone_from_id: UUID });
  });

  it("stores unscoped permissions as 'all'", () => {
    const v = createPackSchema.parse({
      name: "Photos",
      description: "",
      category: "production",
      permissions: [
        { permission: "photos:read", scope: "own" },
        { permission: "photos:upload", scope: "own" },
      ],
    });
    expect(v.permissions).toEqual([
      { permission: "photos:read", scope: "own" },
      { permission: "photos:upload", scope: "all" },
    ]);
    expect(normalizeScope("leads:read", "team")).toBe("team");
    expect(normalizeScope("leads:create", "team")).toBe("all");
  });

  it("rejects empty, duplicate or unknown permissions", () => {
    const base = { name: "X", description: "", category: "sales" };
    expect(createPackSchema.safeParse({ ...base, permissions: [] }).success).toBe(false);
    expect(
      createPackSchema.safeParse({
        ...base,
        permissions: [
          { permission: "jobs:read", scope: "all" },
          { permission: "jobs:read", scope: "own" },
        ],
      }).success,
    ).toBe(false);
    expect(
      createPackSchema.safeParse({ ...base, permissions: [{ permission: "nope:x", scope: "all" }] })
        .success,
    ).toBe(false);
    expect(
      createPackSchema.safeParse({
        ...base,
        category: "marketing",
        permissions: [{ permission: "jobs:read", scope: "all" }],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate packs on a template", () => {
    expect(
      setTemplatePacksSchema.safeParse({ template_id: UUID, pack_ids: [UUID2, UUID2] }).success,
    ).toBe(false);
    expect(setTemplatePacksSchema.safeParse({ template_id: UUID, pack_ids: [] }).success).toBe(
      true,
    );
  });

  it("requires a delete reason", () => {
    expect(
      deleteRecordSchema.safeParse({ table: "role_templates", id: UUID, reason: " a " }).success,
    ).toBe(false);
    expect(
      deleteRecordSchema.safeParse({ table: "profiles", id: UUID, reason: "No longer used" })
        .success,
    ).toBe(false);
    expect(
      deleteRecordSchema.parse({ table: "permission_packs", id: UUID, reason: " Not needed " })
        .reason,
    ).toBe("Not needed");
  });
});

describe("diffs", () => {
  it("diffs pack permission rows", () => {
    expect(
      diffPackPermissions(
        [
          { permission: "jobs:read", scope: "own" },
          { permission: "jobs:create", scope: "all" },
        ],
        [
          { permission: "jobs:read", scope: "all" },
          { permission: "photos:upload", scope: "all" },
        ],
      ),
    ).toEqual({
      insert: [{ permission: "photos:upload", scope: "all" }],
      update: [{ permission: "jobs:read", scope: "all" }],
      remove: ["jobs:create"],
    });
  });

  it("diffs pack id lists", () => {
    expect(diffIds(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(diffIds([], [])).toEqual({ add: [], remove: [] });
  });
});
