import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDateTime } from "@/lib/format/dates";
import { BulkCsvForm } from "./bulk-csv-form";
import { BULK_STATUS } from "./statuses";

export const metadata: Metadata = { title: "Bulk Update" };

const MODULE_LABELS: Record<string, string> = {
  leads: "Leads",
  jobs: "Jobs",
  accounts: "Accounts",
  contacts: "Contacts",
};

/** Admin → Bulk Update (SPEC §8.19): preview first, audited, reversible. */
export default async function BulkUpdatePage() {
  const viewer = await requirePermission("bulk:update");
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("bulk_updates")
    .select(
      "id, module, source, title, status, total_rows, changed_rows, applied_rows, failed_rows, reverted_rows, conflict_rows, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  const list = data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bulk Update"
        description="Change a field on many records at once. You always see a preview first; nothing changes until you apply, every change is in the audit log, and an applied update can be reverted."
      />
      <section className="rounded-2xl border bg-card p-5" aria-labelledby="bulk-how">
        <h2 id="bulk-how" className="text-base font-semibold">
          Two ways to start
        </h2>
        <ol className="mt-2 list-decimal pl-5 text-sm text-muted-foreground">
          <li>
            On the{" "}
            <Link className="text-bb-forest underline" href="/leads/list">
              Lead List
            </Link>
            ,{" "}
            <Link className="text-bb-forest underline" href="/jobs/list">
              Job List
            </Link>
            ,{" "}
            <Link className="text-bb-forest underline" href="/accounts">
              Accounts
            </Link>{" "}
            or{" "}
            <Link className="text-bb-forest underline" href="/contacts">
              Contacts
            </Link>
            , tick the records and choose <strong>Bulk update…</strong>
          </li>
          <li>
            Or upload a CSV with an <code>id</code> column (export the list to get it) and a column
            per field to change.
          </li>
        </ol>
        {!viewer.impersonating && <BulkCsvForm />}
      </section>
      <section className="rounded-2xl border bg-card p-5" aria-labelledby="bulk-history">
        <h2 id="bulk-history" className="mb-3 text-base font-semibold">
          History
        </h2>
        {list.length === 0 ? (
          <EmptyState icon={Layers} title="No bulk updates yet" className="py-8">
            Previews and applied updates show up here, with a way to undo them.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {list.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/bulk-update/${b.id}`}
                    className="font-medium text-bb-forest hover:underline"
                  >
                    {b.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {MODULE_LABELS[b.module] ?? b.module} ·{" "}
                    {b.source === "csv" ? "CSV" : "List selection"} · {b.changed_rows} of{" "}
                    {b.total_rows} change
                    {b.status === "applied" ? ` · ${b.applied_rows} applied` : ""}
                    {b.status === "reverted"
                      ? ` · ${b.reverted_rows} reverted, ${b.conflict_rows} left`
                      : ""}{" "}
                    · {formatDateTime(b.created_at)}
                  </p>
                </div>
                <Badge variant={BULK_STATUS[b.status]?.variant ?? "neutral"}>
                  {BULK_STATUS[b.status]?.label ?? b.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
