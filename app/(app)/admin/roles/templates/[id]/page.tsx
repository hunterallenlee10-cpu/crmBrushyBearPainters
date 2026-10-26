import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { isUuid, loadRolesModel, loadUserCounts } from "../../data";
import { resolveTemplate } from "../../model";
import { TemplateBadges } from "../../_components/badges";
import { DeleteRecordDialog } from "../../_components/delete-record-dialog";
import { PermissionMatrix } from "../../_components/permission-matrix";
import { TemplateDetailsForm } from "./template-details-form";
import { TemplatePacksEditor } from "./template-packs-editor";

export const metadata: Metadata = { title: "Role template" };

const USERS_SHOWN = 12;

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("roles:manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [{ templates, packs }, counts] = await Promise.all([loadRolesModel(), loadUserCounts()]);
  const template = templates.find((t) => t.id === id);
  if (!template) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: users, count } = await supabase
    .from("profiles")
    .select("id, full_name, is_active", { count: "exact" })
    .eq("role_template_id", template.id)
    .order("is_active", { ascending: false })
    .order("full_name")
    .limit(USERS_SHOWN);
  const userList = users ?? [];
  const activeUsers = counts.get(template.id)?.active ?? 0;
  const totalUsers = count ?? userList.length;

  const packsById = new Map(packs.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/admin/roles?tab=templates">
            <ArrowLeft aria-hidden /> Roles &amp; Permissions
          </Link>
        </Button>
      </div>
      <PageHeader
        title={template.name}
        description={template.description ?? undefined}
        actions={
          !template.isSystem ? (
            <DeleteRecordDialog
              table="role_templates"
              id={template.id}
              name={template.name}
              redirectTo="/admin/roles?tab=templates"
              size="default"
            />
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <TemplateBadges template={template} />
        <span className="font-mono text-xs">{template.key}</span>
      </div>

      {template.grantsAll ? (
        <>
          <div
            role="note"
            className="flex items-start gap-3 rounded-2xl border border-bb-honey bg-bb-honey/10 p-4 text-sm"
          >
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <strong>The Owner template has every permission and is locked.</strong> Its name,
              packs and flags can&apos;t be changed, so the business can never lock itself out. To
              limit what an owner-level person can do, put them on a different template.
            </p>
          </div>
          <PermissionMatrix
            map={resolveTemplate(template, [], packsById)}
            description="Every permission, for everyone's records."
          />
        </>
      ) : (
        <>
          <TemplateDetailsForm
            key={`${template.name}|${template.description ?? ""}`}
            id={template.id}
            name={template.name}
            description={template.description ?? ""}
          />
          <TemplatePacksEditor
            key={[...template.packIds].sort().join(",")}
            templateId={template.id}
            savedPackIds={template.packIds}
            packs={packs}
            activeUsers={activeUsers}
          />
        </>
      )}

      <section aria-labelledby="template-users" className="rounded-2xl border bg-card p-5">
        <h2 id="template-users" className="text-base font-semibold">
          Users on this template ({totalUsers})
        </h2>
        {userList.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Nobody is on this template yet. Assign it from a user&apos;s page.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {userList.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/admin/users/${u.id}`}
                  className="inline-flex rounded-full border px-3 py-1 text-sm hover:bg-muted"
                >
                  {u.full_name}
                  {!u.is_active && (
                    <span className="ml-1 text-muted-foreground">(deactivated)</span>
                  )}
                </Link>
              </li>
            ))}
            {totalUsers > userList.length && (
              <li className="px-1 py-1 text-sm text-muted-foreground">
                and {totalUsers - userList.length} more
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
