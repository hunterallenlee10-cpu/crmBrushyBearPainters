"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type OutboxRowView = {
  id: string;
  when: string;
  domain: string;
  operation: string;
  recipient: string;
  subject: string | null;
  status: string;
  statusLabel: string;
  body: { kind: "html" | "text"; content: string } | null;
  payloadJson: string;
};

/** Most recent outbox entries with an expandable rendered body and payload viewer. */
export function OutboxList({ rows }: { rows: readonly OutboxRowView[] }) {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
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
            <TableHead>Integration</TableHead>
            <TableHead>Operation</TableHead>
            <TableHead>Recipient</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const expanded = open.has(row.id);
            const detailId = `outbox-detail-${row.id}`;
            return (
              <React.Fragment key={row.id}>
                <TableRow data-testid="outbox-row" data-outbox-id={row.id}>
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
                        {expanded ? "Hide" : "Show"} message from {row.when}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.when}</TableCell>
                  <TableCell>{row.domain}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs">{row.operation}</code>
                  </TableCell>
                  <TableCell>{row.recipient}</TableCell>
                  <TableCell className="max-w-64 truncate" title={row.subject ?? undefined}>
                    {row.subject ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.status === "simulated" ? "info" : "neutral"}>
                      {row.statusLabel}
                    </Badge>
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow id={detailId} className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={7} className="whitespace-normal">
                      <div className="grid gap-4 py-2 lg:grid-cols-2">
                        <div className="min-w-0">
                          <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase">
                            Rendered body
                          </h3>
                          {row.body === null ? (
                            <p className="text-sm text-muted-foreground">No body.</p>
                          ) : row.body.kind === "html" ? (
                            <iframe
                              title={`Rendered body of the message from ${row.when}`}
                              sandbox=""
                              srcDoc={row.body.content}
                              className="h-56 w-full rounded-lg border bg-white"
                            />
                          ) : (
                            <p className="rounded-lg border bg-card p-3 text-sm whitespace-pre-wrap">
                              {row.body.content}
                            </p>
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase">
                            Payload
                          </h3>
                          <pre className="max-h-56 overflow-auto rounded-lg border bg-card p-3 font-mono text-xs">
                            {row.payloadJson}
                          </pre>
                        </div>
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
