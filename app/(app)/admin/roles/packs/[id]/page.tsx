import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABELS, SCOPE_LABELS } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/viewer";
import { isUuid, loadRolesModel } from "../../data";
import { CATALOG_BY_CATEGORY } from "../../model";
import { PackBadge } from "../../_components/badges";
import { DeleteRecordDialog } from "../../_components/delete-record-dialog";
import { PackEditor } from "../pack-editor";
import { DuplicatePackButton } from "./duplicate-pack-button";

export const metadata: Metadata = { title: "Permission pack" };

export default async function PackPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("roles:manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { templates, packs } = await loadRolesModel();
  const pack = packs.find((p) => p.id === id);
  if (!pack) notFound();
  const usedBy = templates.filter((t) => t.packIds.includes(pack.id));
  const scopes = new Map(pack.permissions.map((p) => [p.permission, p.scope]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/admin/roles?tab=packs">
            <ArrowLeft aria-hidden /> Roles &amp; Permissions
          </Link>
        </Button>
      </div>
      <PageHeader
        title={pack.name}
        description={pack.description ?? undefined}
        actions={
          pack.isSystem ? (
            <DuplicatePackButton id={pack.id} />
          ) : (
            <DeleteRecordDialog
              table="permission_packs"
              id={pack.id}
              name={pack.name}
              redirectTo="/admin/roles?tab=packs"
              size="default"
            />
          )
        }
      />
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <PackBadge pack={pack} />
        <span>{CATEGORY_LABELS[pack.category]}</span>
        <span className="font-mono text-xs">{pack.key}</span>
      </div>

      {pack.isSystem ? (
        <>
          <div
            role="note"
            className="flex items-start gap-3 rounded-2xl border bg-muted/40 p-4 text-sm"
          >
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Built-in packs are read-only so the starting templates stay predictable. To change
              what this pack grants, duplicate it as a custom pack, edit the copy, and swap it into
              the templates that need it.
            </p>
          </div>
          <section aria-labelledby="pack-perms" className="rounded-2xl border bg-card p-5">
            <h2 id="pack-perms" className="mb-4 text-base font-semibold">
              Permissions ({pack.permissions.length})
            </h2>
            <div className="grid gap-5 lg:grid-cols-2">
              {CATALOG_BY_CATEGORY.map((g) => {
                const items = g.items.filter((p) => scopes.has(p.key));
                if (items.length === 0) return null;
                return (
                  <table key={g.category} className="w-full text-sm">
                    <caption className="pb-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {g.label}
                    </caption>
                    <thead className="sr-only">
                      <tr>
                        <th scope="col">Permission</th>
                        <th scope="col">Scope</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map((p) => {
                        const s = scopes.get(p.key);
                        return (
                          <tr key={p.key}>
                            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                              {p.label}
                            </th>
                            <td className="py-1.5 text-right font-medium whitespace-nowrap">
                              {s && p.scoped ? SCOPE_LABELS[s] : "Granted"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <PackEditor
          key={pack.permissions
            .map((p) => `${p.permission}=${p.scope}`)
            .sort()
            .join(",")}
          mode="edit"
          pack={{
            id: pack.id,
            name: pack.name,
            description: pack.description ?? "",
            category: pack.category,
            permissions: pack.permissions,
          }}
        />
      )}

      <section aria-labelledby="pack-used-by" className="rounded-2xl border bg-card p-5">
        <h2 id="pack-used-by" className="text-base font-semibold">
          Used by {usedBy.length === 1 ? "1 template" : `${usedBy.length} templates`}
        </h2>
        {usedBy.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Not in any template yet. Add it from a template&apos;s page.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {usedBy.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/admin/roles/templates/${t.id}`}
                  className="inline-flex rounded-full border px-3 py-1 text-sm hover:bg-muted"
                >
                  {t.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
