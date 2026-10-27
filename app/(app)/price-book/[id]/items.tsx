"use client";

import * as React from "react";
import { Package, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect, TOUCH } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import {
  CATALOG_FAMILIES,
  CATALOG_FAMILY_LABELS,
  CATALOG_ITEM_TYPES,
  CATALOG_ITEM_TYPE_LABELS,
  METHODS,
  METHOD_LABELS,
  PRICING_METHODS,
  PRICING_METHOD_LABELS,
  SAMPLE_BADGE,
  UNITS,
  UNIT_LABELS,
  WORK_ORDER_PHASES,
  WORK_ORDER_PHASE_LABELS,
  type CatalogFamily,
  type CatalogItemType,
  type Method,
  type PricingMethod,
  type Unit,
  type WorkOrderPhase,
} from "@/lib/estimating/engine";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import { saveCatalogItem, setCatalogItemActive } from "../actions";

export type ItemRow = {
  id: string;
  code: string;
  name: string;
  itemType: string;
  family: string;
  unit: string;
  pricingMethod: string;
  surface: string | null;
  workType: string | null;
  workOrderPhase: string | null;
  paintSqftPerUnit: number;
  defaultCoats: number;
  defaultMethod: string;
  defaultProductId: string | null;
  unitPriceCents: number | null;
  unitCostCents: number | null;
  laborHoursPerUnit: number;
  taxable: boolean;
  isOptionalDefault: boolean;
  isRepairAllowance: boolean;
  allowanceNote: string | null;
  customerDescription: string | null;
  active: boolean;
  isSample: boolean;
};

type Choice = { value: string; label: string };

const famLabel = (f: string) => CATALOG_FAMILY_LABELS[f as CatalogFamily] ?? f;

