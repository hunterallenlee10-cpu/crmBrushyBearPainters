import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageSquare, Plus, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/forms/native-select";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABELS,
  type TemplateCategory,
} from "@/lib/domain/templates/defaults";
import { WORKFLOWS, templatesUsed } from "@/lib/domain/workflows/catalog";
import { formatRelative } from "@/lib/format/dates";

export const metadata: Metadata = { title: "Messaging & Templates" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Admin → Messaging & Templates (SPEC §11.3, §8.19): every SMS and email
 * template by category, which workflows use it, and whether an owner has
 * approved the wording. Filters live in the URL.
 */
export default async function TemplatesPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission("templates:manage");
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").trim().slice(0, 80);
  const channel = one(sp.channel) === "sms" || one(sp.channel) === "email" ? one(sp.channel) : null;
  const status =
    one(sp.status) === "draft" || one(sp.status) === "approved" ? one(sp.status) : null;
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("message_templates")
    .select("id, key, channel, name, category, message_type, status, active, is_system, updated_at")
    .order("category")
    .order("key")
    .order("channel")
    .limit(500);
  if (channel) query = query.eq("channel", channel);
  if (status) query = query.eq("status", status);
  if (q)
    query = query.or(
      `name.ilike.%${q.replace(/[%_,()]/g, "")}%,key.ilike.%${q.replace(/[%_,()]/g, "")}%`,
    );
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const usedBy = new Map<string, string[]>();
  for (const w of WORKFLOWS) {
    for (const k of templatesUsed(w)) usedBy.set(k, [...(usedBy.get(k) ?? []), `${w.number}`]);
  }
  const drafts = rows.filter((r) => r.status === "draft").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Messaging & Templates"
        description="The wording of every automatic and suggested text and email. Merge fields like {{contact.first_name}} fill in when a message goes out. Changing the wording puts a template back to “Draft – owner to approve”."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin/templates/settings">
                <Settings2 className="size-4" aria-hidden /> Messaging settings
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/templates/new">
                <Plus className="size-4" aria-hidden /> New template
              </Link>
            </Button>
          </>
        }
      />
      {drafts > 0 && (
        <p className="rounded-2xl border border-bb-honey bg-bb-honey/10 p-3 text-sm" role="status">
          {drafts} template{drafts === 1 ? " is" : "s are"} still “Draft – owner to approve”. Drafts
          are used while everything is simulated; when texting and email are connected, only
          approved wording will go out.
        </p>
      )}
      <form className="flex flex-wrap items-end gap-2" role="search">
        <div className="flex flex-col gap-1">
          <label htmlFor="tq" className="text-xs text-muted-foreground">
            Search
          </label>
          <Input id="tq" name="q" defaultValue={q} placeholder="Name or key" className="w-56" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="tc" className="text-xs text-muted-foreground">
            Channel
          </label>
          <NativeSelect id="tc" name="channel" defaultValue={channel ?? ""} className="w-36">
            <option value="">Text and email</option>
            <option value="sms">Text</option>
            <option value="email">Email</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ts" className="text-xs text-muted-foreground">
            Status
          </label>
          <NativeSelect id="ts" name="status" defaultValue={status ?? ""} className="w-36">
            <option value="">Any</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          No templates match. Clear the filters, or add one with New template.
        </p>
      ) : (
        TEMPLATE_CATEGORIES.filter((c) => rows.some((r) => r.category === c)).map((cat) => (
          <section key={cat} aria-labelledby={`cat-${cat}`} className="rounded-2xl border bg-card">
            <h2 id={`cat-${cat}`} className="border-b px-4 py-2 text-sm font-semibold">
              {TEMPLATE_CATEGORY_LABELS[cat as TemplateCategory]}
            </h2>
            <ul>
              {rows
                .filter((r) => r.category === cat)
                .map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 border-b px-4 py-2 last:border-0"
                  >
                    {r.channel === "sms" ? (
                      <MessageSquare className="size-4 text-muted-foreground" aria-label="Text" />
                    ) : (
                      <Mail className="size-4 text-muted-foreground" aria-label="Email" />
                    )}
                    <Link
                      href={`/admin/templates/${r.id}`}
                      className="font-medium text-bb-forest hover:underline"
                    >
                      {r.name}
                    </Link>
                    <code className="text-xs text-muted-foreground">{r.key}</code>
                    {r.status === "draft" ? (
                      <Badge variant="sample">Draft – owner to approve</Badge>
                    ) : (
                      <Badge variant="success">Approved</Badge>
                    )}
                    {r.message_type === "marketing" && <Badge variant="info">Marketing</Badge>}
                    {!r.active && <Badge variant="neutral">Off</Badge>}
                    {usedBy.get(r.key) && (
                      <span className="text-xs text-muted-foreground">
                        Workflow {usedBy.get(r.key)?.join(", ")}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {r.is_system ? "System · " : ""}edited {formatRelative(r.updated_at)}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
