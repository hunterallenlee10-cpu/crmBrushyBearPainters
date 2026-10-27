"use client";

import * as React from "react";
import { AlertTriangle, Ruler, Trash2 } from "lucide-react";
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
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect, TOUCH } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import {
  ACCESS_LABELS,
  ACCESS_TYPES,
  COLOR_CHANGES,
  COLOR_CHANGE_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  HEIGHTS,
  HEIGHT_LABELS,
  METHODS,
  METHOD_LABELS,
  PREP_LEVELS,
  PREP_LEVEL_LABELS,
  PRIMERS,
  PRIMER_LABELS,
  UNIT_LABELS,
  type Access,
  type ColorChange,
  type Condition,
  type Height,
  type Method,
  type PrepLevel,
  type Primer,
} from "@/lib/estimating/engine";
import {
  MEASUREMENT_LABELS,
  defaultMeasurementKind,
  quantityFromMeasurement,
  type Measurement,
} from "@/lib/estimating/measurement";
import { formatCents } from "@/lib/format/money";
import { deleteLine, updateLine } from "./actions";
import type { BuilderLine, MeasureSettings, ProductChoice } from "./types";

type MeasureKind = NonNullable<Measurement["kind"]>;

type Form = {
  name: string;
  quantity: string;
  sides: "1" | "2";
  condition: Condition;
  prep_level: PrepLevel;
  coats: "1" | "2" | "3";
  primer: Primer;
  color_change: ColorChange;
  method: Method;
  access: Access;
  height: Height;
  sheen: string;
  paint_product_id: string;
  primer_product_id: string;
  lead_safe: boolean;
  taxable: boolean;
  unit_price: string;
  unit_cost: string;
  override_price: string;
  override_reason: string;
  customer_note: string;
};

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const pick = <T extends string>(list: readonly T[], v: string, fallback: T): T =>
  (list as readonly string[]).includes(v) ? (v as T) : fallback;

function formFor(l: BuilderLine): Form {
  return {
    name: l.name,
    quantity: String(l.quantity),
    sides: l.sides === 2 ? "2" : "1",
    condition: pick(CONDITIONS, l.condition, "good"),
    prep_level: pick(PREP_LEVELS, l.prepLevel, "standard"),
    coats: l.coats === 1 ? "1" : l.coats === 3 ? "3" : "2",
    primer: pick(PRIMERS, l.primer, "none"),
    color_change: pick(COLOR_CHANGES, l.colorChange, "same"),
    method: pick(METHODS, l.method, "brush_roll"),
    access: pick(ACCESS_TYPES, l.access, "ladder"),
    height: pick(HEIGHTS, l.height, "one_story"),
    sheen: l.sheen ?? "",
    paint_product_id: l.productId ?? "",
    primer_product_id: l.primerProductId ?? "",
    lead_safe: l.leadSafe,
    taxable: l.taxable,
    unit_price: dollars(l.unitPriceCents),
    unit_cost: dollars(l.unitCostCents),
    override_price: dollars(l.overridePriceCents),
    override_reason: l.overrideReason ?? "",
    customer_note: l.customerNote ?? "",
  };
}

