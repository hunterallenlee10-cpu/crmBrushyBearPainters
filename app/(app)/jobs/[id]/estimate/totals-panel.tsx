"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import type { OptionSummary } from "@/lib/estimating/engine";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: React.ReactNode;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 py-1 text-sm",
        strong && "text-base font-semibold",
        muted && "text-muted-foreground",
      )}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Totals for one option, the customer's view (SPEC §7.4): lines, add-ons,
 * lead-safe, minimum, discount, tax, total and deposit. Margin and labor are
 * internal and shown separately.
 */
export function TotalsPanel({
  summary,
  withAllAddOns,
  hasAddOns,
  taxConfirmed,
}: {
  summary: OptionSummary;
  withAllAddOns: OptionSummary | null;
  hasAddOns: boolean;
  taxConfirmed: boolean;
}) {
  return (
    <section aria-labelledby="totals-h" className="rounded-2xl border bg-card p-4">
      <h2
        id="totals-h"
        className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
      >
        Customer total
      </h2>
      <dl className="mt-2 border-b pb-1">
        <Row label="Scope" value={formatCents(summary.linesCents)} />
        {summary.rrpCents > 0 && (
          <Row label="Lead-safe (RRP)" value={formatCents(summary.rrpCents)} />
        )}
        {summary.minimumAdjustmentCents > 0 && (
          <Row label="Job minimum" value={formatCents(summary.minimumAdjustmentCents)} />
        )}
        {summary.discountCents > 0 && (
          <Row label="Discount" value={formatCents(-summary.discountCents)} />
        )}
        <Row
          label={
            <>
              Tax{" "}
              {!taxConfirmed && (
                <Badge variant="sample" className="ml-1">
                  Not confirmed
                </Badge>
              )}
            </>
          }
          value={formatCents(summary.taxCents)}
        />
      </dl>
      <dl className="pt-1">
        <Row label="Total" value={formatCents(summary.totalCents)} strong />
        <Row label="Deposit due at signing" value={formatCents(summary.depositCents)} muted />
        {hasAddOns && withAllAddOns && (
          <Row label="With every add-on" value={formatCents(withAllAddOns.totalCents)} muted />
        )}
      </dl>
    </section>
  );
}

/** Internal numbers: cost, gross margin against the floor, labor, crew days, paint. */
export function MarginPanel({
  summary,
  floorPercent,
  effectiveDiscountPercent,
  isSample,
}: {
  summary: OptionSummary;
  floorPercent: number;
  effectiveDiscountPercent: number;
  isSample: boolean;
}) {
  const margin = summary.grossMarginRatio === null ? null : summary.grossMarginRatio * 100;
  return (
    <section aria-labelledby="margin-h" className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="margin-h"
          className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Margin (internal)
        </h2>
        {isSample && <Badge variant="sample">Sample rates</Badge>}
      </div>
      <dl className="mt-2">
        <Row label="Our cost" value={formatCents(summary.costCents)} />
        <Row label="Gross profit" value={formatCents(summary.grossProfitCents)} />
        <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
          <dt>Gross margin</dt>
          <dd
            className={cn(
              "font-semibold tabular-nums",
              summary.belowMarginFloor ? "text-danger" : "text-success",
            )}
          >
            {margin === null ? "—" : `${margin.toFixed(1)}%`}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              floor {floorPercent}%
            </span>
          </dd>
        </div>
        {effectiveDiscountPercent > 0 && (
          <Row label="Below computed price" value={`${effectiveDiscountPercent}%`} />
        )}
        <Row label="Labor" value={`${summary.laborHours} h`} />
        <Row label="Crew days" value={String(summary.crewDays)} />
      </dl>
      {summary.belowMarginFloor && (
        <p role="alert" className="mt-2 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
          Below the margin floor. Check the prices before sending.
        </p>
      )}
      {summary.gallonsByProduct.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold text-muted-foreground uppercase">Paint</h3>
          <ul className="mt-1 text-sm">
            {summary.gallonsByProduct.map((g) => (
              <li key={g.productId ?? g.label} className="flex justify-between gap-2 py-0.5">
                <span className="min-w-0 truncate">{g.label}</span>
                <span className="tabular-nums">{g.gallons} gal</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
