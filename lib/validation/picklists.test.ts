import { describe, expect, it } from "vitest";
import {
  addPicklistValueSchema,
  moveItem,
  normalizeColor,
  picklistConflictMessage,
  reorderPicklistValuesSchema,
  slugifyKey,
  suggestKey,
  uniqueKey,
  updatePicklistValueSchema,
} from "./picklists";

const PICKLIST = "6f1c2c8e-3b1a-4d2e-9c6f-1a2b3c4d5e6f";
const VALUE_A = "0b8f4c2a-1d3e-4f5a-8b6c-7d8e9f0a1b2c";
const VALUE_B = "1c9a5d3b-2e4f-4a6b-9c7d-8e9f0a1b2c3d";

describe("slugifyKey", () => {
  it.each([
    ["Semi-gloss", "semi_gloss"],
    ["  Deck & Fence  ", "deck_and_fence"],
    ["Past Customer (Repeat)", "past_customer_repeat"],
    ["Café Crème", "cafe_creme"],
    ["2-Story Exterior", "2_story_exterior"],
    ["___Weird___Spacing___", "weird_spacing"],
    ["!!!", "value"],
    ["", "value"],
  ])("%s → %s", (label, key) => {
    expect(slugifyKey(label)).toBe(key);
  });

  it("always matches the database key rule and length", () => {
    const key = slugifyKey("A ".repeat(80));
    expect(key).toMatch(/^[a-z0-9][a-z0-9_]*$/);
    expect(key.length).toBeLessThanOrEqual(60);
    expect(key.endsWith("_")).toBe(false);
  });
});

describe("uniqueKey / suggestKey", () => {
  it("returns the base when free", () => {
    expect(uniqueKey("satin", ["flat", "matte"])).toBe("satin");
  });
  it("adds the first free numeric suffix", () => {
    expect(uniqueKey("satin", ["satin", "satin_2"])).toBe("satin_3");
  });
  it("keeps suffixed keys within 60 characters", () => {
    const base = "a".repeat(60);
    const k = uniqueKey(base, [base]);
    expect(k.length).toBeLessThanOrEqual(60);
    expect(k.endsWith("_2")).toBe(true);
  });
  it("slugifies then de-duplicates", () => {
    expect(suggestKey("Semi-gloss", ["semi_gloss"])).toBe("semi_gloss_2");
  });
});

describe("moveItem", () => {
  it("moves up and down", () => {
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });
  it("ignores moves past either end and never mutates", () => {
    const input = ["a", "b"];
    expect(moveItem(input, 0, -1)).toEqual(["a", "b"]);
    expect(moveItem(input, 1, 1)).toEqual(["a", "b"]);
    expect(moveItem(input, 5, -1)).toEqual(["a", "b"]);
    expect(input).toEqual(["a", "b"]);
  });
});

describe("normalizeColor", () => {
  it("normalizes hex colors", () => {
    expect(normalizeColor(" #2f6b4f ")).toBe("#2F6B4F");
    expect(normalizeColor("2f6b4f")).toBe("#2F6B4F");
    expect(normalizeColor("")).toBeNull();
    expect(normalizeColor("green")).toBe("green");
  });
});

describe("addPicklistValueSchema", () => {
  const base = {
    picklistId: PICKLIST,
    label: "Velvet",
    value: "velvet",
    category: "",
    parentValueId: "",
    color: "",
  };

  it("accepts a plain value and turns blanks into nulls", () => {
    const r = addPicklistValueSchema.parse(base);
    expect(r).toEqual({ ...base, category: null, parentValueId: null, color: null });
  });

  it("validates key, category, parent and color", () => {
    const r = addPicklistValueSchema.safeParse({
      ...base,
      value: "Has Spaces",
      category: "maybe",
      parentValueId: "nope",
      color: "#12345",
    });
    expect(r.success).toBe(false);
    const paths = r.error?.issues.map((i) => i.path.join(".")).sort();
    expect(paths).toEqual(["category", "color", "parentValueId", "value"]);
  });

  it("accepts a disposition category and parent source", () => {
    const r = addPicklistValueSchema.parse({
      ...base,
      category: "won",
      parentValueId: VALUE_A,
      color: "#abcdef",
    });
    expect(r.category).toBe("won");
    expect(r.parentValueId).toBe(VALUE_A);
    expect(r.color).toBe("#ABCDEF");
  });

  it("requires a label", () => {
    expect(addPicklistValueSchema.safeParse({ ...base, label: "   " }).success).toBe(false);
  });
});

describe("updatePicklistValueSchema", () => {
  it("requires at least one change", () => {
    expect(updatePicklistValueSchema.safeParse({ id: VALUE_A }).success).toBe(false);
    expect(updatePicklistValueSchema.safeParse({ id: VALUE_A, active: false }).success).toBe(true);
  });
  it("clears optional fields with empty strings", () => {
    expect(updatePicklistValueSchema.parse({ id: VALUE_A, color: "", parentValueId: "" })).toEqual({
      id: VALUE_A,
      color: null,
      parentValueId: null,
    });
  });
});

describe("reorderPicklistValuesSchema", () => {
  it("rejects duplicates", () => {
    expect(
      reorderPicklistValuesSchema.safeParse({ picklistId: PICKLIST, valueIds: [VALUE_A, VALUE_A] })
        .success,
    ).toBe(false);
    expect(
      reorderPicklistValuesSchema.safeParse({ picklistId: PICKLIST, valueIds: [VALUE_B, VALUE_A] })
        .success,
    ).toBe(true);
  });
});

describe("picklistConflictMessage", () => {
  it("maps the unique constraints to field messages", () => {
    expect(
      picklistConflictMessage(
        'duplicate key value violates unique constraint "picklist_values_label_uidx"',
        "Satin",
      ),
    ).toEqual({
      field: "label",
      message: `There's already a value labeled "Satin" in this picklist.`,
    });
    expect(
      picklistConflictMessage(
        'duplicate key value violates unique constraint "picklist_values_picklist_id_value_key"',
        "Satin",
        "satin",
      )?.field,
    ).toBe("value");
    expect(picklistConflictMessage("something else", "x")).toBeNull();
  });
});
