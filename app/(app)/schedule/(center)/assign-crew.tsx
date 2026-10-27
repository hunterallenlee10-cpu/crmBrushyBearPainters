"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import { assignCrew } from "../actions";

/** Pick (or clear) a job's crew; ranked crews first with their score. */
export function AssignCrew({
  jobId,
  jobLabel,
  crewId,
  options,
  disabled,
}: {
  jobId: string;
  jobLabel: string;
  crewId: string | null;
  options: { id: string; label: string }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const id = `crew-${jobId}`;
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Crew for {jobLabel}
      </label>
      <NativeSelect
        id={id}
        value={crewId ?? ""}
        disabled={disabled || pending}
        onChange={(e) =>
          run(() => assignCrew({ jobId, crewId: e.target.value || null }), {
            success: e.target.value ? "Crew assigned." : "Crew removed.",
            onOk: () => router.refresh(),
          })
        }
      >
        <option value="">No crew</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}
