"use client";

import * as React from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection, fieldAria } from "@/components/forms/field";
import { updateTemplate } from "../../actions";

export function TemplateDetailsForm({
  id,
  name: initialName,
  description: initialDescription,
}: {
  id: string;
  name: string;
  description: string;
}) {
  const [name, setName] = React.useState(initialName);
  const [description, setDescription] = React.useState(initialDescription);
  const [errors, setErrors] = React.useState<{ name?: string; description?: string }>({});
  const [pending, startTransition] = React.useTransition();
  const dirty = name !== initialName || description !== initialDescription;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: "Name is required." });
      return;
    }
    startTransition(async () => {
      const result = await updateTemplate({ id, name, description });
      if (!result.ok) {
        setErrors({
          name: result.error.fieldErrors?.name?.[0],
          description: result.error.fieldErrors?.description?.[0],
        });
        toast.error(result.error.message);
        return;
      }
      setErrors({});
      toast.success("Template details saved.");
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <FormSection title="Details">
        <Field id="template-name" label="Name" required error={errors.name}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            {...fieldAria("template-name", errors.name)}
          />
        </Field>
        <Field id="template-description" label="Description" error={errors.description}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            className="min-h-9"
            {...fieldAria("template-description", errors.description)}
          />
        </Field>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" variant="outline" disabled={pending || !dirty}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            Save details
          </Button>
        </div>
      </FormSection>
    </form>
  );
}
