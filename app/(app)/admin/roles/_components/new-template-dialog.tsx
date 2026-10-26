"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { keyFromName } from "@/lib/validation/roles";
import { createTemplate } from "../actions";

type Option = { id: string; name: string };

/** "New template": a custom template that starts as a copy of an existing one's packs. */
export function NewTemplateDialog({
  sources,
  takenKeys,
}: {
  sources: readonly Option[];
  takenKeys: readonly string[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [cloneFrom, setCloneFrom] = React.useState(sources[0]?.id ?? "");
  const [errors, setErrors] = React.useState<Record<string, string | undefined>>({});
  const [pending, startTransition] = React.useTransition();

  const key = name.trim() ? keyFromName(name, takenKeys) : null;

  function reset() {
    setName("");
    setDescription("");
    setCloneFrom(sources[0]?.id ?? "");
    setErrors({});
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string | undefined> = {};
    if (!name.trim()) next.name = "Name is required.";
    if (!cloneFrom) next.clone_from_id = "Pick a template to copy.";
    setErrors(next);
    if (next.name || next.clone_from_id) return;

    startTransition(async () => {
      const result = await createTemplate({ name, description, clone_from_id: cloneFrom });
      if (!result.ok) {
        const fe = result.error.fieldErrors ?? {};
        setErrors({
          name: fe.name?.[0],
          description: fe.description?.[0],
          clone_from_id: fe.clone_from_id?.[0],
          _form: fe.name || fe.description || fe.clone_from_id ? undefined : result.error.message,
        });
        return;
      }
      toast.success(`Created “${name.trim()}”.`);
      setOpen(false);
      reset();
      router.push(`/admin/roles/templates/${result.data.id}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="cta">
          <Plus aria-hidden /> New template
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>New role template</DialogTitle>
            <DialogDescription>
              Starts with the same packs as the template you copy. Adjust its packs on the next
              screen. Built-in templates aren&apos;t changed.
            </DialogDescription>
          </DialogHeader>
          <Field
            id="new-template-name"
            label="Name"
            required
            error={errors.name}
            description={key ? `Key: ${key} (set automatically, can't change later)` : undefined}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoComplete="off"
              {...fieldAria("new-template-name", errors.name, Boolean(key))}
            />
          </Field>
          <Field id="new-template-description" label="Description" error={errors.description}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="Who gets this template and what it's for"
              {...fieldAria("new-template-description", errors.description)}
            />
          </Field>
          <Field
            id="new-template-source"
            label="Copy packs from"
            required
            error={errors.clone_from_id}
          >
            <select
              value={cloneFrom}
              onChange={(e) => setCloneFrom(e.target.value)}
              className="h-9 w-full rounded-md border bg-card px-2 text-sm"
              {...fieldAria("new-template-source", errors.clone_from_id)}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
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
            <Button type="submit" variant="cta" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
              Create template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
