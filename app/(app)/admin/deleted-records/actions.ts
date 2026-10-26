"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, mapDbError } from "@/lib/actions/errors";
import { DELETED_RECORD_TYPES, restoreRecordSchema } from "@/lib/validation/records";

/**
 * Restores a soft-deleted record (SPEC §8.19 Deleted Records). The RPC checks
 * `records:restore`; table guards re-check uniqueness (e.g. a territory's ZIPs
 * or name may have been reused since it was deleted). Audit + events come
 * from database triggers.
 */
export const restoreRecord = defineAction({
  name: "record.restore",
  schema: restoreRecordSchema,
  permissions: ["records:restore"],
  handler: async (v, { supabase }) => {
    const { error } = await supabase.rpc("restore_record", { p_table: v.table, p_id: v.id });
    if (error) {
      const type = DELETED_RECORD_TYPES[v.table];
      if (error.code === "23505" && /duplicate key value/i.test(error.message)) {
        throw new ActionFailure({
          code: "conflict",
          message: `Another ${type.singular.toLowerCase()} now uses this name. Rename that one first, then restore.`,
        });
      }
      throw new ActionFailure(mapDbError(error));
    }
    revalidatePath("/admin/deleted-records");
    revalidatePath(DELETED_RECORD_TYPES[v.table].href);
    return { restored: true };
  },
});
