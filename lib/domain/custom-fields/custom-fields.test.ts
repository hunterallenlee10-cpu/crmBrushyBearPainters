import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAYOUT_SECTIONS,
  VALIDATION_STANDARD_FIELDS,
  checkCustomValue,
  checkRule,
  checkRules,
  formatCustomValue,
  layoutKey,
  mergeCustomValues,
  moveSection,
  parseCustomInput,
  parseStoredLayout,
  readCustomInputs,
  resolveLayout,
  ruleSettingsError,
  toApiName,
  toCustomFieldDef,
  toCustomInput,
  toCustomValues,
  toOptionValue,
  toStoredLayout,
  type CustomFieldDef,
  type ValidationRule,
} from "@/lib/domain/custom-fields";
import { JOB_SECTIONS } from "@/lib/domain/jobs/constants";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261031000100_hardening.sql"),
  "utf8",
);

function def(partial: Partial<CustomFieldDef> & Pick<CustomFieldDef, "type">): CustomFieldDef {
  return {
    id: "d1",
    module: "leads",
    apiName: "f",
    label: "Field",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    sortOrder: 0,
    active: true,
    ...partial,
  };
}

const pick = def({
  type: "picklist",
  label: "Brand",
  options: [
    { value: "sw", label: "Sherwin-Williams" },
    { value: "bm", label: "Benjamin Moore" },
  ],
});

describe("api names", () => {
  it("derives a valid api name from a label", () => {
    expect(toApiName("Paint brand preference!")).toBe("paint_brand_preference");
    expect(toApiName("  HOA – approval #  ")).toBe("hoa_approval");
    expect(toApiName("2nd story?")).toBe("nd_story");
    expect(toApiName("!!!")).toBe("");
    expect(toApiName("x".repeat(60))).toHaveLength(40);
    expect(toOptionValue("Benjamin Moore")).toBe("benjamin_moore");
    expect(toOptionValue("2 coats")).toBe("2_coats");
  });

  it("parses rows and values defensively", () => {
    expect(
      toCustomFieldDef({
        id: "1",
        module: "jobs",
        api_name: "permit",
        label: "Permit",
        field_type: "text",
        options: [{ value: "a", label: "A" }, { bad: true }, "x"],
        required: true,
        help_text: null,
        show_in_list: true,
        sort_order: 2,
        active: true,
      }),
    ).toMatchObject({ module: "jobs", type: "text", options: [{ value: "a", label: "A" }] });
    expect(
      toCustomFieldDef({
        id: "1",
        module: "estimates",
        api_name: "x",
        label: "X",
        field_type: "text",
        options: [],
        required: false,
        help_text: null,
        show_in_list: false,
        sort_order: 0,
        active: true,
      }),
    ).toBeNull();
    expect(toCustomValues({ a: 1, b: "x", c: [1], d: ["y"], e: { z: 1 }, f: null })).toEqual({
      a: 1,
      b: "x",
      d: ["y"],
      f: null,
    });
    expect(toCustomValues(null)).toEqual({});
    expect(toCustomValues([1])).toEqual({});
  });
});

