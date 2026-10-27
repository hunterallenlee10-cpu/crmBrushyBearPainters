"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveMarketingSpend } from "./actions";

export function SpendForm({
  month,
  months,
  rows,
  readOnly,
}: {
  month: string;
  months: { value: string; label: string }[];
  rows: { source: string; label: string; active: boolean; amount: string }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [values, setValues] = React.useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.source, r.amount])),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  React.useEffect(
    () => setValues(Object.fromEntries(rows.map((r) => [r.source, r.amount]))),
    [rows],
  );
  const visible = rows.filter((r) => r.active || r.amount);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveMarketingSpend({
        month,
        rows: visible.map((r) => ({ lead_source: r.source, amount: values[r.source] ?? "" })),
      });
      if (!res.ok) {
        setError(
          res.error.fieldErrors
            ? (Object.values(res.error.fieldErrors).flat()[0] ?? res.error.message)
            : res.error.message,
        );
        return;
      }
      toast.success("Spend saved.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="flex flex-col gap-1">
        <label htmlFor="spend-month" className="text-sm font-medium">
          Month
        </label>
        <select
          id="spend-month"
          className="h-9 w-fit rounded-md border border-input bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          value={month}
          onChange={(e) => router.push(`${pathname}?month=${e.target.value}`)}
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <fieldset disabled={readOnly || pending} className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <legend className="sr-only">Spend by lead source</legend>
        {visible.map((r) => (
          <div key={r.source} className="flex items-center justify-between gap-3">
            <label htmlFor={`spend-${r.source}`} className="text-sm">
              {r.label}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground" aria-hidden>
                $
              </span>
              <Input
                id={`spend-${r.source}`}
                inputMode="decimal"
                className="h-9 w-32 text-right"
                value={values[r.source] ?? ""}
                placeholder="0.00"
                onChange={(e) => setValues((v) => ({ ...v, [r.source]: e.target.value }))}
              />
            </div>
          </div>
        ))}
      </fieldset>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" variant="cta" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            Save spend
          </Button>
        </div>
      )}
    </form>
  );
}
