"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRevenueGoals } from "../marketing-spend/actions";

export function GoalsForm({
  months,
  readOnly,
}: {
  months: { month: string; label: string; goal: string }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState<Record<string, string>>(
    Object.fromEntries(months.map((m) => [m.month, m.goal])),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await saveRevenueGoals({
            months: months.map((m) => ({ month: m.month, goal: values[m.month] ?? "" })),
          });
          if (!res.ok) {
            setError(
              res.error.fieldErrors
                ? (Object.values(res.error.fieldErrors).flat()[0] ?? res.error.message)
                : res.error.message,
            );
            return;
          }
          toast.success("Goals saved.");
          router.refresh();
        });
      }}
    >
      <fieldset
        disabled={readOnly || pending}
        className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        <legend className="sr-only">Goal per month</legend>
        {months.map((m) => (
          <div key={m.month} className="flex items-center justify-between gap-3">
            <label htmlFor={`goal-${m.month}`} className="text-sm">
              {m.label}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground" aria-hidden>
                $
              </span>
              <Input
                id={`goal-${m.month}`}
                inputMode="decimal"
                className="h-9 w-36 text-right"
                placeholder="No goal"
                value={values[m.month] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [m.month]: e.target.value }))}
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
            Save goals
          </Button>
        </div>
      )}
    </form>
  );
}
