"use client";

import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { savePolicies, saveSkill, saveWorkRule, saveWorkType } from "./actions";

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 rounded-2xl border bg-card p-5"
    >
      <h2 id={`${id}-title`} className="text-base font-semibold">
        {title}
      </h2>
      <p className="mt-0.5 mb-4 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

export type Policies = {
  productionDays: number[];
  dayStart: string;
  arrivalWindowMinutes: number;
  crewDayHours: number;
  requireApproval: boolean;
  autoExecute: boolean;
  undoWindowMinutes: number;
};

export function PoliciesForm({ initial }: { initial: Policies }) {
  const [v, setV] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  const set = <K extends keyof Policies>(k: K, value: Policies[K]) =>
    setV((x) => ({ ...x, [k]: value }));
  return (
    <Section
      id="policies"
      title="Operating hours & scheduling policies"
      description={
        <>
          Crew production days and arrival window (used in customer notices). Business hours for the
          speed-to-lead and estimate SLAs live in{" "}
          <Link className="text-bb-forest underline" href="/admin/company">
            Company Settings
          </Link>
          .
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => savePolicies(v), {
            success: "Scheduling policies saved.",
            onOk: () => setErrors({}),
            onError: (err) => setErrors(firstErrors(err)),
          });
        }}
      >
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">Production days</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map(([d, label]) => (
              <label key={d} className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                <input
                  type="checkbox"
                  className="size-4 accent-bb-forest"
                  checked={v.productionDays.includes(d)}
                  onChange={(e) =>
                    set(
                      "productionDays",
                      e.target.checked
                        ? [...v.productionDays, d]
                        : v.productionDays.filter((x) => x !== d),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          {errors.productionDays && (
            <p className="mt-1 text-xs text-danger">{errors.productionDays}</p>
          )}
        </fieldset>
        <Field
          id="day-start"
          label="Crews arrive from"
          error={errors.dayStart}
          description="Pacific time."
        >
          <Input
            type="time"
            value={v.dayStart}
            onChange={(e) => set("dayStart", e.target.value)}
            {...fieldAria("day-start", errors.dayStart, true)}
          />
        </Field>
        <Field
          id="arrival"
          label="Arrival window (minutes)"
          error={errors.arrivalWindowMinutes}
          description="“We'll arrive between 8:00–8:30 am.”"
        >
          <Input
            type="number"
            min={0}
            max={240}
            value={v.arrivalWindowMinutes}
            onChange={(e) => set("arrivalWindowMinutes", Number(e.target.value))}
            {...fieldAria("arrival", errors.arrivalWindowMinutes, true)}
          />
        </Field>
        <Field
          id="crew-day"
          label="Crew-day hours"
          error={errors.crewDayHours}
          description="Turns budgeted hours into production days."
        >
          <Input
            type="number"
            min={1}
            max={16}
            step={0.5}
            value={v.crewDayHours}
            onChange={(e) => set("crewDayHours", Number(e.target.value))}
            {...fieldAria("crew-day", errors.crewDayHours, true)}
          />
        </Field>
        <Field
          id="undo"
          label="Recommendation undo window (minutes)"
          error={errors.undoWindowMinutes}
        >
          <Input
            type="number"
            min={1}
            max={240}
            value={v.undoWindowMinutes}
            onChange={(e) => set("undoWindowMinutes", Number(e.target.value))}
            {...fieldAria("undo", errors.undoWindowMinutes)}
          />
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
          <Label htmlFor="require-approval">Recommendations require approval</Label>
          <Switch
            id="require-approval"
            checked={v.requireApproval}
            onCheckedChange={(c) => set("requireApproval", c)}
          />
        </div>
        <div className="flex flex-col gap-1 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="auto-execute">Recommendations run on their own</Label>
            <Switch
              id="auto-execute"
              checked={v.autoExecute}
              onCheckedChange={(c) => set("autoExecute", c)}
            />
          </div>
          {errors.autoExecute && <p className="text-xs text-danger">{errors.autoExecute}</p>}
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            Save policies
          </Button>
        </div>
      </form>
    </Section>
  );
}

export type SkillRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  isCertification: boolean;
  active: boolean;
};

export type WorkTypeRow = {
  key: string;
  label: string;
  defaultMinutes: number;
  assignedRole: "estimator" | "crew" | "pm";
  requiredSkillKey: string | null;
  isProduction: boolean;
  active: boolean;
};

const ROLE_LABELS = { estimator: "Estimator", crew: "Crew", pm: "PM" } as const;

