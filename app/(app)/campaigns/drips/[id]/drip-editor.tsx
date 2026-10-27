"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/forms/native-select";
import { Field } from "@/components/forms/field";
import { useRunAction } from "@/components/forms/use-run-action";
import {
  DRIP_EXIT_CONDITIONS,
  validateDripSteps,
  type DripChannel,
  type DripExitCondition,
  type DripStep,
} from "@/lib/domain/drips";
import { cancelEnrollment, saveDrip } from "../../actions";

const CHANNELS: { value: DripChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "sms", label: "Text" },
  { value: "email_or_sms", label: "Email, else text" },
  { value: "sms_or_email", label: "Text, else email" },
];

export function DripEditor({
  drip,
  templates,
  readOnly,
}: {
  drip: {
    id: string;
    name: string;
    description: string;
    active: boolean;
    steps: DripStep[];
    exitConditions: string[];
  };
  templates: { key: string; name: string }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [v, setV] = React.useState(drip);
  const disabled = pending || readOnly;
  const errors = validateDripSteps(v.steps).errors;
  const setStep = (i: number, patch: Partial<DripStep>) =>
    setV((x) => ({ ...x, steps: x.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field id="d-name" label="Name">
          <Input
            id="d-name"
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
            maxLength={120}
            disabled={disabled}
          />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <Switch
            checked={v.active}
            onCheckedChange={(c) => setV({ ...v, active: c })}
            disabled={disabled}
            aria-label="Drip on"
          />
          {v.active ? "On" : "Off: nobody new is enrolled and people in it stop at their next step"}
        </label>
      </div>
      <Field id="d-desc" label="Description">
        <Textarea
          id="d-desc"
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value })}
          rows={2}
          maxLength={1000}
          disabled={disabled}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Steps</legend>
        {v.steps.map((s, i) => {
          const byDate = typeof s.on_date === "string";
          return (
            <div
              key={i}
              className="grid items-end gap-2 rounded-xl border p-3 md:grid-cols-[2rem_9rem_8rem_10rem_minmax(0,1fr)_auto]"
              role="group"
              aria-label={`Step ${i + 1}`}
            >
              <span className="pb-2 text-sm font-semibold">{i + 1}.</span>
              <Field id={`d-when-${i}`} label="When">
                <NativeSelect
                  id={`d-when-${i}`}
                  value={byDate ? "date" : "delay"}
                  disabled={disabled}
                  onChange={(e) =>
                    setStep(
                      i,
                      e.target.value === "date"
                        ? { on_date: "03-01", delay_days: undefined }
                        : { delay_days: 7, on_date: undefined },
                    )
                  }
                >
                  <option value="delay">Days after</option>
                  <option value="date">On a date</option>
                </NativeSelect>
              </Field>
              {byDate ? (
                <Field id={`d-date-${i}`} label="MM-DD">
                  <Input
                    id={`d-date-${i}`}
                    value={s.on_date ?? ""}
                    onChange={(e) => setStep(i, { on_date: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
              ) : (
                <Field
                  id={`d-days-${i}`}
                  label={i === 0 ? "Days after enrolling" : "Days after last"}
                >
                  <Input
                    id={`d-days-${i}`}
                    type="number"
                    min={0}
                    max={365}
                    value={s.delay_days ?? 0}
                    onChange={(e) => setStep(i, { delay_days: Number(e.target.value) })}
                    disabled={disabled}
                  />
                </Field>
              )}
              <Field id={`d-ch-${i}`} label="Channel">
                <NativeSelect
                  id={`d-ch-${i}`}
                  value={s.channel}
                  onChange={(e) => setStep(i, { channel: e.target.value as DripChannel })}
                  disabled={disabled}
                >
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id={`d-tpl-${i}`} label="Template">
                <NativeSelect
                  id={`d-tpl-${i}`}
                  value={s.template_key}
                  onChange={(e) => setStep(i, { template_key: e.target.value })}
                  disabled={disabled}
                >
                  <option value="">Choose…</option>
                  {templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove step ${i + 1}`}
                disabled={disabled || v.steps.length <= 1}
                onClick={() => setV({ ...v, steps: v.steps.filter((_, j) => j !== i) })}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          disabled={disabled || v.steps.length >= 20}
          onClick={() =>
            setV({
              ...v,
              steps: [...v.steps, { delay_days: 7, channel: "email", template_key: "" }],
            })
          }
        >
          <Plus className="size-4" aria-hidden /> Add step
        </Button>
        {errors.length > 0 && (
          <ul className="text-sm text-danger" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Stop the drip when</legend>
        {(Object.keys(DRIP_EXIT_CONDITIONS) as DripExitCondition[]).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={v.exitConditions.includes(k)}
              disabled={disabled || k === "opted_out"}
              onCheckedChange={(c) =>
                setV({
                  ...v,
                  exitConditions:
                    c === true ? [...v.exitConditions, k] : v.exitConditions.filter((x) => x !== k),
                })
              }
            />
            {DRIP_EXIT_CONDITIONS[k]}
            {k === "opted_out" ? " (always)" : ""}
          </label>
        ))}
      </fieldset>
      <Button
        type="button"
        className="self-start"
        disabled={disabled || errors.length > 0}
        onClick={() =>
          run(
            () =>
              saveDrip({
                id: v.id,
                name: v.name,
                description: v.description,
                active: v.active,
                steps: v.steps,
                exitConditions: [
                  ...new Set([...v.exitConditions, "opted_out"]),
                ] as DripExitCondition[],
              }),
            { success: "Drip saved.", onOk: () => router.refresh() },
          )
        }
      >
        <Save className="size-4" aria-hidden /> Save drip
      </Button>
    </div>
  );
}

export function CancelEnrollmentButton({
  id,
  name,
  readOnly,
}: {
  id: string;
  name: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending || readOnly}
      aria-label={`Stop the drip for ${name}`}
      onClick={() =>
        run(() => cancelEnrollment({ id }), {
          success: "Stopped.",
          onOk: () => router.refresh(),
        })
      }
    >
      Stop
    </Button>
  );
}
