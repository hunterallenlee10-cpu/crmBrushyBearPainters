"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import {
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  RULE_TYPES,
  RULE_TYPE_LABELS,
  moveSection,
  toApiName,
  toOptionValue,
  type CustomFieldDef,
  type CustomFieldModule,
  type CustomFieldType,
  type ResolvedSection,
  type RuleType,
  type ValidationRule,
} from "@/lib/domain/custom-fields";
import {
  deleteValidationRule,
  reorderCustomFields,
  saveCustomField,
  saveLayout,
  saveValidationRule,
} from "./actions";

type Props = {
  module: CustomFieldModule;
  moduleLabel: string;
  fields: CustomFieldDef[];
  rules: ValidationRule[];
  layout: ResolvedSection[];
  standardFields: { key: string; label: string }[];
  readOnly: boolean;
};

export function ModuleManager(props: Props) {
  return (
    <Tabs defaultValue="fields" className="gap-4">
      <TabsList aria-label="Module Manager sections" className="h-auto! w-full flex-wrap sm:w-fit">
        <TabsTrigger value="fields" className="min-h-11 sm:min-h-8">
          Custom fields ({props.fields.length})
        </TabsTrigger>
        <TabsTrigger value="layout" className="min-h-11 sm:min-h-8">
          Page layout
        </TabsTrigger>
        <TabsTrigger value="rules" className="min-h-11 sm:min-h-8">
          Validation rules ({props.rules.length})
        </TabsTrigger>
      </TabsList>
      <TabsContent value="fields">
        <FieldsTab {...props} />
      </TabsContent>
      <TabsContent value="layout">
        <LayoutTab {...props} />
      </TabsContent>
      <TabsContent value="rules">
        <RulesTab {...props} />
      </TabsContent>
    </Tabs>
  );
}

// --- Custom fields -----------------------------------------------------------------------

