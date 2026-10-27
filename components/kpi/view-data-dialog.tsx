"use client";

import * as React from "react";
import Link from "next/link";
import { Download, Loader2, Table2 } from "lucide-react";
import { toast } from "sonner";
import { formatInTimeZone } from "date-fns-tz";
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
import { csvFileName, toCsv, type CsvCell } from "@/lib/domain/reports/csv";
import { DISPLAY_TZ } from "@/lib/format/dates";
import { useCanExport } from "@/components/kpi/export-context";
import { logChartExport } from "@/app/(app)/analytics/export-actions";

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

function csvValue(v: DataCell | undefined): CsvCell {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "string") return v;
  return v.text;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "chart";

/** Saves the table as CSV after the server logs the export (data:export). */
function DownloadCsvButton({
  title,
  dataset,
  kind,
  filters,
  columns,
  rows,
}: {
  title: string;
  dataset: string;
  kind: "chart" | "kpi_table";
  filters: Record<string, string>;
  columns: readonly DataColumn[];
  rows: readonly DataRow[];
}) {
  const canExport = useCanExport();
  const [busy, setBusy] = React.useState(false);
  if (!canExport) {
    return (
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
        <TooltipContent>
          Your role can&apos;t export data. Ask an owner for export access.
        </TooltipContent>
      </Tooltip>
    );
  }
  async function download() {
    setBusy(true);
    try {
      const res = await logChartExport({ kind, dataset, title, row_count: rows.length, filters });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      const csv = toCsv(
        columns.map((c) => c.label),
        rows.map((r) => columns.map((c) => csvValue(r[c.key]))),
      );
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = csvFileName(title, formatInTimeZone(new Date(), DISPLAY_TZ, "yyyy-MM-dd"));
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded. The export is logged.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={download}
      disabled={busy}
      data-testid="download-csv"
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      Download CSV
    </Button>
  );
}

/**
 * "View data" (SPEC §8 global patterns): the exact aggregates behind a chart
 * in a plain table. It is also the accessible alternative to the chart.
 * "Download CSV" saves the same table for people with data:export; each
 * download is logged (export_log). Without the permission it is disabled.
 */
export function ViewDataDialog({
  title,
  description,
  columns,
  rows,
  triggerLabel = "View data",
  dataset,
  kind = "chart",
  filters = {},
}: {
  title: string;
  description: string;
  columns: readonly DataColumn[];
  rows: readonly DataRow[];
  triggerLabel?: string;
  /** Registry id of what's shown (export log); defaults to the title. */
  dataset?: string;
  kind?: "chart" | "kpi_table";
  /** Period / filters in effect (export log). */
  filters?: Record<string, string>;
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
          <DownloadCsvButton
            title={title}
            dataset={dataset ?? slug(title)}
            kind={kind}
            filters={filters}
            columns={columns}
            rows={rows}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
