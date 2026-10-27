"use client";

import * as React from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect, TOUCH } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import {
  CATALOG_FAMILY_LABELS,
  UNITS,
  UNIT_LABELS,
  type CatalogFamily,
  type Unit,
} from "@/lib/estimating/engine";
import { cn } from "@/lib/utils";
import { addLine } from "./actions";

export type CatalogChoice = {
  id: string;
  code: string;
  name: string;
  family: string;
  unit: string;
  itemType: string;
  pricingMethod: string;
  isSample: boolean;
};

export type LineTarget =
  | { kind: "version"; versionId: string; optionId: string | null; areaId: string | null }
  | { kind: "change_order"; changeOrderId: string };

const familyLabel = (f: string) => CATALOG_FAMILY_LABELS[f as CatalogFamily] ?? f;
const unitLabel = (u: string) => UNIT_LABELS[u as Unit] ?? u;

/**
 * Add a line from the price book, or a custom line (SPEC §7.2). Tablet-first:
 * big rows, a search box, families as filter chips.
 */
export function CatalogPicker({
  catalog,
  target,
  title,
  label = "Add line",
  variant = "outline",
  onAdded,
}: {
  catalog: CatalogChoice[];
  target: LineTarget;
  title: string;
  label?: string;
  variant?: "outline" | "default" | "ghost";
  onAdded?: (lineId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [family, setFamily] = React.useState<string>("all");
  const [custom, setCustom] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    unit: "each" as Unit,
    price: "",
    cost: "",
    credit: false,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();

  React.useEffect(() => {
    if (!open) return;
    setQ("");
    setCustom(false);
    setErrors({});
    setForm({ name: "", unit: "each", price: "", cost: "", credit: false });
  }, [open]);

  const families = [...new Set(catalog.map((c) => c.family))];
  const term = q.trim().toLowerCase();
  const items = catalog.filter(
    (c) =>
      (family === "all" || c.family === family) &&
      (!term || c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term)),
  );

  const placement =
    target.kind === "version"
      ? {
          version_id: target.versionId,
          option_id: target.optionId ?? "",
          area_id: target.areaId ?? "",
        }
      : { change_order_id: target.changeOrderId };

  const add = (catalogItemId: string) =>
    run(() => addLine({ ...placement, catalog_item_id: catalogItemId }), {
      success: "Line added.",
      onOk: (d) => {
        setOpen(false);
        onAdded?.(d.id);
      },
    });

  const addCustom = () =>
    run(
      () =>
        addLine({
          ...placement,
          custom_name: form.name,
          custom_unit: form.unit,
          custom_price: form.price,
          custom_cost: form.cost,
          is_credit: target.kind === "change_order" ? form.credit : undefined,
        }),
      {
        success: "Line added.",
        onOk: (d) => {
          setOpen(false);
          onAdded?.(d.id);
        },
        onError: (e) => setErrors(firstErrors(e)),
      },
    );

  return (
    <>
      <Button variant={variant} className={TOUCH} onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Pick from the price book, or add a custom line with its own price.
            </DialogDescription>
          </DialogHeader>
          {!custom ? (
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  aria-label="Search the price book"
                  placeholder="Search walls, trim, doors, cabinets…"
                  className={cn("pl-9", TOUCH)}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Families">
                {["all", ...families].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFamily(f)}
                    aria-pressed={family === f}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm",
                      family === f
                        ? "border-bb-forest bg-bb-forest text-white"
                        : "border-bb-border bg-card hover:bg-bb-cream",
                    )}
                  >
                    {f === "all" ? "All" : familyLabel(f)}
                  </button>
                ))}
              </div>
              {catalog.length === 0 ? (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  The price book is empty. An owner can add items in Price Book, or add a custom
                  line below.
                </p>
              ) : items.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Nothing matches “{q}”.
                </p>
              ) : (
                <ul className="max-h-[45dvh] divide-y overflow-y-auto rounded-xl border">
                  {items.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => add(c.id)}
                        className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-bb-cream-light disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{c.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {familyLabel(c.family)} · per {unitLabel(c.unit)}
                            {c.pricingMethod === "production_rate" ? " · production rate" : ""}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {c.isSample && <Badge variant="sample">Sample</Badge>}
                          <Plus className="size-4 text-bb-forest" aria-hidden />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <DialogFooter>
                <Button variant="ghost" className={TOUCH} onClick={() => setCustom(true)}>
                  Custom line instead
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                addCustom();
              }}
            >
              <Field
                id="cl-name"
                label="Name"
                required
                error={errors.custom_name}
                className="sm:col-span-2"
              >
                <Input
                  {...fieldAria("cl-name", errors.custom_name)}
                  className={TOUCH}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoFocus
                />
              </Field>
              <Field id="cl-unit" label="Unit">
                <NativeSelect
                  id="cl-unit"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value as Unit })}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                id="cl-price"
                label="Price per unit ($)"
                required
                error={errors.custom_price ?? errors.catalog_item_id}
              >
                <Input
                  {...fieldAria("cl-price", errors.custom_price)}
                  className={TOUCH}
                  inputMode="decimal"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </Field>
              <Field
                id="cl-cost"
                label="Our cost per unit ($)"
                description="For the margin panel. Leave blank if it's all labor we price elsewhere."
                error={errors.custom_cost}
              >
                <Input
                  {...fieldAria("cl-cost", errors.custom_cost, true)}
                  className={TOUCH}
                  inputMode="decimal"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                />
              </Field>
              {target.kind === "change_order" && (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={form.credit}
                    onChange={(e) => setForm({ ...form, credit: e.target.checked })}
                  />
                  This is a credit (work removed from the contract)
                </label>
              )}
              <DialogFooter className="sm:col-span-2">
                <Button
                  type="button"
                  variant="ghost"
                  className={TOUCH}
                  onClick={() => setCustom(false)}
                >
                  Back to the price book
                </Button>
                <Button type="submit" className={TOUCH} disabled={pending}>
                  Add line
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
