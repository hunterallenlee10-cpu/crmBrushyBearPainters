"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { check } from "@/lib/actions/errors";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";

/** Top-bar actions: universal search and notifications (SPEC §8.1). */

export type SearchHit = {
  kind: "lead" | "job" | "account" | "contact" | "invoice";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

const searchSchema = z.object({
  query: z.string().trim().max(120),
  scope: z.enum(["all", "leads", "jobs", "accounts", "contacts", "invoices"]).default("all"),
});

/**
 * Record search. Runs the search_records RPC with the user's own session, so
 * results only include records they may open. Read-only: works while viewing as
 * another user (not wrapped in defineAction, which refuses during View as).
 */
export async function searchRecords(input: z.input<typeof searchSchema>): Promise<SearchHit[]> {
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success || parsed.data.query.length < 2) return [];
  const state = await getViewerState();
  if (state.status !== "ok") return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("search_records", {
    p_query: parsed.data.query,
    p_scope: parsed.data.scope,
    p_limit: 8,
  });
  if (error) return [];
  const seen = new Set<string>();
  return (data ?? []).flatMap((r) => {
    const key = `${r.kind}:${r.id}`;
    if (
      seen.has(key) ||
      (r.kind !== "lead" &&
        r.kind !== "job" &&
        r.kind !== "account" &&
        r.kind !== "contact" &&
        r.kind !== "invoice")
    )
      return [];
    seen.add(key);
    // Stored phones are E.164; show "(425) 555-0100".
    const subtitle = (r.subtitle ?? "").replace(/\+1(\d{3})(\d{3})(\d{4})\b/g, "($1) $2-$3");
    return [{ kind: r.kind, id: r.id, title: r.title, subtitle, href: r.href }];
  });
}

export const markNotificationsRead = defineAction({
  name: "notifications.mark_read",
  permissions: null,
  schema: z.object({ ids: z.array(z.uuid()).max(100).optional() }),
  handler: async ({ ids }, { supabase, viewer }) => {
    let q = supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", viewer.real.id)
      .is("read_at", null);
    if (ids?.length) q = q.in("id", ids);
    const rows = check(await q.select("id"));
    revalidatePath("/", "layout");
    return { marked: rows?.length ?? 0 };
  },
});
