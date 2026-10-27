import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadLeadOptions } from "@/lib/leads/service";
import type { TerritoryLite } from "@/lib/domain/territory";
import { NewLeadWizard } from "./new-lead-wizard";

export const metadata: Metadata = { title: "New Lead" };

/** New Lead wizard (SPEC §8.4): Info → Property → Qualify. */
export default async function NewLeadPage() {
  const viewer = await requirePermission("leads:create");
  const supabase = await createSupabaseServerClient();
  const [options, territoriesRes] = await Promise.all([
    loadLeadOptions(supabase),
    supabase
      .from("territories")
      .select("id, name, zip_codes, is_service_area, active")
      .eq("active", true)
      .order("sort_order"),
  ]);

  const territories: TerritoryLite[] = (territoriesRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    zipCodes: t.zip_codes,
    isServiceArea: t.is_service_area,
    active: t.active,
  }));
  const users = options.users.some((u) => u.value === viewer.id)
    ? options.users
    : [{ value: viewer.id, label: viewer.name }, ...options.users];
  const active = <T extends { active?: boolean }>(list: T[]) =>
    list.filter((o) => o.active !== false);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title="New Lead"
        description="Three quick steps. Only a name, one way to reach them and a source are required."
      />
      <NewLeadWizard
        me={{ id: viewer.id, name: viewer.name }}
        canAssign={viewer.can("leads:assign")}
        canConvert={viewer.can("jobs:create") && viewer.can("leads:update")}
        readOnly={viewer.impersonating}
        options={{
          sources: active(options.picklists.lead_source),
          subSources: options.picklists.lead_sub_source,
          propertyTypes: active(options.picklists.property_type),
          sidingTypes: active(options.picklists.siding_type),
          users,
          territories,
        }}
      />
    </div>
  );
}
