import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  AGREEMENT_DOC_TYPE_LABELS,
  LEGAL_DRAFT_BADGE,
  placeholderSlots,
  type AgreementDocType,
} from "@/lib/estimating/engine";
import { formatDate } from "@/lib/format/dates";
import { NewTemplateButton } from "./new-template";

export const metadata: Metadata = { title: "Agreement Templates" };

/** Admin → Agreement Templates (SPEC §8.19). */
export default async function AgreementTemplatesPage() {
  const viewer = await requirePermission("templates:manage");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agreement_templates")
    .select("id, doc_type, name, status, version, is_default, body, updated_at, approved_at")
    .order("doc_type")
    .order("name")
    .limit(100);
  if (error) throw error;
  const list = data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agreement Templates"
        description={`Proposal, contract and change-order wording for BearSign. Seeded templates are drafts (${LEGAL_DRAFT_BADGE}); fill every [slot] and publish when your attorney has approved the text.`}
        actions={!viewer.impersonating ? <NewTemplateButton /> : undefined}
      />
      {list.length === 0 ? (
        <EmptyState icon={FileSignature} title="No templates yet">
          <p>Add a proposal or contract template to show terms on the customer page.</p>
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {list.map((t) => {
            const slots = placeholderSlots(t.body).length;
            return (
              <li key={t.id}>
                <Link
                  href={`/admin/agreements/${t.id}`}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-bb-cream-light"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{t.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {AGREEMENT_DOC_TYPE_LABELS[t.doc_type as AgreementDocType] ?? t.doc_type} · v
                      {t.version} · updated {formatDate(t.updated_at)}
                      {slots ? ` · ${slots} slot${slots === 1 ? "" : "s"} to fill` : ""}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {t.is_default && <Badge variant="outline">Default</Badge>}
                    {t.status === "published" ? (
                      <Badge variant="success">Published</Badge>
                    ) : (
                      <Badge variant="sample">Draft</Badge>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
