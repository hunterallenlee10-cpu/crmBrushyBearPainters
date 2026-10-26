"use client";

import * as React from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Field, fieldAria } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
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
import {
  DISPOSITION_CATEGORIES,
  DISPOSITION_CATEGORY_LABELS,
  addPicklistValueSchema,
  suggestKey,
} from "@/lib/validation/picklists";
import { addPicklistValue } from "../actions";
import { selectClass, type ParentOption } from "./shared";

type Errors = Partial<
  Record<"label" | "value" | "category" | "parentValueId" | "color" | "_form", string>
>;

const EMPTY = { label: "", value: "", category: "", parentValueId: "", color: "" };

export function AddValueDialog({
  picklistId,
  picklistName,
  takenKeys,
  hasCategory,
  parent,
  onAdded,
}: {
  picklistId: string;
  picklistName: string;
  takenKeys: readonly string[];
  hasCategory: boolean;
  parent: { name: string; options: ParentOption[] } | null;
  onAdded: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);
  const [keyEdited, setKeyEdited] = React.useState(false);
  const [errors, setErrors] = React.useState<Errors>({});
  const [submitting, setSubmitting] = React.useState(false);

  function reset() {
    setForm(EMPTY);
    setKeyEdited(false);
    setErrors({});
  }

  function setLabel(label: string) {
    setForm((f) => ({
      ...f,
      label,
      value: keyEdited ? f.value : label.trim() === "" ? "" : suggestKey(label, takenKeys),
    }));
    setErrors((e) => ({ ...e, label: undefined, ...(keyEdited ? {} : { value: undefined }) }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = { picklistId, ...form };
    const parsed = addPicklistValueSchema.safeParse(input);
    const next: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const k = (issue.path[0] ?? "_form") as keyof Errors;
        next[k] ??= issue.message;
      }
    }
    if (!next.value && takenKeys.includes(form.value.trim())) {
      next.value = "That key is already used in this picklist.";
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    setSubmitting(true);
    const result = await addPicklistValue(input);
    setSubmitting(false);
    if (result.ok) {
      toast.success(`Added "${form.label.trim()}" to ${picklistName}.`);
      reset();
      setOpen(false);
      onAdded();
      return;
    }
    const fieldErrors: Errors = {};
    for (const [k, messages] of Object.entries(result.error.fieldErrors ?? {})) {
      fieldErrors[k as keyof Errors] = messages[0];
    }
    if (Object.keys(fieldErrors).length === 0) fieldErrors._form = result.error.message;
    setErrors(fieldErrors);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="cta" size="sm">
          <Plus aria-hidden /> Add value
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add a value to {picklistName}</DialogTitle>
            <DialogDescription>
              New values are active and go to the end of the list.
            </DialogDescription>
          </DialogHeader>

          <Field id="new-label" label="Label" required error={errors.label}>
            <Input
              value={form.label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
              autoComplete="off"
              {...fieldAria("new-label", errors.label)}
            />
          </Field>

          <Field
            id="new-key"
            label="Key"
            required
            error={errors.value}
            description="Saved on records and in reports, so it can't change after you add the value. Lowercase letters, numbers and underscores."
          >
            <Input
              value={form.value}
              maxLength={60}
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
              onChange={(e) => {
                setKeyEdited(true);
                setForm((f) => ({ ...f, value: e.target.value }));
                setErrors((x) => ({ ...x, value: undefined }));
              }}
              {...fieldAria("new-key", errors.value, true)}
            />
          </Field>

          {hasCategory && (
            <Field id="new-category" label="Category" error={errors.category}>
              <select
                className={selectClass}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                {...fieldAria("new-category", errors.category)}
              >
                <option value="">No category</option>
                {DISPOSITION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {DISPOSITION_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {!hasCategory && parent && (
            <Field
              id="new-parent"
              label={`Parent ${parent.name.toLowerCase()}`}
              error={errors.parentValueId}
            >
              <select
                className={selectClass}
                value={form.parentValueId}
                onChange={(e) => setForm((f) => ({ ...f, parentValueId: e.target.value }))}
                {...fieldAria("new-parent", errors.parentValueId)}
              >
                <option value="">No parent</option>
                {parent.options
                  .filter((o) => o.active)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
              </select>
            </Field>
          )}

          <Field id="new-color" label="Color (optional)" error={errors.color}>
            <Input
              value={form.color}
              placeholder="#RRGGBB"
              maxLength={7}
              spellCheck={false}
              className="w-32 font-mono uppercase"
              onChange={(e) => {
                setForm((f) => ({ ...f, color: e.target.value }));
                setErrors((x) => ({ ...x, color: undefined }));
              }}
              {...fieldAria("new-color", errors.color)}
            />
          </Field>

          {errors._form && (
            <p role="alert" className="text-sm text-danger">
              {errors._form}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden />}
              Add value
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
