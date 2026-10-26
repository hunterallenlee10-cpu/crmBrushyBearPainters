import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AUDIT_ACTIONS,
  auditTableOptions,
  hasAuditFilters,
  type AuditFilters,
} from "@/lib/admin/audit-format";

const selectClass =
  "h-9 w-full rounded-md border bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** Plain GET form: filters live in the URL, so they work without JavaScript and can be shared. */
export function AuditFiltersForm({
  filters,
  users,
}: {
  filters: AuditFilters;
  users: readonly { id: string; label: string }[];
}) {
  return (
    <form
      method="get"
      action="/admin/audit-log"
      className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      aria-label="Filter the audit log"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-table">Table</Label>
        <select
          id="audit-table"
          name="table"
          defaultValue={filters.table ?? ""}
          className={selectClass}
        >
          <option value="">All tables</option>
          {auditTableOptions(filters.table).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-action">Change</Label>
        <select
          id="audit-action"
          name="action"
          defaultValue={filters.action ?? ""}
          className={selectClass}
        >
          <option value="">Any change</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-actor">Who</Label>
        <select
          id="audit-actor"
          name="actor"
          defaultValue={filters.actor ?? ""}
          className={selectClass}
        >
          <option value="">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-from">From (Pacific)</Label>
        <Input
          id="audit-from"
          name="from"
          type="date"
          defaultValue={filters.from ?? ""}
          className="h-9"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-to">To (Pacific)</Label>
        <Input
          id="audit-to"
          name="to"
          type="date"
          defaultValue={filters.to ?? ""}
          className="h-9"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-record">Record ID</Label>
        <Input
          id="audit-record"
          name="record"
          defaultValue={filters.record ?? ""}
          placeholder="Exact ID"
          autoComplete="off"
          className="h-9"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-6">
        <Button type="submit" size="sm">
          Apply filters
        </Button>
        {hasAuditFilters(filters) && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/audit-log">Clear filters</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