describe("checkCustomValue (same rules as app.custom_value_error)", () => {
  it("accepts well-formed values and empties", () => {
    expect(checkCustomValue(def({ type: "text" }), "hello")).toBeNull();
    expect(checkCustomValue(def({ type: "number" }), 3.5)).toBeNull();
    expect(checkCustomValue(def({ type: "currency" }), 12500)).toBeNull();
    expect(checkCustomValue(def({ type: "date" }), "2026-02-28")).toBeNull();
    expect(checkCustomValue(def({ type: "datetime" }), "2026-02-28T10:00:00Z")).toBeNull();
    expect(checkCustomValue(def({ type: "checkbox" }), false)).toBeNull();
    expect(checkCustomValue(pick, "bm")).toBeNull();
    expect(checkCustomValue({ ...pick, type: "multi_picklist" }, ["sw", "bm"])).toBeNull();
    expect(checkCustomValue(def({ type: "url" }), "https://example.com/x")).toBeNull();
    expect(
      checkCustomValue(def({ type: "user" }), "0b3c6d1e-1111-4222-8333-444455556666"),
    ).toBeNull();
    expect(checkCustomValue(def({ type: "text" }), null)).toBeNull();
    expect(checkCustomValue(def({ type: "text" }), undefined)).toBeNull();
  });

  it("rejects the wrong shape with the field's label", () => {
    expect(checkCustomValue(def({ type: "number", label: "Rooms" }), "six")).toBe(
      "Rooms: enter a number.",
    );
    expect(checkCustomValue(def({ type: "currency" }), 12.5)).toMatch(/cents/);
    expect(checkCustomValue(def({ type: "date" }), "2026-02-30")).toMatch(/real date/);
    expect(checkCustomValue(def({ type: "date" }), "02/01/2026")).toMatch(/YYYY-MM-DD/);
    expect(checkCustomValue(def({ type: "datetime" }), "soon")).toMatch(/date and time/);
    expect(checkCustomValue(def({ type: "checkbox" }), "yes")).toMatch(/yes or no/);
    expect(checkCustomValue(pick, "ppg")).toMatch(/listed options/);
    expect(checkCustomValue({ ...pick, type: "multi_picklist" }, ["sw", "ppg"])).toMatch(/listed/);
    expect(checkCustomValue({ ...pick, type: "multi_picklist" }, "sw")).toMatch(/listed/);
    expect(checkCustomValue(def({ type: "url" }), "javascript:alert(1)")).toMatch(/http/);
    expect(checkCustomValue(def({ type: "user" }), "nobody")).toMatch(/person/);
    expect(
      checkCustomValue(
        def({ type: "user" }),
        "0b3c6d1e-1111-4222-8333-444455556666",
        new Set(["x"]),
      ),
    ).toMatch(/person/);
    expect(checkCustomValue(def({ type: "text" }), "x".repeat(501))).toMatch(/500/);
    expect(checkCustomValue(def({ type: "long_text" }), "x".repeat(5001))).toMatch(/5,000/);
    expect(checkCustomValue(def({ type: "text" }), 5)).toMatch(/enter text/);
  });

  it("the SQL check names the same field types", () => {
    for (const t of [
      "text",
      "long_text",
      "url",
      "date",
      "datetime",
      "picklist",
      "user",
      "number",
      "currency",
      "checkbox",
      "multi_picklist",
    ]) {
      expect(MIGRATION).toContain(`'${t}'`);
    }
  });
});

