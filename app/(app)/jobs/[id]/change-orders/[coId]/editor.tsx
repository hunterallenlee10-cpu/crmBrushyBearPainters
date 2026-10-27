"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, FileDown, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { TOUCH } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import {
  CHANGE_ORDER_STATUS_LABELS,
  UNIT_LABELS,
  type ChangeOrderStatus,
} from "@/lib/estimating/engine";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import { sendChangeOrder, updateChangeOrder } from "../../estimate/change-order-actions";
import { CatalogPicker } from "../../estimate/catalog-picker";
import { LineEditor } from "../../estimate/line-editor";
import { SendDialog } from "../../estimate/send-dialog";
import type { ChangeOrderData } from "./data";

/**
 * Change order editor (SPEC §7.7): same lines as the estimate builder, plus
 * credits for work removed. The customer signs it on the proposal page; a
 * signed change order updates the contract.
 */
export function ChangeOrderEditor({ data }: { data: ChangeOrderData }) {
  const { job, co, can } = data;
  const readOnly = !can.edit;
  const draft = co.status === "draft";
  const [editing, setEditing] = React.useState<string | null>(null);
  const [justSent, setJustSent] = React.useState(false);
  const editingLine = data.lines.find((l) => l.id === editing) ?? null;
  const [form, setForm] = React.useState({
    title: co.title,
    reason: co.reason ?? "",
    bill: co.billSeparately,
  });
  React.useEffect(
    () => setForm({ title: co.title, reason: co.reason ?? "", bill: co.billSeparately }),
    [co.title, co.reason, co.billSeparately],
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  const errorIssues = [
    ...data.issues.filter((i) => i.severity === "error"),
    ...data.lines.flatMap((l) => l.issues.filter((i) => i.severity === "error")),
  ];
  const after =
    data.contractCents === null ? null : data.contractCents + (draft ? data.totals.totalCents : 0);
  const sendBlocked =
    data.lines.length === 0
      ? "Add at least one line first."
      : !data.sendable
        ? "Fix the problems marked in red first."
        : !data.contact
          ? "Add a primary contact to the job first."
          : null;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/jobs/${job.id}?section=estimate`}
        className="inline-flex w-fit items-center gap-1 text-sm text-bb-forest hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {job.number} · {job.name}
      </Link>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-bb-ink">
          {co.number} · {co.title}
          <Badge
            variant={
              co.status === "signed"
                ? "success"
                : co.status === "declined"
                  ? "danger"
                  : draft
                    ? "neutral"
                    : "info"
            }
          >
            {CHANGE_ORDER_STATUS_LABELS[co.status as ChangeOrderStatus] ?? co.status}
          </Badge>
          {co.fromField && <Badge variant="outline">From the field</Badge>}
        </h1>
        <div className="flex flex-wrap gap-2">
          {!draft && (
            <Button asChild variant="outline" className={TOUCH}>
              <a
                href={`/jobs/${job.id}/change-orders/${co.id}/pdf`}
                target="_blank"
                rel="noreferrer"
              >
                <FileDown aria-hidden />
                PDF
              </a>
            </Button>
          )}
          {(can.send || justSent) && (
            <SendDialog
              id={co.id}
              title={`Send ${co.number} for signature`}
              contact={data.contact}
              messages={data.messages}
              disabledReason={can.send ? sendBlocked : "Already sent."}
              onSent={() => setJustSent(true)}
              send={sendChangeOrder}
            />
          )}
        </div>
      </div>

      {!draft && (
        <p className="flex items-center gap-2 rounded-xl border border-info/30 bg-info-bg px-4 py-3 text-sm text-info">
          <Lock className="size-4 shrink-0" aria-hidden />
          {co.status === "signed"
            ? `Signed ${formatDateTime(co.signedAt)}. The contract includes it.`
            : co.status === "declined"
              ? `Declined${co.declineReason ? `: ${co.declineReason}` : "."}`
              : `Sent ${formatDateTime(co.sentAt)}${co.viewedAt ? `, viewed ${formatDateTime(co.viewedAt)}` : ""}. Link expires ${formatDate(co.expiresAt)}.`}
        </p>
      )}
      {co.fieldNotes && (
        <section className="rounded-2xl border border-bb-honey bg-bb-honey/10 p-4 text-sm">
          <h2 className="font-semibold">What the crew found</h2>
          <p className="mt-1 whitespace-pre-line">{co.fieldNotes}</p>
        </section>
      )}
      {draft && errorIssues.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" aria-hidden />
            Fix before sending
          </p>
          <ul className="mt-1 list-disc pl-6">
            {[...new Set(errorIssues.map((e) => e.message))].map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <form
            className="grid gap-3 rounded-2xl border bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              run(
                () =>
                  updateChangeOrder({
                    id: co.id,
                    title: form.title,
                    reason: form.reason,
                    bill_separately: form.bill,
                  }),
                { success: "Saved.", onError: (er) => setErrors(firstErrors(er)) },
              );
            }}
          >
            <Field id="co-title" label="Title" error={errors.title}>
              <Input
                {...fieldAria("co-title", errors.title)}
                className={TOUCH}
                value={form.title}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field id="co-reason" label="Why (the customer sees this)" error={errors.reason}>
              <Textarea
                {...fieldAria("co-reason", errors.reason)}
                rows={3}
                value={form.reason}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={form.bill}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, bill: e.target.checked })}
              />
              Bill separately (draft a change-order invoice when signed)
            </label>
            {!readOnly && (
              <Button type="submit" className={cn(TOUCH, "w-fit")} disabled={pending}>
                Save
              </Button>
            )}
          </form>

          <section aria-labelledby="co-lines" className="rounded-2xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <h2 id="co-lines" className="text-base font-semibold">
                Lines
              </h2>
              {!readOnly && (
                <CatalogPicker
                  catalog={data.catalog}
                  target={{ kind: "change_order", changeOrderId: co.id }}
                  title={`Add to ${co.number}`}
                  onAdded={setEditing}
                />
              )}
            </div>
            {data.lines.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                No lines yet
                {readOnly ? "." : " — add the extra work, or a credit for work removed."}
              </p>
            ) : (
              <ul className="divide-y">
                {data.lines.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(l.id)}
                      className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-bb-cream-light"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {l.issues.some((i) => i.severity === "error") && (
                            <AlertTriangle
                              className="size-4 text-danger"
                              aria-label="Needs fixing"
                            />
                          )}
                          <span className="truncate">{l.name}</span>
                          {(l.priceCents ?? 0) < 0 && <Badge variant="info">Credit</Badge>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {l.description}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm">
                        <span className="block tabular-nums">
                          {l.quantity.toLocaleString("en-US")} {UNIT_LABELS[l.unit]}
                        </span>
                        <span className="block font-semibold tabular-nums">
                          {formatCents(l.priceCents)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <section aria-labelledby="co-totals" className="rounded-2xl border bg-card p-4 text-sm">
            <h2
              id="co-totals"
              className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
            >
              Change order total
            </h2>
            <dl className="mt-2 flex flex-col gap-1">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{formatCents(data.totals.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Tax</dt>
                <dd className="tabular-nums">{formatCents(data.totals.taxCents)}</dd>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatCents(data.totals.totalCents)}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Our cost</dt>
                <dd className="tabular-nums">{formatCents(data.totals.costCents)}</dd>
              </div>
            </dl>
            {data.contractCents !== null && (
              <dl className="mt-3 flex flex-col gap-1 border-t pt-3">
                <div className="flex justify-between">
                  <dt>Contract {draft ? "now" : "(includes this if signed)"}</dt>
                  <dd className="tabular-nums">{formatCents(data.contractCents)}</dd>
                </div>
                {draft && after !== null && (
                  <div className="flex justify-between font-semibold">
                    <dt>Contract once signed</dt>
                    <dd className="tabular-nums">{formatCents(after)}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>
        </aside>
      </div>

      {editingLine && (
        <LineEditor
          key={editingLine.id}
          line={editingLine}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          products={data.products}
          sheens={data.sheens}
          settings={data.settings}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
