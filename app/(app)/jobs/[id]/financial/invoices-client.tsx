"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, FileDown, PenLine, Plus, Send, Trash2 } from "lucide-react";
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
import { INVOICE_TYPE_LABELS, type InvoiceType } from "@/lib/domain/ledger/types";
import { addDays } from "@/lib/domain/scheduling/dates";
import { defaultInvoiceMessages } from "@/lib/money/messages";
import { createInvoice, sendInvoice, updateInvoiceDraft, voidInvoice } from "./actions";
import type { FinancialView, FinInvoice } from "./types";
import { InvoiceStatusBadge, LockNotice, day, dollarsText, money } from "./ui";

type LineDraft = { description: string; amount: string };

const NEW_TYPES: InvoiceType[] = ["progress", "change_order", "final", "deposit", "credit_memo"];

export function InvoicesPanel({ view, focusId }: { view: FinancialView; focusId?: string }) {
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<FinInvoice | null>(null);
  const [sending, setSending] = React.useState<FinInvoice | null>(null);
  const [voiding, setVoiding] = React.useState<FinInvoice | null>(null);
  const can = view.can;

  return (
    <section aria-labelledby="fin-inv-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="fin-inv-h" className="text-base font-semibold">
          Invoices
        </h3>
        {can.editInvoices && (
          <Button className="h-11 sm:h-9" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New invoice
          </Button>
        )}
      </div>
      {view.invoices.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
          No invoices yet. The deposit invoice is drafted when the customer accepts the estimate,
          and the final invoice when the job is Completed.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {view.invoices.map((inv) => (
            <li
              key={inv.id}
              id={`invoice-${inv.id}`}
              className={`rounded-2xl border bg-card p-4 ${focusId === inv.id ? "ring-2 ring-bb-forest" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {inv.number} · {INVOICE_TYPE_LABELS[inv.type]}
                    <InvoiceStatusBadge status={inv.displayStatus} type={inv.type} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {inv.issued
                      ? `Issued ${day(inv.issueDate)} · due ${day(inv.dueDate)}`
                      : `Drafted ${day(inv.createdAt?.slice(0, 10))} · not sent`}
                    {inv.daysPastDue > 0 ? ` · ${inv.daysPastDue} days past due` : ""}
                    {inv.status === "void" && inv.voidReason ? ` · Void: ${inv.voidReason}` : ""}
                  </p>
                </div>
                <dl className="grid grid-cols-3 gap-x-4 text-right text-sm tabular-nums">
                  <dt className="text-xs text-muted-foreground">Total</dt>
                  <dt className="text-xs text-muted-foreground">Paid</dt>
                  <dt className="text-xs text-muted-foreground">Balance</dt>
                  <dd className="font-semibold">{money(inv.totalCents)}</dd>
                  <dd>{money(inv.collectedCents)}</dd>
                  <dd className={inv.balanceCents > 0 ? "font-semibold" : ""}>
                    {money(inv.balanceCents)}
                  </dd>
                </dl>
              </div>
              <ul className="mt-2 divide-y text-sm">
                {inv.lines.map((l) => (
                  <li key={l.id} className="flex justify-between gap-3 py-1">
                    <span className="min-w-0">{l.description}</span>
                    <span className="tabular-nums">{money(l.amountCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`/jobs/${view.jobId}/invoices/${inv.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm hover:bg-accent sm:min-h-9"
                >
                  <FileDown className="size-4" aria-hidden /> PDF
                  <span className="sr-only"> of {inv.number}</span>
                </a>
                {can.editInvoices && inv.status !== "void" && !inv.sentAt && (
                  <Button variant="outline" className="h-11 sm:h-9" onClick={() => setEditing(inv)}>
                    <PenLine aria-hidden /> Edit<span className="sr-only"> {inv.number}</span>
                  </Button>
                )}
                {can.editInvoices && inv.status !== "void" && (
                  <Button className="h-11 sm:h-9" onClick={() => setSending(inv)}>
                    <Send aria-hidden /> {inv.sentAt ? "Send again" : "Send"}
                    <span className="sr-only"> {inv.number}</span>
                  </Button>
                )}
                {can.editInvoices && inv.status !== "void" && inv.collectedCents === 0 && (
                  <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setVoiding(inv)}>
                    <Ban aria-hidden /> Void<span className="sr-only"> {inv.number}</span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <InvoiceDialog view={view} onClose={() => setCreating(false)} />}
      {editing && <InvoiceDialog view={view} invoice={editing} onClose={() => setEditing(null)} />}
      {sending && <SendDialog view={view} invoice={sending} onClose={() => setSending(null)} />}
      {voiding && <VoidDialog view={view} invoice={voiding} onClose={() => setVoiding(null)} />}
    </section>
  );
}

function suggestedLines(view: FinancialView, type: InvoiceType): LineDraft[] {
  const left = Math.max(0, view.summary.leftToBillCents);
  if (type === "final" || type === "progress") {
    return [
      {
        description: type === "final" ? "Balance of contract" : "Progress payment",
        amount: dollarsText(left),
      },
    ];
  }
  if (type === "credit_memo") return [{ description: "Credit", amount: "-0.00" }];
  return [{ description: INVOICE_TYPE_LABELS[type], amount: "" }];
}

function InvoiceDialog({
  view,
  invoice,
  onClose,
}: {
  view: FinancialView;
  invoice?: FinInvoice;
  onClose: () => void;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [type, setType] = React.useState<InvoiceType>(invoice?.type ?? "progress");
  const [lines, setLines] = React.useState<LineDraft[]>(
    invoice
      ? invoice.lines
          .filter((l) => l.sourceType !== "credit")
          .map((l) => ({ description: l.description, amount: dollarsText(l.amountCents) }))
      : suggestedLines(view, "progress"),
  );
  const credits = invoice?.lines.filter((l) => l.sourceType === "credit") ?? [];
  const [dueDate, setDueDate] = React.useState(invoice?.dueDate ?? "");
  const [notes, setNotes] = React.useState(invoice?.notes ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const total =
    lines.reduce((s, l) => {
      const n = Number(l.amount.replace(/[$,\s]/g, "").replace("−", "-"));
      return s + (Number.isFinite(n) ? Math.round(n * 100) : 0);
    }, 0) + credits.reduce((s, c) => s + c.amountCents, 0);

  const submit = () => {
    const payload = {
      lines,
      dueDate,
      notes,
      terms: invoice?.terms ?? "",
    };
    run(
      () =>
        invoice
          ? updateInvoiceDraft({ ...payload, invoiceId: invoice.id })
          : createInvoice({ ...payload, jobId: view.jobId, type }),
      {
        success: invoice ? "Invoice saved." : "Invoice drafted.",
        onOk: () => {
          onClose();
          router.refresh();
        },
        onError: (e) => setErrors(firstErrors(e)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{invoice ? `Edit ${invoice.number}` : "New invoice"}</DialogTitle>
          <DialogDescription>
            {money(Math.max(0, view.summary.leftToBillCents))} is left to bill on this job. Prices
            include tax (set in Estimate Setup).
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {!invoice && (
            <Field id="inv-type" label="Type" required>
              <NativeSelect
                id="inv-type"
                value={type}
                onChange={(e) => {
                  const t = e.target.value as InvoiceType;
                  setType(t);
                  setLines(suggestedLines(view, t));
                }}
              >
                {NEW_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {INVOICE_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Lines</legend>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_auto] items-end gap-2">
                <Field id={`inv-line-${i}`} label={`Line ${i + 1} description`}>
                  <Input
                    className="h-11 sm:h-9"
                    value={l.description}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                      )
                    }
                    {...fieldAria(`inv-line-${i}`, errors[`lines.${i}.description`])}
                  />
                </Field>
                <Field id={`inv-amt-${i}`} label="Amount ($)">
                  <Input
                    className="h-11 text-right tabular-nums sm:h-9"
                    inputMode="decimal"
                    value={l.amount}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                      )
                    }
                    {...fieldAria(`inv-amt-${i}`, errors[`lines.${i}.amount`])}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 sm:h-9"
                  disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  aria-label={`Remove line ${i + 1}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            {credits.map((c) => (
              <p key={c.id} className="flex justify-between text-sm text-muted-foreground">
                <span>{c.description} (approved credit)</span>
                <span className="tabular-nums">{money(c.amountCents)}</span>
              </p>
            ))}
            <Button
              type="button"
              variant="outline"
              className="h-11 self-start sm:h-9"
              onClick={() => setLines([...lines, { description: "", amount: "" }])}
            >
              <Plus aria-hidden /> Add line
            </Button>
          </fieldset>
          <p className="text-right text-sm font-semibold tabular-nums">Total {money(total)}</p>
          <Field id="inv-due" label="Due date (optional; set when you send)" error={errors.dueDate}>
            <Input
              id="inv-due"
              type="date"
              className="h-11 sm:h-9"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <Field id="inv-notes" label="Notes (internal)">
            <Textarea
              id="inv-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {invoice ? "Save" : "Draft invoice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SendDialog({
  view,
  invoice,
  onClose,
}: {
  view: FinancialView;
  invoice: FinInvoice;
  onClose: () => void;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [issueDate, setIssueDate] = React.useState(invoice.issueDate ?? view.today);
  const [dueDate, setDueDate] = React.useState(invoice.dueDate ?? addDays(view.today, 0));
  const defaults = defaultInvoiceMessages({
    customerFirstName: view.messaging.customerFirstName,
    senderName: view.messaging.senderName,
    companyName: view.messaging.companyName,
    invoiceNumber: invoice.number,
    invoiceType: invoice.type,
    totalCents: invoice.totalCents,
    dueDate,
  });
  const [sms, setSms] = React.useState(!view.messaging.smsBlock);
  const [email, setEmail] = React.useState(!view.messaging.emailBlock);
  const [smsBody, setSmsBody] = React.useState<string | null>(null);
  const [emailSubject, setEmailSubject] = React.useState<string | null>(null);
  const [emailBody, setEmailBody] = React.useState<string | null>(null);
  const [override, setOverride] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Send {invoice.number}</DialogTitle>
          <DialogDescription>
            {money(invoice.totalCents)}. The PDF is saved to Documents and goes with the email.
            Messages are simulated (recorded in the outbox, not sent). Wording is a draft for the
            owners to approve.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                sendInvoice({
                  invoiceId: invoice.id,
                  issueDate,
                  dueDate,
                  channels: [
                    ...(sms ? ["sms" as const] : []),
                    ...(email ? ["email" as const] : []),
                  ],
                  smsBody: smsBody ?? defaults.sms,
                  emailSubject: emailSubject ?? defaults.emailSubject,
                  emailBody: emailBody ?? defaults.emailBody,
                  overrideReason: override,
                }),
              {
                success: "Invoice sent (simulated).",
                onOk: () => {
                  onClose();
                  router.refresh();
                },
                onError: (e) => setErrors(firstErrors(e)),
              },
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="send-issue" label="Issue date" error={errors.issueDate} required>
              <Input
                id="send-issue"
                type="date"
                className="h-11 sm:h-9"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </Field>
            <Field id="send-due" label="Due date" error={errors.dueDate} required>
              <Input
                id="send-due"
                type="date"
                className="h-11 sm:h-9"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Send to the customer</legend>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={sms}
                disabled={!!view.messaging.smsBlock}
                onCheckedChange={(v) => setSms(v === true)}
              />
              Text
              {view.messaging.smsBlock && (
                <span className="text-xs text-muted-foreground">({view.messaging.smsBlock})</span>
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={email}
                disabled={!!view.messaging.emailBlock}
                onCheckedChange={(v) => setEmail(v === true)}
              />
              Email with the PDF
              {view.messaging.emailBlock && (
                <span className="text-xs text-muted-foreground">({view.messaging.emailBlock})</span>
              )}
            </label>
            {!sms && !email && (
              <p className="text-xs text-muted-foreground">
                Nothing is sent to the customer; the invoice is just marked sent (e.g. you handed it
                over in person).
              </p>
            )}
          </fieldset>
          {sms && (
            <Field id="send-sms" label="Text message">
              <Textarea
                id="send-sms"
                rows={3}
                value={smsBody ?? defaults.sms}
                onChange={(e) => setSmsBody(e.target.value)}
              />
            </Field>
          )}
          {email && (
            <>
              <Field id="send-subject" label="Email subject">
                <Input
                  id="send-subject"
                  className="h-11 sm:h-9"
                  value={emailSubject ?? defaults.emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
              </Field>
              <Field id="send-email" label="Email">
                <Textarea
                  id="send-email"
                  rows={7}
                  value={emailBody ?? defaults.emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                />
              </Field>
            </>
          )}
          <LockNotice
            idPrefix="send"
            days={[issueDate, invoice.issueDate]}
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
              <Send aria-hidden /> Send invoice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({
  view,
  invoice,
  onClose,
}: {
  view: FinancialView;
  invoice: FinInvoice;
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
          <DialogTitle>Void {invoice.number}?</DialogTitle>
          <DialogDescription>
            A void invoice no longer counts as billed. It stays on record. Credits on it go back to
            waiting for an invoice.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => voidInvoice({ invoiceId: invoice.id, reason, overrideReason: override }), {
              success: "Invoice voided.",
              onOk: () => {
                onClose();
                router.refresh();
              },
              onError: (er) => setErrors(firstErrors(er)),
            });
          }}
        >
          <Field id="void-reason" label="Why" error={errors.reason} required>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              {...fieldAria("void-reason", errors.reason)}
            />
          </Field>
          <LockNotice
            idPrefix="void"
            days={[invoice.issueDate]}
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
              Void invoice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