describe("parseCustomInput / format / round trip", () => {
  it("reads form input into stored values", () => {
    expect(parseCustomInput(def({ type: "number" }), "1,250")).toEqual({ value: 1250 });
    expect(parseCustomInput(def({ type: "currency" }), "$1,250.50")).toEqual({ value: 125050 });
    expect(parseCustomInput(def({ type: "currency" }), "12.345")).toHaveProperty("error");
    expect(parseCustomInput(def({ type: "date" }), "3/7/2026")).toEqual({ value: "2026-03-07" });
    expect(parseCustomInput(def({ type: "checkbox" }), "on")).toEqual({ value: true });
    expect(parseCustomInput(def({ type: "checkbox" }), "")).toEqual({ value: null });
    expect(parseCustomInput(def({ type: "checkbox" }), "maybe")).toHaveProperty("error");
    expect(parseCustomInput(pick, "Benjamin Moore")).toEqual({ value: "bm" });
    expect(parseCustomInput({ ...pick, type: "multi_picklist" }, "sw; Benjamin Moore, sw")).toEqual(
      {
        value: ["sw", "bm"],
      },
    );
    expect(parseCustomInput({ ...pick, type: "multi_picklist" }, [])).toEqual({ value: null });
    expect(parseCustomInput(def({ type: "text" }), "  ")).toEqual({ value: null });
    expect(parseCustomInput(def({ type: "text" }), ["a"])).toHaveProperty("error");
    expect(parseCustomInput(def({ type: "datetime" }), "2026-03-07T10:00:00-08:00")).toEqual({
      value: "2026-03-07T18:00:00.000Z",
    });
    expect(parseCustomInput(def({ type: "url" }), "example.com")).toHaveProperty("error");
  });

  it("formats values for display", () => {
    expect(formatCustomValue(def({ type: "currency" }), 125050)).toBe("$1,250.50");
    expect(formatCustomValue(def({ type: "checkbox" }), false)).toBe("No");
    expect(formatCustomValue(pick, "sw")).toBe("Sherwin-Williams");
    expect(formatCustomValue({ ...pick, type: "multi_picklist" }, ["sw", "bm"])).toBe(
      "Sherwin-Williams, Benjamin Moore",
    );
    expect(formatCustomValue(def({ type: "date" }), "2026-03-07")).toBe("Mar 7, 2026");
    expect(formatCustomValue(def({ type: "text" }), null)).toBe("—");
    expect(formatCustomValue(def({ type: "user" }), "u1", new Map([["u1", "Erik"]]))).toBe("Erik");
    expect(formatCustomValue(def({ type: "number" }), 1250)).toBe("1,250");
    expect(formatCustomValue(def({ type: "datetime" }), "2026-03-07T18:00:00Z")).toMatch(
      /Mar 7, 2026/,
    );
  });

  it("turns stored values back into form input", () => {
    expect(toCustomInput(def({ type: "currency" }), 125050)).toBe("1250.50");
    expect(toCustomInput(def({ type: "checkbox" }), true)).toBe(true);
    expect(toCustomInput({ ...pick, type: "multi_picklist" }, null)).toEqual([]);
    expect(toCustomInput(def({ type: "number" }), 3)).toBe("3");
  });

  it("reads a whole form: required, inactive, errors", () => {
    const defs = [
      def({ apiName: "rooms", type: "number", label: "Rooms", required: true }),
      def({ apiName: "brand", type: "picklist", options: pick.options }),
      def({ apiName: "old", type: "text", active: false }),
    ];
    expect(readCustomInputs(defs, { rooms: "", brand: "sw" })).toEqual({
      values: { brand: "sw" },
      errors: { rooms: "Rooms is required." },
    });
    expect(readCustomInputs(defs, { rooms: "4", brand: "x", old: "y" }).errors).toEqual({
      brand: "Field: pick one of the listed options.",
    });
    expect(readCustomInputs(defs, { brand: "bm" }, { enforceRequired: false })).toEqual({
      values: { brand: "bm" },
      errors: {},
    });
    expect(mergeCustomValues({ a: 1, b: "x" }, { a: null, c: true })).toEqual({ b: "x", c: true });
  });
});

