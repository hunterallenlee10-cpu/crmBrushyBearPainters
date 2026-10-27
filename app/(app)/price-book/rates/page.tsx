import type { Metadata } from "next";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { humanize, surfaceLabels } from "../choices";
import { RatesEditor } from "./rates";

export const metadata: Metadata = { title: "Production Rates" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Production Rates (SPEC §7.3): units per labor hour and prep hours per unit,
 * by surface × method × condition. One surface at a time (server-filtered).
 */
export default async function ProductionRatesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const viewer = await requireViewer();
  const canManage = viewer.can("catalog:manage") && !viewer.impersonating;
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [surfacesRes, items] = await Promise.all([
    supabase.from("production_rates").select("surface, is_sample").limit(5000),
    supabase.from("catalog_items").select("surface, name").not("surface", "is", null),
  ]);
  const labels = surfaceLabels(items.data ?? []);
  const surfaceKeys = [...new Set((surfacesRes.data ?? []).map((r) => r.surface))].sort();
  const sampleCount = (surfacesRes.data ?? []).filter((r) => r.is_sample).length;
  const requested = one(sp.surface);
  const surface =
    requested && surfaceKeys.includes(requested) ? requested : (surfaceKeys[0] ?? null);
  const { data: rates } = surface
    ? await supabase
        .from("production_rates")
        .select(
          "id, surface, method, condition, units_per_labor_hour, prep_hours_per_unit, notes, is_sample",
        )
        .eq("surface", surface)
        .order("method")
        .order("condition")
    : { data: [] };
  return (
    <RatesEditor
      canManage={canManage}
      surface={surface}
      sampleCount={sampleCount}
      totalCount={(surfacesRes.data ?? []).length}
      surfaces={surfaceKeys.map((s) => ({ value: s, label: labels.get(s) ?? humanize(s) }))}
      rates={(rates ?? []).map((r) => ({
        id: r.id,
        method: r.method,
        condition: r.condition,
        unitsPerHour: Number(r.units_per_labor_hour),
        prepHours: Number(r.prep_hours_per_unit),
        notes: r.notes,
        isSample: r.is_sample,
      }))}
    />
  );
}
