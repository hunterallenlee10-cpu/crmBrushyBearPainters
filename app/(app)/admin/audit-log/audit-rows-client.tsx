"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type FieldChange } from "@/lib/admin/audit-format";

export type AuditRowView = {
  id: number;
  when: string;
  who: string;
  what: string;
  ip: string;
  table: string;
  recordId: string | null;
  changes: FieldChange[];
};

/** Audit entries; expanding a row shows the before/after of the fields that changed. */
export function AuditRows({ rows }: { rows: readonly AuditRowView[] }) {
  const [open, setOpen] = React.useState<ReadonlySet<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="rounded-2xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Details</span>
            </TableHead>
            <TableHead>When</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>What</TableHead>
            <TableHead>IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const expanded = open.has(row.id);
            const detailId = `audit-detail-${row.id}`;
            return (
              <React.Fragment key={row.id}>
                <TableRow data-testid="audit-row">
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggle(row.id)}
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      className="grid size-7 place-items-center rounded-md hover:bg-muted"
                    >
                      {expanded ? (
                        <ChevronDown className="size-4" aria-hidden />
                      ) : (
                        <ChevronRight className="size-4" aria-hidden />
                      )}
                      <span className="sr-only">
                        {expanded ? "Hide changes" : "Show changes"}: {row.what}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.when}</TableCell>
                  <TableCell>{row.who}</TableCell>
                  <TableCell className="max-w-[36rem] truncate" title={row.what}>
                    {row.what}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.ip}
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow id={detailId} className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={5} className="whitespace-normal">
                      <div className="flex flex-col gap-2 py-2">
                        <p className="text-xs text-muted-foreground">
                          {row.table}
                          {row.recordId && (
                            <>
                              {" · Record "}
                              <code className="font-mono">{row.recordId}</code>
                            </>
                          )}
                        </p>
                        {row.changes.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No field details recorded.
                          </p>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border bg-card">
                            <table className="w-full text-sm" aria-label="Field changes">
                              <thead>
                                <tr className="border-b text-left text-xs text-muted-foreground">
                                  <th scope="col" className="px-3 py-1.5 font-medium">
                                    Field
                                  </th>
                                  <th scope="col" className="px-3 py-1.5 font-medium">
                                    Before
                                  </th>
                                  <th scope="col" className="px-3 py-1.5 font-medium">
                                    After
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.changes.map((c) => (
                                  <tr key={c.field} className="border-b align-top last:border-0">
                                    <th
                                      scope="row"
                                      className="px-3 py-1.5 text-left font-mono text-xs font-normal"
                                    >
                                      {c.field}
                                    </th>
                                    <td className="px-3 py-1.5 break-all text-danger/90">
                                      {c.before}
                                    </td>
                                    <td className="px-3 py-1.5 break-all text-success">
                                      {c.after}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
