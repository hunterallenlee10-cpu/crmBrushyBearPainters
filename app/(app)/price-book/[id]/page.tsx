import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { surfaceLabels } from "../choices";
import { PriceBookForm } from "../price-book-form";
import { CatalogItems } from "./items";

export const metadata: Metadata = { title: "Price Book" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PriceBookDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const viewer = await requireViewer();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const canManage = viewer.can("catalog:manage") && !viewer.impersonating;
  const supabase = await createSupabaseServerClient();
  const [book, items, products, rates, workTypes] = await Promise.all([
    supabase
      .from("price_books")
      .select("id, name, description, is_default, active")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("catalog_items")
      .select("*")
      .eq("price_book_id", id)
      .is("deleted_at", null)
      .order("family")
      .order("sort_order")
      .order("name")
      .limit(500),
    supabase
      .from("paint_products")
      .select("id, product, is_primer")
      .is("deleted_at", null)
      .order("product"),
    supabase
      .from("production_rates")
      .select("surface")
      .eq("method", "brush_roll")
      .eq("condition", "good"),
    supabase
      .from("picklist_values")
      .select("value, label, sort_order, picklists!inner(key)")
      .eq("picklists.key", "work_type")
      .eq("active", true)
      .order("sort_order"),
  ]);
  if (!book.data) notFound();
  const rows = items.data ?? [];
  const labels = surfaceLabels(rows);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {book.data.name}
            {book.data.is_default && <Badge variant="success">Default</Badge>}
          </h2>
          {book.data.description && (
            <p className="text-sm text-muted-foreground">{book.data.description}</p>
          )}
        </div>
        {canManage && <PriceBookForm book={book.data} />}
      </div>
      <CatalogItems
        priceBookId={id}
        canManage={canManage}
        initialQuery={one(sp.q) ?? ""}
        items={rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          itemType: r.item_type,
          family: r.family,
          unit: r.unit,
          pricingMethod: r.pricing_method,
          surface: r.surface,
          workType: r.work_type,
          workOrderPhase: r.work_order_phase,
          paintSqftPerUnit: Number(r.paint_sqft_per_unit),
          defaultCoats: r.default_coats,
          defaultMethod: r.default_method,
          defaultProductId: r.default_product_id,
          unitPriceCents: r.unit_price_cents,
          unitCostCents: r.unit_cost_cents,
          laborHoursPerUnit: Number(r.labor_hours_per_unit),
          taxable: r.taxable,
          isOptionalDefault: r.is_optional_default,
          isRepairAllowance: r.is_repair_allowance,
          allowanceNote: r.allowance_note,
          customerDescription: r.customer_description,
          active: r.active,
          isSample: r.is_sample,
        }))}
        products={(products.data ?? []).map((p) => ({
          id: p.id,
          label: p.product,
          isPrimer: p.is_primer,
        }))}
        surfaces={[...new Set((rates.data ?? []).map((r) => r.surface))]
          .sort()
          .map((s) => ({ value: s, label: labels.get(s) ?? s }))}
        workTypes={(workTypes.data ?? []).map((w) => ({ value: w.value, label: w.label }))}
      />
    </div>
  );
}
