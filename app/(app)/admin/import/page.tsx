import type { Metadata } from "next";
import Link from "next/link";
import { FileUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDateTime } from "@/lib/format/dates";
import { IMPORT_MODULE_LABELS, IMPORT_MODULES, type ImportModule } from "@/lib/domain/imports";
import { NewImportForm } from "./new-import-form";

export const metadata: Metadata = { title: "Data Import" };

const STATUS: Record<
  string,
  { label: string; variant: "info" | "success" | "warning" | "neutral" }
> = {
  mapping: { label: "Mapping", variant: "info" },
  review: { label: "In review", variant: "warning" },
  applying: { label: "Applying", variant: "info" },
  applied: { label: "Applied", variant: "success" },
  canceled: { label: "Canceled", variant: "neutral" },
};

/** Admin → Data Import (SPEC §8.19): CSV → field mapping → preview → review queue → apply. */
export default async function ImportPage() {
  const viewer = await requirePermission("bulk:update");
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("imports")
    .select(
      "id, module, file_name, status, total_rows, applied_rows, error_rows, duplicate_rows, created_at, created_by",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  const imports = data ?? [];
  const creatorIds = [...new Set(imports.flatMap((i) => (i.created_by ? [i.created_by] : [])))];
  const { data: people } = creatorIds.length
    ? await db.from("profiles").select("id, full_name").in("id", creatorIds)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const allowed = IMPORT_MODULES.filter((m) =>
    viewer.can(
      m === "leads" ? "leads:create" : m === "accounts" ? "accounts:create" : "contacts:create",
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Data Import"
        description="Bring in leads, customers or contacts from a spreadsheet (CSV). You map the columns, see every row before anything is saved, and decide what to do with duplicates."
      />
      {!viewer.impersonating && allowed.length > 0 && (
        <NewImportForm
          modules={allowed.map((m) => ({ value: m, label: IMPORT_MODULE_LABELS[m] }))}
        />
      )}
      <section className="rounded-2xl border bg-card p-5" aria-labelledby="imports-heading">
        <h2 id="imports-heading" className="mb-3 text-base font-semibold">
          Recent imports
        </h2>
        {imports.length === 0 ? (
          <EmptyState icon={FileUp} title="No imports yet" className="py-8">
            Export your old customer list as CSV and upload it above. Nothing is saved until you
            apply it.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {imports.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/import/${i.id}`}
                    className="font-medium text-bb-forest hover:underline"
                  >
                    {i.file_name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {IMPORT_MODULE_LABELS[i.module as ImportModule] ?? i.module} · {i.total_rows}{" "}
                    rows
                    {i.status === "applied" ? ` · ${i.applied_rows} added` : ""} ·{" "}
                    {formatDateTime(i.created_at)}
                    {i.created_by && names.get(i.created_by) ? ` · ${names.get(i.created_by)}` : ""}
                  </p>
                </div>
                <Badge variant={STATUS[i.status]?.variant ?? "neutral"}>
                  {STATUS[i.status]?.label ?? i.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
