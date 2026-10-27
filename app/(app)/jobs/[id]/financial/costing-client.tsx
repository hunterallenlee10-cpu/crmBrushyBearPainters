"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "@/lib/domain/ledger/types";
import { removeExpense } from "./actions";
import type { FinancialView } from "./types";
import { day, money } from "./ui";

function pct(r: number | null): string {
  return r === null ? "—" : `${Math.round(r * 1000) / 10}%`;
}

/** Job Costing (SPEC §5.6): labor, materials, subs, expenses → gross profit and margin. */
export function CostingPanel({ view }: { view: FinancialView }) {
  const c = view.costing;
  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  if (!c) {
    return (
      <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
        Job costing is for owners and the bookkeeper.
      </p>
    );
  }
  const tiles = [
    { label: "Revenue", value: money(c.revenueCents), caption: "Contract net of credits" },
    {
      label: "Costs",
      value: money(c.totalCostCents),
      caption: "Labor + materials + subs + expenses",
    },
    { label: "Gross profit", value: money(c.grossProfitCents), caption: "Revenue − costs" },
    { label: "Gross margin", value: pct(c.marginPct), caption: "Gross profit ÷ revenue" },
  ];
  return (
    <section aria-labelledby="fin-cost-h" className="flex flex-col gap-4">
      <h3 id="fin-cost-h" className="text-base font-semibold">
        Job costing
      </h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t.label}</p>
            <p className="text-xl font-bold tabular-nums">{t.value}</p>
            <p className="text-xs text-muted-foreground">{t.caption}</p>
          </div>
        ))}
      </div>
      {c.warnings.length > 0 && (
        <ul className="rounded-lg border border-warning/30 bg-warning-bg p-3 text-sm text-warning">
          {c.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4">
          <h4 className="mb-2 text-sm font-semibold">
            Labor · {c.laborHours} h{c.budgetedHours ? ` of ${c.budgetedHours} h budgeted` : ""} ·{" "}
            {money(c.laborCents)}
          </h4>
          {c.labor.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hours yet. Daily logs record them.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Person</th>
                  <th className="py-1 text-right font-medium">Hours</th>
                  <th className="py-1 text-right font-medium">Rate</th>
                  <th className="py-1 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {c.labor.map((l) => (
                  <tr key={`${l.userId ?? l.name}`}>
                    <td className="py-1">{l.name}</td>
                    <td className="py-1 text-right tabular-nums">{l.hours}</td>
                    <td className="py-1 text-right tabular-nums">
                      {l.rateCents === null ? "Not set" : `${money(l.rateCents)}/h`}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {l.costCents === null ? "—" : money(l.costCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <h4 className="mb-2 text-sm font-semibold">Materials · {money(c.materialsCents)}</h4>
          {c.materials.length === 0 ? (
            <p className="text-sm text-muted-foreground">No paint orders.</p>
          ) : (
            <ul className="divide-y text-sm">
              {c.materials.map((m) => (
                <li key={m.label} className="flex justify-between py-1">
                  <span>
                    {m.label} <span className="text-xs text-muted-foreground">({m.status})</span>
                  </span>
                  <span className="tabular-nums">{money(m.cents)}</span>
                </li>
              ))}
            </ul>
          )}
          <h4 className="mt-4 mb-2 text-sm font-semibold">
            Subcontractors · {money(c.subcontractorCents)}
          </h4>
          {c.subcontractors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No subcontractor POs on work orders.</p>
          ) : (
            <ul className="divide-y text-sm">
              {c.subcontractors.map((s) => (
                <li key={s.label} className="flex justify-between py-1">
                  <span>{s.label}</span>
                  <span className="tabular-nums">{money(s.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="rounded-2xl border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Other expenses · {money(c.expensesCents)}</h4>
          {!view.can.readOnly && (
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setAdding(true)}>
              <Plus aria-hidden /> Add expense
            </Button>
          )}
        </div>
        {c.expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No expenses. Add equipment rental, dump fees, permits and the like with a photo of the
            receipt.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {c.expenses.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  {e.description}
                  <span className="block text-xs text-muted-foreground">
                    {EXPENSE_CATEGORY_LABELS[e.category]} · {day(e.spentOn)}
                    {e.vendor ? ` · ${e.vendor}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{money(e.amountCents)}</span>
                  {e.hasReceipt && (
                    <a
                      href={`/api/files/receipts/${e.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 px-2 text-bb-forest hover:underline sm:min-h-9"
                    >
                      <Paperclip className="size-4" aria-hidden /> Receipt
                    </a>
                  )}
                  {!view.can.readOnly && (
                    <Button
                      variant="ghost"
                      className="h-11 sm:h-9"
                      aria-label={`Remove ${e.description}`}
                      onClick={() => setRemoving(e.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {adding && <ExpenseDialog view={view} onClose={() => setAdding(false)} />}
      {removing && <RemoveDialog id={removing} onClose={() => setRemoving(null)} />}
    </section>
  );
}

function ExpenseDialog({ view, onClose }: { view: FinancialView; onClose: () => void }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an expense</DialogTitle>
          <DialogDescription>
            Photos of receipts are cleaned of location data before they&apos;re stored.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            const form = new FormData(e.currentTarget);
            try {
              const res = await fetch(`/api/jobs/${view.jobId}/expenses`, {
                method: "POST",
                body: form,
              });
              const body = (await res.json().catch(() => ({}))) as { error?: string };
              if (!res.ok) {
                setError(body.error ?? "We couldn't save that expense.");
                return;
              }
              toast.success("Expense added.");
              onClose();
              router.refresh();
            } finally {
              setPending(false);
            }
          }}
        >
          <Field id="exp-category" label="Category" required>
            <NativeSelect id="exp-category" name="category" defaultValue="equipment">
              {view.expenseCategories.map((c: ExpenseCategory) => (
                <option key={c} value={c}>
                  {EXPENSE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="exp-desc" label="What" required>
            <Input id="exp-desc" name="description" className="h-11 sm:h-9" required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="exp-amount" label="Amount ($)" required>
              <Input
                id="exp-amount"
                name="amount"
                inputMode="decimal"
                className="h-11 sm:h-9"
                required
              />
            </Field>
            <Field id="exp-date" label="Date" required>
              <Input
                id="exp-date"
                name="spentOn"
                type="date"
                defaultValue={view.today}
                max={view.today}
                className="h-11 sm:h-9"
                required
              />
            </Field>
          </div>
          <Field id="exp-vendor" label="Vendor">
            <Input id="exp-vendor" name="vendor" className="h-11 sm:h-9" />
          </Field>
          <Field id="exp-receipt" label="Receipt (photo or PDF, optional)">
            <Input
              id="exp-receipt"
              name="receipt"
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="h-11 sm:h-9"
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Add expense
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [reason, setReason] = React.useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this expense?</DialogTitle>
          <DialogDescription>It stays in the audit log.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => removeExpense({ expenseId: id, reason }), {
              success: "Expense removed.",
              onOk: () => {
                onClose();
                router.refresh();
              },
            });
          }}
        >
          <Field id="exp-remove" label="Why" required>
            <Textarea
              id="exp-remove"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              Remove
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
