"use client";

import * as React from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportListCsv } from "@/lib/exports/actions";

/**
 * "Export CSV" for a list (Export Controls): the server rebuilds the list from
 * the same filters, checks the export permission, logs it, and returns the
 * file. Up to 10,000 rows.
 */
export function ExportListButton({
  list,
  total,
}: {
  list: "leads" | "jobs" | "audit_log";
  total: number | null;
}) {
  const [busy, setBusy] = React.useState(false);
  async function run() {
    setBusy(true);
    const r = await exportListCsv({ list, query: window.location.search.slice(1) });
    setBusy(false);
    if (!r.ok) return toast.error(r.error.message);
    const blob = new Blob([r.data.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.data.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(
      `Exported ${r.data.rows.toLocaleString("en-US")} rows${r.data.truncated ? " (the first 10,000)" : ""}.`,
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9"
      disabled={busy || total === 0}
      onClick={run}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      Export CSV
    </Button>
  );
}
