import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TemplateEditor } from "@/components/templates/template-editor";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadTemplateEditorContext } from "@/lib/messaging/template-page";

export const metadata: Metadata = { title: "New template" };

/** A company template (e.g. for campaigns or the inbox's template picker). */
export default async function NewTemplatePage() {
  const viewer = await requirePermission("templates:manage");
  const ctx = await loadTemplateEditorContext(await createSupabaseServerClient());
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/templates" className="flex w-fit items-center gap-1 text-sm text-bb-forest hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Messaging &amp; Templates
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New template</h1>
      <TemplateEditor
        template={{
          id: null,
          key: "",
          channel: "sms",
          name: "",
          description: "",
          category: "marketing",
          messageType: "transactional",
          subject: "",
          body: "Hi {{contact.first_name | default:\"there\"}}, ",
          active: true,
          status: "draft",
          approvedBy: null,
          approvedAt: null,
          isSystem: false,
        }}
        company={ctx.company}
        jobs={ctx.jobs}
        canApprove={viewer.isOwner}
        readOnly={viewer.impersonating}
        usedBy={[]}
      />
    </div>
  );
}
