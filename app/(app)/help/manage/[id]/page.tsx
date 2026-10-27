import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ChevronLeft } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listCategories } from "@/lib/help/server";
import { ArticleEditor } from "./article-editor";

export const metadata: Metadata = { title: "Edit article" };

type Params = Promise<{ id: string }>;

export default async function EditArticlePage({ params }: { params: Params }) {
  const viewer = await requirePermission("help:manage");
  const { id } = await params;
  const db = await createSupabaseServerClient();
  const categories = await listCategories(db);
  let article = null;
  if (id !== "new") {
    if (!z.uuid().safeParse(id).success) notFound();
    const { data } = await db
      .from("kb_articles")
      .select("id, slug, title, summary, body, tags, audience, status, category_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) notFound();
    article = data;
  }
  return (
    <PageContainer className="flex flex-col gap-5">
      <Link
        href="/help/manage"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden /> Manage articles
      </Link>
      <PageHeader title={article ? `Edit “${article.title}”` : "New article"} />
      <ArticleEditor
        article={
          article
            ? {
                id: article.id,
                slug: article.slug,
                title: article.title,
                summary: article.summary,
                body: article.body,
                tags: article.tags,
                audience: article.audience,
                status: article.status === "published" ? "published" : "draft",
                categoryId: article.category_id,
              }
            : null
        }
        categories={categories.map((c) => ({ value: c.id, label: c.name }))}
        readOnly={viewer.impersonating}
      />
    </PageContainer>
  );
}
