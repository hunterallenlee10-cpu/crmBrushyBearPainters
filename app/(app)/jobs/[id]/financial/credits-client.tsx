"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BadgePercent, Check, FileStack, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CREDIT_TYPE_LABELS, type CreditType } from "@/lib/domain/ledger/types";
import { createCredit, decideCredit, placeCredits } from "./actions";
import type { FinCredit, FinancialView } from "./types";
import { CreditStatusBadge, day, money } from "./ui";

const PEOPLE_TYPES: Exclude<CreditType, "on_time_guarantee">[] = [
  "goodwill",
  "discount",
  "referral",
];

/** Credits (SPEC §10): On-Time Guarantee (from the schedule), goodwill, discount, referral. */
export function CreditsPanel({ view }: { view: FinancialView }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [adding, setAdding] = React.useState(false);
  const [deciding, setDeciding] = React.useState<{ c: FinCredit; d: "reject" | "void" } | null>(
    null,
  );
  const can = view.can;
  const waiting = view.credits.filter((c) => c.status === "approved");
  const completed = ["completed", "invoiced", "paid_in_full", "closed_won"].includes(view.stage);

  return (
    <section
      aria-labelledby="fin-credits-h"
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="fin-credits-h" className="text-base font-semibold">
          Credits
        </h3>
        <div className="flex flex-wrap gap-2">
          {can.editInvoices && waiting.length > 0 && completed && (
            <Button
              variant="outline"
              className="h-11 sm:h-9"
              disabled={pending}
              onClick={() =>
                run(() => placeCredits({ jobId: view.jobId }), {
                  success: "Credits put on the invoice.",
                  onOk: () => router.refresh(),
                })
              }
            >
              <FileStack aria-hidden /> Put credits on the invoice
            </Button>
          )}
          {(can.editInvoices || can.approveCredits) && (
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setAdding(true)}>
              <BadgePercent aria-hidden /> Add credit
            </Button>
          )}
        </div>
      </div>
      {view.credits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No credits. An On-Time Guarantee credit is drafted on its own if the start slips for a
          reason other than weather; an owner approves it on Schedule and it goes on the final
          invoice.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {view.credits.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium">
                  {CREDIT_TYPE_LABELS[c.type]} · {money(c.amountCents)}
                </span>{" "}
                <CreditStatusBadge status={c.status} />
                <span className="block text-xs text-muted-foreground">
                  {c.reason} · {day(c.requestedAt.slice(0, 10))}
                  {c.invoiceNumber ? ` · on ${c.invoiceNumber}` : ""}
                  {c.status === "approved" ? " · waiting for the final invoice" : ""}
                  {c.decisionNote ? ` · ${c.decisionNote}` : ""}
                </span>
              </span>
              {can.approveCredits && c.status === "pending_approval" && (
                <span className="flex gap-2">
                  <Button
                    className="h-11 sm:h-9"
                    disabled={pending}
                    onClick={() =>
                      run(() => decideCredit({ creditId: c.id, decision: "approve" }), {
                        success: "Credit approved.",
                        onOk: () => router.refresh(),
                      })
                    }
                  >
                    <Check aria-hidden /> Approve
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 sm:h-9"
                    onClick={() => setDeciding({ c, d: "reject" })}
                  >
                    <X aria-hidden /> Reject
                  </Button>
                </span>
              )}
              {can.approveCredits && c.status === "approved" && !c.fromSchedule && (
                <Button
                  variant="ghost"
                  className="h-11 sm:h-9"
                  onClick={() => setDeciding({ c, d: "void" })}
                >
                  Void
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddCreditDialog view={view} onClose={() => setAdding(false)} />}
      {deciding && (
        <DecideDialog credit={deciding.c} decision={deciding.d} onClose={() => setDeciding(null)} />
      )}
    </section>
  );
}

function AddCreditDialog({ view, onClose }: { view: FinancialView; onClose: () => void }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [type, setType] = React.useState<(typeof PEOPLE_TYPES)[number]>("goodwill");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [approve, setApprove] = React.useState(view.can.approveCredits);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a credit</DialogTitle>
          <DialogDescription>
            An approved credit takes money off the contract and goes on the final invoice (or a
            credit memo once the final invoice is sent).
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createCredit({ jobId: view.jobId, type, amount, reason, approve }), {
              success: approve ? "Credit approved." : "Credit sent for approval.",
              onOk: () => {
                onClose();
                router.refresh();
              },
              onError: (er) => setErrors(firstErrors(er)),
            });
          }}
        >
          <Field id="cr-type" label="Type" required>
            <NativeSelect
              id="cr-type"
              value={type}
              onChange={(e) => setType(e.target.value as (typeof PEOPLE_TYPES)[number])}
            >
              {PEOPLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CREDIT_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="cr-amount" label="Amount ($)" error={errors.amount} required>
            <Input
              inputMode="decimal"
              className="h-11 sm:h-9"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              {...fieldAria("cr-amount", errors.amount)}
            />
          </Field>
          <Field id="cr-reason" label="Why" error={errors.reason} required>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              {...fieldAria("cr-reason", errors.reason)}
            />
          </Field>
          {view.can.approveCredits ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={approve} onCheckedChange={(v) => setApprove(v === true)} />
              Approve it now
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">An owner approves it before it counts.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Add credit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({
  credit,
  decision,
  onClose,
}: {
  credit: FinCredit;
  decision: "reject" | "void";
  onClose: () => void;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {decision === "reject" ? "Reject" : "Void"} the {CREDIT_TYPE_LABELS[credit.type]} credit
          </DialogTitle>
          <DialogDescription>
            {money(credit.amountCents)} · {credit.reason}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => decideCredit({ creditId: credit.id, decision, note }), {
              success: decision === "reject" ? "Credit rejected." : "Credit voided.",
              onOk: () => {
                onClose();
                router.refresh();
              },
              onError: (er) => setErrors(firstErrors(er)),
            });
          }}
        >
          <Field id="cr-note" label="Why" error={errors.note} required>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              {...fieldAria("cr-note", errors.note)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {decision === "reject" ? "Reject" : "Void"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
