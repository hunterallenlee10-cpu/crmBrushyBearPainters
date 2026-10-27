"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, fieldAria } from "@/components/forms/field";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { formatCents } from "@/lib/format/money";
import { closeMonth, reopenMonth } from "./actions";

export type MonthRow = {
  month: string;
  label: string;
  status: "open" | "closed" | "reopened";
  closedBy: string | null;
  closedAt: string | null;
  note: string | null;
  reopenReason: string | null;
  billedCents: number | null;
  collectedCents: number | null;
};

export function FinanceClient({
  rows,
  canReopen,
  canClose,
}: {
  rows: MonthRow[];
  canReopen: boolean;
  canClose: boolean;
}) {
  const [closing, setClosing] = React.useState<MonthRow | null>(null);
  const [reopening, setReopening] = React.useState<MonthRow | null>(null);
  return (
    <section aria-labelledby="close-h" className="rounded-2xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 id="close-h" className="text-base font-semibold">
          Month close
        </h2>
        <p className="text-xs text-muted-foreground">
          Closing a month locks invoices issued and payments received in it. After that, changes
          need an owner override with a reason; only an owner can reopen a month.
        </p>
      </div>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.month} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                {r.label}
                {r.status === "closed" ? (
                  <Badge variant="success">
                    <Lock aria-hidden /> Closed
                  </Badge>
                ) : r.status === "reopened" ? (
                  <Badge variant="warning">Reopened</Badge>
                ) : (
                  <Badge variant="neutral">Open</Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.status === "closed" && r.closedAt
                  ? `Closed ${r.closedAt}${r.closedBy ? ` by ${r.closedBy}` : ""} · billed ${formatCents(r.billedCents ?? 0)} · collected ${formatCents(r.collectedCents ?? 0)}${r.note ? ` · ${r.note}` : ""}`
                  : r.status === "reopened"
                    ? `Reopened: ${r.reopenReason ?? ""}`
                    : "Not closed"}
              </p>
            </div>
            {r.status === "closed"
              ? canReopen && (
                  <Button variant="outline" className="h-11 sm:h-9" onClick={() => setReopening(r)}>
                    <LockOpen aria-hidden /> Reopen<span className="sr-only"> {r.label}</span>
                  </Button>
                )
              : canClose && (
                  <Button className="h-11 sm:h-9" onClick={() => setClosing(r)}>
                    <Lock aria-hidden /> Close<span className="sr-only"> {r.label}</span>
                  </Button>
                )}
          </li>
        ))}
      </ul>
      {closing && <CloseDialog row={closing} onClose={() => setClosing(null)} />}
      {reopening && <ReopenDialog row={reopening} onClose={() => setReopening(null)} />}
    </section>
  );
}

function CloseDialog({ row, onClose }: { row: MonthRow; onClose: () => void }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [note, setNote] = React.useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {row.label}?</DialogTitle>
          <DialogDescription>
            Reconcile the bank first. Afterwards, invoices and payments dated in {row.label} need an
            owner override to change.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => closeMonth({ month: row.month, note }), {
              success: `${row.label} closed.`,
              onOk: () => {
                onClose();
                router.refresh();
              },
            });
          }}
        >
          <Field id="close-note" label="Note (optional)">
            <Textarea
              id="close-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Close month
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ row, onClose }: { row: MonthRow; onClose: () => void }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reopen {row.label}?</DialogTitle>
          <DialogDescription>Owner override. The reason is audit-logged.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => reopenMonth({ month: row.month, reason }), {
              success: `${row.label} reopened.`,
              onOk: () => {
                onClose();
                router.refresh();
              },
              onError: (er) => setErrors(firstErrors(er)),
            });
          }}
        >
          <Field id="reopen-reason" label="Why" error={errors.reason} required>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              {...fieldAria("reopen-reason", errors.reason)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Reopen month
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