function duration(min: number): string {
  if (min % 60 === 0) return `${min / 60} h`;
  return min > 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

function WorkTypeEditRow({ row, skills }: { row: WorkTypeRow; skills: SkillRow[] }) {
  const [v, setV] = React.useState(row);
  const { pending, run } = useRunAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(row);
  const id = `wt-${row.key}`;
  return (
    <tr className="border-t align-middle">
      <td className="py-2 pr-2">
        <label htmlFor={`${id}-label`} className="sr-only">
          Name
        </label>
        <Input
          id={`${id}-label`}
          value={v.label}
          onChange={(e) => setV({ ...v, label: e.target.value })}
        />
        <span className="text-xs text-muted-foreground">
          {row.isProduction ? "Production day" : "Appointment"} · default{" "}
          {duration(row.defaultMinutes)}
        </span>
      </td>
      <td className="py-2 pr-2">
        <label htmlFor={`${id}-min`} className="sr-only">
          Default minutes
        </label>
        <Input
          id={`${id}-min`}
          type="number"
          min={15}
          max={1440}
          step={15}
          className="w-24"
          value={v.defaultMinutes}
          onChange={(e) => setV({ ...v, defaultMinutes: Number(e.target.value) })}
        />
      </td>
      <td className="py-2 pr-2">
        <label htmlFor={`${id}-role`} className="sr-only">
          Assigned role
        </label>
        <NativeSelect
          id={`${id}-role`}
          value={v.assignedRole}
          onChange={(e) =>
            setV({ ...v, assignedRole: e.target.value as WorkTypeRow["assignedRole"] })
          }
        >
          {Object.entries(ROLE_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="py-2 pr-2">
        <label htmlFor={`${id}-skill`} className="sr-only">
          Required skill
        </label>
        <NativeSelect
          id={`${id}-skill`}
          value={v.requiredSkillKey ?? ""}
          onChange={(e) => setV({ ...v, requiredSkillKey: e.target.value || null })}
        >
          <option value="">No skill needed</option>
          {skills.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="py-2 pr-2">
        <Switch
          aria-label={`${row.label} active`}
          checked={v.active}
          onCheckedChange={(c) => setV({ ...v, active: c })}
        />
      </td>
      <td className="py-2 text-right">
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || pending}
          onClick={() => run(() => saveWorkType(v), { success: `${v.label} saved.` })}
        >
          Save
        </Button>
      </td>
    </tr>
  );
}

export function WorkTypesEditor({ rows, skills }: { rows: WorkTypeRow[]; skills: SkillRow[] }) {
  return (
    <Section
      id="work-types"
      title="Work types"
      description="Scheduling work types with default durations, who they're assigned to, and the skill a crew needs for them."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Work type</th>
              <th className="pb-2 font-medium">Minutes</th>
              <th className="pb-2 font-medium">Assigned to</th>
              <th className="pb-2 font-medium">Required skill</th>
              <th className="pb-2 font-medium">Active</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <WorkTypeEditRow key={r.key} row={r} skills={skills} />
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export type WorkRuleRow = {
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  severity: "block" | "warn";
  ownerOverride: boolean;
  requiresWeather: boolean;
  locked: boolean;
  params: Record<string, number | string>;
};

const PARAM_LABELS: Record<string, string> = {
  rain_percent: "Rain chance at or above (%)",
  min_stories: "Stories or more",
  skill: "Skill key",
};

function WorkRuleEditRow({ row }: { row: WorkRuleRow }) {
  const [v, setV] = React.useState(row);
  const { pending, run } = useRunAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(row);
  const id = `wr-${row.key}`;
  return (
    <li className="flex flex-col gap-3 border-t py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-label`} className="sr-only">
            Rule name
          </label>
          <Input
            id={`${id}-label`}
            value={v.label}
            onChange={(e) => setV({ ...v, label: e.target.value })}
            className="font-medium"
          />
          <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {row.requiresWeather && <Badge variant="neutral">Only when weather is connected</Badge>}
            {row.locked && (
              <Badge variant="neutral">
                <Lock aria-hidden /> Always on: holds stop scheduling
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${id}-on`} className="text-sm">
            On
          </Label>
          <Switch
            id={`${id}-on`}
            disabled={row.locked}
            checked={v.enabled}
            onCheckedChange={(c) => setV({ ...v, enabled: c })}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field id={`${id}-severity`} label="When it's broken" className="w-48">
          <NativeSelect
            id={`${id}-severity`}
            value={v.severity}
            onChange={(e) => setV({ ...v, severity: e.target.value === "warn" ? "warn" : "block" })}
          >
            <option value="block">Block publishing</option>
            <option value="warn">Warn only</option>
          </NativeSelect>
        </Field>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input
            type="checkbox"
            className="size-4 accent-bb-forest"
            checked={v.ownerOverride}
            onChange={(e) => setV({ ...v, ownerOverride: e.target.checked })}
          />
          Owners can override with a reason
        </label>
        {Object.entries(v.params)
          .filter(([k]) => k !== "skill")
          .map(([k, val]) => (
            <Field key={k} id={`${id}-${k}`} label={PARAM_LABELS[k] ?? k} className="w-44">
              <Input
                id={`${id}-${k}`}
                type="number"
                value={val}
                onChange={(e) =>
                  setV({ ...v, params: { ...v.params, [k]: Number(e.target.value) } })
                }
              />
            </Field>
          ))}
        <Button
          className="ml-auto"
          size="sm"
          variant="outline"
          disabled={!dirty || pending}
          onClick={() =>
            run(() => saveWorkRule({ ...v, description: v.description ?? undefined }), {
              success: "Rule saved.",
            })
          }
        >
          Save
        </Button>
      </div>
    </li>
  );
}

export function WorkRulesEditor({ rows }: { rows: WorkRuleRow[] }) {
  return (
    <Section
      id="work-rules"
      title="Work rules"
      description="The Master Schedule checks these on every draft and won't publish a change that breaks a blocking rule (owners can override the ones that allow it, with a reason)."
    >
      <ul>
        {rows.map((r) => (
          <WorkRuleEditRow key={r.key} row={r} />
        ))}
      </ul>
    </Section>
  );
}

function SkillEditRow({ row }: { row: SkillRow }) {
  const [v, setV] = React.useState(row);
  const { pending, run } = useRunAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(row);
  return (
    <tr className="border-t">
      <td className="py-2 pr-2">
        <label htmlFor={`sk-${row.id}`} className="sr-only">
          Skill name
        </label>
        <Input
          id={`sk-${row.id}`}
          value={v.label}
          onChange={(e) => setV({ ...v, label: e.target.value })}
        />
      </td>
      <td className="py-2 pr-2">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-bb-forest"
            checked={v.isCertification}
            onChange={(e) => setV({ ...v, isCertification: e.target.checked })}
          />
          Certificate with expiry
        </label>
      </td>
      <td className="py-2 pr-2">
        <Switch
          aria-label={`${row.label} active`}
          checked={v.active}
          onCheckedChange={(c) => setV({ ...v, active: c })}
        />
      </td>
      <td className="py-2 text-right">
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || pending}
          onClick={() =>
            run(() => saveSkill({ ...v, description: v.description ?? undefined }), {
              success: "Skill saved.",
            })
          }
        >
          Save
        </Button>
      </td>
    </tr>
  );
}

export function SkillsEditor({ rows }: { rows: SkillRow[] }) {
  const [label, setLabel] = React.useState("");
  const [cert, setCert] = React.useState(false);
  const { pending, run } = useRunAction();
  return (
    <Section
      id="skills"
      title="Skills"
      description="Skills crews can have. The scheduler matches them to each job (spray for cabinets, high access for 2-story exteriors, a certified renovator for pre-1978 homes)."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Skill</th>
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 font-medium">Active</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SkillEditRow key={r.id} row={r} />
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveSkill({ label, isCertification: cert, active: true }), {
            success: "Skill added.",
            onOk: () => {
              setLabel("");
              setCert(false);
            },
          });
        }}
      >
        <Field id="new-skill" label="New skill" className="w-64">
          <Input
            id="new-skill"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Wallpaper removal"
          />
        </Field>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input
            type="checkbox"
            className="size-4 accent-bb-forest"
            checked={cert}
            onChange={(e) => setCert(e.target.checked)}
          />
          Certificate with expiry
        </label>
        <Button type="submit" variant="outline" disabled={pending || label.trim().length === 0}>
          Add skill
        </Button>
      </form>
    </Section>
  );
}

export type ChecklistTemplateView = {
  id: string;
  name: string;
  appliesTo: string;
  active: boolean;
  items: string[];
};

export function ChecklistTemplates({ rows }: { rows: ChecklistTemplateView[] }) {
  return (
    <Section
      id="checklists"
      title="Checklist templates"
      description="Added to work orders by work type (lead-safe on pre-1978 homes) and used on the job's Tasks & Checklists section."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((t) => (
          <div key={t.id} className="rounded-xl border p-3">
            <p className="font-medium">{t.name}</p>
            <ol className="mt-2 list-decimal pl-5 text-sm text-muted-foreground">
              {t.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </Section>
  );
}
