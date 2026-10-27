"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/layout/empty-state";
import { NativeSelect, TOUCH } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import {
  CONDITION_LABELS,
  METHOD_LABELS,
  SAMPLE_BADGE,
  type Condition,
  type Method,
} from "@/lib/estimating/engine";
import { updateProductionRate } from "../actions";

type Rate = {
  id: string;
  method: string;
  condition: string;
  unitsPerHour: number;
  prepHours: number;
  notes: string | null;
  isSample: boolean;
};

export function RatesEditor({
  canManage,
  surface,
  surfaces,
  rates,
  sampleCount,
  totalCount,
}: {
  canManage: boolean;
  surface: string | null;
  surfaces: { value: string; label: string }[];
  rates: Rate[];
  sampleCount: number;
  totalCount: number;
}) {
  const router = useRouter();
  if (!surface) {
    return (
      <EmptyState icon={Gauge} title="No production rates yet">
        <p>Rates are added with the catalog. Flat-priced items don&apos;t need them.</p>
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Surface
          <NativeSelect
            className="w-72"
            value={surface}
            onChange={(e) => router.push(`/price-book/rates?surface=${e.target.value}`)}
          >
            {surfaces.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <p className="text-sm text-muted-foreground">
          {sampleCount > 0 ? (
            <>
              <Badge variant="sample" className="mr-1">
                Sample
              </Badge>
              {sampleCount} of {totalCount} rates are still samples ({SAMPLE_BADGE}).
            </>
          ) : (
            "Every rate has been calibrated."
          )}
        </p>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Method</th>
              <th className="px-4 py-2 font-medium">Condition</th>
              <th className="px-4 py-2 font-medium">Units per labor hour</th>
              <th className="px-4 py-2 font-medium">Prep hours per unit</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {canManage && <th className="px-4 py-2" aria-label="Save" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rates.map((r) => (
              <RateRow key={r.id} rate={r} canManage={canManage} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Example: walls at 175 sq ft per hour and 0.004 prep hours per sq ft. Changes apply to drafts
        the next time they&apos;re priced; sent estimates don&apos;t change.
      </p>
    </div>
  );
}

function RateRow({ rate, canManage }: { rate: Rate; canManage: boolean }) {
  const [units, setUnits] = React.useState(String(rate.unitsPerHour));
  const [prep, setPrep] = React.useState(String(rate.prepHours));
  const { pending, run } = useRunAction();
  const dirty = units !== String(rate.unitsPerHour) || prep !== String(rate.prepHours);
  const label = `${METHOD_LABELS[rate.method as Method] ?? rate.method}, ${CONDITION_LABELS[rate.condition as Condition] ?? rate.condition}`;
  return (
    <tr>
      <td className="px-4 py-2">{METHOD_LABELS[rate.method as Method] ?? rate.method}</td>
      <td className="px-4 py-2">
        {CONDITION_LABELS[rate.condition as Condition] ?? rate.condition}
      </td>
      <td className="px-4 py-2">
        {canManage ? (
          <Input
            aria-label={`Units per labor hour, ${label}`}
            className={`${TOUCH} w-32`}
            inputMode="decimal"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
          />
        ) : (
          <span className="tabular-nums">{rate.unitsPerHour}</span>
        )}
      </td>
      <td className="px-4 py-2">
        {canManage ? (
          <Input
            aria-label={`Prep hours per unit, ${label}`}
            className={`${TOUCH} w-32`}
            inputMode="decimal"
            value={prep}
            onChange={(e) => setPrep(e.target.value)}
          />
        ) : (
          <span className="tabular-nums">{rate.prepHours}</span>
        )}
      </td>
      <td className="px-4 py-2">{rate.isSample && <Badge variant="sample">Sample</Badge>}</td>
      {canManage && (
        <td className="px-4 py-2 text-right">
          <Button
            size="sm"
            variant={dirty ? "default" : "outline"}
            className={TOUCH}
            disabled={pending || (!dirty && !rate.isSample)}
            onClick={() =>
              run(
                () =>
                  updateProductionRate({
                    id: rate.id,
                    units_per_labor_hour: units,
                    prep_hours_per_unit: prep,
                  }),
                { success: "Rate saved." },
              )
            }
          >
            {dirty || !rate.isSample ? "Save" : "Confirm"}
          </Button>
        </td>
      )}
    </tr>
  );
}
