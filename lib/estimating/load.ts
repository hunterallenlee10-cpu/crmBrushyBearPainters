import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import {
  parseDiscountLimits,
  priceVersion,
  toPricingSettings,
  type DiscountLimits,
  type PricedVersion,
  type PricingSettings,
  type VersionInput,
} from "@/lib/estimating/engine";
import {
  lineResultJson,
  rateKey,
  settingsJson,
  toVersionInput,
  type AreaRow,
  type CatalogLookups,
  type LineRow,
  type OptionRow,
  type ProductRow,
  type RateRow,
} from "./map";

type Db = SupabaseClient<Database>;

/**
 * Loads what the pricing engine needs and stores what it returns. Server-only.
 * Callers pass the service client after their own permission checks (the
 * engine's columns are written by trusted code only).
 */

export type PricingContext = {
  settings: PricingSettings;
  limits: DiscountLimits;
  isSample: boolean;
  lookups: CatalogLookups;
};

export const PRODUCT_COLUMNS =
  "id, brand, line, product, use, sheens, coverage_sqft_per_gal, cost_per_gal_cents, containers, is_primer, active, is_sample";

async function picklistLabels(db: Db, orgId: string, key: string): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("picklist_values")
    .select("value, label, picklists!inner(key, org_id)")
    .eq("picklists.key", key)
    .eq("picklists.org_id", orgId);
  if (error) throw error;
  return new Map((data ?? []).map((v) => [v.value, v.label]));
}

export async function loadPricingContext(db: Db, orgId: string): Promise<PricingContext> {
  const [est, company, products, rates, brands, sheens] = await Promise.all([
    db
      .from("estimate_settings")
      .select("pricing, discount_limits, is_sample")
      .eq("org_id", orgId)
      .maybeSingle(),
    db
      .from("company_settings")
      .select("deposit_percent, estimate_expiry_days, tax_config")
      .eq("org_id", orgId)
      .maybeSingle(),
    db.from("paint_products").select(PRODUCT_COLUMNS).eq("org_id", orgId).is("deleted_at", null),
    db
      .from("production_rates")
      .select("surface, method, condition, units_per_labor_hour, prep_hours_per_unit, active")
      .eq("org_id", orgId),
    picklistLabels(db, orgId, "paint_brand"),
    picklistLabels(db, orgId, "sheen"),
  ]);
  for (const r of [est, company, products, rates]) if (r.error) throw r.error;
  const productMap = new Map<string, ProductRow>((products.data ?? []).map((p) => [p.id, p]));
  const rateMap = new Map<string, RateRow>(
    (rates.data ?? []).map((r) => [rateKey(r.surface, r.method, r.condition), r]),
  );
  return {
    settings: toPricingSettings({
      pricing: est.data?.pricing ?? {},
      depositPercent: Number(company.data?.deposit_percent ?? 30),
      expiryDays: company.data?.estimate_expiry_days ?? 30,
      taxConfig: company.data?.tax_config ?? {},
    }),
    limits: parseDiscountLimits(est.data?.discount_limits),
    isSample: est.data?.is_sample ?? true,
    lookups: { products: productMap, rates: rateMap, brandLabels: brands, sheenLabels: sheens },
  };
}

export type VersionRows = {
  version: Database["public"]["Tables"]["estimate_versions"]["Row"];
  estimate: Database["public"]["Tables"]["estimates"]["Row"];
  options: OptionRow[];
  areas: AreaRow[];
  lines: LineRow[];
};

/** A version with its options, areas and lines (whatever the client may read). */
export async function loadVersionRows(db: Db, versionId: string): Promise<VersionRows | null> {
  const { data: version, error } = await db
    .from("estimate_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  if (!version) return null;
  const [estimate, options, areas, lines] = await Promise.all([
    db.from("estimates").select("*").eq("id", version.estimate_id).maybeSingle(),
    db.from("estimate_options").select("*").eq("version_id", versionId).order("sort_order"),
    db.from("estimate_areas").select("*").eq("version_id", versionId).order("sort_order"),
    db.from("estimate_line_items").select("*").eq("version_id", versionId).order("sort_order"),
  ]);
  for (const r of [estimate, options, areas, lines]) if (r.error) throw r.error;
  if (!estimate.data) return null;
  return {
    version,
    estimate: estimate.data,
    options: options.data ?? [],
    areas: areas.data ?? [],
    lines: lines.data ?? [],
  };
}

/** The settings a version is priced with: company settings, with the version's deposit % if set. */
export function versionSettings(
  ctx: PricingContext,
  version: Pick<VersionRows["version"], "deposit_percent">,
): PricingSettings {
  return version.deposit_percent === null
    ? ctx.settings
    : { ...ctx.settings, depositPercent: Number(version.deposit_percent) };
}

export function buildVersionInput(rows: VersionRows, ctx: PricingContext): VersionInput {
  return toVersionInput({
    options: rows.options,
    areas: rows.areas,
    lines: rows.lines,
    discountType: rows.version.discount_type,
    discountValue: rows.version.discount_value,
    settings: versionSettings(ctx, rows.version),
    lookups: ctx.lookups,
  });
}

/** The internal summary stored in estimate_versions.priced (margin panel, approvals). */
export function pricedJson(p: PricedVersion): Json {
  return JSON.parse(
    JSON.stringify({
      options: p.options.map((o) => ({
        id: o.option.id,
        name: o.option.name,
        summary: o.summary,
        withAllAddOns: o.withAllAddOns,
      })),
      addOns: p.addOns.map((a) => ({ id: a.line.id, priceCents: a.priced.priceCents })),
      terms: p.terms,
      issues: p.issues,
      sendable: p.sendable,
      maxEffectiveDiscountPercent: p.maxEffectiveDiscountPercent,
    }),
  ) as Json;
}

export type RepricedVersion = {
  rows: VersionRows;
  context: PricingContext;
  input: VersionInput;
  priced: PricedVersion;
};

/**
 * Re-prices a draft version with today's catalog and settings and stores the
 * results. Sent versions are frozen: they're returned priced but not stored.
 */
export async function repriceVersion(
  service: Db,
  versionId: string,
): Promise<RepricedVersion | null> {
  const rows = await loadVersionRows(service, versionId);
  if (!rows) return null;
  const context = await loadPricingContext(service, rows.version.org_id);
  const input = buildVersionInput(rows, context);
  const priced = priceVersion(input);
  if (rows.version.status === "draft") {
    const { error } = await service.rpc("store_version_pricing", {
      p_version: versionId,
      p_settings: settingsJson(input.settings),
      p_priced: pricedJson(priced),
      p_max_discount: priced.maxEffectiveDiscountPercent,
      p_lines: priced.lines.map((l) => lineResultJson(l.line.id, l.line, l.priced)),
      p_options: priced.options.map((o) => ({
        id: o.option.id,
        subtotalCents: o.summary.subtotalCents,
        totalCents: o.summary.totalCents,
      })),
    });
    if (error) throw error;
  }
  return { rows, context, input, priced };
}
