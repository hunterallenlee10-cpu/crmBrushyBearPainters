"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/forms/native-select";
import { Field } from "@/components/forms/field";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { DISPOSITION_GROUP_LABELS, type DispositionGroup } from "@/lib/domain/follow-ups";
import type { ListRow } from "@/lib/follow-ups/lists";
import { saveDispositionSchema, updateListSchema } from "@/lib/validation/follow-ups";
import { saveDisposition, updateFollowUpList } from "@/app/(app)/follow-ups/actions";

function issues(list: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of list) out[String(i.path[0] ?? "_form")] ??= i.message;
  return out;
}

export function ListSettingsForm({ list, readOnly }: { list: ListRow; readOnly: boolean }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [active, setActive] = React.useState(list.active);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const id = `list-${list.key}`;
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = updateListSchema.safeParse({
      key: list.key,
      name: f.get("name"),
      description: f.get("description"),
      script: f.get("script"),
      cooldownHours: f.get("cooldown"),
      active,
    });
    if (!parsed.success) return setErrors(issues(parsed.error.issues));
    setErrors({});
    run(() => updateFollowUpList(parsed.data), {
      success: `${parsed.data.name} saved.`,
      onOk: () => router.refresh(),
      onError: (err) => setErrors(firstErrors(err)),
    });
  }
  const disabled = pending || readOnly;
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={list.name}
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="text-xs text-muted-foreground">{list.key}</code>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={active}
            onCheckedChange={setActive}
            disabled={disabled}
            aria-label={`${list.name} on`}
          />
          {active ? "On" : "Off"}
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
        <Field id={`${id}-name`} label="Name" error={errors.name}>
          <Input
            id={`${id}-name`}
            name="name"
            defaultValue={list.name}
            maxLength={120}
            disabled={disabled}
          />
        </Field>
        <Field id={`${id}-cooldown`} label="Rest after a call (hours)" error={errors.cooldownHours}>
          <Input
            id={`${id}-cooldown`}
            name="cooldown"
            type="number"
            min={0}
            max={8760}
            defaultValue={list.cooldownHours}
            disabled={disabled}
          />
        </Field>
      </div>
      <Field id={`${id}-description`} label="Who's on it">
        <Input
          id={`${id}-description`}
          name="description"
          defaultValue={list.description}
          maxLength={500}
          disabled={disabled}
        />
      </Field>
      <Field id={`${id}-script`} label="Call script" error={errors.script}>
        <Textarea
          id={`${id}-script`}
          name="script"
          defaultValue={list.script}
          rows={4}
          maxLength={5000}
          disabled={disabled}
        />
      </Field>
      <Button type="submit" size="sm" disabled={disabled} className="self-start">
        <Save className="size-4" aria-hidden /> Save
      </Button>
    </form>
  );
}

type DispositionRow = {
  id?: string;
  key: string;
  label: string;
  group: DispositionGroup;
  leadDisposition: string;
  requiresCallback: boolean;
  setsDoNotContact: boolean;
  active: boolean;
};

