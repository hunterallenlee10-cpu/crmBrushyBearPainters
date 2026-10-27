"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CloudRain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRunAction } from "@/components/forms/use-run-action";
import { markRainDelay } from "../../actions";

/** Manual rain delay (SPEC §1.3 rain-day promise) while weather isn't connected. */
export function RainDelayForm({
  jobId,
  label,
  defaultDate,
}: {
  jobId: string;
  label: string;
  defaultDate: string;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [date, setDate] = React.useState(defaultDate);
  const [notify, setNotify] = React.useState(true);
  const id = `rain-${jobId}`;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => markRainDelay({ jobId, date, notifyCustomer: notify }), {
          success: (r) =>
            r.customerNotified
              ? "Rain delay marked. The customer text is recorded (simulated) and the job is first in line."
              : `Rain delay marked. ${r.customerNote ?? ""}`,
          onOk: () => router.refresh(),
        });
      }}
    >
      <label htmlFor={`${id}-date`} className="sr-only">
        Rain day for {label}
      </label>
      <Input
        id={`${id}-date`}
        type="date"
        className="w-40"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
        <input
          type="checkbox"
          className="size-4 accent-bb-forest"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
        />
        Text the customer
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !date}>
        <CloudRain aria-hidden /> Mark rain delay
      </Button>
    </form>
  );
}
