"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_HOMES,
  DEFAULT_HOME_LABELS,
  TIME_FORMATS,
  DENSITIES,
  DENSITY_LABELS,
  TIME_FORMAT_LABELS,
  preferencesSchema,
  type PreferencesValues,
} from "@/lib/validation/users";
import { TOUCH } from "../admin/users/_components/form-bits";
import { savePreferences } from "./actions";

const HOME_HELP: Record<(typeof DEFAULT_HOMES)[number], string> = {
  executive_overview: "Company numbers, pipeline and what needs attention.",
  my_day: "Your tasks, jobs, leads and messages for today.",
};

export function PreferencesForm({
  defaults,
  readOnly,
  canExecutive = true,
}: {
  defaults: PreferencesValues;
  readOnly: boolean;
  /** The Executive Overview needs analytics access; otherwise home is always My Day. */
  canExecutive?: boolean;
}) {
  const form = useForm<PreferencesValues>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: defaults,
  });
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, isDirty },
  } = form;

  async function onSubmit(values: PreferencesValues) {
    const result = await savePreferences(values);
    if (result.ok) {
      toast.success("Preferences saved.");
      form.reset(values);
      return;
    }
    toast.error(result.error.message);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3">
      <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-5">
        <section className="rounded-2xl border bg-card p-5">
          <fieldset>
            <legend className="text-base font-semibold">Default home</legend>
            <p className="mt-0.5 mb-3 text-sm text-muted-foreground">
              Where you land after signing in.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {DEFAULT_HOMES.map((h) => (
                <label
                  key={h}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 has-[:checked]:border-bb-forest has-[:checked]:bg-accent"
                >
                  <input
                    type="radio"
                    value={h}
                    className="mt-1 size-4 accent-bb-forest"
                    disabled={h === "executive_overview" && !canExecutive}
                    {...register("default_home")}
                  />
                  <span>
                    <span className="block text-sm font-medium">{DEFAULT_HOME_LABELS[h]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {h === "executive_overview" && !canExecutive
                        ? "Needs analytics access (ask an owner)."
                        : HOME_HELP[h]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <fieldset>
            <legend className="text-base font-semibold">Time format</legend>
            <p className="mt-0.5 mb-3 text-sm text-muted-foreground">
              How times show on the schedule, timelines and lists (always Pacific time).
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TIME_FORMATS.map((t) => (
                <label
                  key={t}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 has-[:checked]:border-bb-forest has-[:checked]:bg-accent"
                >
                  <input
                    type="radio"
                    value={t}
                    className="size-4 accent-bb-forest"
                    {...register("time_format")}
                  />
                  <span className="text-sm font-medium">{TIME_FORMAT_LABELS[t]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
        <section className="rounded-2xl border bg-card p-5">
          <fieldset>
            <legend className="text-base font-semibold">Density</legend>
            <p className="mt-0.5 mb-3 text-sm text-muted-foreground">
              How tightly lists and tables are packed on this account.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {DENSITIES.map((d) => (
                <label
                  key={d}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 has-[:checked]:border-bb-forest has-[:checked]:bg-accent"
                >
                  <input
                    type="radio"
                    value={d}
                    className="size-4 accent-bb-forest"
                    {...register("density")}
                  />
                  <span className="text-sm font-medium">{DENSITY_LABELS[d]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      </fieldset>
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" className={TOUCH} disabled={isSubmitting || !isDirty}>
            {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            Save preferences
          </Button>
        </div>
      )}
    </form>
  );
}
