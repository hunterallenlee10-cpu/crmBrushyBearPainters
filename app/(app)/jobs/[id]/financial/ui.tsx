"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import {
  CREDIT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type CreditStatus,
  type InvoiceStatus,
  type PaymentStatus,
} from "@/lib/domain/ledger/types";
import { isLocked, monthLabel, monthOf } from "@/lib/domain/ledger/periods";
import { formatDay } from "@/lib/domain/scheduling/dates";
import { formatCents } from "@/lib/format/money";

type Tone = "success" | "info" | "warning" | "danger" | "neutral";

const INVOICE_TONE: Record<InvoiceStatus, Tone> = {
  draft: "neutral",
  sent: "info",
  viewed: "info",
  partially_paid: "warning",
  paid: "success",
  void: "neutral",
  overdue: "danger",
};

export function InvoiceStatusBadge({ status, type }: { status: InvoiceStatus; type?: string }) {
  if (type === "credit_memo" && status !== "void" && status !== "draft") {
    return <Badge variant="success">Credit issued</Badge>;
  }
  return <Badge variant={INVOICE_TONE[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>;
}

const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  received: "info",
  cleared: "success",
  bounced: "danger",
  refunded: "neutral",
  void: "neutral",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant={PAYMENT_TONE[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}

const CREDIT_TONE: Record<CreditStatus, Tone> = {
  pending_approval: "warning",
  approved: "info",
  applied: "success",
  rejected: "neutral",
  voided: "neutral",
};

export function CreditStatusBadge({ status }: { status: CreditStatus }) {
  return <Badge variant={CREDIT_TONE[status]}>{CREDIT_STATUS_LABELS[status]}</Badge>;
}

export const money = formatCents;

export function day(d: string | null | undefined): string {
  return d ? formatDay(d) : "—";
}

/**
 * Closed-month notice: an owner override with a reason (owners), or a plain
 * "ask an owner" (everyone else). Renders nothing when the dates are open.
 */
export function LockNotice({
  days,
  closedMonths,
  canOverride,
  value,
  onChange,
  error,
  idPrefix,
}: {
  days: readonly (string | null | undefined)[];
  closedMonths: readonly string[];
  canOverride: boolean;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  idPrefix: string;
}) {
  const closed = new Set(closedMonths);
  const locked = days.find((d) => isLocked(d, closed));
  if (!locked) return null;
  const label = monthLabel(monthOf(locked));
  if (!canOverride) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg p-3 text-sm text-warning"
      >
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        {label} is closed. Ask an owner to make this change with an override.
      </p>
    );
  }
  const id = `${idPrefix}-override`;
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-bg p-3">
      <p className="mb-2 flex items-start gap-2 text-sm text-warning">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        {label} is closed. As an owner you can still make this change; say why (it&apos;s
        audit-logged).
      </p>
      <Field id={id} label="Override reason" error={error} required>
        <Textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...fieldAria(id, error)}
        />
      </Field>
    </div>
  );
}

/** "250.00" from cents, for prefilled amount inputs. */
export function dollarsText(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function useErrors() {
  return React.useState<Record<string, string>>({});
}
