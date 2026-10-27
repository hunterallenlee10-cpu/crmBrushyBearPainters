"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, checkOne } from "@/lib/actions/errors";

/**
 * Export Controls (SPEC §8.19): turn data export on or off per role by adding
 * or removing the "Data export" permission pack on the role template (the
 * same change Roles & Permissions makes). roles:manage; the Owner template is
 * locked; audit rows come from triggers.
 */
const schema = z.object({ template_id: z.uuid(), allowed: z.boolean() });

export const setRoleExport = defineAction({
  name: "export_controls.set_role",
  schema,
  permissions: ["roles:manage"],
  handler: async ({ template_id, allowed }, { supabase, viewer }) => {
    const template = checkOne(
      await supabase
        .from("role_templates")
        .select("id, grants_all")
        .eq("id", template_id)
        .maybeSingle(),
      "That role no longer exists.",
    );
    if (template.grants_all)
      throw new ActionFailure(actionError("forbidden", "Owners can always export."));
    const pack = checkOne(
      await supabase
        .from("permission_packs")
        .select("id")
        .eq("key", "data_export")
        .is("deleted_at", null)
        .maybeSingle(),
      "The Data export pack is missing. Check Roles & Permissions.",
    );
    const { data: link } = await supabase
      .from("template_packs")
      .select("id")
      .eq("template_id", template_id)
      .eq("pack_id", pack.id)
      .maybeSingle();
    if (allowed && !link) {
      check(
        await supabase
          .from("template_packs")
          .insert({ org_id: viewer.orgId, template_id, pack_id: pack.id }),
      );
    } else if (!allowed && link) {
      check(await supabase.from("template_packs").delete().eq("id", link.id));
    }
    revalidatePath("/admin/export-controls");
    revalidatePath("/admin/roles");
    return { template_id, allowed };
  },
});
