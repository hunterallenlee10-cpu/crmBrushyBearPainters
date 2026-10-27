"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { ArticleBody } from "@/components/help/article-body";
import { slugify } from "@/lib/domain/help/markdown";
import { deleteArticle, saveArticle } from "../../actions";

type Audience = "owner" | "office" | "sales" | "crew";
const AUDIENCES: { value: Audience; label: string }[] = [
  { value: "owner", label: "Owners" },
  { value: "office", label: "Office" },
  { value: "sales", label: "Sales" },
  { value: "crew", label: "Crew" },
];

export function ArticleEditor({
  article,
  categories,
  readOnly,
}: {
  article: {
    id: string;
    slug: string;
    title: string;
    summary: string;
    body: string;
    tags: string[];
    audience: string[];
    status: "draft" | "published";
    categoryId: string | null;
  } | null;
  categories: { value: string; label: string }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [title, setTitle] = React.useState(article?.title ?? "");
  const [slug, setSlug] = React.useState(article?.slug ?? "");
  const [slugTouched, setSlugTouched] = React.useState(Boolean(article));
  const [category, setCategory] = React.useState(article?.categoryId ?? "");
  const [summary, setSummary] = React.useState(article?.summary ?? "");
  const [body, setBody] = React.useState(
    article?.body ?? "## Steps\n\n1. \n\n## Good to know\n\n- ",
  );
  const [tags, setTags] = React.useState((article?.tags ?? []).join(", "));
  const [audience, setAudience] = React.useState<Audience[]>(
    (article?.audience ?? []) as Audience[],
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function save(status: "draft" | "published") {
    run(
      () =>
        saveArticle({
          id: article?.id,
          title,
          slug,
          category_id: category,
          summary,
          body,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          audience,
          status,
        }),
      {
        success: status === "published" ? "Published." : "Saved as a draft.",
        onOk: (d) => router.push(`/help/${d.slug}`),
        onError: (err) => setErrors(firstErrors(err)),
      },
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form
        className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save(article?.status ?? "draft");
        }}
      >
        <Field id="a-title" label="Title" error={errors.title} required>
          <Input
            {...fieldAria("a-title", errors.title)}
            value={title}
            maxLength={160}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field
          id="a-slug"
          label="Web address"
          error={errors.slug}
          description={`/help/${slug || "…"}`}
        >
          <Input
            {...fieldAria("a-slug", errors.slug, true)}
            value={slug}
            maxLength={80}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
        </Field>
        <Field id="a-cat" label="Category">
          <NativeSelect id="a-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="a-summary" label="One-line summary" error={errors.summary}>
          <Input
            {...fieldAria("a-summary", errors.summary)}
            value={summary}
            maxLength={300}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
        <Field
          id="a-body"
          label="Article"
          error={errors.body}
          description="## for a heading, 1. for steps, - for bullets, **bold**, [link text](/leads/new)."
        >
          <Textarea
            {...fieldAria("a-body", errors.body, true)}
            rows={16}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="font-mono text-sm"
          />
        </Field>
        <Field id="a-tags" label="Tags (comma separated)" error={errors.tags}>
          <Input
            {...fieldAria("a-tags", errors.tags)}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 text-sm font-medium">Written for</legend>
          {AUDIENCES.map((a) => (
            <label key={a.value} className="flex min-h-11 items-center gap-2 sm:min-h-0">
              <Checkbox
                checked={audience.includes(a.value)}
                onCheckedChange={(c) =>
                  setAudience((list) =>
                    c === true ? [...list, a.value] : list.filter((x) => x !== a.value),
                  )
                }
              />
              {a.label}
            </label>
          ))}
        </fieldset>
        {!readOnly && (
          <div className="flex flex-wrap justify-between gap-2">
            {article ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  window.confirm("Remove this article? It goes to Deleted Records.") &&
                  run(() => deleteArticle({ id: article.id }), {
                    success: "Article removed.",
                    onOk: () => router.push("/help/manage"),
                  })
                }
              >
                <Trash2 aria-hidden /> Remove
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => save("draft")}
              >
                Save draft
              </Button>
              <Button type="button" disabled={pending} onClick={() => save("published")}>
                Publish
              </Button>
            </div>
          </div>
        )}
      </form>
      <section aria-labelledby="preview-heading" className="rounded-2xl border bg-card p-5">
        <h2
          id="preview-heading"
          className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Preview
        </h2>
        <h3 className="text-xl font-bold text-bb-ink">{title || "Untitled"}</h3>
        {summary && <p className="mb-3 text-muted-foreground">{summary}</p>}
        <ArticleBody body={body} />
      </section>
    </div>
  );
}
