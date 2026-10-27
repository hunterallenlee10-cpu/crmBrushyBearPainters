import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { TemplateEditor } from "@/components/templates/template-editor";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { TEMPLATE_CATEGORIES, type TemplateCategory } from "@/lib/domain/templates/defaults";
import { formatDate } from "@/lib/format/dates";
import { loadTemplateEditorContext, workflowsUsing } from "@/lib/messaging/template-page";

export const metadata: Metadata = { title: "Edit template" };

type Params = Promise<{ id: string }>;

export default async function TemplatePage({ params }: { params: Params }) {
  const viewer = await requirePermission("templates:manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: t } = await supabase.from("message_templates").select("*").eq("id", id).maybeSingle();
  if (!t) notFound();
  const [ctx, approver] = await Promise.all([
    loadTemplateEditorContext(supabase),
    t.approved_by
      ? supabase.from("profiles").select("full_name").eq("id", t.approved_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const category = (TEMPLATE_CATEGORIES as readonly string[]).includes(t.category)
    ? (t.category as TemplateCategory)
    : "internal";
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/templates" className="flex w-fit items-center gap-1 text-sm text-bb-forest hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Messaging &amp; Templates
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t.name}</h1>
        <p className="text-sm text-muted-foreground">
          {t.channel === "sms" ? "Text" : "Email"} template · {t.description ?? ""}
          {t.approved_at ? ` · approved ${formatDate(t.approved_at)}` : ""}
        </p>
      </div>
      <TemplateEditor
        template={{
          id: t.id,
          key: t.key,
          channel: t.channel === "email" ? "email" : "sms",
          name: t.name,
          description: t.description ?? "",
          category,
          messageType: t.message_type === "marketing" ? "marketing" : "transactional",
          subject: t.subject ?? "",
          body: t.body,
          active: t.active,
          status: t.status === "approved" ? "approved" : "draft",
          approvedBy: approver.data?.full_name ?? null,
          approvedAt: t.approved_at,
          isSystem: t.is_system,
        }}
        company={ctx.company}
        jobs={ctx.jobs}
        canApprove={viewer.isOwner}
        readOnly={viewer.impersonating}
        usedBy={workflowsUsing(t.key)}
      />
    </div>
  );
}
