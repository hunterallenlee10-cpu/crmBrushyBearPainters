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
  userProfileSchema,
  type UserProfileInput,
  type UserProfileValues,
} from "@/lib/validation/users";
import { updateUserProfile } from "../actions";
import { NativeSelect, TOUCH, applyFieldErrors } from "../_components/form-bits";
import { ColorField } from "../_components/color-field";

export function ProfileForm({
  defaults,
  territories,
}: {
  defaults: UserProfileInput;
  territories: { id: string; name: string }[];
}) {
  const form = useForm<UserProfileInput, unknown, UserProfileValues>({
    resolver: zodResolver(userProfileSchema),
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
  const err = (k: keyof UserProfileInput) => errors[k]?.message;

  async function onSubmit() {
    const result = await updateUserProfile(form.getValues());
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
      <FormSection title="Edit profile" description="Saved to the audit log.">
        <Field id="full_name" label="Full name" required error={err("full_name")}>
          <Input
            className={TOUCH}
            {...register("full_name")}
            {...fieldAria("full_name", err("full_name"))}
          />
        </Field>
        <Field id="phone" label="Phone" error={err("phone")}>
          <Input
            inputMode="tel"
            className={TOUCH}
            {...register("phone")}
            {...fieldAria("phone", err("phone"))}
          />
        </Field>
        <Field id="title" label="Title" error={err("title")}>
          <Input className={TOUCH} {...register("title")} {...fieldAria("title", err("title"))} />
        </Field>
        <Field id="department" label="Department" error={err("department")}>
          <Input
            className={TOUCH}
            {...register("department")}
            {...fieldAria("department", err("department"))}
          />
        </Field>
        <Field
          id="default_territory_id"
          label="Default territory"
          error={err("default_territory_id")}
          description="Used to suggest who covers new leads in that area."
        >
          <NativeSelect
            {...register("default_territory_id")}
            {...fieldAria("default_territory_id", err("default_territory_id"), true)}
          >
            <option value="">No default</option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
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
      <div className="flex justify-end">
        <Button type="submit" className={TOUCH} disabled={isSubmitting || !isDirty}>
          {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Save profile
        </Button>
      </div>
    </form>
  );
}
