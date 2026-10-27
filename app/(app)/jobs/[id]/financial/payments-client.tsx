"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, CircleDollarSign, RotateCcw, Shuffle, Undo2 } from "lucide-react";
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
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { dollarsToCents } from "@/lib/validation/common";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/domain/ledger/types";
import {
  recordPayment,
  refundPayment,
  setPaymentApplications,
  updatePaymentStatus,
} from "./actions";
import type { FinancialView, FinInvoice, FinPayment } from "./types";
import { LockNotice, PaymentStatusBadge, day, dollarsText, money } from "./ui";

/** Invoices a payment can go on, oldest due first (same order as the ledger's suggestion). */
function payable(invoices: readonly FinInvoice[]): FinInvoice[] {
  return invoices
    .filter((i) => i.status !== "void" && i.totalCents > 0)
    .sort((a, b) => {
      const ka = a.dueDate ?? a.issueDate ?? a.createdAt ?? "";
      const kb = b.dueDate ?? b.issueDate ?? b.createdAt ?? "";
      return ka === kb ? a.number.localeCompare(b.number) : ka.localeCompare(kb);
    });
}

function cents(text: string): number {
  const c = dollarsToCents(text);
  return c === null || Number.isNaN(c) ? 0 : c;
}

export function PaymentsPanel({ view }: { view: FinancialView }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [recording, setRecording] = React.useState(false);
  const [applying, setApplying] = React.useState<FinPayment | null>(null);
  const [status, setStatus] = React.useState<{ p: FinPayment; action: "bounce" | "void" } | null>(
    null,
  );
  const [refunding, setRefunding] = React.useState<FinPayment | null>(null);
  const can = view.can.recordPayments;
  const owed = view.invoices.some((i) => i.status !== "void" && i.balanceCents > 0);

  return (
    <section aria-labelledby="fin-pay-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="fin-pay-h" className="text-base font-semibold">
          Payments
        </h3>
        {can && (
          <Button className="h-11 sm:h-9" onClick={() => setRecording(true)} disabled={!owed}>
            <CircleDollarSign aria-hidden /> Record payment
          </Button>
        )}
      </div>
      {can && !owed && (
        <p className="text-xs text-muted-foreground">
          Nothing is owed on this job&apos;s invoices. Payments are always applied to an invoice, so
          create the invoice first.
        </p>
      )}
      {view.payments.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
          No payments yet. When the customer pays, record it here and apply it to the invoice; the
          balance, the deposit check and the job&apos;s stage update on their own.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {view.payments.map((p) => {
            const live = p.status === "received" || p.status === "cleared";
            return (
              <li key={p.id} className="rounded-2xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {p.number} · {money(p.amountCents)}
                      <PaymentStatusBadge status={p.status} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.method ? PAYMENT_METHOD_LABELS[p.method] : "Payment"} · received{" "}
                      {day(p.receivedOn)}
                      {p.reference ? ` · ${p.reference}` : ""}
                      {p.clearedOn ? ` · cleared ${day(p.clearedOn)}` : ""}
                      {p.statusReason && !live ? ` · ${p.statusReason}` : ""}
                    </p>
                    <p className="mt-1 text-sm">
                      {p.applications.length
                        ? `Applied: ${p.applications.map((a) => `${a.number} ${money(a.amountCents)}`).join(", ")}`
                        : "Not applied to an invoice."}
                      {p.refundedCents > 0 ? ` · Refunded ${money(p.refundedCents)}` : ""}
                    </p>
                    {p.unappliedCents > 0 && (
                      <p className="mt-1 text-sm font-medium text-warning">
                        {money(p.unappliedCents)} unapplied — it doesn&apos;t count until it&apos;s
                        on an invoice.
                      </p>
                    )}
                  </div>
                </div>
                {can && live && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="h-11 sm:h-9"
                      onClick={() => setApplying(p)}
                    >
                      <Shuffle aria-hidden /> Apply<span className="sr-only"> {p.number}</span>
                    </Button>
                    {p.status === "received" && (
                      <Button
                        variant="outline"
                        className="h-11 sm:h-9"
                        disabled={pending}
                        onClick={() =>
                          run(() => updatePaymentStatus({ paymentId: p.id, action: "clear" }), {
                            success: "Marked cleared.",
                            onOk: () => router.refresh(),
                          })
                        }
                      >
                        <CheckCircle2 aria-hidden /> Mark cleared
                        <span className="sr-only"> {p.number}</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="h-11 sm:h-9"
                      onClick={() => setStatus({ p, action: "bounce" })}
                    >
                      <RotateCcw aria-hidden /> Bounced<span className="sr-only"> {p.number}</span>
                    </Button>
                    <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setRefunding(p)}>
                      <Undo2 aria-hidden /> Refund<span className="sr-only"> {p.number}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-11 sm:h-9"
                      onClick={() => setStatus({ p, action: "void" })}
                    >
                      <Ban aria-hidden /> Void<span className="sr-only"> {p.number}</span>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {view.refunds.length > 0 && (
        <div className="rounded-2xl border bg-card p-4">
          <h4 className="mb-2 text-sm font-semibold">Refunds</h4>
          <ul className="divide-y text-sm">
            {view.refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1">
                <span>
                  {day(r.refundedOn)} · {r.paymentNumber} · {r.reason}
                </span>
                <span className="tabular-nums">{money(r.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recording && <RecordDialog view={view} onClose={() => setRecording(false)} />}
      {applying && <ApplyDialog view={view} payment={applying} onClose={() => setApplying(null)} />}
      {status && (
        <StatusDialog
          view={view}
          payment={status.p}
          action={status.action}
          onClose={() => setStatus(null)}
        />
      )}
      {refunding && (
        <RefundDialog view={view} payment={refunding} onClose={() => setRefunding(null)} />
      )}
    </section>
  );
}

/** Per-invoice amounts for a payment: what's still owed on each, ignoring this payment. */
function AllocationTable({
  view,
  payment,
  values,
  onChange,
  errors,
}: {
  view: FinancialView;
  payment?: FinPayment;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  errors: Record<string, string>;
}) {
  const rows = payable(view.invoices).filter(
    (i) => i.balanceCents > 0 || payment?.applications.some((a) => a.invoiceId === i.id),
  );
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No invoice on this job is owed money.</p>;
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Apply to invoices</legend>
      {rows.map((inv) => {
        const mine = payment?.applications.find((a) => a.invoiceId === inv.id)?.amountCents ?? 0;
        const room = inv.balanceCents + mine;
        const id = `alloc-${inv.id}`;
        return (
          <div key={inv.id} className="grid grid-cols-[1fr_130px] items-center gap-2">
            <label htmlFor={id} className="text-sm">
              {inv.number}
              <span className="block text-xs text-muted-foreground">
                {room > 0 ? `${money(room)} open` : "Paid"}
                {inv.dueDate ? ` · due ${day(inv.dueDate)}` : ""}
              </span>
            </label>
            <Input
              inputMode="decimal"
              className="h-11 text-right tabular-nums sm:h-9"
              value={values[inv.id] ?? ""}
              onChange={(e) => onChange({ ...values, [inv.id]: e.target.value })}
              aria-label={`Amount on ${inv.number}`}
              {...fieldAria(id, errors[id])}
            />
          </div>
        );
      })}
    </fieldset>
  );
}

function RecordDialog({ view, onClose }: { view: FinancialView; onClose: () => void }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const open = payable(view.invoices).filter((i) => i.balanceCents > 0);
  const firstOpen = open[0];
  const [amount, setAmount] = React.useState(firstOpen ? dollarsText(firstOpen.balanceCents) : "");
  const [method, setMethod] = React.useState<PaymentMethod>("check");
  const [receivedOn, setReceivedOn] = React.useState(view.today);
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [override, setOverride] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [touched, setTouched] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});

  // Until someone edits the split, it follows the amount: oldest open invoice first.
  const split = React.useMemo(() => {
    if (touched) return values;
    let left = cents(amount);
    const out: Record<string, string> = {};
    for (const inv of open) {
      const take = Math.min(left, inv.balanceCents);
      out[inv.id] = take > 0 ? dollarsText(take) : "";
      left -= Math.max(0, take);
    }
    return out;
  }, [amount, touched, values, open]);
  const applied = Object.values(split).reduce((s, v) => s + cents(v), 0);
  const total = cents(amount);
  const openTotal = open.reduce((s, i) => s + i.balanceCents, 0);
  const leftover = total - applied;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            The whole payment goes onto invoices so the balance is right. Only money above
            what&apos;s owed can stay unapplied.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                recordPayment({
                  jobId: view.jobId,
                  method,
                  amount,
                  receivedOn,
                  reference,
                  notes,
                  allocations: Object.entries(split)
                    .filter(([, v]) => cents(v) > 0)
                    .map(([invoiceId, v]) => ({ invoiceId, amount: v })),
                  overrideReason: override,
                }),
              {
                success: "Payment recorded.",
                onOk: () => {
                  onClose();
                  router.refresh();
                },
                onError: (er) => setErrors(firstErrors(er)),
              },
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pay-amount" label="Amount ($)" error={errors.amount} required>
              <Input
                inputMode="decimal"
                className="h-11 tabular-nums sm:h-9"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                {...fieldAria("pay-amount", errors.amount)}
              />
            </Field>
            <Field id="pay-method" label="Method" required>
              <NativeSelect
                id="pay-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="pay-date" label="Received" error={errors.receivedOn} required>
              <Input
                id="pay-date"
                type="date"
                max={view.today}
                className="h-11 sm:h-9"
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
              />
            </Field>
            <Field id="pay-ref" label="Check # / reference">
              <Input
                id="pay-ref"
                className="h-11 sm:h-9"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          </div>
          <AllocationTable
            view={view}
            values={split}
            onChange={(v) => {
              setTouched(true);
              setValues(v);
            }}
            errors={errors}
          />
          <p
            className={`text-sm tabular-nums ${leftover !== 0 && !(leftover > 0 && applied >= openTotal) ? "text-danger" : "text-muted-foreground"}`}
            aria-live="polite"
          >
            Applied {money(applied)} of {money(total)}
            {leftover > 0
              ? applied >= openTotal
                ? ` · ${money(leftover)} more than is owed stays unapplied (shown as a warning)`
                : ` · apply ${money(leftover)} more`
              : leftover < 0
                ? ` · ${money(-leftover)} more than the payment`
                : ""}
          </p>
          <Field id="pay-notes" label="Notes">
            <Textarea
              id="pay-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <LockNotice
            idPrefix="pay"
            days={[receivedOn]}
            closedMonths={view.closedMonths}
            canOverride={view.can.overrideLock}
            value={override}
            onChange={setOverride}
            error={errors.overrideReason}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApplyDialog({
  view,
  payment,
  onClose,
}: {
  view: FinancialView;
  payment: FinPayment;
  onClose: () => void;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(payment.applications.map((a) => [a.invoiceId, dollarsText(a.amountCents)])),
  );
  const [override, setOverride] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const applied = Object.values(values).reduce((s, v) => s + cents(v), 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply {payment.number}</DialogTitle>
          <DialogDescription>
            {money(payment.availableCents)} to apply. Set the amount on each invoice; $0 takes it
            off.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                setPaymentApplications({
                  paymentId: payment.id,
                  allocations: Object.entries(values).map(([invoiceId, v]) => ({
                    invoiceId,
                    amount: v.trim() === "" ? "0" : v,
                  })),
                  overrideReason: override,
                }),
              {
                success: "Payment applied.",
                onOk: () => {
                  onClose();
                  router.refresh();
                },
                onError: (er) => setErrors(firstErrors(er)),
              },
            );
          }}
        >
          <AllocationTable
            view={view}
            payment={payment}
            values={values}
            onChange={setValues}
            errors={errors}
          />
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            Applied {money(applied)} of {money(payment.availableCents)}
            {payment.availableCents - applied > 0
              ? ` · ${money(payment.availableCents - applied)} stays unapplied`
              : ""}
          </p>
          <LockNotice
            idPrefix="apply"
            days={[payment.receivedOn]}
            closedMonths={view.closedMonths}
            canOverride={view.can.overrideLock}
            value={override}
            onChange={setOverride}
            error={errors.overrideReason}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({
  view,
  payment,
  action,
  onClose,
}: {
  view: FinancialView;
  payment: FinPayment;
  action: "bounce" | "void";
  onClose: () => void;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [reason, setReason] = React.useState("");
  const [override, setOverride] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === "bounce" ? `${payment.number} bounced` : `Void ${payment.number}`}
          </DialogTitle>
          <DialogDescription>
            {action === "bounce"
              ? "The payment stops counting and its amount goes back on the invoices' balance."
              : "For a payment entered by mistake. It stops counting and stays on record."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                updatePaymentStatus({
                  paymentId: payment.id,
                  action,
                  reason,
                  overrideReason: override,
                }),
              {
                success: action === "bounce" ? "Marked bounced." : "Payment voided.",
                onOk: () => {
                  onClose();
                  router.refresh();
                },
                onError: (er) => setErrors(firstErrors(er)),
              },
            );
          }}
        >
          <Field id="pay-status-reason" label="What happened" error={errors.reason} required>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              {...fieldAria("pay-status-reason", errors.reason)}
            />
          </Field>
          <LockNotice
            idPrefix="pay-status"
            days={[payment.receivedOn]}
            closedMonths={view.closedMonths}
            canOverride={view.can.overrideLock}
            value={override}
            onChange={setOverride}
            error={errors.overrideReason}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {action === "bounce" ? "Mark bounced" : "Void payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  view,
  payment,
  onClose,
}: {
  view: FinancialView;
  payment: FinPayment;
  onClose: () => void;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [amount, setAmount] = React.useState(
    dollarsText(payment.unappliedCents > 0 ? payment.unappliedCents : payment.availableCents),
  );
  const [refundedOn, setRefundedOn] = React.useState(view.today);
  const [method, setMethod] = React.useState<PaymentMethod>(payment.method ?? "check");
  const [reference, setReference] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [override, setOverride] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Refund {payment.number}</DialogTitle>
          <DialogDescription>
            Up to {money(payment.availableCents)}. It comes out of unapplied money first, then off
            the invoices it paid (newest first), so their balance goes back up.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                refundPayment({
                  paymentId: payment.id,
                  amount,
                  refundedOn,
                  method,
                  reference,
                  reason,
                  overrideReason: override,
                }),
              {
                success: "Refund recorded.",
                onOk: () => {
                  onClose();
                  router.refresh();
                },
                onError: (er) => setErrors(firstErrors(er)),
              },
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ref-amount" label="Amount ($)" error={errors.amount} required>
              <Input
                inputMode="decimal"
                className="h-11 tabular-nums sm:h-9"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                {...fieldAria("ref-amount", errors.amount)}
              />
            </Field>
            <Field id="ref-date" label="Refunded on" required>
              <Input
                id="ref-date"
                type="date"
                max={view.today}
                className="h-11 sm:h-9"
                value={refundedOn}
                onChange={(e) => setRefundedOn(e.target.value)}
              />
            </Field>
            <Field id="ref-method" label="How">
              <NativeSelect
                id="ref-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="ref-reference" label="Reference">
              <Input
                id="ref-reference"
                className="h-11 sm:h-9"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          </div>
          <Field id="ref-reason" label="Why" error={errors.reason} required>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              {...fieldAria("ref-reason", errors.reason)}
            />
          </Field>
          <LockNotice
            idPrefix="refund"
            days={[payment.receivedOn, refundedOn]}
            closedMonths={view.closedMonths}
            canOverride={view.can.overrideLock}
            value={override}
            onChange={setOverride}
            error={errors.overrideReason}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Record refund
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
