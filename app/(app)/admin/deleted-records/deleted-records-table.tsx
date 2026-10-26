"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { restoreRecord } from "./actions";
import {
  DELETED_RECORD_TABLES,
  DELETED_RECORD_TYPES,
  type DeletedRecordTable,
} from "@/lib/validation/records";

export type DeletedRecordRow = {
  table: DeletedRecordTable;
  id: string;
  label: string;
  deletedAt: string;
  /** Pre-formatted on the server in Pacific time. */
  deletedAtText: string;
  deletedBy: string | null;
  reason: string | null;
};

type Filter = DeletedRecordTable | "all";

export function DeletedRecordsTable({ rows }: { rows: DeletedRecordRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [restoring, setRestoring] = React.useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyState icon={Trash2} title="Nothing has been deleted">
        Deleted territories, templates and packs show up here for restoring.
      </EmptyState>
    );
  }

  const counts = Object.fromEntries(
    DELETED_RECORD_TABLES.map((t) => [t, rows.filter((r) => r.table === t).length]),
  ) as Record<DeletedRecordTable, number>;
  // A type whose last record was just restored falls back to "All".
  const active: Filter = filter !== "all" && counts[filter] === 0 ? "all" : filter;
  const visible = active === "all" ? rows : rows.filter((r) => r.table === active);
  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: rows.length },
    ...DELETED_RECORD_TABLES.filter((t) => counts[t] > 0).map((t) => ({
      key: t,
      label: DELETED_RECORD_TYPES[t].plural,
      count: counts[t],
    })),
  ];

  async function restore(row: DeletedRecordRow) {
    setRestoring(row.id);
    const result = await restoreRecord({ table: row.table, id: row.id });
    setRestoring(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    const type = DELETED_RECORD_TYPES[row.table];
    toast.success(`Restored ${row.label}.`, {
      action: { label: `Open ${type.plural}`, onClick: () => router.push(type.href) },
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Button
            key={f.key}
            type="button"
            size="sm"
            variant={active === f.key ? "default" : "outline"}
            aria-pressed={active === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-xs tabular-nums",
                active === f.key ? "bg-primary-foreground/20" : "bg-muted",
              )}
            >
              {f.count}
            </span>
          </Button>
        ))}
      </div>

      <section className="rounded-2xl border bg-card">
        <Table aria-label="Deleted records">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Name</TableHead>
              <TableHead className="hidden sm:table-cell">What</TableHead>
              <TableHead className="hidden md:table-cell">Deleted</TableHead>
              <TableHead className="hidden lg:table-cell">By</TableHead>
              <TableHead className="hidden lg:table-cell">Reason</TableHead>
              <TableHead className="pr-4 text-right">
                <span className="sr-only">Restore</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const type = DELETED_RECORD_TYPES[r.table];
              return (
                <TableRow key={`${r.table}:${r.id}`}>
                  <TableCell className="pl-4 align-top whitespace-normal">
                    <p className="font-medium">{r.label}</p>
                    {/* Small screens: the hidden columns, stacked. */}
                    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground lg:hidden">
                      <span className="sm:hidden">{type.singular}</span>
                      <span className="md:hidden">
                        <time dateTime={r.deletedAt}>{r.deletedAtText}</time>
                      </span>
                      {r.deletedBy && <span>by {r.deletedBy}</span>}
                      {r.reason && <span className="break-words">Reason: {r.reason}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden align-top sm:table-cell">
                    <Badge variant="neutral">{type.singular}</Badge>
                  </TableCell>
                  <TableCell className="hidden align-top md:table-cell">
                    <time dateTime={r.deletedAt}>{r.deletedAtText}</time>
                  </TableCell>
                  <TableCell className="hidden align-top lg:table-cell">
                    {r.deletedBy ?? <span className="text-muted-foreground">Unknown</span>}
                  </TableCell>
                  <TableCell className="hidden max-w-xs align-top whitespace-normal lg:table-cell">
                    {r.reason ?? <span className="text-muted-foreground">No reason given</span>}
                  </TableCell>
                  <TableCell className="pr-4 text-right align-top">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restoring !== null}
                      onClick={() => void restore(r)}
                      aria-label={`Restore ${r.label}`}
                    >
                      {restoring === r.id ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <ArchiveRestore aria-hidden />
                      )}
                      Restore
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      <p className="text-xs text-muted-foreground">
        Restored territories go back to{" "}
        <Link href="/admin/territories" className="underline">
          Territories
        </Link>
        ; templates and packs go back to{" "}
        <Link href="/admin/roles" className="underline">
          Roles &amp; Permissions
        </Link>
        .
      </p>
    </div>
  );
}
