import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import {
  WORK_ORDER_PHASE_LABELS,
  buildPaintOrder,
  buildWorkOrders,
  colorSelectionSeeds,
  describeLine,
  isContainer,
  onboardingRequirements,
  type Container,
  type Unit,
  type WorkOrderPhase,
} from "@/lib/estimating/engine";

type Db = SupabaseClient<Database>;

/**
 * What signing an estimate creates (SPEC §6.4, §7.5): onboarding rows, the
 * paint order, work orders by phase and color-sheet rows, built from the
 * accepted lines. Its own module (no PDF code) so the demo data script can
 * accept proposals the same way the customer page does.
 */

type LineRow = Database["public"]["Tables"]["estimate_line_items"]["Row"];

function containersOf(ids: readonly string[] | undefined): Container[] {
  return (ids ?? []).filter(isContainer) as Container[];
}

/** The accepted lines → onboarding rows, paint order, work orders and color rows. */
export async function buildAcceptOutputs(
  service: Db,
  input: {
    lines: LineRow[];
    areaNames: Map<string, { name: string; workType: string | null }>;
    jobWorkTypes: readonly string[];
    jobName: string;
    hasHoa: boolean;
    depositCents: number;
    orgId: string;
  },
): Promise<Record<string, Json>> {
  const productIds = [
    ...new Set(
      input.lines
        .flatMap((l) => [l.paint_product_id, l.primer_product_id])
        .filter((x): x is string => !!x),
    ),
  ];
  const [{ data: products }, { data: brands }] = await Promise.all([
    productIds.length
      ? service
          .from("paint_products")
          .select("id, brand, product, containers, cost_per_gal_cents")
          .in("id", productIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            brand: string;
            product: string;
            containers: string[];
            cost_per_gal_cents: number;
          }[],
        }),
    service
      .from("picklist_values")
      .select("value, label, picklists!inner(key, org_id)")
      .eq("picklists.key", "paint_brand")
      .eq("picklists.org_id", input.orgId),
  ]);
  const brandLabel = new Map((brands ?? []).map((b) => [b.value, b.label]));
  const prod = new Map((products ?? []).map((p) => [p.id, p]));
  const label = (id: string | null) => {
    const p = id ? prod.get(id) : undefined;
    return p ? `${brandLabel.get(p.brand) ?? p.brand} ${p.product}` : null;
  };

  const workTypes = new Set<string>(input.jobWorkTypes);
  for (const l of input.lines) if (l.work_type) workTypes.add(l.work_type);
  for (const a of input.areaNames.values()) if (a.workType) workTypes.add(a.workType);

  const describe = (l: LineRow) =>
    describeLine({
      name: l.name,
      quantity: Number(l.quantity),
      unit: l.unit as Unit,
      kind: l.kind === "flat" ? "flat" : "production_rate",
    });

  const paintOrder = buildPaintOrder(
    input.lines.map((l) => {
      const p = l.paint_product_id ? prod.get(l.paint_product_id) : undefined;
      const pr = l.primer_product_id ? prod.get(l.primer_product_id) : undefined;
      return {
        productId: l.paint_product_id,
        productLabel: label(l.paint_product_id),
        containers: containersOf(p?.containers),
        costPerGalCents: Number(p?.cost_per_gal_cents ?? 0),
        sheen: l.sheen,
        gallonsNeeded: Number(l.gallons_needed ?? 0),
        primerProductId: l.primer_product_id,
        primerProductLabel: label(l.primer_product_id),
        primerContainers: containersOf(pr?.containers),
        primerCostPerGalCents: Number(pr?.cost_per_gal_cents ?? 0),
        primerGallonsNeeded: Number(l.primer_gallons_needed ?? 0),
        sundriesCents: Number(l.sundries_cents ?? 0),
      };
    }),
  );
  const workOrders = buildWorkOrders(
    input.lines.map((l) => ({
      description: `${l.area_id ? `${input.areaNames.get(l.area_id)?.name ?? ""}: ` : ""}${describe(l)}`,
      workType:
        l.work_type ?? (l.area_id ? (input.areaNames.get(l.area_id)?.workType ?? null) : null),
      phase: (l.work_order_phase as WorkOrderPhase | null) ?? null,
      laborHours: Number(l.labor_hours ?? 0),
      prepHours: Number(l.prep_hours ?? 0),
    })),
  ).map((w) => ({
    ...w,
    title: `${WORK_ORDER_PHASE_LABELS[w.phase]} – ${input.jobName}`.slice(0, 160),
  }));
  const colors = colorSelectionSeeds(
    input.lines.map((l) => ({
      lineId: l.id,
      areaName: l.area_id ? (input.areaNames.get(l.area_id)?.name ?? null) : null,
      surface: l.name,
      productId: l.paint_product_id,
      brand: l.paint_product_id ? (prod.get(l.paint_product_id)?.brand ?? null) : null,
      sheen: l.sheen,
      paints: l.kind === "production_rate" && Number(l.paint_sqft_per_unit ?? 0) > 0,
    })),
  );
  const onboarding = onboardingRequirements({
    workTypes: [...workTypes],
    hasHoa: input.hasHoa,
    leadSafeWork: input.lines.some((l) => l.lead_safe),
    hasRepairAllowance: input.lines.some((l) => l.is_repair_allowance),
    hasColorConsult: input.lines.some((l) => l.catalog_code === "color_consultation"),
    depositCents: input.depositCents,
  });
  return JSON.parse(JSON.stringify({ onboarding, paintOrder, workOrders, colors })) as Record<
    string,
    Json
  >;
}
