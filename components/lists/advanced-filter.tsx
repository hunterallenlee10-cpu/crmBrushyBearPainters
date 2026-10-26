"use client";

import * as React from "react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DATE_OPERATOR_LABELS,
  NO_VALUE_OPERATORS,
  OPERATORS_BY_TYPE,
  OPERATOR_LABELS,
  validateRules,
  type FieldDef,
  type FilterSpec,
  type Operator,
  type Rule,
} from "@/lib/lists/filters";

/**
 * Advanced rule builder (SPEC §8 "Lists"): Match ALL/ANY; field · operator ·
 * value; add rule. Invalid rules are pointed out and never applied.
 */

const selectClass =
  "h-9 rounded-md border border-input bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

function opLabel(field: FieldDef | undefined, op: Operator): string {
  if (field?.type === "date") return DATE_OPERATOR_LABELS[op] ?? OPERATOR_LABELS[op];
  return OPERATOR_LABELS[op];
}

function defaultRule(fields: readonly FieldDef[]): Rule {
  const f = fields[0]!;
  return { field: f.key, op: OPERATORS_BY_TYPE[f.type][0]! };
}

function ValueInput({
  field,
  rule,
  index,
  onChange,
}: {
  field: FieldDef;
  rule: Rule;
  index: number;
  onChange: (patch: Partial<Rule>) => void;
}) {
  const label = `Rule ${index + 1} value`;
  if (NO_VALUE_OPERATORS.includes(rule.op))
    return <span className="text-sm text-muted-foreground">—</span>;
  const single = Array.isArray(rule.value) ? (rule.value[0] ?? "") : (rule.value ?? "");

  if (field.type === "boolean") {
    return (
      <select
        aria-label={label}
        className={selectClass}
        value={single}
        onChange={(e) => onChange({ value: e.target.value })}
      >
        <option value="">Choose…</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if ((field.type === "enum" || field.type === "user" || field.type === "array") && field.options) {
    if (rule.op === "in") {
      const chosen = new Set(
        Array.isArray(rule.value) ? rule.value : rule.value ? [rule.value] : [],
      );
      return (
        <fieldset
          className="max-h-40 min-w-48 overflow-y-auto rounded-md border p-2"
          aria-label={label}
        >
          {field.options.map((o) => (
            <label key={o.value} className="flex min-h-8 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.has(o.value)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(o.value);
                  else next.delete(o.value);
                  onChange({ value: [...next] });
                }}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      );
    }
    return (
      <select
        aria-label={label}
        className={selectClass}
        value={single}
        onChange={(e) => onChange({ value: e.target.value })}
      >
        <option value="">Choose…</option>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "date") {
    if (rule.op === "in_last_days") {
      return (
        <Input
          aria-label={label}
          type="number"
          min={1}
          max={3650}
          className="h-9 w-28"
          placeholder="Days"
          value={single}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      );
    }
    return (
      <div className="flex items-center gap-2">
        <Input
          aria-label={label}
          type="date"
          className="h-9 w-40"
          value={single}
          onChange={(e) => onChange({ value: e.target.value })}
        />
        {rule.op === "between" && (
          <>
            <span className="text-sm text-muted-foreground">and</span>
            <Input
              aria-label={`Rule ${index + 1} end date`}
              type="date"
              className="h-9 w-40"
              value={rule.value2 ?? ""}
              onChange={(e) => onChange({ value2: e.target.value })}
            />
          </>
        )}
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div className="flex items-center gap-2">
        <Input
          aria-label={label}
          type="number"
          className="h-9 w-28"
          value={single}
          onChange={(e) => onChange({ value: e.target.value })}
        />
        {rule.op === "between" && (
          <>
            <span className="text-sm text-muted-foreground">and</span>
            <Input
              aria-label={`Rule ${index + 1} upper value`}
              type="number"
              className="h-9 w-28"
              value={rule.value2 ?? ""}
              onChange={(e) => onChange({ value2: e.target.value })}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <Input
      aria-label={label}
      className="h-9 w-56"
      value={single}
      onChange={(e) => onChange({ value: e.target.value })}
    />
  );
}

export function AdvancedFilter({
  fields,
  filter,
  onApply,
}: {
  fields: readonly FieldDef[];
  filter: FilterSpec;
  onApply: (filter: FilterSpec) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<FilterSpec>(filter);
  const [showErrors, setShowErrors] = React.useState(false);

  // Start from the applied filter each time the dialog opens.
  const appliedRef = React.useRef({ filter, fields });
  appliedRef.current = { filter, fields };
  React.useEffect(() => {
    if (!open) return;
    const { filter: f, fields: fs } = appliedRef.current;
    setDraft(f.rules.length ? f : { match: "all", rules: [defaultRule(fs)] });
    setShowErrors(false);
  }, [open]);

  const errors = validateRules(draft, fields);
  const errorFor = (i: number) => errors.find((e) => e.index === i)?.message;

  function update(i: number, patch: Partial<Rule>) {
    setDraft((d) => ({ ...d, rules: d.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  }

  function changeField(i: number, key: string) {
    const f = fields.find((x) => x.key === key);
    if (!f) return;
    update(i, {
      field: key,
      op: OPERATORS_BY_TYPE[f.type][0]!,
      value: undefined,
      value2: undefined,
    });
  }

  function apply() {
    if (errors.length) {
      setShowErrors(true);
      return;
    }
    onApply(draft);
    setOpen(false);
  }

  const count = filter.rules.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <SlidersHorizontal aria-hidden />
          Advanced
          {count > 0 && (
            <Badge variant="info" className="ml-1 px-1.5" aria-label={`${count} rules`}>
              {count}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Advanced filter</DialogTitle>
          <DialogDescription>
            Combine rules to narrow the list. Filters apply on the server across every record.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-sm">
          <span>Match</span>
          <select
            aria-label="Match"
            className={selectClass}
            value={draft.match}
            onChange={(e) =>
              setDraft((d) => ({ ...d, match: e.target.value === "any" ? "any" : "all" }))
            }
          >
            <option value="all">ALL rules</option>
            <option value="any">ANY rule</option>
          </select>
        </div>
        <ol className="flex flex-col gap-3">
          {draft.rules.map((rule, i) => {
            const field = fields.find((f) => f.key === rule.field) ?? fields[0]!;
            const err = showErrors ? errorFor(i) : undefined;
            return (
              <li key={i} className="flex flex-col gap-1 rounded-xl border p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <select
                    aria-label={`Rule ${i + 1} field`}
                    className={selectClass}
                    value={field.key}
                    onChange={(e) => changeField(i, e.target.value)}
                  >
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Rule ${i + 1} operator`}
                    className={selectClass}
                    value={rule.op}
                    onChange={(e) =>
                      update(i, {
                        op: e.target.value as Operator,
                        value: undefined,
                        value2: undefined,
                      })
                    }
                  >
                    {OPERATORS_BY_TYPE[field.type].map((op) => (
                      <option key={op} value={op}>
                        {opLabel(field, op)}
                      </option>
                    ))}
                  </select>
                  <ValueInput
                    field={field}
                    rule={rule}
                    index={i}
                    onChange={(patch) => update(i, patch)}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    aria-label={`Remove rule ${i + 1}`}
                    onClick={() =>
                      setDraft((d) => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                {err && (
                  <p role="alert" className="text-xs text-danger">
                    {err}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDraft((d) => ({ ...d, rules: [...d.rules, defaultRule(fields)] }))}
            disabled={draft.rules.length >= 20}
          >
            <Plus aria-hidden />
            Add rule
          </Button>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              onApply({ match: "all", rules: [] });
              setOpen(false);
            }}
          >
            Clear all
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={apply}>Apply</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
