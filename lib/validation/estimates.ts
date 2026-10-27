import { z } from "zod";
import {
  ACCESS_TYPES,
  AGREEMENT_DOC_TYPES,
  CATALOG_FAMILIES,
  CATALOG_ITEM_TYPES,
  COLOR_CHANGES,
  COLOR_CHANGE_ACTIONS,
  CONDITIONS,
  CONTAINERS,
  HEIGHTS,
  METHODS,
  PREP_LEVELS,
  PRICING_METHODS,
  PRIMERS,
  PRODUCT_USES,
  UNITS,
  WORK_ORDER_PHASES,
  pricingJsonSchema,
} from "@/lib/estimating/engine";
import { dollarsToCents } from "./common";

/** Zod schemas for estimating Server Actions and forms (SPEC §7, §8.12, §8.19). */

const uuid = z.uuid();
const key = z.string().regex(/^[a-z0-9][a-z0-9_]{0,59}$/, "Pick one of the choices.");
const text = (max: number) =>
  z
    .string()
    .max(max, `Keep it under ${max} characters.`)
    .optional()
    .nullable()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : null;
    });
const name = (label: string, max = 120) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `Keep it under ${max} characters.`);
const optionalUuid = z
  .union([uuid, z.literal("")])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const optionalKey = z
  .union([key, z.literal("")])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** "$1,234.50" → cents; empty → null. */
