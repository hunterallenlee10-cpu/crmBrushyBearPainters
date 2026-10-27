"use client";

import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import { updateWorkOrder } from "@/app/(app)/schedule/actions";

const STATUSES = [
  ["new", "New"],
  ["scheduled", "Scheduled"],
  ["in_progress", "In progress"],
  ["pending_approval", "Pending approval"],
  ["completed", "Completed"],
  ["canceled", "Canceled"],
] as const;

const CREW_LEAD = new Set(["in_progress", "pending_approval", "completed"]);

/** Work order status (office: any; crew lead: start, flag or finish) and crew. */
export function WorkOrderControls({
  id,
  number,
  status,
  crewId,
  crews,
  canManage,
  canField,
}: {
  id: string;
  number: string;
  status: string;
  crewId: string | null;
  crews: { id: string; name: string }[];
  canManage: boolean;
  canField: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const options = STATUSES.filter(([v]) => canManage || CREW_LEAD.has(v) || v === status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`wo-status-${id}`} className="sr-only">
        Status of {number}
      </label>
      <NativeSelect
        id={`wo-status-${id}`}
        className="w-44"
        value={status}
        disabled={pending || (!canManage && !canField)}
        onChange={(e) =>
          run(() => updateWorkOrder({ id, status: e.target.value as "completed" }), {
            success: e.target.value === "completed" ? `${number} completed.` : `${number} updated.`,
            onOk: () => router.refresh(),
          })
        }
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
      {canManage && (
        <>
          <label htmlFor={`wo-crew-${id}`} className="sr-only">
            Crew for {number}
          </label>
          <NativeSelect
            id={`wo-crew-${id}`}
            className="w-40"
            value={crewId ?? ""}
            disabled={pending}
            onChange={(e) =>
              run(() => updateWorkOrder({ id, crewId: e.target.value || null }), {
                success: `${number} crew saved.`,
                onOk: () => router.refresh(),
              })
            }
          >
            <option value="">No crew</option>
            {crews.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </>
      )}
    </div>
  );
}
