"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection } from "@/components/forms/field";
import { NativeSelect, TOUCH } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import {
  ACCESS_LABELS,
  ACCESS_TYPES,
  COLOR_CHANGE_ACTIONS,
  COLOR_CHANGE_ACTION_LABELS,
  DRAFT_BADGE,
  HEIGHTS,
  HEIGHT_LABELS,
  PREP_LEVELS,
  PREP_LEVEL_LABELS,
  type ColorChangeAction,
  type Guarantee,
  type InclusionWorkType,
  type PricingJson,
  type TaxSettings,
} from "@/lib/estimating/engine";
import { saveEstimateSetup, saveGuarantees, saveInclusions } from "./actions";

type Num = string;

function NumField({
  id,
  label,
  value,
  onChange,
  help,
  error,
}: {
  id: string;
  label: string;
  value: Num;
  onChange: (v: Num) => void;
  help?: string;
  error?: string;
}) {
  return (
    <Field id={id} label={label} description={help} error={error}>
      <Input
        id={id}
        className={TOUCH}
        inputMode="decimal"
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

const s = (n: number) => String(n);
const dollars = (c: number) => (c / 100).toFixed(2);

export function PricingForm({
  pricing,
  tax,
  roles,
}: {
  pricing: PricingJson;
  tax: TaxSettings;
  roles: { key: string; name: string; limit: number }[];
}) {
  const [f, setF] = React.useState({
    labor: dollars(pricing.loaded_labor_rate_cents),
    sundries: s(pricing.sundries_percent),
    waste: s(pricing.waste_percent),
    margin: s(pricing.target_margin_percent),
    floor: s(pricing.margin_floor_percent),
    minimum: dollars(pricing.minimum_job_cents),
    height: Object.fromEntries(HEIGHTS.map((h) => [h, s(pricing.height_multipliers[h])])),
    access: Object.fromEntries(ACCESS_TYPES.map((a) => [a, s(pricing.access_multipliers[a])])),
    coats: {
      "1": s(pricing.coat_factors["1"]),
      "2": s(pricing.coat_factors["2"]),
      "3": s(pricing.coat_factors["3"]),
    },
    prep: Object.fromEntries(PREP_LEVELS.map((p) => [p, s(pricing.prep_level_factors[p])])),
    spot: s(pricing.spot_primer_fraction),
    lightToDark: pricing.color_change_rule.light_to_dark,
    darkToLight: pricing.color_change_rule.dark_to_light,
    leadSafe: s(pricing.lead_safe_labor_percent),
    rrp: dollars(pricing.rrp_supplies_cost_cents),
    crew: s(pricing.crew_size),
    hours: s(pricing.hours_per_crew_day),
    door: s(pricing.door_deduction_sqft),
    window: s(pricing.window_deduction_sqft),
    gable: s(pricing.gable_factor),
    roles: Object.fromEntries(roles.map((r) => [r.key, s(r.limit)])),
    taxRate: s(tax.ratePercent),
    taxDefault: tax.defaultTaxable,
    taxConfirmed: tax.confirmedWithAccountant,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  const n = (v: string) => Number(v);
  const c = (v: string) => Math.round(Number(v) * 100);
  const map = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, n(v)]));
  const err = (path: string) => errors[`pricing.${path}`];

  const submit = () => {
    setErrors({});
    run(
      () =>
        saveEstimateSetup({
          pricing: {
            loaded_labor_rate_cents: c(f.labor),
            sundries_percent: n(f.sundries),
            waste_percent: n(f.waste),
            target_margin_percent: n(f.margin),
            margin_floor_percent: n(f.floor),
            minimum_job_cents: c(f.minimum),
            height_multipliers: map(f.height) as PricingJson["height_multipliers"],
            access_multipliers: map(f.access) as PricingJson["access_multipliers"],
            coat_factors: map(f.coats) as PricingJson["coat_factors"],
            prep_level_factors: map(f.prep) as PricingJson["prep_level_factors"],
            spot_primer_fraction: n(f.spot),
            color_change_rule: { light_to_dark: f.lightToDark, dark_to_light: f.darkToLight },
            lead_safe_labor_percent: n(f.leadSafe),
            rrp_supplies_cost_cents: c(f.rrp),
            crew_size: n(f.crew),
            hours_per_crew_day: n(f.hours),
            door_deduction_sqft: n(f.door),
            window_deduction_sqft: n(f.window),
            gable_factor: n(f.gable),
          },
          discount_limits: { roles: map(f.roles) },
          tax: {
            rate_percent: f.taxRate,
            default_taxable: f.taxDefault,
            confirmed_with_accountant: f.taxConfirmed,
          },
        }),
      { success: "Estimate Setup saved.", onError: (e) => setErrors(firstErrors(e)) },
    );
  };
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form
      aria-label="Pricing"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormSection title="Labor and margin" description="Price = cost ÷ (1 − target margin).">
        <NumField
          id="es-labor"
          label="Loaded labor rate ($ per hour)"
          help="Wages + payroll taxes + insurance."
          value={f.labor}
          onChange={(v) => setF({ ...f, labor: v })}
          error={err("loaded_labor_rate_cents")}
        />
        <NumField
          id="es-sundries"
          label="Sundries (% of labor cost)"
          value={f.sundries}
          onChange={(v) => setF({ ...f, sundries: v })}
          error={err("sundries_percent")}
        />
        <NumField
          id="es-waste"
          label="Paint waste (% of gallons)"
          value={f.waste}
          onChange={(v) => setF({ ...f, waste: v })}
          error={err("waste_percent")}
        />
        <NumField
          id="es-margin"
          label="Target gross margin (%)"
          value={f.margin}
          onChange={(v) => setF({ ...f, margin: v })}
          error={err("target_margin_percent")}
        />
        <NumField
          id="es-floor"
          label="Margin floor (%)"
          help="The builder warns below this."
          value={f.floor}
          onChange={(v) => setF({ ...f, floor: v })}
          error={err("margin_floor_percent")}
        />
        <NumField
          id="es-min"
          label="Minimum job ($)"
          value={f.minimum}
          onChange={(v) => setF({ ...f, minimum: v })}
          error={err("minimum_job_cents")}
        />
      </FormSection>
      <FormSection title="Multipliers" description="Applied to labor hours.">
        {HEIGHTS.map((h) => (
          <NumField
            key={h}
            id={`es-h-${h}`}
            label={`Height: ${HEIGHT_LABELS[h]}`}
            value={f.height[h] ?? ""}
            onChange={(v) => setF({ ...f, height: { ...f.height, [h]: v } })}
            error={err(`height_multipliers.${h}`)}
          />
        ))}
        {ACCESS_TYPES.map((a) => (
          <NumField
            key={a}
            id={`es-a-${a}`}
            label={`Access: ${ACCESS_LABELS[a]}`}
            value={f.access[a] ?? ""}
            onChange={(v) => setF({ ...f, access: { ...f.access, [a]: v } })}
            error={err(`access_multipliers.${a}`)}
          />
        ))}
        {(["1", "2", "3"] as const).map((k) => (
          <NumField
            key={k}
            id={`es-c-${k}`}
            label={`${k} coat${k === "1" ? "" : "s"} (labor factor)`}
            value={f.coats[k]}
            onChange={(v) => setF({ ...f, coats: { ...f.coats, [k]: v } })}
            error={err(`coat_factors.${k}`)}
          />
        ))}
        {PREP_LEVELS.map((p) => (
          <NumField
            key={p}
            id={`es-p-${p}`}
            label={`Prep: ${PREP_LEVEL_LABELS[p]}`}
            value={f.prep[p] ?? ""}
            onChange={(v) => setF({ ...f, prep: { ...f.prep, [p]: v } })}
            error={err(`prep_level_factors.${p}`)}
          />
        ))}
        <NumField
          id="es-spot"
          label="Spot primer covers (0–1 of the area)"
          value={f.spot}
          onChange={(v) => setF({ ...f, spot: v })}
          error={err("spot_primer_fraction")}
        />
      </FormSection>
      <FormSection title="Color changes and lead-safe work">
        <Field id="es-ltd" label="Light → dark">
          <NativeSelect
            id="es-ltd"
            value={f.lightToDark}
            onChange={(e) => setF({ ...f, lightToDark: e.target.value as ColorChangeAction })}
          >
            {COLOR_CHANGE_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {COLOR_CHANGE_ACTION_LABELS[a]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="es-dtl" label="Dark → light">
          <NativeSelect
            id="es-dtl"
            value={f.darkToLight}
            onChange={(e) => setF({ ...f, darkToLight: e.target.value as ColorChangeAction })}
          >
            {COLOR_CHANGE_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {COLOR_CHANGE_ACTION_LABELS[a]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <NumField
          id="es-ls"
          label="Lead-safe labor (% added)"
          value={f.leadSafe}
          onChange={(v) => setF({ ...f, leadSafe: v })}
          error={err("lead_safe_labor_percent")}
        />
        <NumField
          id="es-rrp"
          label="RRP supplies per job ($ cost)"
          value={f.rrp}
          onChange={(v) => setF({ ...f, rrp: v })}
          error={err("rrp_supplies_cost_cents")}
        />
      </FormSection>
      <FormSection title="Crew and measuring">
        <NumField
          id="es-crew"
          label="Crew size"
          value={f.crew}
          onChange={(v) => setF({ ...f, crew: v })}
          error={err("crew_size")}
        />
        <NumField
          id="es-hours"
          label="Hours per crew day"
          value={f.hours}
          onChange={(v) => setF({ ...f, hours: v })}
          error={err("hours_per_crew_day")}
        />
        <NumField
          id="es-door"
          label="Door deduction (sq ft)"
          value={f.door}
          onChange={(v) => setF({ ...f, door: v })}
          error={err("door_deduction_sqft")}
        />
        <NumField
          id="es-window"
          label="Window deduction (sq ft)"
          value={f.window}
          onChange={(v) => setF({ ...f, window: v })}
          error={err("window_deduction_sqft")}
        />
        <NumField
          id="es-gable"
          label="Default gable factor"
          value={f.gable}
          onChange={(v) => setF({ ...f, gable: v })}
          error={err("gable_factor")}
        />
      </FormSection>
      <FormSection
        title="Discount limits"
        description="How far below the computed price each role can go without an owner's approval (%). Owners have no limit."
      >
        {roles.map((r) => (
          <NumField
            key={r.key}
            id={`es-r-${r.key}`}
            label={r.name}
            value={f.roles[r.key] ?? "0"}
            onChange={(v) => setF({ ...f, roles: { ...f.roles, [r.key]: v } })}
            error={errors[`discount_limits.roles.${r.key}`]}
          />
        ))}
      </FormSection>
      <FormSection
        title="Sales tax"
        description="Leave at 0% until your accountant confirms how Washington sales tax applies to your work."
      >
        <NumField
          id="es-tax"
          label="Tax rate (%)"
          value={f.taxRate}
          onChange={(v) => setF({ ...f, taxRate: v })}
          error={errors["tax.rate_percent"]}
        />
        <div className="flex flex-col justify-end gap-1">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={f.taxDefault}
              onChange={(e) => setF({ ...f, taxDefault: e.target.checked })}
            />
            New lines are taxable by default
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={f.taxConfirmed}
              onChange={(e) => setF({ ...f, taxConfirmed: e.target.checked })}
            />
            Confirmed with our accountant
          </label>
        </div>
      </FormSection>
      {hasErrors && (
        <p role="alert" className="text-sm text-danger">
          Some fields need attention.
        </p>
      )}
      <div>
        <Button type="submit" className={TOUCH} disabled={pending}>
          Save Estimate Setup
        </Button>
      </div>
    </form>
  );
}

export function InclusionsForm({
  workType,
  label,
  items,
  approved,
  fromWebsite,
}: {
  workType: InclusionWorkType;
  label: string;
  items: string[];
  approved: boolean;
  fromWebsite: boolean;
}) {
  const [text, setText] = React.useState(items.join("\n"));
  const [ok, setOk] = React.useState(approved);
  const { pending, run } = useRunAction();
  const id = `inc-${workType}`;
  return (
    <form
      aria-label={`What's included: ${label}`}
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveInclusions({
              work_type: workType,
              items: text
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
              approved: ok,
            }),
          { success: `${label} list saved.` },
        );
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{label}</h3>
        {fromWebsite && <Badge variant="info">From the website</Badge>}
        {!ok && <Badge variant="sample">{DRAFT_BADGE}</Badge>}
      </div>
      <Field id={id} label="Items (one per line)">
        <Textarea id={id} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={ok}
          onChange={(e) => setOk(e.target.checked)}
        />
        Approved to show customers without the draft label
      </label>
      <Button type="submit" variant="outline" className={`${TOUCH} w-fit`} disabled={pending}>
        Save
      </Button>
    </form>
  );
}

export function GuaranteesForm({
  guarantees,
  approved,
  leadSafeDisclosure,
}: {
  guarantees: Guarantee[];
  approved: boolean;
  leadSafeDisclosure: string;
}) {
  const [list, setList] = React.useState(guarantees);
  const [ok, setOk] = React.useState(approved);
  const [disclosure, setDisclosure] = React.useState(leadSafeDisclosure);
  const { pending, run } = useRunAction();
  const update = (i: number, patch: Partial<Guarantee>) =>
    setList((l) => l.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <form
      aria-label="Guarantees and disclosures"
      className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveGuarantees({ guarantees: list, approved: ok, lead_safe_disclosure: disclosure }),
          {
            success: "Guarantees saved.",
          },
        );
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Guarantees</h2>
        {!ok && <Badge variant="sample">{DRAFT_BADGE}</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        Merge fields like {"{{company.on_time_guarantee}}"} fill in from Company Settings.
      </p>
      <ul className="flex flex-col gap-3">
        {list.map((g, i) => (
          <li
            key={g.key}
            className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-start"
          >
            <Field id={`g-t-${g.key}`} label="Title">
              <Input
                id={`g-t-${g.key}`}
                className={TOUCH}
                value={g.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />
            </Field>
            <Field id={`g-b-${g.key}`} label="What we promise">
              <Textarea
                id={`g-b-${g.key}`}
                rows={2}
                value={g.body}
                onChange={(e) => update(i, { body: e.target.value })}
              />
            </Field>
            <label className="flex min-h-11 items-center gap-2 pt-6 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={g.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
              />
              Show
            </label>
          </li>
        ))}
      </ul>
      <Field
        id="g-ls"
        label="Lead-safe disclosure (shown when a pre-1978 home gets lead-safe work)"
      >
        <Textarea
          id="g-ls"
          rows={4}
          value={disclosure}
          onChange={(e) => setDisclosure(e.target.value)}
        />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={ok}
          onChange={(e) => setOk(e.target.checked)}
        />
        Owner approved
      </label>
      <Button type="submit" className={`${TOUCH} w-fit`} disabled={pending}>
        Save guarantees
      </Button>
    </form>
  );
}
