"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import { generatePaintOrder, updatePaintOrder } from "../../actions";

const STATUSES = [
  ["draft", "Draft"],
  ["waiting_to_order", "Waiting to order"],
  ["ordered", "Ordered"],
  ["partially_received", "Partially received"],
  ["picked_up", "Picked up"],
  ["delivered", "Delivered"],
  ["canceled", "Canceled"],
] as const;

export function PaintOrderControls({
  id,
  po,
  status,
  supplier,
  expectedOn,
  fulfillment,
  disabled,
}: {
  id: string;
  po: string;
  status: string;
  supplier: string | null;
  expectedOn: string | null;
  fulfillment: string | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [s, setS] = React.useState(supplier ?? "");
  const [d, setD] = React.useState(expectedOn ?? "");
  const [ful, setFul] = React.useState(fulfillment ?? "");
  const save = (patch: Parameters<typeof updatePaintOrder>[0]) =>
    run(() => updatePaintOrder(patch), { success: `${po} updated.`, onOk: () => router.refresh() });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`po-status-${id}`} className="sr-only">
        Status of {po}
      </label>
      <NativeSelect
        id={`po-status-${id}`}
        className="w-44"
        value={status}
        disabled={disabled || pending}
        onChange={(e) => save({ id, status: e.target.value as "ordered" })}
      >
        {STATUSES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
      <label htmlFor={`po-sup-${id}`} className="sr-only">
        Supplier for {po}
      </label>
      <Input
        id={`po-sup-${id}`}
        className="w-36"
        placeholder="Supplier"
        value={s}
        disabled={disabled}
        onChange={(e) => setS(e.target.value)}
      />
      <label htmlFor={`po-ful-${id}`} className="sr-only">
        Pickup or delivery for {po}
      </label>
      <NativeSelect
        id={`po-ful-${id}`}
        className="w-32"
        value={ful}
        disabled={disabled}
        onChange={(e) => setFul(e.target.value)}
      >
        <option value="">Pickup/delivery</option>
        <option value="pickup">Pickup</option>
        <option value="delivery">Delivery</option>
      </NativeSelect>
      <label htmlFor={`po-date-${id}`} className="sr-only">
        Pickup or delivery date for {po}
      </label>
      <Input
        id={`po-date-${id}`}
        type="date"
        className="w-40"
        value={d}
        disabled={disabled}
        onChange={(e) => setD(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={
          disabled ||
          pending ||
          (s === (supplier ?? "") && d === (expectedOn ?? "") && ful === (fulfillment ?? ""))
        }
        onClick={() =>
          save({
            id,
            supplier: s,
            expectedOn: d || null,
            fulfillment: ful === "pickup" || ful === "delivery" ? ful : null,
          })
        }
      >
        Save
      </Button>
    </div>
  );
}

export function GeneratePaintOrderButton({ jobId, label }: { jobId: string; label: string }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Generate paint order from estimate for ${label}`}
      onClick={() =>
        run(() => generatePaintOrder({ jobId }), {
          success: (r) => `${r.poNumber} created from the estimate.`,
          onOk: () => router.refresh(),
        })
      }
    >
      Generate order from estimate
    </Button>
  );
}
