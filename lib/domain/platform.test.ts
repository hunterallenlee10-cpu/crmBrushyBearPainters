import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions";
import { diffPermissions, resolvePermissions } from "@/lib/domain/permissions";
import {
  findZipConflicts,
  normalizeZip,
  parseZipList,
  territoryForZip,
  type TerritoryLite,
} from "@/lib/domain/territory";
import {
  formatCents,
  isInSeason,
  isPlaceholder,
  isValidMonthDay,
  placeholderFields,
  toBusinessHours,
  validateBusinessHours,
} from "@/lib/domain/company-settings";

describe("resolvePermissions (mirror of app.user_perm_scope)", () => {
  const packs = [
    {
      id: "a",
      permissions: [
        { permission: "leads:read", scope: "own" },
        { permission: "jobs:read", scope: "own" },
      ],
    },
    { id: "b", permissions: [{ permission: "leads:read", scope: "all" }] },
    { id: "c", deleted: true, permissions: [{ permission: "hr:read", scope: "all" }] },
  ] as const;

  it("takes the widest scope across packs and ignores deleted packs", () => {
    expect(resolvePermissions({ grantsAll: false, packs })).toEqual({
      "leads:read": "all",
      "jobs:read": "own",
    });
  });

  it("grant overrides add, revoke overrides win", () => {
    const map = resolvePermissions({
      grantsAll: false,
      packs,
      overrides: [
        { permission: "users:read", effect: "grant", scope: "all" },
        { permission: "leads:read", effect: "revoke", scope: "all" },
        { permission: "leads:read", effect: "grant", scope: "all" },
      ],
    });
    expect(map).toEqual({ "jobs:read": "own", "users:read": "all" });
  });

  it("grants_all holds every permission", () => {
    const map = resolvePermissions({ grantsAll: true, packs: [] });
    expect(Object.keys(map)).toHaveLength(PERMISSIONS.length);
    expect(new Set(Object.values(map))).toEqual(new Set(["all"]));
  });

  it("diffs two maps", () => {
    expect(
      diffPermissions(
        { "leads:read": "own", "jobs:read": "all" },
        { "leads:read": "all", "users:read": "all" },
      ),
    ).toEqual({
      added: ["users:read"],
      removed: ["jobs:read"],
      rescoped: [{ permission: "leads:read", from: "own", to: "all" }],
    });
  });
});

describe("territories", () => {
  const territories: TerritoryLite[] = [
    { id: "k", name: "Kirkland", zipCodes: ["98033", "98034"], isServiceArea: true, active: true },
    { id: "b", name: "Bellevue", zipCodes: ["98004"], isServiceArea: true, active: true },
    { id: "x", name: "Old", zipCodes: ["98101"], isServiceArea: true, active: false },
    { id: "o", name: "Outside service area", zipCodes: [], isServiceArea: false, active: true },
  ];

  it.each([
    ["98033", "98033"],
    ["98033-1234", "98033"],
    ["123 Main St, Kirkland, WA 98033", "98033"],
    ["12345 NE 85th St Kirkland WA 98034-5555", "98034"],
    ["no zip here", null],
    ["", null],
  ])("normalizeZip(%j) → %j", (input, expected) => {
    expect(normalizeZip(input)).toBe(expected);
  });

  it("maps ZIPs to active service territories only", () => {
    expect(territoryForZip(territories, "98034")?.name).toBe("Kirkland");
    expect(territoryForZip(territories, "Bellevue WA 98004")?.name).toBe("Bellevue");
    expect(territoryForZip(territories, "98101")).toBeNull();
    expect(territoryForZip(territories, "99999")).toBeNull();
  });

  it("parses ZIP lists and reports invalid entries", () => {
    expect(parseZipList("98033, 98034\n98033 9803x")).toEqual({
      zips: ["98033", "98034"],
      invalid: ["9803x"],
    });
  });

  it("finds conflicts with other territories", () => {
    expect(findZipConflicts(territories, ["98004", "98052"], "k")).toEqual([
      { zip: "98004", territory: "Bellevue" },
    ]);
    expect(findZipConflicts(territories, ["98033"], "k")).toEqual([]);
  });
});

describe("company settings rules", () => {
  it("detects placeholders", () => {
    expect(isPlaceholder("[PHONE]")).toBe(true);
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder("(425) 555-0100")).toBe(false);
    expect(
      placeholderFields({ phone: "[PHONE]", email: "hi@example.com", hours_text: "[HOURS]" }),
    ).toEqual(["phone", "hours_text", "lni_number", "ubi_number"]);
  });

  it("normalizes and validates business hours", () => {
    const hours = toBusinessHours({
      mon: { open: "08:00", close: "17:00" },
      tue: { open: "17:00", close: "08:00" },
      wed: { open: "8am", close: "17:00" },
      sat: { by_appointment: true },
      sun: "closed",
    });
    expect(hours.sat).toEqual({ by_appointment: true });
    expect(hours.sun).toBeNull();
    expect(hours.thu).toBeNull();
    expect(validateBusinessHours(hours)).toEqual({
      tue: "Closing time must be after opening time.",
      wed: "Use 24-hour times like 08:00.",
    });
  });

  it.each([
    ["06-01", true],
    ["09-30", true],
    ["02-29", true],
    ["02-30", false],
    ["13-01", false],
    ["6-1", false],
  ])("isValidMonthDay(%j) → %s", (v, ok) => {
    expect(isValidMonthDay(v)).toBe(ok);
  });

  it("checks the exterior season, including seasons that wrap the year", () => {
    expect(isInSeason("2027-06-01", "06-01", "09-30")).toBe(true);
    expect(isInSeason("2027-09-30", "06-01", "09-30")).toBe(true);
    expect(isInSeason("2027-10-01", "06-01", "09-30")).toBe(false);
    expect(isInSeason("2027-01-15", "11-01", "02-28")).toBe(true);
    expect(isInSeason("2027-06-15", "11-01", "02-28")).toBe(false);
  });

  it("formats cents as dollars", () => {
    expect(formatCents(25000)).toBe("$250.00");
  });
});
