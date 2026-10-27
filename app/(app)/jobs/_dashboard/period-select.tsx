"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DEFAULT_JOB_PERIOD, JOB_PERIODS, type JobPeriodId } from "./periods";

/** Period select for the Jobs Dashboard; the choice lives in the URL (?period=). */
export function PeriodSelect({ value }: { value: JobPeriodId }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="jobs-period" className="text-sm font-medium text-muted-foreground">
        Period
      </label>
      <select
        id="jobs-period"
        className="h-9 rounded-md border border-input bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        value={value}
        onChange={(e) => {
          const next = e.target.value as JobPeriodId;
          startTransition(() =>
            router.push(next === DEFAULT_JOB_PERIOD ? pathname : `${pathname}?period=${next}`, {
              scroll: false,
            }),
          );
        }}
      >
        {JOB_PERIODS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      {pending && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
      )}
    </div>
  );
}
