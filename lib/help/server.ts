import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

type Db = SupabaseClient<Database>;

export type ArticleSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  categoryId: string | null;
  status: string;
  views: number;
};

const SELECT =
  "id, slug, title, summary, tags, category_id, status, sort_order, stats:kb_article_stats(view_count)";

type Row = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  category_id: string | null;
  status: string;
  stats: { view_count: number } | { view_count: number }[] | null;
};

function toSummary(r: Row): ArticleSummary {
  const stats = Array.isArray(r.stats) ? r.stats[0] : r.stats;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    tags: r.tags,
    categoryId: r.category_id,
    status: r.status,
    views: stats?.view_count ?? 0,
  };
}

/** Published articles (or every article for managers), optionally searched or tagged. */
export async function listArticles(
  db: Db,
  opts: {
    q?: string;
    tag?: string;
    category?: string;
    includeDrafts?: boolean;
    limit?: number;
  } = {},
): Promise<ArticleSummary[]> {
  let query = db.from("kb_articles").select(SELECT).is("deleted_at", null);
  if (!opts.includeDrafts) query = query.eq("status", "published");
  if (opts.q?.trim())
    query = query.textSearch("search", opts.q.trim().slice(0, 100), {
      type: "websearch",
      config: "english",
    });
  if (opts.tag) query = query.contains("tags", [opts.tag.toLowerCase()]);
  if (opts.category) query = query.eq("category_id", opts.category);
  const { data } = await query
    .order("sort_order")
    .order("title")
    .limit(opts.limit ?? 200);
  return ((data ?? []) as unknown as Row[]).map(toSummary);
}

export async function listCategories(db: Db) {
  const { data } = await db
    .from("kb_categories")
    .select("id, key, name, description, sort_order")
    .order("sort_order");
  return data ?? [];
}

/** Tags by how many published articles use them. */
export function popularTags(
  articles: readonly ArticleSummary[],
  limit = 12,
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of articles) for (const t of a.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}
