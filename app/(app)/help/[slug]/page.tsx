import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { PageContainer } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArticleBody } from "@/components/help/article-body";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDate } from "@/lib/format/dates";

type Params = Promise<{ slug: string }>;

async function load(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return null;
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("kb_articles")
    .select(
      "id, slug, title, summary, body, tags, status, updated_at, category:kb_categories(name)",
    )
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  return data ? { db, article: data } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const found = await load((await params).slug);
  return { title: found?.article.title ?? "Help" };
}

/** One Help Center article. Reading it counts toward "Popular articles". */
export default async function HelpArticlePage({ params }: { params: Params }) {
  const viewer = await requireViewer();
  const found = await load((await params).slug);
  if (!found) notFound();
  const { db, article } = found;
  if (article.status === "published") await db.rpc("kb_article_viewed", { p_article: article.id });
  const canManage = viewer.can("help:manage") && !viewer.impersonating;

  return (
    <PageContainer className="flex max-w-3xl flex-col gap-4">
      <Link
        href="/help"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden /> Help Center
      </Link>
      <article className="rounded-2xl border bg-card p-5 sm:p-8">
        <header className="mb-4 flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {article.category?.name ?? "Help"}
          </p>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-bb-ink">{article.title}</h1>
            {canManage && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/help/manage/${article.id}`}>
                  <Pencil aria-hidden /> Edit
                </Link>
              </Button>
            )}
          </div>
          {article.summary && <p className="text-muted-foreground">{article.summary}</p>}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {article.status !== "published" && (
              <Badge variant="warning">Draft — only article managers see it</Badge>
            )}
            <span>Updated {formatDate(article.updated_at)}</span>
            {article.tags.map((t) => (
              <Link
                key={t}
                href={`/help?tag=${encodeURIComponent(t)}`}
                className="rounded-full border px-2 py-0.5 hover:bg-muted"
              >
                {t}
              </Link>
            ))}
          </div>
        </header>
        <ArticleBody body={article.body} />
      </article>
    </PageContainer>
  );
}
