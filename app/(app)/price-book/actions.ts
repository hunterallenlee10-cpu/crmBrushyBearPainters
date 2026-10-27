"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, checkOne } from "@/lib/actions/errors";
import {
  catalogItemSchema,
  paintProductSchema,
  priceBookSchema,
  productionRateAddSchema,
  productionRateSchema,
} from "@/lib/validation/estimates";

/**
 * Price Book, Paint Catalog and Production Rates (SPEC §8.12, §7.3). Owners
 * (catalog:manage) edit; row security enforces it again. Saving a row (even
 * unchanged) confirms it: the Sample flag is cleared; the database never lets
 * anyone set it back. Audit rows and events come from
 * the table triggers. Prices already on sent estimates never change.
 */

const refresh = () => {
  revalidatePath("/price-book", "layout");
};

export const savePriceBook = defineAction({
  name: "catalog.save_price_book",
  permissions: ["catalog:manage"],
  schema: priceBookSchema,
  handler: async ({ id, name, description, active }, ctx) => {
    if (id) {
      const rows = check(
        await ctx.supabase
          .from("price_books")
          .update({ name, description, active })
          .eq("id", id)
          .select("id"),
      );
      if (!rows?.length) throw new ActionFailure(actionError("not_found"));
      refresh();
      return { id };
    }
    const row = checkOne(
      await ctx.supabase
        .from("price_books")
        .insert({ org_id: ctx.viewer.orgId, name, description: description ?? null, active })
        .select("id")
        .single(),
    );
    refresh();
    return { id: row.id };
  },
});

export const saveCatalogItem = defineAction({
  name: "catalog.save_item",
  permissions: ["catalog:manage"],
  schema: catalogItemSchema,
  handler: async ({ id, unit_price, unit_cost, ...fields }, ctx) => {
    const values = {
      ...fields,
      surface: fields.pricing_method === "production_rate" ? (fields.surface ?? null) : null,
      unit_price_cents: fields.pricing_method === "flat" ? (unit_price ?? null) : null,
      unit_cost_cents: fields.pricing_method === "flat" ? (unit_cost ?? null) : null,
      customer_description: fields.customer_description ?? null,
      allowance_note: fields.allowance_note ?? null,
      work_type: fields.work_type ?? null,
      default_product_id: fields.default_product_id ?? null,
    };
    if (id) {
      const rows = check(
        await ctx.supabase
          .from("catalog_items")
          .update({ ...values, is_sample: false })
          .eq("id", id)
          .select("id"),
      );
      if (!rows?.length) throw new ActionFailure(actionError("not_found"));
      refresh();
      return { id };
    }
    const row = checkOne(
      await ctx.supabase
        .from("catalog_items")
        .insert({ ...values, org_id: ctx.viewer.orgId, sort_order: 1000 })
        .select("id")
        .single(),
    );
    refresh();
    return { id: row.id };
  },
});

const activeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export const setCatalogItemActive = defineAction({
  name: "catalog.set_item_active",
  permissions: ["catalog:manage"],
  schema: activeSchema,
  handler: async ({ id, active }, ctx) => {
    const rows = check(
      await ctx.supabase.from("catalog_items").update({ active }).eq("id", id).select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("not_found"));
    refresh();
    return { id };
  },
});

export const savePaintProduct = defineAction({
  name: "catalog.save_paint_product",
  permissions: ["catalog:manage"],
  schema: paintProductSchema,
  handler: async ({ id, cost_per_gal, price_per_gal, ...fields }, ctx) => {
    const values = {
      ...fields,
      line: fields.line ?? null,
      base: fields.base ?? null,
      notes: fields.notes ?? null,
      cost_per_gal_cents: cost_per_gal as number,
      price_per_gal_cents: price_per_gal ?? null,
    };
    if (id) {
      const rows = check(
        await ctx.supabase
          .from("paint_products")
          .update({ ...values, is_sample: false })
          .eq("id", id)
          .select("id"),
      );
      if (!rows?.length) throw new ActionFailure(actionError("not_found"));
      refresh();
      return { id };
    }
    const row = checkOne(
      await ctx.supabase
        .from("paint_products")
        .insert({ ...values, org_id: ctx.viewer.orgId })
        .select("id")
        .single(),
    );
    refresh();
    return { id: row.id };
  },
});

export const setPaintProductActive = defineAction({
  name: "catalog.set_paint_product_active",
  permissions: ["catalog:manage"],
  schema: activeSchema,
  handler: async ({ id, active }, ctx) => {
    const rows = check(
      await ctx.supabase.from("paint_products").update({ active }).eq("id", id).select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("not_found"));
    refresh();
    return { id };
  },
});

export const updateProductionRate = defineAction({
  name: "catalog.update_rate",
  permissions: ["catalog:manage"],
  schema: productionRateSchema,
  handler: async ({ id, ...patch }, ctx) => {
    const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as {
      units_per_labor_hour: number;
      prep_hours_per_unit: number;
      notes?: string | null;
    };
    const rows = check(
      await ctx.supabase
        .from("production_rates")
        .update({ ...values, is_sample: false })
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("not_found"));
    refresh();
    return { id };
  },
});

export const addProductionRate = defineAction({
  name: "catalog.add_rate",
  permissions: ["catalog:manage"],
  schema: productionRateAddSchema,
  handler: async (input, ctx) => {
    const row = checkOne(
      await ctx.supabase
        .from("production_rates")
        .insert({ ...input, org_id: ctx.viewer.orgId })
        .select("id")
        .single(),
    );
    refresh();
    return { id: row.id };
  },
});
