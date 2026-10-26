"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { check } from "@/lib/actions/errors";
import { createSupabaseServerClient } from "@/lib/db/server";

/** Start View as user (owners only; Postgres re-checks and audit-logs it). */
export const startViewAs = defineAction({
  name: "view_as.start",
  schema: z.object({ targetUserId: z.uuid() }),
  permissions: ["users:view_as"],
  handler: async ({ targetUserId }, { supabase }) => {
    check(await supabase.rpc("start_view_as", { p_target_user_id: targetUserId }));
    revalidatePath("/", "layout");
    return { ok: true };
  },
});

/**
 * Exit View as user. Deliberately not wrapped in defineAction: the wrapper
 * refuses every action while impersonating, and this is the one that must work.
 * It can only end the caller's own sessions.
 */
export async function stopViewAs(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("stop_view_as");
  revalidatePath("/", "layout");
}
