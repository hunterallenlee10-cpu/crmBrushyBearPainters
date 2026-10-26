"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, fieldAria } from "@/components/forms/field";
import { laborCostSchema, type LaborCostInput, type LaborCostValues } from "@/lib/validation/users";
import { saveLaborCost } from "../actions";
import { Card, TOUCH, applyFieldErrors } from "../_components/form-bits";

export function LaborCostCard({
  userId,
  canEdit,
  defaultValue,
}: {
  userId: string;
  canEdit: boolean;
  defaultValue: string;
}) {
  const form = useForm<LaborCostInput, unknown, LaborCostValues>({
    resolver: zodResolver(laborCostSchema),
    defaultValues: { user_id: userId, hourly_cost: defaultValue },
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form;
  const error = errors.hourly_cost?.message;

  async function onSubmit() {
    const result = await saveLaborCost(form.getValues());
    if (result.ok) {
      toast.success("Labor cost saved.");
      form.reset(form.getValues());
      return;
    }
    applyFieldErrors(setError, result.error);
    toast.error(result.error.message);
  }

  return (
    <Card
      title="Labor cost"
      headingId="labor-cost"
      description="Loaded hourly cost used for job costing. Only people with HR access can see it."
      actions={
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden /> HR &amp; Sensitive
        </span>
      }
    >
      {canEdit ? (
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Field id="hourly_cost" label="Hourly cost ($)" error={error} className="sm:w-56">
            <Input
              inputMode="decimal"
              placeholder="0.00"
              className={TOUCH}
              {...register("hourly_cost")}
              {...fieldAria("hourly_cost", error)}
            />
          </Field>
          <Button type="submit" className={TOUCH} disabled={isSubmitting || !isDirty}>
            {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            Save cost
          </Button>
        </form>
      ) : (
        <p className="text-sm">
          {defaultValue ? `$${defaultValue} per hour` : "Not set yet."}{" "}
          <span className="text-muted-foreground">Ask someone with HR access to change it.</span>
        </p>
      )}
    </Card>
  );
}
