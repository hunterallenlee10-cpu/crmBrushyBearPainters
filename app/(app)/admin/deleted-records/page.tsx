import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { check } from "@/lib/actions/errors";
import { createSupabaseServerClient } from "@/lib/db/server";
import { DeletedRecordsTable, type DeletedRecordRow } from "./deleted-records-table";
import { isDeletedRecordTable } from "@/lib/validation/records";

export const metadata: Metadata = { title: "Deleted Records" };

const TZ = "America/Los_Angeles";

export default async function DeletedRecordsPage() {
  await requirePermission("records:restore");
  const supabase = await createSupabaseServerClient();
  const records = check(await supabase.rpc("list_deleted_records")) ?? [];

  const rows: DeletedRecordRow[] = records
    .filter((r) => isDeletedRecordTable(r.table_name))
    .map((r) => ({
      table: r.table_name as DeletedRecordRow["table"],
      id: r.record_id,
      label: r.label,
      deletedAt: r.deleted_at,
      deletedAtText: formatInTimeZone(r.deleted_at, TZ, "MMM d, yyyy, h:mm a zzz"),
      deletedBy: r.deleted_by_name ?? null,
      reason: r.delete_reason ?? null,
    }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Deleted Records"
        description="Deleted territories, role templates and permission packs. Restoring puts a record back exactly as it was."
      />
      <DeletedRecordsTable rows={rows} />
    </div>
  );
}
