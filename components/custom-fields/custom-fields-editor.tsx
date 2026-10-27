"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import type { CustomFieldDef, CustomFieldModule, CustomInput } from "@/lib/domain/custom-fields";
import { saveCustomValues } from "@/lib/custom-fields/actions";

/** Edit dialog for a record's custom fields (one input per field type). */
export function CustomFieldsEditor({
  module,
  recordId,
  defs,
  initial,
  users,
}: {
  module: CustomFieldModule;
  recordId: string;
  defs: CustomFieldDef[];
  initial: Record<string, CustomInput>;
  users: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  React.useEffect(() => {
    if (open) {
      setValues(initial);
      setErrors({});
    }
  }, [open, initial]);

  const set = (k: string, v: CustomInput) => setValues((s) => ({ ...s, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, string | boolean | string[] | null> = {};
    for (const d of defs) {
      const v = values[d.apiName];
      payload[d.apiName] = v === undefined ? null : v;
    }
    run(() => saveCustomValues({ module, record_id: recordId, values: payload }), {
      success: "Saved.",
      onOk: () => {
        setOpen(false);
        router.refresh();
      },
      onError: (err) => setErrors(firstErrors(err)),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil aria-hidden /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>More fields</DialogTitle>
            <DialogDescription>Your company&apos;s own fields for this record.</DialogDescription>
          </DialogHeader>
          {defs.map((d) => {
            const id = `cf-${d.apiName}`;
            const err = errors[d.apiName];
            const v = values[d.apiName];
            const aria = fieldAria(id, err, Boolean(d.helpText));
            return (
              <Field
                key={d.id}
                id={id}
                label={d.label}
                required={d.required}
                error={err}
                description={d.helpText ?? undefined}
              >
                {d.type === "long_text" ? (
                  <Textarea
                    {...aria}
                    rows={4}
                    value={String(v ?? "")}
                    onChange={(e) => set(d.apiName, e.target.value)}
                  />
                ) : d.type === "checkbox" ? (
                  <span className="flex min-h-11 items-center gap-3 sm:min-h-9">
                    <Checkbox
                      id={id}
                      aria-invalid={err ? true : undefined}
                      checked={v === true}
                      onCheckedChange={(c) => set(d.apiName, c === true)}
                    />
                    <span className="text-sm">Yes</span>
                  </span>
                ) : d.type === "picklist" || d.type === "user" ? (
                  <NativeSelect
                    {...aria}
                    value={String(v ?? "")}
                    onChange={(e) => set(d.apiName, e.target.value)}
                  >
                    <option value="">—</option>
                    {(d.type === "user" ? users : d.options).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                ) : d.type === "multi_picklist" ? (
                  <fieldset
                    id={id}
                    className="flex flex-col gap-2"
                    aria-invalid={err ? true : undefined}
                  >
                    <legend className="sr-only">{d.label}</legend>
                    {d.options.map((o) => {
                      const list = Array.isArray(v) ? v : [];
                      return (
                        <label
                          key={o.value}
                          className="flex min-h-11 items-center gap-3 text-sm sm:min-h-0"
                        >
                          <Checkbox
                            checked={list.includes(o.value)}
                            onCheckedChange={(c) =>
                              set(
                                d.apiName,
                                c === true ? [...list, o.value] : list.filter((x) => x !== o.value),
                              )
                            }
                          />
                          {o.label}
                        </label>
                      );
                    })}
                  </fieldset>
                ) : (
                  <Input
                    {...aria}
                    type={
                      d.type === "date"
                        ? "date"
                        : d.type === "datetime"
                          ? "datetime-local"
                          : d.type === "url"
                            ? "url"
                            : "text"
                    }
                    inputMode={d.type === "number" || d.type === "currency" ? "decimal" : undefined}
                    placeholder={d.type === "currency" ? "$0.00" : undefined}
                    value={String(v ?? "")}
                    onChange={(e) => set(d.apiName, e.target.value)}
                  />
                )}
              </Field>
            );
          })}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
