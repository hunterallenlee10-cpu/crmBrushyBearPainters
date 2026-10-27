import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Search, Settings2, Sparkles } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listArticles, listCategories, popularTags } from "@/lib/help/server";

export const metadata: Metadata = { title: "Help Center" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Help Center (SPEC §8.17): categories, search, popular tags and articles, release notes. */
export default async function HelpPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const tag = typeof sp.tag === "string" ? sp.tag.slice(0, 40) : "";
  const db = await createSupabaseServerClient();
  const [all, categories, found] = await Promise.all([
    listArticles(db),
    listCategories(db),
    q || tag ? listArticles(db, { q, tag }) : Promise.resolve(null),
  ]);
  const tags = popularTags(all);
  const popular = [...all]
    .filter((a) => a.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);
  const canManage = viewer.can("help:manage") && !viewer.impersonating;

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="Help Center"
        description="Short how-to articles for everyday work in the CRM."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/help/release-notes">
                <Sparkles aria-hidden /> Release notes
              </Link>
            </Button>
            {canManage && (
              <Button asChild>
                <Link href="/help/manage">
                  <Settings2 aria-hidden /> Manage articles
                </Link>
              </Button>
            )}
          </>
        }
      />
      <form method="get" action="/help" role="search" className="flex gap-2">
        <label htmlFor="help-q" className="sr-only">
          Search help articles
        </label>
        <Input
          id="help-q"
          name="q"
          defaultValue={q}
          placeholder="Search: deposit, daily log, schedule…"
          className="h-11 sm:h-9"
        />
        <Button type="submit" variant="outline" className="h-11 sm:h-9">
          <Search aria-hidden /> Search
        </Button>
      </form>
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Popular tags">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Popular tags
          </span>
          {tags.map((t) => (
            <Link
              key={t.tag}
              href={`/help?tag=${encodeURIComponent(t.tag)}`}
              aria-current={tag === t.tag ? "page" : undefined}
              className="inline-flex min-h-9 items-center rounded-full border bg-card px-3 text-xs hover:bg-muted aria-[current=page]:border-bb-forest aria-[current=page]:bg-bb-forest aria-[current=page]:text-white"
            >
              {t.tag}
            </Link>
          ))}
        </div>
      )}

      {found ? (
        <section aria-labelledby="results-heading" className="rounded-2xl border bg-card p-5">
          <h2 id="results-heading" className="mb-3 text-base font-semibold">
            {found.length} result{found.length === 1 ? "" : "s"} for {q ? `“${q}”` : `#${tag}`}
          </h2>
          {found.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing matched. Try fewer words, or browse the categories below.
            </p>
          ) : (
            <ArticleList items={found} />
          )}
        </section>
      ) : null}

      {all.length === 0 ? (
        <EmptyState icon={BookOpen} title="No articles yet">
          {canManage
            ? "Write the first one in Manage articles."
            : "Your owners haven't published any articles yet."}
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="grid gap-5 sm:grid-cols-2 lg:col-span-2">
            {categories.map((c) => {
              const items = all.filter((a) => a.categoryId === c.id);
              if (items.length === 0) return null;
              return (
                <section
                  key={c.id}
                  aria-labelledby={`cat-${c.key}`}
                  className="rounded-2xl border bg-card p-5"
                >
                  <h2 id={`cat-${c.key}`} className="text-base font-semibold">
                    {c.name}
                  </h2>
                  {c.description && (
                    <p className="mb-2 text-xs text-muted-foreground">{c.description}</p>
                  )}
                  <ArticleList items={items} compact />
                </section>
              );
            })}
            {all.some((a) => !a.categoryId) && (
              <section aria-labelledby="cat-other" className="rounded-2xl border bg-card p-5">
                <h2 id="cat-other" className="text-base font-semibold">
                  More
                </h2>
                <ArticleList items={all.filter((a) => !a.categoryId)} compact />
              </section>
            )}
          </div>
          <aside className="flex flex-col gap-5">
            <section
              aria-labelledby="popular-heading"
              className="rounded-2xl border bg-bb-cream-light p-5"
            >
              <h2 id="popular-heading" className="text-base font-semibold">
                Popular articles
              </h2>
              {popular.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Articles people read most show up here.
                </p>
              ) : (
                <ArticleList items={popular} compact />
              )}
            </section>
          </aside>
        </div>
      )}
    </PageContainer>
  );
}

function ArticleList({
  items,
  compact,
}: {
  items: { id: string; slug: string; title: string; summary: string; status: string }[];
  compact?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((a) => (
        <li key={a.id}>
          <Link href={`/help/${a.slug}`} className="font-medium text-bb-forest hover:underline">
            {a.title}
          </Link>
          {a.status !== "published" && (
            <Badge variant="warning" className="ml-2">
              Draft
            </Badge>
          )}
          {!compact && a.summary && <p className="text-sm text-muted-foreground">{a.summary}</p>}
        </li>
      ))}
    </ul>
  );
}
