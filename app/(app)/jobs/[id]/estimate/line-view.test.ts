import { describe, expect, it } from "vitest";
import { priceVersion } from "@/lib/estimating/engine";
import { interiorJob } from "@/lib/domain/estimating/fixtures";
import type { LineRow } from "@/lib/estimating/map";
import { issuesOf, toBuilderLine } from "./line-view";

function row(over: Partial<LineRow> = {}): LineRow {
  return {
    id: "l1",
    org_id: "o",
    version_id: "v",
    change_order_id: null,
    option_id: "opt",
    area_id: "a",
    is_optional: false,
    is_credit: false,
    catalog_item_id: null,
    kind: "flat",
    name: "Color consultation",
    catalog_code: "color_consultation",
    surface: null,
    unit: "lump",
    work_type: null,
    work_order_phase: null,
    quantity: 1,
    sides: 1,
    condition: "good",
    prep_level: "standard",
    coats: 2,
    primer: "none",
    color_change: "same",
    method: "brush_roll",
    access: "ladder",
    height: "one_story",
    sheen: "satin",
    paint_product_id: null,
    primer_product_id: null,
    paint_sqft_per_unit: 0,
    lead_safe: false,
    taxable: true,
    is_repair_allowance: false,
    unit_price_cents: 15000,
    unit_cost_cents: 5000,
    labor_hours_per_unit: 1,
    override_price_cents: null,
    override_reason: null,
    customer_note: null,
    measurement: {},
    labor_hours: 1,
    gallons: 0,
    primer_gallons: 0,
    cost_cents: 5000,
    computed_price_cents: 15000,
    price_cents: 15000,
    issues: [{ severity: "warning", message: "Stored warning" }, "junk", { severity: "x" }],
    sort_order: 10,
    created_at: "",
    updated_at: "",
    created_by: null,
    updated_by: null,
    ...over,
  } as LineRow;
}

describe("toBuilderLine", () => {
  it("shows stored (frozen) numbers without a live result", () => {
    const l = toBuilderLine(row(), undefined, new Map([["satin", "Satin"]]));
    expect(l).toMatchObject({ priceCents: 15000, laborHours: 1, gallons: 0, quantity: 1 });
    expect(l.issues).toEqual([{ severity: "warning", message: "Stored warning" }]);
    expect(l.description).toContain("Color consultation");
  });
  it("uses the live engine result for drafts", () => {
    const priced = priceVersion(interiorJob());
    const live = priced.lines[0]!;
    const l = toBuilderLine(row({ id: live.line.id, kind: "production_rate" }), live, new Map());
    expect(l.priceCents).toBe(live.priced.priceCents);
    expect(l.issues.length).toBe(live.priced.issues.length);
  });
  it("issuesOf ignores anything that isn't an issue", () => {
    expect(issuesOf(null)).toEqual([]);
    expect(issuesOf([{ severity: "error", message: "Bad" }])).toEqual([
      { severity: "error", message: "Bad" },
    ]);
  });
});
