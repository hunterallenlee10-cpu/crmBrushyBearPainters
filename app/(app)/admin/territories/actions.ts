"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check, mapDbError } from "@/lib/actions/errors";
import {
  deleteTerritorySchema,
  territoryConflictMessage,
  territoryFormSchema,
} from "@/lib/validation/territories";

/**
 * Territories (SPEC §5.1). User-scoped client, so RLS (`settings:manage`) and
 * the territories guard (one territory per ZIP) apply; audit rows and
 * `territory.*` events come from database triggers.
 */

function failWith(error: { code?: string | null; message?: string | null }, name: string): never {
  const nameClash = error.code === "23505" ? territoryConflictMessage(error.message, name) : null;
  if (nameClash) {
    throw new ActionFailure({
      code: "conflict",
      message: nameClash,
      fieldErrors: { name: [nameClash] },
    });
  }
  const mapped = mapDbError(error);
  // The guard's ZIP message ("One or more ZIP codes already belong to Bellevue.") belongs on the ZIP field.
  if (mapped.code === "conflict" && /ZIP/.test(mapped.message)) {
    throw new ActionFailure({ ...mapped, fieldErrors: { zipText: [mapped.message] } });
  }
  throw new ActionFailure(mapped);
}

function revalidate() {
  revalidatePath("/admin/territories");
  revalidatePath("/admin/deleted-records");
}

export const saveTerritory = defineAction({
  name: "territory.save",
  schema: territoryFormSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase, viewer }) => {
    const fields = {
      name: v.name,
      zip_codes: v.zipText,
      is_service_area: v.isServiceArea,
      active: v.active,
    };

    if (v.id) {
      const { data, error } = await supabase
        .from("territories")
        .update(fields)
        .eq("id", v.id)
        .select("id");
      if (error) failWith(error, v.name);
      if (data.length === 0) {
        throw new ActionFailure({ code: "not_found", message: "That territory no longer exists." });
      }
      revalidate();
      return { id: v.id, created: false };
    }

    // New service areas go after the existing ones (and before "Outside service area").
    const existing =
      check(await supabase.from("territories").select("sort_order, is_service_area")) ?? [];
    const pool = existing.filter((t) => t.is_service_area === v.isServiceArea);
    const sortOrder = Math.max(0, ...pool.map((t) => t.sort_order)) + (v.isServiceArea ? 1 : 10);

    const { data, error } = await supabase
      .from("territories")
      .insert({ ...fields, org_id: viewer.orgId, sort_order: sortOrder })
      .select("id")
      .single();
    if (error) failWith(error, v.name);
    revalidate();
    return { id: data.id, created: true };
  },
});

export const deleteTerritory = defineAction({
  name: "territory.delete",
  schema: deleteTerritorySchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase }) => {
    check(
      await supabase.rpc("soft_delete_record", {
        p_table: "territories",
        p_id: v.id,
        p_reason: v.reason,
      }),
    );
    revalidate();
    return { deleted: true };
  },
});