/** Catalog items by family (SPEC §8.12), with search and an editor for owners. */
export function CatalogItems({
  priceBookId,
  items,
  canManage,
  initialQuery,
  products,
  surfaces,
  workTypes,
}: {
  priceBookId: string;
  items: ItemRow[];
  canManage: boolean;
  initialQuery: string;
  products: { id: string; label: string; isPrimer: boolean }[];
  surfaces: Choice[];
  workTypes: Choice[];
}) {
  const [q, setQ] = React.useState(initialQuery);
  const [showInactive, setShowInactive] = React.useState(false);
  const [editing, setEditing] = React.useState<ItemRow | "new" | null>(null);
  const term = q.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (showInactive || i.active) &&
      (!term || i.name.toLowerCase().includes(term) || i.code.includes(term)),
  );
  const families = CATALOG_FAMILIES.filter((f) => shown.some((i) => i.family === f));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search the catalog"
            placeholder="Search by name or code"
            className={cn(TOUCH, "pl-9")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
        {canManage && (
          <Button className={TOUCH} onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            New item
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Package} title="No items yet">
          <p>Add walls, trim, doors, add-ons and fees the builder can price.</p>
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        families.map((f) => (
          <section
            key={f}
            aria-labelledby={`fam-${f}`}
            className="overflow-x-auto rounded-2xl border bg-card"
          >
            <h3 id={`fam-${f}`} className="border-b px-4 py-2 text-sm font-semibold">
              {famLabel(f)}
            </h3>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium">Unit</th>
                  <th className="px-4 py-2 font-medium">Pricing</th>
                  <th className="px-4 py-2 text-right font-medium">Price / cost</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown
                  .filter((i) => i.family === f)
                  .map((i) => (
                    <tr key={i.id} className={cn(!i.active && "opacity-60")}>
                      <td className="px-4 py-2">
                        {canManage ? (
                          <button
                            type="button"
                            className="text-left font-medium text-bb-forest hover:underline"
                            onClick={() => setEditing(i)}
                          >
                            {i.name}
                          </button>
                        ) : (
                          <span className="font-medium">{i.name}</span>
                        )}
                        <span className="block text-xs text-muted-foreground">{i.code}</span>
                      </td>
                      <td className="px-4 py-2">{UNIT_LABELS[i.unit as Unit] ?? i.unit}</td>
                      <td className="px-4 py-2">
                        {i.pricingMethod === "production_rate" ? "Production rate" : "Flat"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {i.pricingMethod === "flat"
                          ? `${formatCents(i.unitPriceCents)} / ${formatCents(i.unitCostCents)}`
                          : "From rates"}
                      </td>
                      <td className="px-4 py-2">
                        <span className="flex flex-wrap gap-1">
                          {i.isSample && (
                            <Badge variant="sample" title={SAMPLE_BADGE}>
                              Sample
                            </Badge>
                          )}
                          {!i.active && <Badge variant="neutral">Inactive</Badge>}
                          {i.isRepairAllowance && <Badge variant="outline">Allowance</Badge>}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))
      )}
      {editing && (
        <ItemEditor
          key={editing === "new" ? "new" : editing.id}
          priceBookId={priceBookId}
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          products={products}
          surfaces={surfaces}
          workTypes={workTypes}
        />
      )}
    </div>
  );
}

function ItemEditor({
  priceBookId,
  item,
  onClose,
  products,
  surfaces,
  workTypes,
}: {
  priceBookId: string;
  item: ItemRow | null;
  onClose: () => void;
  products: { id: string; label: string; isPrimer: boolean }[];
  surfaces: Choice[];
  workTypes: Choice[];
}) {
  const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
  const [f, setF] = React.useState({
    item_type: (item?.itemType ?? "labor") as CatalogItemType,
    family: (item?.family ?? "interior_labor") as CatalogFamily,
    code: item?.code ?? "",
    name: item?.name ?? "",
    customer_description: item?.customerDescription ?? "",
    unit: (item?.unit ?? "sqft") as Unit,
    pricing_method: (item?.pricingMethod ?? "production_rate") as PricingMethod,
    surface: item?.surface ?? "",
    work_type: item?.workType ?? "",
    work_order_phase: (item?.workOrderPhase ?? "") as WorkOrderPhase | "",
    paint_sqft_per_unit: String(item?.paintSqftPerUnit ?? 1),
    default_coats: String(item?.defaultCoats ?? 2),
    default_method: (item?.defaultMethod ?? "brush_roll") as Method,
    default_product_id: item?.defaultProductId ?? "",
    unit_price: dollars(item?.unitPriceCents ?? null),
    unit_cost: dollars(item?.unitCostCents ?? null),
    labor_hours_per_unit: String(item?.laborHoursPerUnit ?? 0),
    taxable: item?.taxable ?? true,
    is_optional_default: item?.isOptionalDefault ?? false,
    is_repair_allowance: item?.isRepairAllowance ?? false,
    allowance_note: item?.allowanceNote ?? "",
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const rate = f.pricing_method === "production_rate";

  const text = (
    k: keyof typeof f,
    label: string,
    opts: { required?: boolean; help?: string; decimal?: boolean; className?: string } = {},
  ) => (
    <Field
      id={`ci-${k}`}
      label={label}
      required={opts.required}
      error={errors[k]}
      description={opts.help}
      className={opts.className}
    >
      <Input
        {...fieldAria(`ci-${k}`, errors[k], !!opts.help)}
        className={TOUCH}
        inputMode={opts.decimal ? "decimal" : undefined}
        value={String(f[k])}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Field>
  );
  const select = <T extends string>(
    k: keyof typeof f,
    label: string,
    options: readonly T[],
    labels: Record<T, string>,
    empty?: string,
  ) => (
    <Field id={`ci-${k}`} label={label} error={errors[k]}>
      <NativeSelect
        id={`ci-${k}`}
        value={String(f[k])}
        onChange={(e) => set(k, e.target.value as never)}
      >
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{item ? item.name : "New catalog item"}</DialogTitle>
          <DialogDescription>
            {item?.isSample
              ? `${SAMPLE_BADGE}. Saving makes these numbers yours. Sent estimates keep the prices they went out with.`
              : "Sent estimates keep the prices they went out with."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            run(
              () =>
                saveCatalogItem({
                  id: item?.id,
                  price_book_id: priceBookId,
                  ...f,
                  active: item?.active ?? true,
                }),
              {
                success: "Item saved.",
                onOk: onClose,
                onError: (er) => setErrors(firstErrors(er)),
              },
            );
          }}
        >
          {text("name", "Name", { required: true, className: "sm:col-span-2" })}
          {text("code", "Code", { required: true, help: "Lowercase letters, numbers and _." })}
          {select("family", "Family", CATALOG_FAMILIES, CATALOG_FAMILY_LABELS)}
          {select("item_type", "Type", CATALOG_ITEM_TYPES, CATALOG_ITEM_TYPE_LABELS)}
          {select("unit", "Unit", UNITS, UNIT_LABELS)}
          <div className="sm:col-span-3">
            {select("pricing_method", "Pricing", PRICING_METHODS, PRICING_METHOD_LABELS)}
          </div>
          {rate ? (
            <>
              <Field id="ci-surface" label="Production-rate surface" error={errors.surface}>
                <NativeSelect
                  id="ci-surface"
                  value={f.surface}
                  onChange={(e) => set("surface", e.target.value)}
                >
                  <option value="">Pick a surface</option>
                  {surfaces.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {text("paint_sqft_per_unit", "Paint sq ft per unit", {
                decimal: true,
                help: "0 = no paint (labor only).",
              })}
              {select("default_coats", "Default coats", ["1", "2", "3"] as const, {
                "1": "1",
                "2": "2",
                "3": "3",
              })}
              {select("default_method", "Default method", METHODS, METHOD_LABELS)}
              <Field id="ci-product" label="Default paint" className="sm:col-span-2">
                <NativeSelect
                  id="ci-product"
                  value={f.default_product_id}
                  onChange={(e) => set("default_product_id", e.target.value)}
                >
                  <option value="">None</option>
                  {products
                    .filter((p) => !p.isPrimer)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            </>
          ) : (
            <>
              {text("unit_price", "Price per unit ($)", { decimal: true, required: true })}
              {text("unit_cost", "Our cost per unit ($)", { decimal: true })}
              {text("labor_hours_per_unit", "Labor hours per unit", {
                decimal: true,
                help: "For work orders and crew days.",
              })}
            </>
          )}
          <Field id="ci-wt" label="Work type">
            <NativeSelect
              id="ci-wt"
              value={f.work_type}
              onChange={(e) => set("work_type", e.target.value)}
            >
              <option value="">Not set</option>
              {workTypes.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {select(
            "work_order_phase",
            "Work-order phase",
            WORK_ORDER_PHASES,
            WORK_ORDER_PHASE_LABELS,
            "Not set",
          )}
          <Field id="ci-desc" label="What the customer sees" className="sm:col-span-3">
            <Textarea
              id="ci-desc"
              rows={2}
              value={f.customer_description}
              onChange={(e) => set("customer_description", e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-x-6 sm:col-span-3">
            {(
              [
                ["taxable", "Taxable"],
                ["is_optional_default", "Offer as an optional add-on"],
                ["is_repair_allowance", "Repair allowance"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={f[k]}
                  onChange={(e) => set(k, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          {f.is_repair_allowance &&
            text("allowance_note", "Allowance note", { className: "sm:col-span-3" })}
          <DialogFooter className="sm:col-span-3">
            {item && (
              <Button
                type="button"
                variant="ghost"
                className={cn(TOUCH, "mr-auto")}
                disabled={pending}
                onClick={() =>
                  run(() => setCatalogItemActive({ id: item.id, active: !item.active }), {
                    success: item.active ? "Item turned off." : "Item turned on.",
                    onOk: onClose,
                  })
                }
              >
                {item.active ? "Turn off" : "Turn on"}
              </Button>
            )}
            <Button type="button" variant="outline" className={TOUCH} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className={TOUCH} disabled={pending}>
              Save item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