function FieldsTab({ module, moduleLabel, fields, readOnly }: Props) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [editing, setEditing] = React.useState<CustomFieldDef | "new" | null>(null);

  function move(index: number, to: number) {
    const ids = moveSection(fields, index, to).map((f) => f.id);
    run(() => reorderCustomFields({ module, ids }), { onOk: () => router.refresh() });
  }

  return (
    <section className="rounded-2xl border bg-card p-5" aria-labelledby="cf-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="cf-heading" className="text-base font-semibold">
            {moduleLabel}: custom fields
          </h2>
          <p className="text-sm text-muted-foreground">
            They show in the “More fields” card on each{" "}
            {moduleLabel.toLowerCase().replace(/s$/, "")} page, and in the list’s Columns and
            Advanced filter.
          </p>
        </div>
        {!readOnly && (
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add field
          </Button>
        )}
      </div>
      {fields.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No custom fields yet. Add one for anything the standard fields don’t cover, like a permit
          number or a preferred paint brand.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {fields.map((f, i) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {f.label}
                  {f.required && <span className="sr-only"> (required)</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {CUSTOM_FIELD_TYPE_LABELS[f.type]} · <code>{f.apiName}</code>
                  {f.options.length > 0 && ` · ${f.options.length} options`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {f.required && <Badge variant="info">Required</Badge>}
                {f.showInList && <Badge variant="neutral">In list</Badge>}
                {!f.active && <Badge variant="warning">Off</Badge>}
              </div>
              {!readOnly && (
                <div className="flex gap-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move ${f.label} up`}
                    disabled={i === 0 || pending}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move ${f.label} down`}
                    disabled={i === fields.length - 1 || pending}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(f)}>
                    <Pencil aria-hidden /> Edit
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <FieldDialog
          module={module}
          field={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function FieldDialog({
  module,
  field,
  onClose,
  onSaved,
}: {
  module: CustomFieldModule;
  field: CustomFieldDef | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pending, run } = useRunAction();
  const [label, setLabel] = React.useState(field?.label ?? "");
  const [apiName, setApiName] = React.useState(field?.apiName ?? "");
  const [apiTouched, setApiTouched] = React.useState(Boolean(field));
  const [type, setType] = React.useState<CustomFieldType>(field?.type ?? "text");
  const [options, setOptions] = React.useState(
    (field?.options ?? []).map((o) => o.label).join("\n"),
  );
  const [required, setRequired] = React.useState(field?.required ?? false);
  const [showInList, setShowInList] = React.useState(field?.showInList ?? false);
  const [active, setActive] = React.useState(field?.active ?? true);
  const [help, setHelp] = React.useState(field?.helpText ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const isPick = type === "picklist" || type === "multi_picklist";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const opts = options
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const existing = field?.options.find((o) => o.label === l);
        return { value: existing?.value ?? toOptionValue(l), label: l };
      });
    run(
      () =>
        saveCustomField({
          id: field?.id,
          module,
          api_name: apiName,
          label,
          field_type: type,
          options: isPick ? opts : [],
          required,
          help_text: help,
          show_in_list: showInList,
          active,
        }),
      {
        success: field ? "Field saved." : "Field added.",
        onOk: onSaved,
        onError: (err) => setErrors(firstErrors(err)),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{field ? `Edit “${field.label}”` : "Add a custom field"}</DialogTitle>
            <DialogDescription>
              {field
                ? "The type and API name stay as they are; values already saved keep working."
                : "Pick the type carefully: it can't change later."}
            </DialogDescription>
          </DialogHeader>
          <Field id="cf-label" label="Label" error={errors.label} required>
            <Input
              {...fieldAria("cf-label", errors.label)}
              value={label}
              maxLength={80}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!apiTouched) setApiName(toApiName(e.target.value));
              }}
            />
          </Field>
          <Field
            id="cf-api"
            label="API name"
            error={errors.api_name}
            description="Used in imports, exports and bulk updates."
          >
            <Input
              {...fieldAria("cf-api", errors.api_name, true)}
              value={apiName}
              disabled={Boolean(field)}
              maxLength={40}
              onChange={(e) => {
                setApiTouched(true);
                setApiName(e.target.value);
              }}
            />
          </Field>
          <Field id="cf-type" label="Type" error={errors.field_type}>
            <NativeSelect
              {...fieldAria("cf-type", errors.field_type)}
              value={type}
              disabled={Boolean(field)}
              onChange={(e) => setType(e.target.value as CustomFieldType)}
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CUSTOM_FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {isPick && (
            <Field
              id="cf-options"
              label="Options (one per line)"
              error={errors.options}
              description="Renaming an option keeps its stored value only if the text stays the same."
            >
              <Textarea
                {...fieldAria("cf-options", errors.options, true)}
                rows={5}
                value={options}
                onChange={(e) => setOptions(e.target.value)}
              />
            </Field>
          )}
          <Field id="cf-help" label="Help text (optional)" error={errors.help_text}>
            <Input
              {...fieldAria("cf-help", errors.help_text)}
              value={help}
              maxLength={300}
              onChange={(e) => setHelp(e.target.value)}
            />
          </Field>
          <div className="flex flex-col gap-3">
            <label className="flex min-h-11 items-center gap-3 text-sm sm:min-h-0">
              <Checkbox checked={required} onCheckedChange={(v) => setRequired(v === true)} />
              Required when someone saves the “More fields” card
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm sm:min-h-0">
              <Checkbox checked={showInList} onCheckedChange={(v) => setShowInList(v === true)} />
              Show as a column in the list by default
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm sm:min-h-0">
              <Switch checked={active} onCheckedChange={setActive} aria-label="Field is on" />
              {active ? "On" : "Off (hidden everywhere; saved values are kept)"}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {field ? "Save field" : "Add field"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Layout --------------------------------------------------------------------------------

function LayoutTab({ module, moduleLabel, layout, readOnly }: Props) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [sections, setSections] = React.useState(layout);
  React.useEffect(() => setSections(layout), [layout]);
  const dirty = JSON.stringify(sections) !== JSON.stringify(layout);

  return (
    <section className="rounded-2xl border bg-card p-5" aria-labelledby="layout-heading">
      <div className="mb-4">
        <h2 id="layout-heading" className="text-base font-semibold">
          {moduleLabel}: page layout
        </h2>
        <p className="text-sm text-muted-foreground">
          The order of the sections on the detail page, and which ones show. Hidden sections hide
          the section only; the data stays and permissions still apply.
        </p>
      </div>
      <ol className="divide-y rounded-xl border">
        {sections.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 px-3 py-2">
            <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <span
              className={
                s.visible ? "flex-1 font-medium" : "flex-1 text-muted-foreground line-through"
              }
            >
              {s.label}
            </span>
            {s.locked ? (
              <Badge variant="neutral">
                <Lock aria-hidden /> Always shown
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={readOnly}
                aria-pressed={!s.visible}
                onClick={() =>
                  setSections((list) =>
                    list.map((x) => (x.key === s.key ? { ...x, visible: !x.visible } : x)),
                  )
                }
              >
                {s.visible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                {s.visible ? "Shown" : "Hidden"}
                <span className="sr-only"> — {s.label}</span>
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Move ${s.label} up`}
              disabled={readOnly || i === 0}
              onClick={() => setSections((list) => moveSection(list, i, i - 1))}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Move ${s.label} down`}
              disabled={readOnly || i === sections.length - 1}
              onClick={() => setSections((list) => moveSection(list, i, i + 1))}
            >
              <ArrowDown aria-hidden />
            </Button>
          </li>
        ))}
      </ol>
      {!readOnly && (
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!dirty || pending}
            onClick={() => setSections(layout)}
          >
            Undo changes
          </Button>
          <Button
            disabled={!dirty || pending}
            onClick={() =>
              run(
                () =>
                  saveLayout({
                    module,
                    sections: sections.map((s) => ({ key: s.key, visible: s.visible })),
                  }),
                { success: "Layout saved.", onOk: () => router.refresh() },
              )
            }
          >
            Save layout
          </Button>
        </div>
      )}
    </section>
  );
}

// --- Validation rules ----------------------------------------------------------------------

function RulesTab({ module, moduleLabel, rules, fields, standardFields, readOnly }: Props) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [editing, setEditing] = React.useState<ValidationRule | "new" | null>(null);
  const fieldLabel = (key: string) =>
    key.startsWith("cf:")
      ? (fields.find((f) => f.apiName === key.slice(3))?.label ?? key)
      : (standardFields.find((f) => f.key === key)?.label ?? key);

  return (
    <section className="rounded-2xl border bg-card p-5" aria-labelledby="rules-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="rules-heading" className="text-base font-semibold">
            {moduleLabel}: validation rules
          </h2>
          <p className="text-sm text-muted-foreground">
            Checked on the server whenever a person saves. Website leads and other automatic writes
            are never blocked by these rules.
          </p>
        </div>
        {!readOnly && (
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add rule
          </Button>
        )}
      </div>
      {rules.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No rules yet. Add one to require a field or check its format (for example, a 5-digit ZIP).
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {fieldLabel(r.field)} · {RULE_TYPE_LABELS[r.type]}
                  {r.value && (
                    <>
                      {" "}
                      <code className="text-xs">{r.value}</code>
                    </>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">“{r.message}”</p>
              </div>
              {!r.active && <Badge variant="warning">Off</Badge>}
              {!readOnly && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                    <Pencil aria-hidden /> Edit
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete the rule on ${fieldLabel(r.field)}`}
                    disabled={pending}
                    onClick={() =>
                      run(() => deleteValidationRule({ id: r.id! }), {
                        success: "Rule deleted.",
                        onOk: () => router.refresh(),
                      })
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <RuleDialog
          module={module}
          rule={editing === "new" ? null : editing}
          choices={[
            ...standardFields,
            ...fields
              .filter((f) => f.active)
              .map((f) => ({ key: `cf:${f.apiName}`, label: `${f.label} (custom)` })),
          ]}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function RuleDialog({
  module,
  rule,
  choices,
  onClose,
  onSaved,
}: {
  module: CustomFieldModule;
  rule: ValidationRule | null;
  choices: { key: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pending, run } = useRunAction();
  const [field, setField] = React.useState(rule?.field ?? choices[0]?.key ?? "");
  const [type, setType] = React.useState<RuleType>(rule?.type ?? "required");
  const [value, setValue] = React.useState(rule?.value ?? "");
  const [message, setMessage] = React.useState(rule?.message ?? "");
  const [active, setActive] = React.useState(rule?.active ?? true);
  const [error, setError] = React.useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    run(
      () =>
        saveValidationRule({
          id: rule?.id,
          module,
          field,
          rule_type: type,
          value: type === "required" ? null : value,
          message,
          active,
        }),
      { success: "Rule saved.", onOk: onSaved, onError: (err) => setError(err.message) },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{rule ? "Edit rule" : "Add a validation rule"}</DialogTitle>
            <DialogDescription>
              Patterns are regular expressions, for example <code>^\d{"{5}"}$</code> for a 5-digit
              ZIP.
            </DialogDescription>
          </DialogHeader>
          <Field id="rule-field" label="Field">
            <NativeSelect id="rule-field" value={field} onChange={(e) => setField(e.target.value)}>
              {choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rule-type" label="Rule">
            <NativeSelect
              id="rule-type"
              value={type}
              onChange={(e) => setType(e.target.value as RuleType)}
            >
              {RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RULE_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {type !== "required" && (
            <Field id="rule-value" label="Value">
              <Input
                id="rule-value"
                value={value}
                maxLength={300}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          )}
          <Field id="rule-message" label="Message people see when it fails">
            <Input
              id="rule-message"
              value={message}
              maxLength={200}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm sm:min-h-0">
            <Switch checked={active} onCheckedChange={setActive} aria-label="Rule is on" />
            {active ? "On" : "Off"}
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
