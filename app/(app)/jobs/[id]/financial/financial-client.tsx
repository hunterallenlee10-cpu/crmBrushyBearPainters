"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CircleDollarSign,
  FilePlus2,
  FileSignature,
  Info,
  Landmark,
  Receipt,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRunAction } from "@/components/forms/use-run-action";
import { INVOICE_TYPE_LABELS } from "@/lib/domain/ledger/types";
import { draftFinalInvoice } from "./actions";
import { CostingPanel } from "./costing-client";
import { CreditsPanel } from "./credits-client";
import { InvoicesPanel } from "./invoices-client";
import { PaymentsPanel } from "./payments-client";
import type { FinancialView } from "./types";
import { InvoiceStatusBadge, PaymentStatusBadge, day, money } from "./ui";

const TABS = ["worksheet", "invoices", "payments", "costing", "accounting"] as const;
type Tab = (typeof TABS)[number];

export function FinancialClient({
  view,
  initialTab,
}: {
  view: FinancialView;
  initialTab?: string;
}) {
  const tabs = TABS.filter((t) => t !== "costing" || view.can.jobCosting);
  const [tab, setTab] = React.useState<Tab>(
    (tabs as readonly string[]).includes(initialTab ?? "") ? (initialTab as Tab) : "worksheet",
  );
  const [focusId] = React.useState<string | undefined>(() =>
    typeof window === "undefined"
      ? undefined
      : (new URL(window.location.href).searchParams.get("invoice") ?? undefined),
  );
  const select = (next: string) => {
    setTab(next as Tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <div className="flex flex-col gap-4">
      <MoneySummary view={view} />
      {view.warnings.length > 0 && <NeedsAttention view={view} />}
      <Tabs value={tab} onValueChange={select} className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList aria-label="Financial">
            <TabsTrigger value="worksheet">Worksheet</TabsTrigger>
            <TabsTrigger value="invoices">
              Invoices
              <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">
                {view.invoices.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="payments">
              Payments
              <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">
                {view.payments.length}
              </span>
            </TabsTrigger>
            {view.can.jobCosting && <TabsTrigger value="costing">Job Costing</TabsTrigger>}
            <TabsTrigger value="accounting">Accounting</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="worksheet">
          <Worksheet view={view} onTab={select} />
        </TabsContent>
        <TabsContent value="invoices">
          <InvoicesPanel view={view} focusId={focusId} />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentsPanel view={view} />
        </TabsContent>
        {view.can.jobCosting && (
          <TabsContent value="costing">
            <CostingPanel view={view} />
          </TabsContent>
        )}
        <TabsContent value="accounting">
          <Accounting view={view} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Tile({
  label,
  value,
  caption,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  icon: LucideIcon;
  tone?: "warning" | "danger" | "success";
}) {
  const chip =
    tone === "danger"
      ? "bg-danger-bg text-danger"
      : tone === "warning"
        ? "bg-warning-bg text-warning"
        : tone === "success"
          ? "bg-success-bg text-success"
          : "bg-accent text-bb-forest";
  return (
    <div className="flex flex-col gap-1 rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={`grid size-7 place-items-center rounded-lg ${chip}`}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="text-xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

/** Money Summary (SPEC §8.5 #5): Contract, Billed, Left to Bill, Collected, Balance, Due. */
function MoneySummary({ view }: { view: FinancialView }) {
  const s = view.summary;
  return (
    <section
      aria-label="Money summary"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
    >
      <Tile
        label="Contract"
        value={money(s.contractCents)}
        caption={
          s.creditsCents
            ? `${money(s.contractBaseCents)} − ${money(s.creditsCents)} credits`
            : s.contractFromEstimate
              ? "Accepted estimate + signed change orders"
              : "Contract baseline (no accepted estimate)"
        }
        icon={FileSignature}
      />
      <Tile
        label="Billed"
        value={money(s.billedCents)}
        caption="Invoices, not void"
        icon={Receipt}
      />
      <Tile
        label="Left to Bill"
        value={money(s.leftToBillCents)}
        caption="Contract − billed"
        icon={FilePlus2}
        tone={s.leftToBillCents < 0 ? "warning" : undefined}
      />
      <Tile
        label="Collected"
        value={money(s.collectedCents)}
        caption="Applied payments that count"
        icon={CircleDollarSign}
        tone={s.collectedCents > 0 ? "success" : undefined}
      />
      <Tile
        label="Balance"
        value={money(s.balanceCents)}
        caption="Billed − collected"
        icon={Scale}
        tone={s.balanceCents < 0 ? "warning" : undefined}
      />
      <Tile
        label="Due"
        value={money(s.dueCents)}
        caption="Past due on sent invoices"
        icon={AlertTriangle}
        tone={s.dueCents > 0 ? "danger" : undefined}
      />
    </section>
  );
}

function NeedsAttention({ view }: { view: FinancialView }) {
  return (
    <section
      aria-labelledby="fin-attn-h"
      className="rounded-2xl border border-warning/30 bg-warning-bg/60 p-4"
    >
      <h3
        id="fin-attn-h"
        className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning"
      >
        <AlertTriangle className="size-4" aria-hidden /> Needs attention
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        {view.warnings.map((w, i) => (
          <li key={`${w.code}-${i}`} className="flex items-start gap-2">
            {w.severity === "warning" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            )}
            <span>{w.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Worksheet({ view, onTab }: { view: FinancialView; onTab: (t: string) => void }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const s = view.summary;
  const hasFinal = view.invoices.some((i) => i.type === "final" && i.status !== "void");
  const completed = ["completed", "invoiced"].includes(view.stage);
  const recent = view.payments.slice(-3).reverse();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="fin-contract-h" className="rounded-2xl border bg-card p-4">
        <h3 id="fin-contract-h" className="mb-2 text-base font-semibold">
          Contract &amp; changes
        </h3>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm tabular-nums">
          <dt>
            {s.contractFromEstimate
              ? "Accepted estimate + signed change orders"
              : "Contract baseline"}
          </dt>
          <dd>{money(s.contractBaseCents)}</dd>
          <dt>Approved credits</dt>
          <dd>{s.creditsCents ? `−${money(s.creditsCents)}` : money(0)}</dd>
          <dt className="font-semibold">Contract</dt>
          <dd className="font-semibold">{money(s.contractCents)}</dd>
          {s.pendingCreditsCents > 0 && (
            <>
              <dt className="text-muted-foreground">Credits waiting for approval</dt>
              <dd className="text-muted-foreground">{money(s.pendingCreditsCents)}</dd>
            </>
          )}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Change orders are priced and signed in Estimate &amp; Scope; signed ones add to the
          contract on their own.
        </p>
      </section>

      <section aria-labelledby="fin-billing-h" className="rounded-2xl border bg-card p-4">
        <h3 id="fin-billing-h" className="mb-2 text-base font-semibold">
          Billing
        </h3>
        {view.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {view.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  {i.number} · {INVOICE_TYPE_LABELS[i.type]}{" "}
                  <InvoiceStatusBadge status={i.displayStatus} type={i.type} />
                </span>
                <span className="tabular-nums">
                  {money(i.totalCents)}
                  {i.balanceCents > 0 ? ` · ${money(i.balanceCents)} open` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 sm:h-9" onClick={() => onTab("invoices")}>
            <Receipt aria-hidden /> Open invoices
          </Button>
          {view.can.editInvoices && completed && !hasFinal && (
            <Button
              className="h-11 sm:h-9"
              disabled={pending}
              onClick={() =>
                run(() => draftFinalInvoice({ jobId: view.jobId }), {
                  success: "Final invoice drafted.",
                  onOk: () => router.refresh(),
                })
              }
            >
              <FilePlus2 aria-hidden /> Draft the final invoice
            </Button>
          )}
        </div>
      </section>

      <section aria-labelledby="fin-pay-sum-h" className="rounded-2xl border bg-card p-4">
        <h3 id="fin-pay-sum-h" className="mb-2 text-base font-semibold">
          Payments
        </h3>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {recent.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  {p.number} · {day(p.receivedOn)} <PaymentStatusBadge status={p.status} />
                </span>
                <span className="tabular-nums">{money(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
        {s.unclearedCents > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {money(s.unclearedCents)} received but not marked cleared yet.
          </p>
        )}
        <Button variant="outline" className="mt-3 h-11 sm:h-9" onClick={() => onTab("payments")}>
          <CircleDollarSign aria-hidden />
          {view.can.recordPayments ? "Record or apply a payment" : "Open payments"}
        </Button>
      </section>

      <CreditsPanel view={view} />
    </div>
  );
}

const SYNC_LABEL: Record<string, string> = {
  not_connected: "Not connected",
  pending: "Waiting to sync",
  synced: "Synced",
  error: "Sync error",
};

/** Accounting (SPEC §10): QuickBooks is not connected; each record shows what would sync. */
function Accounting({ view }: { view: FinancialView }) {
  return (
    <section aria-labelledby="fin-acct-h" className="flex flex-col gap-3">
      <h3 id="fin-acct-h" className="flex items-center gap-2 text-base font-semibold">
        <Landmark className="size-4" aria-hidden /> Accounting
      </h3>
      <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
        QuickBooks isn&apos;t connected. Each sent invoice and recorded payment writes a
        &ldquo;would sync&rdquo; preview to the outbox (Admin → Integrations); nothing leaves the
        CRM.
      </p>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Record</th>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Accounting sync</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {view.invoices.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-2">Invoice {i.number}</td>
                <td className="px-4 py-2 tabular-nums">{money(i.totalCents)}</td>
                <td className="px-4 py-2">
                  {SYNC_LABEL[i.accountingSyncStatus] ?? i.accountingSyncStatus}
                </td>
              </tr>
            ))}
            {view.payments.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2">Payment {p.number}</td>
                <td className="px-4 py-2 tabular-nums">{money(p.amountCents)}</td>
                <td className="px-4 py-2">
                  {SYNC_LABEL[p.accountingSyncStatus] ?? p.accountingSyncStatus}
                </td>
              </tr>
            ))}
            {view.invoices.length + view.payments.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-3 text-muted-foreground">
                  Nothing to sync yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {view.outbox && view.outbox.length > 0 && (
        <div className="rounded-2xl border bg-card p-4">
          <h4 className="mb-2 text-sm font-semibold">Would sync (simulated)</h4>
          <ul className="divide-y text-sm">
            {view.outbox.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>
                  {o.operation === "accounting.sync_invoice" ? "Invoice" : "Payment"} · {o.subject}
                </span>
                <span className="text-xs text-muted-foreground">
                  Simulated – not sent · {day(o.createdAt.slice(0, 10))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
