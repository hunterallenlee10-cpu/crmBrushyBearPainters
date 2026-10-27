"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, mapDbError, type DbError } from "@/lib/actions/errors";
import { purgeDemo } from "@/lib/demo/purge";

/**
 * Admin → Demo Data: owners only. Removes every record the demo script tagged
 * `is_demo` (and what hangs off it, including demo photo files) through
 * `purgeDemo()`, run as the service with the owner recorded as the actor. Real
 * records are never touched.
 */
export const purgeDemoData = defineAction({
  name: "demo.purge",
  schema: z.object({ confirm: z.literal("PURGE", "Type PURGE to confirm.") }),
  permissions: null,
  handler: async (_v, { viewer, service }) => {
    if (!viewer.isOwner)
      throw new ActionFailure(actionError("forbidden", "Only owners can purge demo data."));
    const db = await service();
    let counts: Record<string, number>;
    try {
      counts = await purgeDemo(db, viewer.orgId);
    } catch (e) {
      throw new ActionFailure(mapDbError(e as DbError));
    }
    revalidatePath("/", "layout");
    return counts;
  },
});