const dollars = (label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const cents = typeof v === "number" ? Math.round(v * 100) : dollarsToCents(v);
      if (cents === null) return null;
      if (Number.isNaN(cents) || cents < 0 || cents > 100_000_000) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be a dollar amount like 250 or 250.00.`,
        });
        return z.NEVER;
      }
      return cents;
    });

const quantity = z.coerce
  .number({ message: "Enter a number." })
  .min(0, "Use zero or more.")
  .max(10_000_000, "That's too large.");

// --- Estimates ----------------------------------------------------------------------------

export const createEstimateSchema = z.object({ job_id: uuid, title: text(200) });

export const versionIdSchema = z.object({ version_id: uuid });

export const versionUpdateSchema = z
  .object({
    version_id: uuid,
    discount_type: z.enum(["none", "amount", "percent"]).default("none"),
    /** Percent as a number, or a dollar amount. */
    discount_value: z.union([z.string(), z.number()]).optional().nullable(),
    discount_reason: text(500),
    deposit_percent: z
      .union([z.coerce.number().min(0).max(100), z.literal("")])
      .optional()
      .nullable()
      .transform((v) => (v === "" || v === undefined ? null : v)),
    customer_notes: text(4000),
    internal_notes: text(4000),
  })
  .transform((v, ctx) => {
    let value: number | null = null;
    if (v.discount_type === "percent") {
      const n = Number(v.discount_value);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        ctx.addIssue({
          code: "custom",
          path: ["discount_value"],
          message: "Enter a percent between 0 and 100.",
        });
        return z.NEVER;
      }
      value = Math.round(n * 100) / 100;
    } else if (v.discount_type === "amount") {
      const cents =
        typeof v.discount_value === "number"
          ? Math.round(v.discount_value * 100)
          : dollarsToCents(String(v.discount_value ?? ""));
      if (cents === null || Number.isNaN(cents) || cents <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["discount_value"],
          message: "Enter a dollar amount like 250.",
        });
        return z.NEVER;
      }
      value = cents;
    }
    if (v.discount_type !== "none" && !v.discount_reason) {
      ctx.addIssue({
        code: "custom",
        path: ["discount_reason"],
        message: "Say why there's a discount.",
      });
      return z.NEVER;
    }
    return {
      version_id: v.version_id,
      discount_type: v.discount_type === "none" ? null : v.discount_type,
      discount_value: value,
      discount_reason: v.discount_type === "none" ? null : v.discount_reason,
      deposit_percent: v.deposit_percent,
      customer_notes: v.customer_notes,
      internal_notes: v.internal_notes,
    };
  });

export const optionAddSchema = z.object({ version_id: uuid, name: name("Option name") });
export const optionUpdateSchema = z.object({
  id: uuid,
  name: name("Option name").optional(),
  description: text(1000),
  is_recommended: z.boolean().optional(),
});
export const idSchema = z.object({ id: uuid });

export const areaAddSchema = z.object({
  version_id: uuid,
  option_id: uuid,
  name: name("Area name"),
  work_type: optionalKey,
});
export const areaUpdateSchema = z.object({
  id: uuid,
  name: name("Area name").optional(),
  work_type: optionalKey,
  notes: text(1000),
});
export const areaCopySchema = z.object({ id: uuid, to_option_id: uuid });

export const lineAddSchema = z
  .object({
    version_id: optionalUuid,
    change_order_id: optionalUuid,
    option_id: optionalUuid,
    area_id: optionalUuid,
    catalog_item_id: optionalUuid,
    /** A custom line (no catalog item): flat price per unit. */
    custom_name: text(160),
    custom_unit: z.enum(UNITS).optional(),
    custom_price: dollars("Price"),
    custom_cost: dollars("Cost"),
    is_credit: z.boolean().optional(),
  })
  .refine((v) => (v.version_id === null) !== (v.change_order_id === null), {
    message: "Pick an estimate or a change order.",
  })
  .refine(
    (v) => v.catalog_item_id !== null || (v.custom_name !== null && v.custom_price !== null),
    {
      message: "Pick a catalog item, or enter a name and price.",
      path: ["catalog_item_id"],
    },
  );

export const measurementSchema = z
  .object({
    kind: z.enum(["room_walls", "room_ceiling", "room_baseboard", "exterior_wall", "fence"]),
    lengthFt: z.coerce.number().min(0).max(10_000).optional(),
    widthFt: z.coerce.number().min(0).max(10_000).optional(),
    heightFt: z.coerce.number().min(0).max(1_000).optional(),
    doors: z.coerce.number().int().min(0).max(100).optional(),
    windows: z.coerce.number().int().min(0).max(200).optional(),
    gableFactor: z.coerce.number().min(1).max(3).optional(),
    sides: z.union([z.literal(1), z.literal(2)]).optional(),
  })
  .partial({ kind: true });
export type MeasurementInput = z.infer<typeof measurementSchema>;

export const lineUpdateSchema = z.object({
  id: uuid,
  name: name("Name", 160).optional(),
  customer_note: text(500),
  quantity: quantity.optional(),
  sides: z.union([z.literal(1), z.literal(2)]).optional(),
  condition: z.enum(CONDITIONS).optional(),
  prep_level: z.enum(PREP_LEVELS).optional(),
  coats: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  primer: z.enum(PRIMERS).optional(),
  color_change: z.enum(COLOR_CHANGES).optional(),
  method: z.enum(METHODS).optional(),
  access: z.enum(ACCESS_TYPES).optional(),
  height: z.enum(HEIGHTS).optional(),
  sheen: optionalKey,
  paint_product_id: optionalUuid,
  primer_product_id: optionalUuid,
  lead_safe: z.boolean().optional(),
  taxable: z.boolean().optional(),
  unit_price: dollars("Unit price"),
  unit_cost: dollars("Unit cost"),
  /** Empty clears the override. */
  override_price: dollars("Override price"),
  override_reason: text(500),
  measurement: measurementSchema.optional().nullable(),
});
export type LineUpdateInput = z.input<typeof lineUpdateSchema>;

const channel = z.enum(["sms", "email"]);
export const sendSchema = z.object({
  id: uuid,
  channels: z.array(channel).min(1, "Pick text, email or both.").max(2),
  sms_body: z.string().max(1000).optional().nullable(),
  email_subject: z.string().max(200).optional().nullable(),
  email_body: z.string().max(5000).optional().nullable(),
});

export const requestDiscountSchema = z.object({
  version_id: uuid,
  reason: z.string().trim().min(10, "Say why (at least 10 characters).").max(1000),
});

export const colorUpdateSchema = z.object({
  id: uuid,
  brand: optionalKey,
  color_name: text(120),
  color_code: text(40),
  sheen: optionalKey,
  paint_product_id: optionalUuid,
  finish_notes: text(1000),
  confirmed: z.boolean().optional(),
});
export const colorAddSchema = z.object({
  job_id: uuid,
  area: name("Area"),
  surface: name("Surface", 160),
});

// --- Change orders -------------------------------------------------------------------------

export const changeOrderCreateSchema = z.object({
  job_id: uuid,
  title: name("Title", 160),
  reason: text(2000),
});
export const changeOrderUpdateSchema = z.object({
  id: uuid,
  title: name("Title", 160).optional(),
  reason: text(2000),
  bill_separately: z.boolean().optional(),
});
/** Crew leads start a draft from the field: what they found, no prices. */
export const fieldChangeOrderSchema = z.object({
  job_id: uuid,
  title: name("What did you find?", 160),
  field_notes: z.string().trim().min(5, "Add a few words about it.").max(2000),
});

// --- Catalog --------------------------------------------------------------------------------

export const priceBookSchema = z.object({
  id: optionalUuid,
  name: name("Name"),
  description: text(1000),
  active: z.boolean().default(true),
});

export const catalogItemSchema = z
  .object({
    id: optionalUuid,
    price_book_id: uuid,
    item_type: z.enum(CATALOG_ITEM_TYPES),
    family: z.enum(CATALOG_FAMILIES),
    code: key,
    name: name("Name", 160),
    customer_description: text(1000),
    unit: z.enum(UNITS),
    pricing_method: z.enum(PRICING_METHODS),
    surface: optionalKey,
    work_type: optionalKey,
    work_order_phase: z
      .union([z.enum(WORK_ORDER_PHASES), z.literal("")])
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
    paint_sqft_per_unit: z.coerce.number().min(0).max(10_000).default(0),
    default_coats: z.coerce.number().int().min(1).max(3).default(2),
    default_method: z.enum(METHODS).default("brush_roll"),
    default_product_id: optionalUuid,
    unit_price: dollars("Unit price"),
    unit_cost: dollars("Unit cost"),
    labor_hours_per_unit: z.coerce.number().min(0).max(1000).default(0),
    taxable: z.boolean().default(true),
    is_optional_default: z.boolean().default(false),
    is_repair_allowance: z.boolean().default(false),
    allowance_note: text(500),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.pricing_method === "production_rate" && !v.surface) {
      ctx.addIssue({
        code: "custom",
        path: ["surface"],
        message: "Pick the production-rate surface.",
      });
    }
    if (v.pricing_method === "flat" && v.unit_price === null) {
      ctx.addIssue({ code: "custom", path: ["unit_price"], message: "Enter the price per unit." });
    }
  });
export type CatalogItemInput = z.input<typeof catalogItemSchema>;

export const paintProductSchema = z.object({
  id: optionalUuid,
  brand: key,
  line: text(120),
  product: name("Product", 160),
  use: z.enum(PRODUCT_USES),
  base: text(80),
  sheens: z.array(key).max(6).default([]),
  coverage_sqft_per_gal: z.coerce.number().positive("Coverage must be above 0.").max(2000),
  cost_per_gal: dollars("Cost per gallon").refine((v) => v !== null, "Enter the cost per gallon."),
  price_per_gal: dollars("Price per gallon"),
  voc_g_per_l: z
    .union([z.coerce.number().min(0).max(1000), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  dry_time_hours: z
    .union([z.coerce.number().min(0).max(1000), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  recoat_hours: z
    .union([z.coerce.number().min(0).max(1000), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  min_temp_f: z
    .union([z.coerce.number().int().min(-20).max(120), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  containers: z.array(z.enum(CONTAINERS)).min(1, "Pick at least one container size.").max(3),
  is_primer: z.boolean().default(false),
  notes: text(1000),
  active: z.boolean().default(true),
});
export type PaintProductInput = z.input<typeof paintProductSchema>;

export const productionRateSchema = z.object({
  id: uuid,
  units_per_labor_hour: z.coerce.number().positive("Must be above 0.").max(100_000),
  prep_hours_per_unit: z.coerce.number().min(0).max(1000),
  notes: text(1000),
  active: z.boolean().optional(),
});
export const productionRateAddSchema = z.object({
  surface: key,
  method: z.enum(METHODS),
  condition: z.enum(CONDITIONS),
  units_per_labor_hour: z.coerce.number().positive("Must be above 0.").max(100_000),
  prep_hours_per_unit: z.coerce.number().min(0).max(1000),
});

// --- Estimate Setup and agreement templates ---------------------------------------------------

export const estimateSetupSchema = z.object({
  pricing: pricingJsonSchema,
  discount_limits: z.object({
    roles: z.record(z.string(), z.coerce.number().min(0).max(100)),
  }),
  deposit_percent: z.coerce.number().min(0).max(100),
  estimate_expiry_days: z.coerce.number().int().min(1).max(365),
  tax: z.object({
    rate_percent: z.coerce.number().min(0).max(25),
    default_taxable: z.boolean(),
    confirmed_with_accountant: z.boolean(),
  }),
});
export type EstimateSetupInput = z.input<typeof estimateSetupSchema>;

export const inclusionsSchema = z.object({
  work_type: z.enum(["interior", "exterior", "cabinets", "deck_fence"]),
  items: z.array(z.string().trim().min(1).max(300)).max(30),
  approved: z.boolean(),
});

export const guaranteesSchema = z.object({
  guarantees: z
    .array(
      z.object({
        key,
        title: name("Title"),
        body: z.string().trim().max(500),
        enabled: z.boolean(),
      }),
    )
    .max(12),
  approved: z.boolean(),
  lead_safe_disclosure: text(4000),
});

export const colorChangeRuleSchema = z.object({
  light_to_dark: z.enum(COLOR_CHANGE_ACTIONS),
  dark_to_light: z.enum(COLOR_CHANGE_ACTIONS),
});

export const agreementTemplateSchema = z.object({
  id: optionalUuid,
  doc_type: z.enum(AGREEMENT_DOC_TYPES),
  name: name("Name"),
  body: z.string().min(1, "Write the template.").max(50_000),
});
export const publishTemplateSchema = z.object({
  id: uuid,
  owner_confirmed: z.boolean(),
  approval_note: text(1000),
});
