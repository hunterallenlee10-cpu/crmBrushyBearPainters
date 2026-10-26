"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection, fieldAria } from "@/components/forms/field";
import {
  ownProfileSchema,
  type OwnProfileInput,
  type OwnProfileValues,
} from "@/lib/validation/users";
import { ColorField } from "../admin/users/_components/color-field";
import { TOUCH, applyFieldErrors } from "../admin/users/_components/form-bits";
import { saveOwnProfile } from "./actions";

export function OwnProfileForm({
  defaults,
  email,
  department,
  roleName,
  readOnly,
}: {
  defaults: OwnProfileInput;
  email: string;
  department: string | null;
  roleName: string;
  readOnly: boolean;
}) {
  const form = useForm<OwnProfileInput, unknown, OwnProfileValues>({
    resolver: zodResolver(ownProfileSchema),
    defaultValues: defaults,
  });
  const {
    register,
    handleSubmit,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = form;
  const err = (k: keyof OwnProfileInput) => errors[k]?.message;

  async function onSubmit() {
    const result = await saveOwnProfile(form.getValues());
    if (result.ok) {
      toast.success("Profile saved.");
      form.reset(form.getValues());
      return;
    }
    applyFieldErrors(setError, result.error);
    toast.error(result.error.message);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3">
      <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-5">
        <FormSection
          title="Profile"
          description="How you appear to your team and on messages you send."
        >
          <Field id="full_name" label="Full name" required error={err("full_name")}>
            <Input
              autoComplete="name"
              className={TOUCH}
              {...register("full_name")}
              {...fieldAria("full_name", err("full_name"))}
            />
          </Field>
          <Field id="phone" label="Phone" error={err("phone")}>
            <Input
              inputMode="tel"
              autoComplete="tel"
              className={TOUCH}
              {...register("phone")}
              {...fieldAria("phone", err("phone"))}
            />
          </Field>
          <Field id="title" label="Job title" error={err("title")}>
            <Input className={TOUCH} {...register("title")} {...fieldAria("title", err("title"))} />
          </Field>
          <ColorField
            id="calendar_color"
            value={watch("calendar_color") ?? ""}
            error={err("calendar_color")}
            register={register("calendar_color")}
            onPick={(v) => setValue("calendar_color", v, { shouldDirty: true })}
          />
          <Field
            id="signature"
            label="Email signature"
            error={err("signature")}
            className="sm:col-span-2"
          >
            <Textarea
              rows={3}
              {...register("signature")}
              {...fieldAria("signature", err("signature"))}
            />
          </Field>
        </FormSection>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-base font-semibold">Set by an admin</h2>
          <p className="mt-0.5 mb-4 text-sm text-muted-foreground">
            Ask an owner if any of these need to change.
          </p>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">Email</dt>
              <dd className="text-sm break-all">{email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Role</dt>
              <dd className="text-sm">{roleName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Department</dt>
              <dd className="text-sm">{department ?? "—"}</dd>
            </div>
          </dl>
        </section>
      </fieldset>
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" className={TOUCH} disabled={isSubmitting || !isDirty}>
            {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            Save profile
          </Button>
        </div>
      )}
    </form>
  );
}