function Choice<T extends string>({
  id,
  label,
  value,
  options,
  labels,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <Field id={id} label={label}>
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

/** Measurement helper (SPEC §7.3): dimensions in, quantity out. */
function MeasureHelper({
  line,
  settings,
  onUse,
  disabled,
}: {
  line: BuilderLine;
  settings: MeasureSettings;
  onUse: (m: Measurement, qty: number) => void;
  disabled?: boolean;
}) {
  const [kind, setKind] = React.useState<MeasureKind>(
    defaultMeasurementKind({ unit: line.unit, surface: line.surface }) ?? "room_walls",
  );
  const [m, setM] = React.useState({
    lengthFt: "",
    widthFt: "",
    heightFt: "",
    doors: "",
    windows: "",
    gableFactor: String(settings.gableFactor),
    sides: "1",
  });
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const measurement: Measurement = {
    kind,
    lengthFt: num(m.lengthFt),
    widthFt: num(m.widthFt),
    heightFt: num(m.heightFt),
    doors: num(m.doors),
    windows: num(m.windows),
    gableFactor: kind === "exterior_wall" ? num(m.gableFactor) : undefined,
    sides: kind === "fence" ? (m.sides === "2" ? 2 : 1) : undefined,
  };
  const valid = Object.values(measurement).every(
    (v) => v === undefined || typeof v === "string" || Number.isFinite(v),
  );
  const qty = valid ? quantityFromMeasurement(measurement, settings) : null;
  const unit = kind === "room_baseboard" ? "lin ft" : "sq ft";
  const show = {
    length: kind !== "exterior_wall",
    width: kind !== "fence",
    height: kind !== "room_ceiling" && kind !== "room_baseboard",
    doors: kind === "room_walls" || kind === "room_baseboard",
    windows: kind === "room_walls",
  };
  const box = (key: keyof typeof m, label: string) => (
    <Field id={`m-${key}`} label={label}>
      <Input
        id={`m-${key}`}
        className={TOUCH}
        inputMode="decimal"
        value={m[key]}
        disabled={disabled}
        onChange={(e) => setM({ ...m, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <div className="rounded-xl border border-bb-border bg-bb-cream-light p-3">
      <Field id="m-kind" label="What to measure">
        <NativeSelect
          id="m-kind"
          value={kind}
          disabled={disabled}
          onChange={(e) => setKind(e.target.value as MeasureKind)}
        >
          {(Object.keys(MEASUREMENT_LABELS) as MeasureKind[]).map((k) => (
            <option key={k} value={k}>
              {MEASUREMENT_LABELS[k]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {show.length && box("lengthFt", kind === "fence" ? "Length (ft)" : "Length (ft)")}
        {show.width && box("widthFt", kind === "exterior_wall" ? "Width (ft)" : "Width (ft)")}
        {show.height && box("heightFt", "Height (ft)")}
        {show.doors && box("doors", "Doors")}
        {show.windows && box("windows", "Windows")}
        {kind === "exterior_wall" && box("gableFactor", "Gable factor")}
        {kind === "fence" && (
          <Field id="m-sides" label="Sides">
            <NativeSelect
              id="m-sides"
              value={m.sides}
              disabled={disabled}
              onChange={(e) => setM({ ...m, sides: e.target.value })}
            >
              <option value="1">One side</option>
              <option value="2">Both sides</option>
            </NativeSelect>
          </Field>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" aria-live="polite">
          {qty === null ? (
            "Enter the dimensions."
          ) : (
            <strong>{`${qty.toLocaleString("en-US")} ${unit}`}</strong>
          )}
          {kind === "room_walls" && (
            <span className="block text-xs text-muted-foreground">
              Minus {settings.doorDeductionSqft} sq ft per door and {settings.windowDeductionSqft}{" "}
              per window (Estimate Setup).
            </span>
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          className={TOUCH}
          disabled={disabled || qty === null}
          onClick={() => qty !== null && onUse(measurement, qty)}
        >
          Use this quantity
        </Button>
      </div>
    </div>
  );
}

/**
 * Edit one line (SPEC §7.2–7.3). Mount it with `key={line.id}`: the form
 * starts from the line and isn't reset by background refreshes. Production-rate lines show the painting
 * inputs; flat lines show their price and cost. Prices and hours are worked
 * out on the server after saving.
 */
export function LineEditor({
  line,
  open,
  onOpenChange,
  products,
  sheens,
  settings,
  readOnly,
  showCost = true,
}: {
  line: BuilderLine;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductChoice[];
  sheens: { value: string; label: string }[];
  settings: MeasureSettings;
  readOnly: boolean;
  showCost?: boolean;
}) {
  const [form, setForm] = React.useState<Form>(() => formFor(line));
  const [measurement, setMeasurement] = React.useState<Measurement | null>(null);
  const [measuring, setMeasuring] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const rate = line.kind === "production_rate";
  const paints = products.filter((p) => !p.isPrimer);
  const primers = products.filter((p) => p.isPrimer);
  const product = products.find((p) => p.id === form.paint_product_id);
  const sheenChoices = product?.sheens.length
    ? sheens.filter((s) => product.sheens.includes(s.value))
    : sheens;
  const measurable = line.unit === "sqft" || line.unit === "lf";
  const unit = UNIT_LABELS[line.unit];

  const save = () => {
    setErrors({});
    run(
      () =>
        updateLine({
          id: line.id,
          name: form.name,
          quantity: form.quantity,
          customer_note: form.customer_note,
          taxable: form.taxable,
          override_price: form.override_price,
          override_reason: form.override_reason,
          measurement,
          ...(rate
            ? {
                sides: form.sides === "2" ? 2 : 1,
                condition: form.condition,
                prep_level: form.prep_level,
                coats: Number(form.coats) as 1 | 2 | 3,
                primer: form.primer,
                color_change: form.color_change,
                method: form.method,
                access: form.access,
                height: form.height,
                sheen: form.sheen,
                paint_product_id: form.paint_product_id,
                primer_product_id: form.primer_product_id,
                lead_safe: form.lead_safe,
              }
            : { unit_price: form.unit_price, unit_cost: form.unit_cost }),
        }),
      {
        success: "Line saved.",
        onOk: () => onOpenChange(false),
        onError: (e) => setErrors(firstErrors(e)),
      },
    );
  };

  const remove = () =>
    run(() => deleteLine({ id: line.id }), {
      success: "Line removed.",
      onOk: () => onOpenChange(false),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{line.name}</DialogTitle>
          <DialogDescription>
            {line.catalogCode ? `${line.catalogCode} · ` : ""}
            {rate ? "Priced from production rates, paint and margin." : "Flat price per unit."}
            {readOnly ? " This version is frozen." : ""}
          </DialogDescription>
        </DialogHeader>

        {line.issues.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {line.issues.map((i, n) => (
              <li
                key={n}
                className={
                  i.severity === "error"
                    ? "flex items-start gap-2 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger"
                    : "flex items-start gap-2 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning"
                }
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {i.message}
              </li>
            ))}
          </ul>
        )}

        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!readOnly) save();
          }}
        >
          <Field id="ln-name" label="Name" error={errors.name} className="sm:col-span-2">
            <Input
              {...fieldAria("ln-name", errors.name)}
              className={TOUCH}
              value={form.name}
              disabled={readOnly}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field id="ln-qty" label={`Quantity (${unit})`} error={errors.quantity}>
            <div className="flex gap-2">
              <Input
                {...fieldAria("ln-qty", errors.quantity)}
                className={TOUCH}
                inputMode="decimal"
                value={form.quantity}
                disabled={readOnly}
                onChange={(e) => {
                  set("quantity", e.target.value);
                  setMeasurement(null);
                }}
              />
              {measurable && !readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  className={TOUCH}
                  aria-label="Measurement helper"
                  aria-pressed={measuring}
                  onClick={() => setMeasuring((v) => !v)}
                >
                  <Ruler aria-hidden />
                </Button>
              )}
            </div>
          </Field>
          {measuring && (
            <div className="sm:col-span-3">
              <MeasureHelper
                line={line}
                settings={settings}
                disabled={readOnly}
                onUse={(m, qty) => {
                  setMeasurement(m);
                  set("quantity", String(qty));
                  setMeasuring(false);
                }}
              />
            </div>
          )}

          {rate ? (
            <>
              <Choice
                id="ln-condition"
                label="Condition"
                value={form.condition}
                options={CONDITIONS}
                labels={CONDITION_LABELS}
                disabled={readOnly}
                onChange={(v) => set("condition", v)}
              />
              <Choice
                id="ln-prep"
                label="Prep"
                value={form.prep_level}
                options={PREP_LEVELS}
                labels={PREP_LEVEL_LABELS}
                disabled={readOnly}
                onChange={(v) => set("prep_level", v)}
              />
              <Choice
                id="ln-coats"
                label="Coats"
                value={form.coats}
                options={["1", "2", "3"] as const}
                labels={{ "1": "1 coat", "2": "2 coats", "3": "3 coats" }}
                disabled={readOnly}
                onChange={(v) => set("coats", v)}
              />
              <Choice
                id="ln-primer"
                label="Primer"
                value={form.primer}
                options={PRIMERS}
                labels={PRIMER_LABELS}
                disabled={readOnly}
                onChange={(v) => set("primer", v)}
              />
              <Choice
                id="ln-color"
                label="Color change"
                value={form.color_change}
                options={COLOR_CHANGES}
                labels={COLOR_CHANGE_LABELS}
                disabled={readOnly}
                onChange={(v) => set("color_change", v)}
              />
              <Choice
                id="ln-method"
                label="Method"
                value={form.method}
                options={METHODS}
                labels={METHOD_LABELS}
                disabled={readOnly}
                onChange={(v) => set("method", v)}
              />
              <Choice
                id="ln-access"
                label="Access"
                value={form.access}
                options={ACCESS_TYPES}
                labels={ACCESS_LABELS}
                disabled={readOnly}
                onChange={(v) => set("access", v)}
              />
              <Choice
                id="ln-height"
                label="Height"
                value={form.height}
                options={HEIGHTS}
                labels={HEIGHT_LABELS}
                disabled={readOnly}
                onChange={(v) => set("height", v)}
              />
              <Choice
                id="ln-sides"
                label="Sides"
                value={form.sides}
                options={["1", "2"] as const}
                labels={{ "1": "One side", "2": "Both sides" }}
                disabled={readOnly}
                onChange={(v) => set("sides", v)}
              />
              <Field id="ln-product" label="Paint" className="sm:col-span-2">
                <NativeSelect
                  id="ln-product"
                  value={form.paint_product_id}
                  disabled={readOnly}
                  onChange={(e) => set("paint_product_id", e.target.value)}
                >
                  <option value="">No paint (labor only)</option>
                  {paints.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.isSample ? " (sample)" : ""}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="ln-sheen" label="Sheen">
                <NativeSelect
                  id="ln-sheen"
                  value={form.sheen}
                  disabled={readOnly}
                  onChange={(e) => set("sheen", e.target.value)}
                >
                  <option value="">Not set</option>
                  {sheenChoices.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {form.primer !== "none" && (
                <Field id="ln-primer-product" label="Primer product" className="sm:col-span-2">
                  <NativeSelect
                    id="ln-primer-product"
                    value={form.primer_product_id}
                    disabled={readOnly}
                    onChange={(e) => set("primer_product_id", e.target.value)}
                  >
                    <option value="">Pick a primer</option>
                    {primers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
              <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={form.lead_safe}
                  disabled={readOnly}
                  onChange={(e) => set("lead_safe", e.target.checked)}
                />
                Lead-safe work practices (RRP) for this surface
              </label>
            </>
          ) : (
            <>
              <Field id="ln-price" label="Price per unit ($)" error={errors.unit_price}>
                <Input
                  {...fieldAria("ln-price", errors.unit_price)}
                  className={TOUCH}
                  inputMode="decimal"
                  value={form.unit_price}
                  disabled={readOnly}
                  onChange={(e) => set("unit_price", e.target.value)}
                />
              </Field>
              {showCost && (
                <Field id="ln-cost" label="Our cost per unit ($)" error={errors.unit_cost}>
                  <Input
                    {...fieldAria("ln-cost", errors.unit_cost)}
                    className={TOUCH}
                    inputMode="decimal"
                    value={form.unit_cost}
                    disabled={readOnly}
                    onChange={(e) => set("unit_cost", e.target.value)}
                  />
                </Field>
              )}
            </>
          )}

          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              className="size-5"
              checked={form.taxable}
              disabled={readOnly}
              onChange={(e) => set("taxable", e.target.checked)}
            />
            Taxable
          </label>

          <Field
            id="ln-override"
            label="Override price for this line ($)"
            description="Leave blank to use the computed price."
            error={errors.override_price}
          >
            <Input
              {...fieldAria("ln-override", errors.override_price, true)}
              className={TOUCH}
              inputMode="decimal"
              value={form.override_price}
              disabled={readOnly}
              onChange={(e) => set("override_price", e.target.value)}
            />
          </Field>
          <Field
            id="ln-override-reason"
            label="Why it's overridden"
            error={errors.override_reason}
            className="sm:col-span-2"
          >
            <Input
              {...fieldAria("ln-override-reason", errors.override_reason)}
              className={TOUCH}
              value={form.override_reason}
              disabled={readOnly || form.override_price.trim() === ""}
              onChange={(e) => set("override_reason", e.target.value)}
            />
          </Field>
          <Field
            id="ln-note"
            label="Note the customer sees"
            error={errors.customer_note}
            className="sm:col-span-3"
          >
            <Textarea
              {...fieldAria("ln-note", errors.customer_note)}
              rows={2}
              value={form.customer_note}
              disabled={readOnly}
              onChange={(e) => set("customer_note", e.target.value)}
            />
          </Field>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border bg-muted/40 p-3 text-sm sm:col-span-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Price</dt>
              <dd className="font-semibold tabular-nums">{formatCents(line.priceCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Computed</dt>
              <dd className="tabular-nums">{formatCents(line.computedPriceCents)}</dd>
            </div>
            {showCost && (
              <div>
                <dt className="text-xs text-muted-foreground">Our cost</dt>
                <dd className="tabular-nums">{formatCents(line.costCents)}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground">Labor / paint</dt>
              <dd className="tabular-nums">
                {line.laborHours ?? 0} h · {line.gallons ?? 0} gal
              </dd>
            </div>
          </dl>
          <p className="-mt-2 text-xs text-muted-foreground sm:col-span-3">
            Shown as last saved. Save to recalculate.
            {line.overridePriceCents !== null && (
              <Badge variant="warning" className="ml-2">
                Overridden
              </Badge>
            )}
          </p>

          <DialogFooter className="sm:col-span-3">
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                className={`${TOUCH} mr-auto text-danger`}
                disabled={pending}
                onClick={remove}
              >
                <Trash2 aria-hidden />
                Remove line
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className={TOUCH}
              onClick={() => onOpenChange(false)}
            >
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button type="submit" className={TOUCH} disabled={pending}>
                Save line
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
