"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Field, FormSection, fieldAria } from "@/components/forms/field";
import { WEEKDAYS, WEEKDAY_LABELS, isPlaceholder } from "@/lib/domain/company-settings";
import {
  companySettingsSchema,
  type CompanySettingsInput,
  type CompanySettingsValues,
} from "@/lib/validation/company-settings";
import { saveCompanySettings } from "./actions";

export function CompanySettingsForm({
  defaults,
  taxConfigured,
}: {
  defaults: CompanySettingsInput;
  taxConfigured: boolean;
}) {
  const form = useForm<CompanySettingsInput, unknown, CompanySettingsValues>({
    resolver: zodResolver(companySettingsSchema),
    defaultValues: defaults,
  });
  const {
    register,
    control,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  async function onSubmit() {
    const result = await saveCompanySettings(form.getValues());
    if (result.ok) {
      toast.success("Company settings saved.");
      form.reset(form.getValues());
      return;
    }
    for (const [key, messages] of Object.entries(result.error.fieldErrors ?? {})) {
      setError(key as keyof CompanySettingsInput, { message: messages[0] });
    }
    toast.error(result.error.message);
  }

  const err = (k: keyof CompanySettingsInput) => {
    const e = errors[k];
    return e && "message" in e ? (e.message as string | undefined) : undefined;
  };
  const placeholderNote = (value: string) =>
    isPlaceholder(value) ? (
      <span className="inline-flex items-center gap-1 text-warning">
        <TriangleAlert className="size-3" aria-hidden /> Placeholder. Replace before it reaches
        customers.
      </span>
    ) : undefined;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <FormSection title="Company">
        <Field id="company_name" label="Company name" required error={err("company_name")}>
          <Input
            {...register("company_name")}
            {...fieldAria("company_name", err("company_name"))}
          />
        </Field>
        <Field id="tagline" label="Tagline" error={err("tagline")}>
          <Input {...register("tagline")} {...fieldAria("tagline", err("tagline"))} />
        </Field>
        <Field id="website_url" label="Website" error={err("website_url")}>
          <Input
            type="url"
            {...register("website_url")}
            {...fieldAria("website_url", err("website_url"))}
          />
        </Field>
        <Field id="service_area_note" label="Service area note" error={err("service_area_note")}>
          <Input
            {...register("service_area_note")}
            {...fieldAria("service_area_note", err("service_area_note"))}
          />
        </Field>
      </FormSection>

      <FormSection
        title="Contact"
        description="Printed on proposals and invoices and used in customer messages."
      >
        <Field
          id="phone"
          label="Phone"
          required
          error={err("phone")}
          description={placeholderNote(watch("phone"))}
        >
          <Input
            inputMode="tel"
            {...register("phone")}
            {...fieldAria("phone", err("phone"), isPlaceholder(watch("phone")))}
          />
        </Field>
        <Field
          id="email"
          label="Email"
          required
          error={err("email")}
          description={placeholderNote(watch("email"))}
        >
          <Input
            type="email"
            {...register("email")}
            {...fieldAria("email", err("email"), isPlaceholder(watch("email")))}
          />
        </Field>
        <Field
          id="hours_text"
          label="Hours (as shown to customers)"
          required
          error={err("hours_text")}
          description={placeholderNote(watch("hours_text"))}
        >
          <Input
            {...register("hours_text")}
            {...fieldAria("hours_text", err("hours_text"), isPlaceholder(watch("hours_text")))}
          />
        </Field>
      </FormSection>

      <FormSection
        title="Licensing"
        description="WA L&I contractor registration and UBI appear on proposals, contracts and invoices."
      >
        <Field
          id="lni_number"
          label="L&I registration #"
          required
          error={err("lni_number")}
          description={placeholderNote(watch("lni_number"))}
        >
          <Input
            {...register("lni_number")}
            {...fieldAria("lni_number", err("lni_number"), isPlaceholder(watch("lni_number")))}
          />
        </Field>
        <Field
          id="ubi_number"
          label="UBI #"
          required
          error={err("ubi_number")}
          description={placeholderNote(watch("ubi_number"))}
        >
          <Input
            {...register("ubi_number")}
            {...fieldAria("ubi_number", err("ubi_number"), isPlaceholder(watch("ubi_number")))}
          />
        </Field>
        <Field
          id="rrp_firm_certification"
          label="Lead-safe (RRP) firm certification #"
          error={err("rrp_firm_certification")}
          description="Verify current Washington requirements with the Department of Commerce."
        >
          <Input
            {...register("rrp_firm_certification")}
            {...fieldAria("rrp_firm_certification", err("rrp_firm_certification"), true)}
          />
        </Field>
        <Field
          id="rrp_firm_cert_expires_on"
          label="RRP certification expires"
          error={err("rrp_firm_cert_expires_on")}
        >
          <Input
            type="date"
            {...register("rrp_firm_cert_expires_on")}
            {...fieldAria("rrp_firm_cert_expires_on", err("rrp_firm_cert_expires_on"))}
          />
        </Field>
      </FormSection>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-base font-semibold">Business hours</h2>
        <p className="mt-0.5 mb-4 text-sm text-muted-foreground">
          Speed-to-lead and unread-message timers only count these hours (Pacific time).
        </p>
        <div className="flex flex-col divide-y">
          {WEEKDAYS.map((day) => (
            <Controller
              key={day}
              control={control}
              name={`business_hours.${day}`}
              render={({ field, fieldState }) => {
                const value = field.value;
                return (
                  <div className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="w-28 text-sm font-medium">{WEEKDAY_LABELS[day]}</span>
                    <select
                      aria-label={`${WEEKDAY_LABELS[day]} hours`}
                      className="h-9 rounded-md border bg-card px-2 text-sm"
                      value={value.mode}
                      onChange={(e) => {
                        const mode = e.target.value as "closed" | "by_appointment" | "open";
                        field.onChange(
                          mode === "open" ? { mode, open: "08:00", close: "17:00" } : { mode },
                        );
                      }}
                    >
                      <option value="open">Open</option>
                      <option value="by_appointment">By appointment</option>
                      <option value="closed">Closed</option>
                    </select>
                    {value.mode === "open" && (
                      <>
                        <Input
                          type="time"
                          aria-label={`${WEEKDAY_LABELS[day]} opens`}
                          className="h-9 w-32"
                          value={value.open}
                          onChange={(e) => field.onChange({ ...value, open: e.target.value })}
                        />
                        <span className="text-sm text-muted-foreground">to</span>
                        <Input
                          type="time"
                          aria-label={`${WEEKDAY_LABELS[day]} closes`}
                          className="h-9 w-32"
                          value={value.close}
                          onChange={(e) => field.onChange({ ...value, close: e.target.value })}
                        />
                      </>
                    )}
                    {fieldState.error && (
                      <span role="alert" className="text-xs text-danger">
                        {fieldState.error.message ?? "Check these hours."}
                      </span>
                    )}
                  </div>
                );
              }}
            />
          ))}
        </div>
      </section>

      <FormSection
        title="Promises & timers"
        description="The brand promises the CRM keeps track of."
      >
        <Field
          id="text_back_sla_minutes"
          label="Text back new leads within (minutes)"
          error={err("text_back_sla_minutes")}
        >
          <Input
            type="number"
            min={1}
            max={240}
            {...register("text_back_sla_minutes")}
            {...fieldAria("text_back_sla_minutes", err("text_back_sla_minutes"))}
          />
        </Field>
        <Field
          id="on_time_guarantee"
          label="On-time start guarantee ($ off)"
          error={err("on_time_guarantee")}
        >
          <Input
            inputMode="decimal"
            {...register("on_time_guarantee")}
            {...fieldAria("on_time_guarantee", err("on_time_guarantee"))}
          />
        </Field>
        <Field
          id="estimate_sla_hours"
          label="Estimate due after walkthrough (hours)"
          error={err("estimate_sla_hours")}
        >
          <Input
            type="number"
            min={1}
            max={168}
            {...register("estimate_sla_hours")}
            {...fieldAria("estimate_sla_hours", err("estimate_sla_hours"))}
          />
        </Field>
        <Field
          id="estimate_sla_warn_hours"
          label="Warn at (hours)"
          error={err("estimate_sla_warn_hours")}
        >
          <Input
            type="number"
            min={1}
            max={168}
            {...register("estimate_sla_warn_hours")}
            {...fieldAria("estimate_sla_warn_hours", err("estimate_sla_warn_hours"))}
          />
        </Field>
      </FormSection>

      <FormSection title="Season, deposits & estimates">
        <Field
          id="exterior_season_start"
          label="Exterior season starts (MM-DD)"
          error={err("exterior_season_start")}
        >
          <Input
            placeholder="06-01"
            {...register("exterior_season_start")}
            {...fieldAria("exterior_season_start", err("exterior_season_start"))}
          />
        </Field>
        <Field
          id="exterior_season_end"
          label="Exterior season ends (MM-DD)"
          error={err("exterior_season_end")}
        >
          <Input
            placeholder="09-30"
            {...register("exterior_season_end")}
            {...fieldAria("exterior_season_end", err("exterior_season_end"))}
          />
        </Field>
        <Field id="deposit_percent" label="Deposit (% of contract)" error={err("deposit_percent")}>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.5"
            {...register("deposit_percent")}
            {...fieldAria("deposit_percent", err("deposit_percent"))}
          />
        </Field>
        <Field
          id="estimate_expiry_days"
          label="Estimates expire after (days)"
          error={err("estimate_expiry_days")}
        >
          <Input
            type="number"
            min={1}
            max={365}
            {...register("estimate_expiry_days")}
            {...fieldAria("estimate_expiry_days", err("estimate_expiry_days"))}
          />
        </Field>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm font-medium">Sales tax</span>
          <p className="text-sm text-muted-foreground">
            {taxConfigured ? (
              "Configured."
            ) : (
              <>
                <Badge variant="warning">Not set</Badge> Confirm Washington sales-tax treatment with
                your accountant. Set the rate in Admin → Estimate Setup.
              </>
            )}
          </p>
        </div>
      </FormSection>

      <FormSection title="Leads, reviews & referrals">
        <Controller
          control={control}
          name="auto_convert_on_walkthrough"
          render={({ field }) => (
            <div className="flex items-center justify-between gap-4 rounded-xl border p-3 sm:col-span-2">
              <div>
                <p id="auto-convert-label" className="text-sm font-medium">
                  Convert a lead to a job when its walkthrough is booked
                </p>
                <p className="text-xs text-muted-foreground">Turn off to convert leads by hand.</p>
              </div>
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                aria-labelledby="auto-convert-label"
              />
            </div>
          )}
        />
        <Field id="review_link" label="Google review link" error={err("review_link")}>
          <Input
            type="url"
            placeholder="https://"
            {...register("review_link")}
            {...fieldAria("review_link", err("review_link"))}
          />
        </Field>
        <Field
          id="referral_reward"
          label="Referral reward ($)"
          error={err("referral_reward")}
          description="Leave blank until the owners decide the reward."
        >
          <Input
            inputMode="decimal"
            {...register("referral_reward")}
            {...fieldAria("referral_reward", err("referral_reward"), true)}
          />
        </Field>
      </FormSection>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button
          type="submit"
          variant="cta"
          size="lg"
          disabled={isSubmitting || !isDirty}
          className="shadow-md"
        >
          {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