function DispositionForm({
  row,
  groups,
  leadDispositions,
  readOnly,
  onDone,
}: {
  row: DispositionRow;
  groups: DispositionGroup[];
  leadDispositions: { value: string; label: string }[];
  readOnly: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [v, setV] = React.useState(row);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const id = `disp-${row.id ?? "new"}`;
  const disabled = pending || readOnly;
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = saveDispositionSchema.safeParse({
      id: v.id,
      key: v.id ? undefined : v.key,
      label: v.label,
      group: v.group,
      leadDisposition: v.leadDisposition,
      requiresCallback: v.requiresCallback,
      setsDoNotContact: v.setsDoNotContact,
      active: v.active,
    });
    if (!parsed.success) return setErrors(issues(parsed.error.issues));
    setErrors({});
    run(() => saveDisposition(parsed.data), {
      success: `${v.label} saved.`,
      onOk: () => {
        router.refresh();
        onDone?.();
      },
      onError: (err) => setErrors(firstErrors(err)),
    });
  }
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={row.id ? row.label : "New disposition"}
      className="grid items-end gap-2 border-b px-4 py-3 last:border-0 md:grid-cols-[minmax(0,1fr)_9rem_minmax(0,11rem)_auto_auto_auto_auto]"
    >
      {!row.id && (
        <Field id={`${id}-key`} label="Key" error={errors.key}>
          <Input
            id={`${id}-key`}
            value={v.key}
            onChange={(e) => setV({ ...v, key: e.target.value })}
            disabled={disabled}
          />
        </Field>
      )}
      <Field id={`${id}-label`} label="Label" error={errors.label}>
        <Input
          id={`${id}-label`}
          value={v.label}
          onChange={(e) => setV({ ...v, label: e.target.value })}
          maxLength={80}
          disabled={disabled}
        />
      </Field>
      <Field id={`${id}-group`} label="Group">
        <NativeSelect
          id={`${id}-group`}
          value={v.group}
          onChange={(e) => setV({ ...v, group: e.target.value as DispositionGroup })}
          disabled={disabled}
        >
          {groups.map((g) => (
            <option key={g} value={g}>
              {DISPOSITION_GROUP_LABELS[g]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-lead`} label="Sets lead disposition">
        <NativeSelect
          id={`${id}-lead`}
          value={v.leadDisposition}
          onChange={(e) => setV({ ...v, leadDisposition: e.target.value })}
          disabled={disabled}
        >
          <option value="">Nothing</option>
          {leadDispositions.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <Switch
          checked={v.requiresCallback}
          onCheckedChange={(c) => setV({ ...v, requiresCallback: c })}
          disabled={disabled}
          aria-label={`${v.label || "New"}: needs a callback time`}
        />
        Callback
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <Switch
          checked={v.setsDoNotContact}
          onCheckedChange={(c) => setV({ ...v, setsDoNotContact: c })}
          disabled={disabled}
          aria-label={`${v.label || "New"}: marks Do Not Contact`}
        />
        DNC
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <Switch
          checked={v.active}
          onCheckedChange={(c) => setV({ ...v, active: c })}
          disabled={disabled}
          aria-label={`${v.label || "New"}: on`}
        />
        On
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={disabled}>
        <Save className="size-4" aria-hidden /> Save
      </Button>
    </form>
  );
}

export function DispositionsEditor({
  rows,
  groups,
  leadDispositions,
  readOnly,
}: {
  rows: DispositionRow[];
  groups: DispositionGroup[];
  leadDispositions: { value: string; label: string }[];
  readOnly: boolean;
}) {
  const [adding, setAdding] = React.useState(false);
  return (
    <div className="rounded-2xl border bg-card">
      {groups.map((g) => {
        const inGroup = rows.filter((r) => r.group === g);
        if (!inGroup.length) return null;
        return (
          <div key={g}>
            <h3 className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">
              {DISPOSITION_GROUP_LABELS[g]}
            </h3>
            {inGroup.map((r) => (
              <DispositionForm
                key={r.id}
                row={r}
                groups={groups}
                leadDispositions={leadDispositions}
                readOnly={readOnly}
              />
            ))}
          </div>
        );
      })}
      <div className="p-4">
        {adding ? (
          <DispositionForm
            row={{
              key: "",
              label: "",
              group: "positive",
              leadDisposition: "",
              requiresCallback: false,
              setsDoNotContact: false,
              active: true,
            }}
            groups={groups}
            leadDispositions={leadDispositions}
            readOnly={readOnly}
            onDone={() => setAdding(false)}
          />
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAdding(true)}
            disabled={readOnly}
          >
            <Plus className="size-4" aria-hidden /> Add a disposition
          </Button>
        )}
      </div>
    </div>
  );
}
