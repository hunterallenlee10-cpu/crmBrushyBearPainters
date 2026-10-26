"use client";

import Link from "next/link";
import { Download, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type DataColumn = { key: string; label: string; align?: "left" | "right" };
/** A cell: plain text/number, or a drill-down link. */
export type DataCell = string | number | null | { text: string; href: string };
export type DataRow = Record<string, DataCell>;

function cellContent(v: DataCell | undefined): React.ReactNode {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "string") return v;
  return (
    <Link href={v.href} className="text-bb-forest underline-offset-2 hover:underline">
      {v.text}
    </Link>
  );
}

/**
 * "View data" (SPEC §8 global patterns): the exact aggregates behind a chart
 * in a plain table. It is also the accessible alternative to the chart.
 * CSV download arrives with Export Controls (Phase 10), so it is shown disabled.
 */
export function ViewDataDialog({
  title,
  description,
  columns,
  rows,
  triggerLabel = "View data",
}: {
  title: string;
  description: string;
  columns: readonly DataColumn[];
  rows: readonly DataRow[];
  triggerLabel?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="xs" aria-label={`${triggerLabel}: ${title}`}>
          <Table2 aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
        // Focus the dialog itself, not the first control (which would pop the CSV tooltip open).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableCaption className="sr-only">{title}</TableCaption>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead
                    key={c.key}
                    scope="col"
                    className={cn(c.align === "right" && "text-right")}
                  >
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                    No data yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((c, j) => {
                      const text = cellContent(row[c.key]);
                      const cls = cn(c.align === "right" && "text-right tabular-nums");
                      return j === 0 ? (
                        <TableHead key={c.key} scope="row" className={cn("font-medium", cls)}>
                          {text}
                        </TableHead>
                      ) : (
                        <TableCell key={c.key} className={cls}>
                          {text}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button gets no hover/focus events, so the wrapper carries the tooltip. */}
              <span tabIndex={0} className="inline-flex rounded-md">
                <Button variant="outline" size="sm" disabled aria-disabled>
                  <Download aria-hidden />
                  Download CSV
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Arrives with Export Controls (Phase 10)</TooltipContent>
          </Tooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
