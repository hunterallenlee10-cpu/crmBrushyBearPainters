import { z } from "zod";
import {
  ACCESS_TYPES,
  COLOR_CHANGE_ACTIONS,
  HEIGHTS,
  PREP_LEVELS,
  type Access,
  type ColorChangeAction,
  type Height,
  type PrepLevel,
} from "./constants";

/**
 * Pricing settings the engine reads (SPEC §5.5 estimate_settings, §7.3, §7.4).
 * Stored in `estimate_settings` (one row per company) plus the deposit %,
 * expiry days and tax config that live in `company_settings`. Every seeded
 * value is SAMPLE data until an owner saves Estimate Setup.
 */

export type TaxSettings = {
  /** 0 until the owners confirm Washington sales-tax treatment with their accountant. */
  ratePercent: number;
  /** Whether new lines are taxable unless the catalog item says otherwise. */
  defaultTaxable: boolean;
  /** Flipped by an owner once the accountant has confirmed the setup. */
  confirmedWithAccountant: boolean;
};

export type PricingSettings = {
  /** Fully loaded labor cost per hour (wages + taxes + insurance), cents. */
  loadedLaborRateCents: number;
  /** Tape, plastic, caulk, patch: % of labor cost. */
  sundriesPercent: number;
  /** Extra paint for waste: % of gallons. */
  wastePercent: number;
  /** price = cost / (1 − margin). */
  targetMarginPercent: number;
  /** Internal warning below this gross margin. */
  marginFloorPercent: number;
  minimumJobCents: number;
  heightMultipliers: Record<Height, number>;
  accessMultipliers: Record<Access, number>;
  /** Labor factor by number of finish coats ("1", "2", "3"). */
  coatFactors: Record<"1" | "2" | "3", number>;
  /** Multiplier on the production rate's prep hours. */
  prepLevelFactors: Record<PrepLevel, number>;
  /** Share of the area a spot prime covers (0–1). */
  spotPrimerFraction: number;
  colorChangeRule: { light_to_dark: ColorChangeAction; dark_to_light: ColorChangeAction };
  /** Containment and cleanup labor added to lead-safe lines: % of their labor hours. */
  leadSafeLaborPercent: number;
  /** RRP supplies (plastic, HEPA bags, wipes) added once per option with lead-safe work, cost. */
  rrpSuppliesCostCents: number;
  /** Crew size and day length for the crew-days estimate. */
  crewSize: number;
  hoursPerCrewDay: number;
  /** Measurement helper deductions. */
  doorDeductionSqft: number;
  windowDeductionSqft: number;
  /** Default gable factor for exterior walls (1 = no gable). */
  gableFactor: number;
  depositPercent: number;
  expiryDays: number;
  tax: TaxSettings;
};

/** Discount limits (% of the computed price) by role template key and by user id. */
export type DiscountLimits = {
  roles: Record<string, number>;
  users: Record<string, number>;
};

const pct = z.number().min(0).max(100);
const mult = z.number().min(0.1).max(10);
const cents = z.number().int().min(0).max(100_000_000);

/** Schema for the `estimate_settings.pricing` jsonb (and the Estimate Setup form). */
export const pricingJsonSchema = z.object({
  loaded_labor_rate_cents: cents,
  sundries_percent: pct,
  waste_percent: pct,
  target_margin_percent: z.number().min(0).max(90),
  margin_floor_percent: z.number().min(0).max(90),
  minimum_job_cents: cents,
  height_multipliers: z.object(
    Object.fromEntries(HEIGHTS.map((h) => [h, mult])) as Record<Height, typeof mult>,
  ),
  access_multipliers: z.object(
    Object.fromEntries(ACCESS_TYPES.map((a) => [a, mult])) as Record<Access, typeof mult>,
  ),
  coat_factors: z.object({ "1": mult, "2": mult, "3": mult }),
  prep_level_factors: z.object(
    Object.fromEntries(PREP_LEVELS.map((p) => [p, z.number().min(0).max(10)])) as Record<
      PrepLevel,
      z.ZodNumber
    >,
  ),
  spot_primer_fraction: z.number().min(0).max(1),
  color_change_rule: z.object({
    light_to_dark: z.enum(COLOR_CHANGE_ACTIONS),
    dark_to_light: z.enum(COLOR_CHANGE_ACTIONS),
  }),
  lead_safe_labor_percent: pct,
  rrp_supplies_cost_cents: cents,
  crew_size: z.number().int().min(1).max(20),
  hours_per_crew_day: z.number().min(1).max(16),
  door_deduction_sqft: z.number().min(0).max(200),
  window_deduction_sqft: z.number().min(0).max(200),
  gable_factor: z.number().min(1).max(3),
});
export type PricingJson = z.infer<typeof pricingJsonSchema>;

