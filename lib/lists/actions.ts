"use server";

import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";

/**
 * Saved views (personal or shared) and per-user column choices for every list
 * (SPEC §8 "Lists"). Writes use the user-scoped client; RLS limits each person
 * to their own views and their own profile preferences.
 */

const moduleId = z.enum(["leads", "accounts", "contacts", "jobs"]);

const viewConfig = z
  .object({
    q: z.string().max(200).optional(),
    tab: z.string().max(60).optional(),
    chips: z.array(z.string().max(60)).max(20).optional(),
    f: z.string().max(8000).optional(),
    sort: z.string().max(60).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    columns: z.array(z.string().max(60)).max(40).optional(),
  })
  .strict();

export const createSavedView = defineAction({
  name: "saved_views.create",
  permissions: null,
  schema: z.object({
    module: moduleId,
    name: z.string().trim().min(1, "Give the view a name.").max(80),
    shared: z.boolean().default(false),
    config: viewConfig,
  }),
  handler: async (v, { supabase, viewer }) => {
    const { data, error } = await supabase
      .from("saved_views")
      .insert({
        org_id: viewer.orgId,
        user_id: viewer.real.id,
        module: v.module,
        name: v.name,
        shared: v.shared,
        config: v.config,
      })
      .select("id")
      .single();
    if (error?.code === "23505") {
      throw new ActionFailure({
        code: "conflict",
        message: "You already have a view with that name.",
        fieldErrors: { name: ["Pick a different name."] },
      });
    }
    const row = check({ data, error });
    if (!row)
      throw new ActionFailure({ code: "server", message: "The view wasn't saved. Try again." });
    return { id: row.id };
  },
});

export const updateSavedView = defineAction({
  name: "saved_views.update",
  permissions: null,
  schema: z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(80).optional(),
    shared: z.boolean().optional(),
    config: viewConfig.optional(),
  }),
  handler: async (v, { supabase }) => {
    const patch: { name?: string; shared?: boolean; config?: z.infer<typeof viewConfig> } = {};
    if (v.name !== undefined) patch.name = v.name;
    if (v.shared !== undefined) patch.shared = v.shared;
    if (v.config !== undefined) patch.config = v.config;
    const rows = check(
      await supabase.from("saved_views").update(patch).eq("id", v.id).select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure({
        code: "forbidden",
        message: "You can only change your own views.",
      });
    return { saved: true };
  },
});

export const deleteSavedView = defineAction({
  name: "saved_views.delete",
  permissions: null,
  schema: z.object({ id: z.uuid() }),
  handler: async (v, { supabase }) => {
    const rows = check(await supabase.from("saved_views").delete().eq("id", v.id).select("id"));
    if (!rows?.length)
      throw new ActionFailure({
        code: "forbidden",
        message: "You can only delete your own views.",
      });
    return { deleted: true };
  },
});

/** Column order/visibility per list, stored in the user's own profile preferences. */
export const saveListColumns = defineAction({
  name: "list_columns.save",
  permissions: null,
  schema: z.object({ module: moduleId, columns: z.array(z.string().max(60)).max(40).nullable() }),
  handler: async (v, { supabase, viewer }) => {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("preferences")
      .eq("id", viewer.real.id)
      .single();
    if (error) throw error;
    const prefs = (profile.preferences ?? {}) as Record<string, unknown>;
    const lists = { ...((prefs.list_columns as Record<string, string[]> | undefined) ?? {}) };
    if (v.columns === null) delete lists[v.module];
    else lists[v.module] = v.columns;
    check(
      await supabase
        .from("profiles")
        .update({ preferences: { ...prefs, list_columns: lists } })
        .eq("id", viewer.real.id)
        .select("id"),
    );
    return { saved: true };
  },
});
