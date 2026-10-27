import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  MERGE_FIELDS,
  REQUIRED_MERGE_FIELDS,
  type AgreementDocType,
} from "@/lib/estimating/engine";
import { formatDateTime } from "@/lib/format/dates";
import { TemplateEditor } from "./editor";

export const metadata: Metadata = { title: "Agreement Template" };

type Params = Promise<{ id: string }>;

export default async function AgreementTemplatePage({ params }: { params: Params }) {
  const viewer = await requirePermission("templates:manage");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: t } = await supabase
    .from("agreement_templates")
    .select("id, doc_type, name, body, clauses, status, version, approved_at, approval_note")
    .eq("id", id)
    .maybeSingle();
  if (!t) notFound();
  const clauses = Array.isArray(t.clauses)
    ? t.clauses.flatMap((c) =>
        c && typeof c === "object" && !Array.isArray(c) && typeof c.body === "string"
          ? [
              {
                title: typeof c.title === "string" ? c.title : "",
                body: c.body,
                when: (c.when === "lead_safe" || c.when === "hoa" ? c.when : "always") as
                  "always" | "lead_safe" | "hoa",
              },
            ]
          : [],
      )
    : [];
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/agreements"
        className="inline-flex w-fit items-center gap-1 text-sm text-bb-forest hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Agreement Templates
      </Link>
      <TemplateEditor
        template={{
          id: t.id,
          docType: t.doc_type as AgreementDocType,
          name: t.name,
          body: t.body,
          clauses,
          status: t.status,
          version: t.version,
          approvedLabel: t.approved_at ? `Published ${formatDateTime(t.approved_at)}` : null,
        }}
        mergeFields={MERGE_FIELDS.map((f) => ({ key: f.key, label: f.label }))}
        required={[...(REQUIRED_MERGE_FIELDS[t.doc_type as AgreementDocType] ?? [])]}
        canPublish={viewer.can("settings:manage") && !viewer.impersonating}
        readOnly={viewer.impersonating}
      />
    </div>
  );
}
