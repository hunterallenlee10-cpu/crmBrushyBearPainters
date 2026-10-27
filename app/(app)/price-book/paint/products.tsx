"use client";

import * as React from "react";
import { PaintBucket, Plus } from "lucide-react";
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
  CONTAINERS,
  CONTAINER_LABELS,
  PRODUCT_USES,
  PRODUCT_USE_LABELS,
  SAMPLE_BADGE,
  type Container,
  type ProductUse,
} from "@/lib/estimating/engine";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import { savePaintProduct, setPaintProductActive } from "../actions";

export type ProductRow = {
  id: string;
  brand: string;
  line: string | null;
  product: string;
  use: string;
  base: string | null;
  sheens: string[];
  coverage: number;
  costCents: number;
  priceCents: number | null;
  voc: number | null;
  dryHours: number | null;
  recoatHours: number | null;
  minTempF: number | null;
  containers: string[];
  isPrimer: boolean;
  notes: string | null;
  active: boolean;
  isSample: boolean;
};
type Choice = { value: string; label: string };

export function PaintProducts({
  products,
  canManage,
  brands,
  sheens,
}: {
  products: ProductRow[];
  canManage: boolean;
  brands: Choice[];
  sheens: Choice[];
}) {
  const [editing, setEditing] = React.useState<ProductRow | "new" | null>(null);
  const label = (list: Choice[], v: string) => list.find((x) => x.value === v)?.label ?? v;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Coverage and cost per gallon drive paint quantities and material cost on every line.
        </p>
        {canManage && (
          <Button className={TOUCH} onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            New paint product
          </Button>
        )}
      </div>
      {products.length === 0 ? (
        <EmptyState icon={PaintBucket} title="No paint products yet">
          <p>Add the paints and primers you use, with coverage and cost per gallon.</p>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Use</th>
                <th className="px-4 py-2 font-medium">Sheens</th>
                <th className="px-4 py-2 text-right font-medium">Coverage</th>
                <th className="px-4 py-2 text-right font-medium">Cost / gal</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((p) => (
                <tr key={p.id} className={cn(!p.active && "opacity-60")}>
                  <td className="px-4 py-2">
                    {canManage ? (
                      <button
                        type="button"
                        className="text-left font-medium text-bb-forest hover:underline"
                        onClick={() => setEditing(p)}
                      >
                        {label(brands, p.brand)} {p.product}
                      </button>
                    ) : (
                      <span className="font-medium">
                        {label(brands, p.brand)} {p.product}
                      </span>
                    )}
                    {p.isPrimer && (
                      <span className="block text-xs text-muted-foreground">Primer</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{PRODUCT_USE_LABELS[p.use as ProductUse] ?? p.use}</td>
                  <td className="px-4 py-2">
                    {p.sheens.map((s) => label(sheens, s)).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.coverage} sq ft/gal</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCents(p.costCents)}</td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {p.isSample && (
                        <Badge variant="sample" title={SAMPLE_BADGE}>
                          Sample
                        </Badge>
                      )}
                      {!p.active && <Badge variant="neutral">Inactive</Badge>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ProductEditor
          key={editing === "new" ? "new" : editing.id}
          product={editing === "new" ? null : editing}
          brands={brands}
          sheens={sheens}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ProductEditor({
  product,
  brands,
  sheens,
  onClose,
}: {
  product: ProductRow | null;
  brands: Choice[];
  sheens: Choice[];
  onClose: () => void;
}) {
  const num = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  const [f, setF] = React.useState({
    brand: product?.brand ?? brands[0]?.value ?? "",
    line: product?.line ?? "",
    product: product?.product ?? "",
    use: (product?.use ?? "interior") as ProductUse,
    base: product?.base ?? "",
    sheens: product?.sheens ?? [],
    coverage_sqft_per_gal: num(product?.coverage ?? 350),
    cost_per_gal: product ? (product.costCents / 100).toFixed(2) : "",
    price_per_gal: product?.priceCents ? (product.priceCents / 100).toFixed(2) : "",
    voc_g_per_l: num(product?.voc),
    dry_time_hours: num(product?.dryHours),
    recoat_hours: num(product?.recoatHours),
    min_temp_f: num(product?.minTempF),
    containers: (product?.containers ?? ["gallon", "five_gallon"]) as Container[],
    is_primer: product?.isPrimer ?? false,
    notes: product?.notes ?? "",
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = <T extends string>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const box = (k: keyof typeof f, label: string, help?: string) => (
    <Field id={`pp-${k}`} label={label} error={errors[k]} description={help}>
      <Input
        {...fieldAria(`pp-${k}`, errors[k], !!help)}
        className={TOUCH}
        inputMode="decimal"
        value={String(f[k])}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Field>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{product ? product.product : "New paint product"}</DialogTitle>
          <DialogDescription>
            {product?.isSample ? `${SAMPLE_BADGE}. ` : ""}Use the store&apos;s real cost and the
            label&apos;s coverage.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            run(
              () => savePaintProduct({ id: product?.id, ...f, active: product?.active ?? true }),
              {
                success: "Paint product saved.",
                onOk: onClose,
                onError: (er) => setErrors(firstErrors(er)),
              },
            );
          }}
        >
          <Field id="pp-brand" label="Brand" error={errors.brand}>
            <NativeSelect
              id="pp-brand"
              value={f.brand}
              onChange={(e) => set("brand", e.target.value)}
            >
              {brands.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="pp-product"
            label="Product"
            required
            error={errors.product}
            className="sm:col-span-2"
          >
            <Input
              {...fieldAria("pp-product", errors.product)}
              className={TOUCH}
              value={f.product}
              onChange={(e) => set("product", e.target.value)}
            />
          </Field>
          <Field id="pp-line" label="Line">
            <Input
              id="pp-line"
              className={TOUCH}
              value={f.line}
              onChange={(e) => set("line", e.target.value)}
            />
          </Field>
          <Field id="pp-use" label="Use">
            <NativeSelect
              id="pp-use"
              value={f.use}
              onChange={(e) => set("use", e.target.value as ProductUse)}
            >
              {PRODUCT_USES.map((u) => (
                <option key={u} value={u}>
                  {PRODUCT_USE_LABELS[u]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="pp-base" label="Base">
            <Input
              id="pp-base"
              className={TOUCH}
              value={f.base}
              onChange={(e) => set("base", e.target.value)}
            />
          </Field>
          {box("coverage_sqft_per_gal", "Coverage (sq ft per gallon)")}
          {box("cost_per_gal", "Our cost per gallon ($)")}
          {box("price_per_gal", "Price per gallon ($)", "Optional; for reference.")}
          {box("voc_g_per_l", "VOC (g/L)")}
          {box("dry_time_hours", "Dry time (hours)")}
          {box("recoat_hours", "Recoat (hours)")}
          {box("min_temp_f", "Min. temperature (°F)")}
          <fieldset className="sm:col-span-3">
            <legend className="mb-1 text-sm font-medium">Sheens</legend>
            <div className="flex flex-wrap gap-x-4">
              {sheens.map((s) => (
                <label key={s.value} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={f.sheens.includes(s.value)}
                    onChange={() => set("sheens", toggle(f.sheens, s.value))}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="sm:col-span-3">
            <legend className="mb-1 text-sm font-medium">Containers we buy</legend>
            <div className="flex flex-wrap gap-x-4">
              {CONTAINERS.map((c) => (
                <label key={c} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={f.containers.includes(c)}
                    onChange={() => set("containers", toggle(f.containers, c))}
                  />
                  {CONTAINER_LABELS[c]}
                </label>
              ))}
            </div>
            {errors.containers && <p className="text-xs text-danger">{errors.containers}</p>}
          </fieldset>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              className="size-5"
              checked={f.is_primer}
              onChange={(e) => set("is_primer", e.target.checked)}
            />
            This is a primer
          </label>
          <Field id="pp-notes" label="Notes" className="sm:col-span-3">
            <Textarea
              id="pp-notes"
              rows={2}
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
          <DialogFooter className="sm:col-span-3">
            {product && (
              <Button
                type="button"
                variant="ghost"
                className={cn(TOUCH, "mr-auto")}
                disabled={pending}
                onClick={() =>
                  run(() => setPaintProductActive({ id: product.id, active: !product.active }), {
                    success: product.active ? "Product turned off." : "Product turned on.",
                    onOk: onClose,
                  })
                }
              >
                {product.active ? "Turn off" : "Turn on"}
              </Button>
            )}
            <Button type="button" variant="outline" className={TOUCH} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className={TOUCH} disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
