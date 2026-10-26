import { describe, expect, it } from "vitest";
import { type TerritoryLite } from "@/lib/domain/territory";
import {
  deleteTerritorySchema,
  describeZipConflicts,
  formatZipList,
  lookupZip,
  territoryConflictMessage,
  territoryFormSchema,
} from "./territories";

const T: TerritoryLite[] = [
  { id: "b", name: "Bellevue", zipCodes: ["98004", "98005"], isServiceArea: true, active: true },
  { id: "k", name: "Kirkland", zipCodes: ["98033", "98034"], isServiceArea: true, active: true },
  { id: "x", name: "Old Area", zipCodes: ["98039"], isServiceArea: true, active: false },
  { id: "o", name: "Outside service area", zipCodes: [], isServiceArea: false, active: true },
];

describe("territoryFormSchema", () => {
  const base = { name: "Mercer Island", zipText: "", isServiceArea: true, active: true };

  it("parses comma, space and newline separated ZIPs into sorted unique codes", () => {
    const r = territoryFormSchema.parse({ ...base, zipText: "98040, 98039\n98040 98039;98004" });
    expect(r.zipText).toEqual(["98004", "98039", "98040"]);
    expect(r.name).toBe("Mercer Island");
  });

  it("allows an empty ZIP list (e.g. Outside service area)", () => {
    expect(territoryFormSchema.parse(base).zipText).toEqual([]);
  });

  it("names the invalid tokens", () => {
    const r = territoryFormSchema.safeParse({ ...base, zipText: "98040, 9804, abcde, 98039-1234" });
    expect(r.success).toBe(false);
    const issue = r.error?.issues.find((i) => i.path[0] === "zipText");
    expect(issue?.message).toBe(`ZIP codes must be 5 digits. Fix "9804", "abcde", "98039-1234".`);
  });

  it("requires a name", () => {
    expect(territoryFormSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
  });
});

describe("deleteTerritorySchema", () => {
  it("requires a reason of at least 3 characters", () => {
    const id = "6f1c2c8e-3b1a-4d2e-9c6f-1a2b3c4d5e6f";
    expect(deleteTerritorySchema.safeParse({ id, reason: " no " }).success).toBe(false);
    expect(deleteTerritorySchema.parse({ id, reason: "  Merged into Bellevue " }).reason).toBe(
      "Merged into Bellevue",
    );
  });
});

describe("formatZipList", () => {
  it("joins sorted ZIPs", () => {
    expect(formatZipList(["98034", "98033"])).toBe("98033, 98034");
  });
});

describe("describeZipConflicts", () => {
  it("groups by territory", () => {
    expect(
      describeZipConflicts([
        { zip: "98005", territory: "Bellevue" },
        { zip: "98004", territory: "Bellevue" },
        { zip: "98033", territory: "Kirkland" },
      ]),
    ).toEqual([
      "98004 and 98005 already belong to Bellevue.",
      "98033 already belongs to Kirkland.",
    ]);
    expect(
      describeZipConflicts([
        { zip: "98004", territory: "Bellevue" },
        { zip: "98005", territory: "Bellevue" },
        { zip: "98006", territory: "Bellevue" },
      ]),
    ).toEqual(["98004, 98005 and 98006 already belong to Bellevue."]);
    expect(describeZipConflicts([])).toEqual([]);
  });
});

describe("lookupZip", () => {
  it("maps an address or ZIP to its territory", () => {
    expect(lookupZip(T, "Kirkland WA 98033")).toEqual({
      kind: "in_area",
      zip: "98033",
      territory: "Kirkland",
    });
    expect(lookupZip(T, "98004-1234")).toEqual({
      kind: "in_area",
      zip: "98004",
      territory: "Bellevue",
    });
  });

  it("flags out-of-area ZIPs and names a turned-off territory that lists it", () => {
    expect(lookupZip(T, "98101")).toEqual({ kind: "out_of_area", zip: "98101", listedUnder: null });
    expect(lookupZip(T, "98039")).toEqual({
      kind: "out_of_area",
      zip: "98039",
      listedUnder: "Old Area",
    });
  });

  it("handles blank and ZIP-less input", () => {
    expect(lookupZip(T, "  ")).toEqual({ kind: "empty" });
    expect(lookupZip(T, "Main Street")).toEqual({ kind: "no_zip" });
  });
});

describe("territoryConflictMessage", () => {
  it("maps the unique name index", () => {
    expect(
      territoryConflictMessage(
        'duplicate key value violates unique constraint "territories_org_name_uidx"',
        "Bellevue",
      ),
    ).toBe(`There's already a territory named "Bellevue".`);
    expect(
      territoryConflictMessage("One or more ZIP codes already belong to Bellevue.", "x"),
    ).toBeNull();
  });
});
