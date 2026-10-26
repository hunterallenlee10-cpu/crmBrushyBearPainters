"use client";

import { type UseFormRegisterReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Field, fieldAria } from "@/components/forms/field";
import { TOUCH } from "./form-bits";

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Calendar color: a swatch picker plus the hex value (either can be used). */
export function ColorField({
  id,
  value,
  error,
  register,
  onPick,
}: {
  id: string;
  value: string;
  error?: string;
  register: UseFormRegisterReturn;
  onPick: (value: string) => void;
}) {
  return (
    <Field
      id={id}
      label="Calendar color"
      error={error}
      description="Shows on the schedule. Leave blank for the default."
    >
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Pick calendar color"
          value={HEX.test(value) ? value : "#2f6b4f"}
          onChange={(e) => onPick(e.target.value.toUpperCase())}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-md border bg-card p-1 sm:h-9"
        />
        <Input
          placeholder="#2F6B4F"
          className={`${TOUCH} font-mono`}
          {...register}
          {...fieldAria(id, error, true)}
        />
      </div>
    </Field>
  );
}
