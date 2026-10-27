import { describe, expect, it } from "vitest";
import {
  agreementTemplateSchema,
  catalogItemSchema,
  estimateSetupSchema,
  lineAddSchema,
  lineUpdateSchema,
  paintProductSchema,
  sendSchema,
  versionUpdateSchema,
} from "./estimates";
import { SAMPLE_PRICING } from "@/lib/estimating/engine";

const id = "6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7";

describe("lineUpdateSchema", () => {
  it("leaves out fields that weren't sent (no accidental clearing)", () => {
    const r = lineUpdateSchema.parse({ id, quantity: "120" });
    expect(r.quantity).toBe(120);
    expect(r.customer_note).toBeUndefined();
    expect(r.sheen).toBeUndefined();
    expect(r.paint_product_id).toBeUndefined();
    expect(r.override_price).toBeUndefined();
  });
  it("clears with an empty value and converts dollars to cents", () => {
    const r = lineUpdateSchema.parse({
      id,
      customer_note: "  ",
      sheen: "",
      override_price: "1,250.50",
      unit_price: 12.5,
    });
    expect(r.customer_note).toBeNull();
    expect(r.sheen).toBeNull();
    expect(r.override_price).toBe(125050);
    expect(r.unit_price).toBe(1250);
  });
  it("rejects bad money and choices", () => {
    expect(lineUpdateSchema.safeParse({ id, override_price: "abc" }).success).toBe(false);
    expect(lineUpdateSchema.safeParse({ id, coats: 4 }).success).toBe(false);
  });
});

describe("lineAddSchema", () => {
  it("needs exactly one parent", () => {
    expect(lineAddSchema.safeParse({ catalog_item_id: id }).success).toBe(false);
    expect(
      lineAddSchema.safeParse({ version_id: id, change_order_id: id, catalog_item_id: id }).success,
    ).toBe(false);
    expect(lineAddSchema.safeParse({ version_id: id, catalog_item_id: id }).success).toBe(true);
  });
  it("custom lines need a name and price", () => {
    expect(lineAddSchema.safeParse({ change_order_id: id, custom_name: "Rot" }).success).toBe(
      false,
    );
    const ok = lineAddSchema.parse({ change_order_id: id, custom_name: "Rot", custom_price: "80" });
    expect(ok.custom_price).toBe(8000);
  });
});

describe("versionUpdateSchema", () => {
  it("stores amount discounts in cents and percent as a number", () => {
    expect(
      versionUpdateSchema.parse({
        version_id: id,
        discount_type: "amount",
        discount_value: "250",
        discount_reason: "Repeat customer",
      }).discount_value,
    ).toBe(25000);
    expect(
      versionUpdateSchema.parse({
        version_id: id,
        discount_type: "percent",
        discount_value: 7.5,
        discount_reason: "Neighbor referral",
      }).discount_value,
    ).toBe(7.5);
  });
  it("needs a reason and a sensible value", () => {
    expect(
      versionUpdateSchema.safeParse({ version_id: id, discount_type: "percent", discount_value: 5 })
        .success,
    ).toBe(false);
    expect(
      versionUpdateSchema.safeParse({
        version_id: id,
        discount_type: "percent",
        discount_value: 120,
        discount_reason: "x",
      }).success,
    ).toBe(false);
    const none = versionUpdateSchema.parse({ version_id: id, discount_reason: "ignored" });
    expect(none).toMatchObject({
      discount_type: null,
      discount_value: null,
      discount_reason: null,
    });
  });
});

describe("other estimating schemas", () => {
  it("send needs a channel", () => {
    expect(sendSchema.safeParse({ id, channels: [] }).success).toBe(false);
    expect(sendSchema.safeParse({ id, channels: ["sms"] }).success).toBe(true);
  });
  it("catalog items: rate items need a surface, flat items a price", () => {
    const base = {
      price_book_id: id,
      item_type: "labor",
      family: "interior_labor",
      code: "int_walls_2",
      name: "Walls",
      unit: "sqft",
    };
    expect(
      catalogItemSchema.safeParse({ ...base, pricing_method: "production_rate" }).success,
    ).toBe(false);
    expect(catalogItemSchema.safeParse({ ...base, pricing_method: "flat" }).success).toBe(false);
    expect(
      catalogItemSchema.safeParse({ ...base, pricing_method: "flat", unit_price: "3.25" }).success,
    ).toBe(true);
  });
  it("paint products need a cost and a container", () => {
    const base = {
      brand: "sample_brand",
      product: "Exterior",
      use: "exterior",
      coverage_sqft_per_gal: 350,
    };
    expect(paintProductSchema.safeParse({ ...base, containers: ["gallon"] }).success).toBe(false);
    expect(
      paintProductSchema.safeParse({ ...base, cost_per_gal: "40", containers: [] }).success,
    ).toBe(false);
    const ok = paintProductSchema.parse({
      ...base,
      cost_per_gal: "40",
      containers: ["gallon"],
      voc_g_per_l: "",
    });
    expect(ok.cost_per_gal).toBe(4000);
    expect(ok.voc_g_per_l).toBeNull();
  });
  it("estimate setup takes the pricing knobs, role limits and tax", () => {
    const ok = estimateSetupSchema.safeParse({
      pricing: SAMPLE_PRICING,
      discount_limits: { roles: { estimator: "5" } },
      tax: { rate_percent: "0", default_taxable: true, confirmed_with_accountant: false },
    });
    expect(ok.success).toBe(true);
    expect(
      estimateSetupSchema.safeParse({
        pricing: { ...SAMPLE_PRICING, target_margin_percent: 95 },
        discount_limits: { roles: {} },
        tax: { rate_percent: 0, default_taxable: true, confirmed_with_accountant: false },
      }).success,
    ).toBe(false);
  });
  it("agreement clauses default to always", () => {
    const r = agreementTemplateSchema.parse({
      doc_type: "contract",
      name: "Contract",
      body: "# Contract",
      clauses: [{ title: "Lead", body: "Lead-safe work." }],
    });
    expect(r.clauses?.[0]?.when).toBe("always");
  });
});

describe("blank numbers", () => {
  it("a blank deposit % means the company default, not 0%", () => {
    expect(
      versionUpdateSchema.parse({ version_id: id, deposit_percent: "" }).deposit_percent,
    ).toBeNull();
    expect(
      versionUpdateSchema.parse({ version_id: id, deposit_percent: "25" }).deposit_percent,
    ).toBe(25);
  });
});