/** Seeded SAMPLE values (also in the migration seed). Not real numbers. */
export const SAMPLE_PRICING: PricingJson = {
  loaded_labor_rate_cents: 6500,
  sundries_percent: 8,
  waste_percent: 10,
  target_margin_percent: 50,
  margin_floor_percent: 40,
  minimum_job_cents: 150000,
  height_multipliers: { one_story: 1, two_story: 1.25, three_plus: 1.5 },
  access_multipliers: { ladder: 1, tall_ladder: 1.1, staging: 1.25, lift: 1.15 },
  coat_factors: { "1": 1, "2": 1.75, "3": 2.5 },
  prep_level_factors: { light: 0.5, standard: 1, heavy: 1.75 },
  spot_primer_fraction: 0.25,
  color_change_rule: { light_to_dark: "extra_coat", dark_to_light: "primer" },
  lead_safe_labor_percent: 15,
  rrp_supplies_cost_cents: 7500,
  crew_size: 2,
  hours_per_crew_day: 8,
  door_deduction_sqft: 21,
  window_deduction_sqft: 15,
  gable_factor: 1.15,
};

export const discountLimitsSchema = z.object({
  roles: z.record(z.string(), pct).catch({}),
  users: z.record(z.string(), pct).catch({}),
});

export const taxConfigSchema = z.object({
  rate_percent: z.number().min(0).max(25).catch(0),
  default_taxable: z.boolean().catch(true),
  confirmed_with_accountant: z.boolean().catch(false),
});
export type TaxConfigJson = z.infer<typeof taxConfigSchema>;

/** Parses stored jsonb; anything missing or malformed falls back to the sample value. */
export function parsePricing(raw: unknown): PricingJson {
  const base = { ...SAMPLE_PRICING, ...(raw && typeof raw === "object" ? raw : {}) };
  const parsed = pricingJsonSchema.safeParse(base);
  return parsed.success ? parsed.data : SAMPLE_PRICING;
}

export function parseTaxConfig(raw: unknown): TaxSettings {
  const t = taxConfigSchema.parse(raw && typeof raw === "object" ? raw : {});
  return {
    ratePercent: t.rate_percent,
    defaultTaxable: t.default_taxable,
    confirmedWithAccountant: t.confirmed_with_accountant,
  };
}

export function parseDiscountLimits(raw: unknown): DiscountLimits {
  return discountLimitsSchema.parse(raw && typeof raw === "object" ? raw : {});
}

/** Builds the engine's settings from the stored rows. */
export function toPricingSettings(input: {
  pricing: unknown;
  depositPercent: number;
  expiryDays: number;
  taxConfig: unknown;
}): PricingSettings {
  const p = parsePricing(input.pricing);
  return {
    loadedLaborRateCents: p.loaded_labor_rate_cents,
    sundriesPercent: p.sundries_percent,
    wastePercent: p.waste_percent,
    targetMarginPercent: p.target_margin_percent,
    marginFloorPercent: p.margin_floor_percent,
    minimumJobCents: p.minimum_job_cents,
    heightMultipliers: p.height_multipliers,
    accessMultipliers: p.access_multipliers,
    coatFactors: p.coat_factors,
    prepLevelFactors: p.prep_level_factors,
    spotPrimerFraction: p.spot_primer_fraction,
    colorChangeRule: p.color_change_rule,
    leadSafeLaborPercent: p.lead_safe_labor_percent,
    rrpSuppliesCostCents: p.rrp_supplies_cost_cents,
    crewSize: p.crew_size,
    hoursPerCrewDay: p.hours_per_crew_day,
    doorDeductionSqft: p.door_deduction_sqft,
    windowDeductionSqft: p.window_deduction_sqft,
    gableFactor: p.gable_factor,
    depositPercent: input.depositPercent,
    expiryDays: input.expiryDays,
    tax: parseTaxConfig(input.taxConfig),
  };
}

/**
 * The discount (as % of the computed price) a person may give without an
 * owner's approval. People who can approve discounts have no limit; a per-user
 * limit beats the role limit; anyone else gets 0%.
 */
export function discountLimitFor(
  limits: DiscountLimits,
  person: { userId: string; roleKey: string | null; canApprove: boolean },
): number {
  if (person.canApprove) return Number.POSITIVE_INFINITY;
  const user = limits.users[person.userId];
  if (typeof user === "number") return user;
  const role = person.roleKey ? limits.roles[person.roleKey] : undefined;
  return typeof role === "number" ? role : 0;
}
