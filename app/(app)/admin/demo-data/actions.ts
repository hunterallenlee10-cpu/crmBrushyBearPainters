"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, mapDbError } from "@/lib/actions/errors";

/**
 * Admin → Demo Data: owners only. Removes every record the demo script tagged
 * `is_demo` (and what hangs off it) through `purge_demo_data()`, run as the
 * service with the owner recorded as the actor. Real records are never touched.
 */
export const purgeDemoData = defineAction({
  name: "demo.purge",
  schema: z.object({ confirm: z.literal("PURGE", "Type PURGE to confirm.") }),
  permissions: null,
  handler: async (_v, { viewer, service }) => {
    if (!viewer.isOwner)
      throw new ActionFailure(actionError("forbidden", "Only owners can purge demo data."));
    const db = await service();
    const { data, error } = await db.rpc("purge_demo_data", { p_org: viewer.orgId });
    if (error) throw new ActionFailure(mapDbError(error));
    revalidatePath("/", "layout");
    return (data ?? {}) as Record<string, number>;
  },
});
