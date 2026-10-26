"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import { type Json } from "@/lib/db/types";
import { mergePreferences, ownProfileSchema, preferencesSchema } from "@/lib/validation/users";

/**
 * Per-user Settings (SPEC §8.18). Any signed-in user edits only their own row;
 * the profiles guard limits which columns a non-admin may change. Audit rows and
 * `user.updated` events come from database triggers.
 */

export const saveOwnProfile = defineAction({
  name: "settings.save_profile",
  schema: ownProfileSchema,
  permissions: null,
  handler: async (v, { supabase, viewer }) => {
    const rows = check(
      await supabase
        .from("profiles")
        .update({
          full_name: v.full_name,
          phone: v.phone,
          title: v.title,
          calendar_color: v.calendar_color,
          signature: v.signature,
        })
        .eq("id", viewer.id)
        .select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("forbidden"));
    revalidatePath("/", "layout");
    return { saved: true };
  },
});

export const savePreferences = defineAction({
  name: "settings.save_preferences",
  schema: preferencesSchema,
  permissions: null,
  handler: async (v, { supabase, viewer }) => {
    const current = check(
      await supabase.from("profiles").select("preferences").eq("id", viewer.id).maybeSingle(),
    );
    if (!current) throw new ActionFailure(actionError("not_found"));
    const rows = check(
      await supabase
        .from("profiles")
        .update({
          preferences: mergePreferences(current.preferences, v) as { [key: string]: Json },
        })
        .eq("id", viewer.id)
        .select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("forbidden"));
    revalidatePath("/settings");
    return { saved: true };
  },
});
