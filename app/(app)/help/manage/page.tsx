import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Plus } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listArticles, listCategories } from "@/lib/help/server";

export const metadata: Metadata = { title: "Manage articles" };

/** Help → Manage articles (owners, help:manage): drafts and published articles. */
export default async function ManageArticlesPage() {
  const viewer = await requirePermission("help:manage");
  const db = await createSupabaseServerClient();
  const [articles, categories] = await Promise.all([
    listArticles(db, { includeDrafts: true, limit: 500 }),
    listCategories(db),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <PageContainer className="flex flex-col gap-5">
      <Link
        href="/help"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden /> Help Center
      </Link>
      <PageHeader
        title="Manage articles"
        description="Write how-tos in plain words. Drafts are only visible here; publish when they're ready."
        actions={
          !viewer.impersonating ? (
            <Button asChild>
              <Link href="/help/manage/new">
                <Plus aria-hidden /> New article
              </Link>
            </Button>
          ) : undefined
        }
      />
      <ul className="divide-y rounded-2xl border bg-card">
        {articles.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link
                href={`/help/manage/${a.id}`}
                className="font-medium text-bb-forest hover:underline"
              >
                {a.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {(a.categoryId && catName.get(a.categoryId)) || "No category"} · /help/{a.slug} ·{" "}
                {a.views} reads
              </p>
            </div>
            <Badge variant={a.status === "published" ? "success" : "warning"}>
              {a.status === "published" ? "Published" : "Draft"}
            </Badge>
          </li>
        ))}
        {articles.length === 0 && (
          <li className="p-6 text-center text-sm text-muted-foreground">No articles yet.</li>
        )}
      </ul>
    </PageContainer>
  );
}
