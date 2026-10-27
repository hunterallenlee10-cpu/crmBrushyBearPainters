import type { Metadata } from "next";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { PaintProducts } from "./products";

export const metadata: Metadata = { title: "Paint Catalog" };

/** Paint Catalog (SPEC §7.3): coverage, cost per gallon, sheens and containers. */
export default async function PaintCatalogPage() {
  const viewer = await requireViewer();
  const canManage = viewer.can("catalog:manage") && !viewer.impersonating;
  const supabase = await createSupabaseServerClient();
  const pick = (key: string) =>
    supabase
      .from("picklist_values")
      .select("value, label, sort_order, picklists!inner(key)")
      .eq("picklists.key", key)
      .eq("active", true)
      .order("sort_order");
  const [products, brands, sheens] = await Promise.all([
    supabase
      .from("paint_products")
      .select("*")
      .is("deleted_at", null)
      .order("brand")
      .order("product")
      .limit(500),
    pick("paint_brand"),
    pick("sheen"),
  ]);
  if (products.error) throw products.error;
  return (
    <PaintProducts
      canManage={canManage}
      brands={(brands.data ?? []).map((b) => ({ value: b.value, label: b.label }))}
      sheens={(sheens.data ?? []).map((s) => ({ value: s.value, label: s.label }))}
      products={(products.data ?? []).map((p) => ({
        id: p.id,
        brand: p.brand,
        line: p.line,
        product: p.product,
        use: p.use,
        base: p.base,
        sheens: p.sheens,
        coverage: Number(p.coverage_sqft_per_gal),
        costCents: p.cost_per_gal_cents,
        priceCents: p.price_per_gal_cents,
        voc: p.voc_g_per_l === null ? null : Number(p.voc_g_per_l),
        dryHours: p.dry_time_hours === null ? null : Number(p.dry_time_hours),
        recoatHours: p.recoat_hours === null ? null : Number(p.recoat_hours),
        minTempF: p.min_temp_f,
        containers: p.containers,
        isPrimer: p.is_primer,
        notes: p.notes,
        active: p.active,
        isSample: p.is_sample,
      }))}
    />
  );
}
