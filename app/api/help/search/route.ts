import { NextResponse, type NextRequest } from "next/server";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listArticles } from "@/lib/help/server";
import { helpSearchSchema } from "@/lib/validation/help";

/**
 * Help panel search (SPEC §8.17): published articles matching the words, for
 * anyone signed in (also while viewing as another user; it only reads).
 */
export async function GET(req: NextRequest) {
  const state = await getViewerState();
  if (state.status !== "ok") return NextResponse.json({ results: [] }, { status: 401 });
  const parsed = helpSearchSchema.safeParse({ q: req.nextUrl.searchParams.get("q") ?? "" });
  if (!parsed.success || !parsed.data.q) return NextResponse.json({ results: [] });
  const db = await createSupabaseServerClient();
  const found = await listArticles(db, { q: parsed.data.q, limit: 6 });
  return NextResponse.json(
    { results: found.map((a) => ({ slug: a.slug, title: a.title, summary: a.summary })) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
