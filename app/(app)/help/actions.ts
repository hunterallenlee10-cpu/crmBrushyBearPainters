"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, checkOne } from "@/lib/actions/errors";
import { articleIdSchema, articleSchema } from "@/lib/validation/help";

/**
 * Help Center (SPEC §8.17). Owners (help:manage) write, publish and remove
 * articles; audit rows and kb_article.* events come from triggers.
 */

export const saveArticle = defineAction({
  name: "help.save_article",
  schema: articleSchema,
  permissions: ["help:manage"],
  handler: async (v, { supabase, viewer }) => {
    const row = {
      title: v.title,
      slug: v.slug,
      category_id: v.category_id,
      summary: v.summary,
      body: v.body,
      tags: v.tags,
      audience: v.audience,
      status: v.status,
    };
    if (v.id) {
      const rows = check(
        await supabase.from("kb_articles").update(row).eq("id", v.id).select("slug"),
      );
      if (!rows?.length)
        throw new ActionFailure(actionError("not_found", "That article no longer exists."));
    } else {
      const created = checkOne(
        await supabase
          .from("kb_articles")
          .insert({ ...row, org_id: viewer.orgId })
          .select("id")
          .single(),
      );
      v.id = created.id;
    }
    revalidatePath("/help", "layout");
    return { id: v.id, slug: v.slug };
  },
});

export const deleteArticle = defineAction({
  name: "help.delete_article",
  schema: articleIdSchema,
  permissions: ["help:manage"],
  handler: async ({ id }, { supabase, viewer }) => {
    const rows = check(
      await supabase
        .from("kb_articles")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: viewer.id,
          delete_reason: "Removed in Manage articles",
        })
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That article no longer exists."));
    revalidatePath("/help", "layout");
    return { id };
  },
});
