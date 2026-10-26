import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { check } from "@/lib/actions/errors";
import { createSupabaseServerClient } from "@/lib/db/server";
import { type TerritoryLite } from "@/lib/domain/territory";
import { TerritoriesManager } from "./territories-manager";

export const metadata: Metadata = { title: "Territories" };

export default async function TerritoriesPage() {
  await requirePermission("settings:manage");
  const supabase = await createSupabaseServerClient();
  const rows =
    check(
      await supabase
        .from("territories")
        .select("id, name, zip_codes, is_service_area, active, sort_order")
        .order("sort_order")
        .order("name"),
    ) ?? [];

  const territories: TerritoryLite[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    zipCodes: t.zip_codes,
    isServiceArea: t.is_service_area,
    active: t.active,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Territories"
        description="Service-area cities and their ZIP codes. Leads are matched to a territory by ZIP; a lead outside every territory is flagged Out of area, not rejected."
      />
      <TerritoriesManager territories={territories} />
    </div>
  );
}