describe("validation rules", () => {
  const rule = (r: Partial<ValidationRule> & Pick<ValidationRule, "type">): ValidationRule => ({
    module: "leads",
    field: "zip",
    value: null,
    message: "Bad.",
    active: true,
    ...r,
  });

  it("checks each rule type like the database trigger", () => {
    expect(checkRule(rule({ type: "regex", value: "^\\d{5}$" }), "98004")).toBeNull();
    expect(checkRule(rule({ type: "regex", value: "^\\d{5}$" }), "980")).toBe("Bad.");
    expect(checkRule(rule({ type: "regex", value: "^\\d{5}$" }), "")).toBeNull();
    expect(checkRule(rule({ type: "required" }), "")).toBe("Bad.");
    expect(checkRule(rule({ type: "required" }), [])).toBe("Bad.");
    expect(checkRule(rule({ type: "required" }), "x")).toBeNull();
    expect(checkRule(rule({ type: "min", value: "1" }), 0)).toBe("Bad.");
    expect(checkRule(rule({ type: "max", value: "40" }), 41)).toBe("Bad.");
    expect(checkRule(rule({ type: "max", value: "40" }), "40")).toBeNull();
    expect(checkRule(rule({ type: "min", value: "2026-01-01" }), "2025-12-31")).toBe("Bad.");
    expect(
      checkRule(rule({ type: "max", value: "2026-01-01" }), "2026-01-01T10:00:00Z"),
    ).toBeNull();
    expect(checkRule(rule({ type: "min_length", value: "3" }), "ab")).toBe("Bad.");
    expect(checkRule(rule({ type: "max_length", value: "3" }), "abcd")).toBe("Bad.");
    expect(checkRule(rule({ type: "min", value: "5" }), "not a number")).toBeNull();
    expect(checkRule(rule({ type: "regex", value: "^\\d{5}$", active: false }), "x")).toBeNull();
  });

  it("checks only changed fields on update and reads custom values", () => {
    const rules = [
      rule({ type: "regex", value: "^\\d{5}$", message: "ZIP" }),
      rule({ field: "cf:rooms", type: "max", value: "40", message: "Rooms" }),
    ];
    const record = { zip: "1", custom_field_values: { rooms: 99 } };
    expect(checkRules(rules, record)).toEqual({ zip: "ZIP", "cf:rooms": "Rooms" });
    expect(checkRules(rules, record, { changed: new Set(["cf:rooms"]) })).toEqual({
      "cf:rooms": "Rooms",
    });
  });

  it("validates a rule's own settings", () => {
    expect(
      ruleSettingsError(
        { module: "leads", field: "zip", type: "regex", value: "([", message: "x" },
        [],
      ),
    ).toMatch(/valid/);
    expect(
      ruleSettingsError(
        { module: "leads", field: "score", type: "min", value: "1", message: "x" },
        [],
      ),
    ).toMatch(/listed/);
    expect(
      ruleSettingsError(
        { module: "leads", field: "cf:nope", type: "required", value: null, message: "x" },
        ["rooms"],
      ),
    ).toMatch(/custom/);
    expect(
      ruleSettingsError(
        { module: "leads", field: "cf:rooms", type: "min", value: "abc", message: "x" },
        ["rooms"],
      ),
    ).toMatch(/number or a date/);
    expect(
      ruleSettingsError(
        { module: "leads", field: "zip", type: "max_length", value: "1.5", message: "x" },
        [],
      ),
    ).toMatch(/whole/);
    expect(
      ruleSettingsError(
        { module: "leads", field: "zip", type: "required", value: null, message: " " },
        [],
      ),
    ).toMatch(/message/);
    expect(
      ruleSettingsError(
        { module: "jobs", field: "name", type: "min_length", value: "3", message: "Name" },
        [],
      ),
    ).toBeNull();
  });

  it("standard fields agree with app.validation_standard_fields()", () => {
    const fn = MIGRATION.split(
      "create or replace function app.validation_standard_fields",
    )[1]!.split("$$;")[0]!;
    for (const [module, fields] of Object.entries(VALIDATION_STANDARD_FIELDS)) {
      const block = fn.split(`when '${module}' then array[`)[1]!.split("]")[0]!;
      const sql = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      expect(sql, module).toEqual(fields.map((f) => f.key));
    }
  });
});

describe("page layouts", () => {
  it("orders by the saved layout, appends new sections, keeps locked ones visible", () => {
    const resolved = resolveLayout("leads", [
      { key: "tasks", visible: true },
      { key: "details", visible: false },
      { key: "gone", visible: true },
      { key: "tasks", visible: false },
      { key: "notes", visible: false },
    ]);
    expect(resolved.map((s) => s.key)).toEqual([
      "tasks",
      "details",
      "notes",
      "custom_fields",
      "activity",
      "comments",
    ]);
    expect(resolved.find((s) => s.key === "details")!.visible).toBe(true);
    expect(resolved.find((s) => s.key === "notes")!.visible).toBe(false);
    expect(toStoredLayout(resolved)[1]).toEqual({ key: "details", visible: true });
    expect(resolveLayout("jobs", null).map((s) => s.key)[0]).toBe("overview");
  });

  it("covers every job section", () => {
    const keys = LAYOUT_SECTIONS.jobs.map((s) => s.key);
    for (const s of JOB_SECTIONS) expect(keys).toContain(layoutKey(s.id));
  });

  it("parses stored layouts and moves sections", () => {
    expect(parseStoredLayout([{ key: "a", visible: true }, { key: 1 }, null, "x"])).toEqual([
      { key: "a", visible: true },
    ]);
    expect(parseStoredLayout("nope")).toEqual([]);
    expect(moveSection(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveSection(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});
