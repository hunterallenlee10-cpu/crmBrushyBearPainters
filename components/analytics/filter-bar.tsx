"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/domain/analytics/periods";

/**
 * Date-range preset (+ custom days) and the analytics filters (work type,
 * city, owner, source). Everything lives in the URL so links, reloads and
 * "View data" agree with what's on screen.
 */

export type FilterOption = { value: string; label: string };

const selectClass =
  "h-9 min-w-0 rounded-md border border-input bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

export function AnalyticsFilterBar({
  presets,
  preset,
  custom,
  labels = {},
  workTypes,
  cities,
  owners,
  sources,
  idPrefix = "af",
}: {
  presets: readonly PeriodPreset[];
  preset: PeriodPreset;
  custom?: { from: string; to: string };
  labels?: Partial<Record<PeriodPreset, string>>;
  workTypes?: readonly FilterOption[];
  cities?: readonly FilterOption[];
  owners?: readonly FilterOption[];
  sources?: readonly FilterOption[];
  idPrefix?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [from, setFrom] = React.useState(custom?.from ?? "");
  const [to, setTo] = React.useState(custom?.to ?? "");
  const [showCustom, setShowCustom] = React.useState(preset === "custom");

  function push(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const filterSelect = (
    key: string,
    label: string,
    allLabel: string,
    options: readonly FilterOption[] | undefined,
  ) =>
    options && (
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${idPrefix}-${key}`} className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        <select
          id={`${idPrefix}-${key}`}
          className={selectClass}
          value={params.get(key) ?? "all"}
          onChange={(e) => push({ [key]: e.target.value })}
        >
          <option value="all">{allLabel}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );

  return (
    <div
      role="search"
      aria-label="Filters"
      className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-3"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${idPrefix}-period`} className="text-xs font-medium text-muted-foreground">
          Date range
        </label>
        <select
          id={`${idPrefix}-period`}
          className={selectClass}
          value={showCustom ? "custom" : preset}
          onChange={(e) => {
            const v = e.target.value as PeriodPreset;
            if (v === "custom") {
              setShowCustom(true);
              return;
            }
            setShowCustom(false);
            push({ period: v, from: null, to: null });
          }}
        >
          {presets.map((p) => (
            <option key={p} value={p}>
              {labels[p] ?? PERIOD_PRESETS.find((x) => x.id === p)?.label ?? p}
            </option>
          ))}
        </select>
      </div>
      {showCustom && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to) push({ period: "custom", from, to });
          }}
        >
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${idPrefix}-from`}
              className="text-xs font-medium text-muted-foreground"
            >
              From
            </label>
            <Input
              id={`${idPrefix}-from`}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-40"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-to`} className="text-xs font-medium text-muted-foreground">
              To
            </label>
            <Input
              id={`${idPrefix}-to`}
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 w-40"
              required
            />
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-9">
            Apply
          </Button>
        </form>
      )}
      {filterSelect("work_type", "Work type", "All work types", workTypes)}
      {filterSelect("territory_id", "City", "All cities", cities)}
      {filterSelect("owner_id", "Owner", "Everyone", owners)}
      {filterSelect("source", "Lead source", "All sources", sources)}
      {pending && (
        <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" aria-label="Loading" />
      )}
    </div>
  );
}
