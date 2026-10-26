"use client";

import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, fieldAria } from "@/components/forms/field";
import { formatPhone } from "@/lib/domain/leads/normalize";
import {
  HOME_BUILT,
  HOME_BUILT_LABELS,
  SERVICES,
  SERVICE_LABELS,
  TIMELINES,
  TIMELINE_LABELS,
  type Service,
} from "@/lib/domain/leads/constants";
import {
  leadUpdateSchema,
  type LeadUpdateInput,
  type LeadUpdateValues,
} from "@/lib/validation/leads";
import { choices, selectClass } from "./labels";
import { updateLead } from "./actions";
import type { LeadDetailData } from "./types";

const nullIfEmpty = (v: unknown) => (v === "" ? null : v);

function defaultsFor(data: LeadDetailData): LeadUpdateInput {
  const l = data.lead;
  return {
    id: l.id,
    first_name: l.firstName,
    last_name: l.lastName ?? "",
    company: l.company ?? "",
    mobile: l.mobile ? formatPhone(l.mobile) : "",
    phone: l.phone ? formatPhone(l.phone) : "",
    email: l.email ?? "",
    street: l.street ?? "",
    unit: l.unit ?? "",
    city: l.city ?? "",
    state: l.state,
    zip: l.zip ?? "",
    year_built: l.yearBuilt ? String(l.yearBuilt) : "",
    home_built: l.homeBuilt,
    property_type: l.propertyType ?? "",
    stories: l.stories ? (String(l.stories) as "1" | "2" | "3") : "",
    siding_type: l.sidingType ?? "",
    has_hoa: l.hasHoa,
    services: l.services,
    timeline: l.timeline,
    lead_source: l.leadSource,
    lead_sub_source: l.leadSubSource ?? "",
    lead_set_by: l.leadSetById ?? "",
    owner_id: l.ownerId ?? "",
    customer_notes: l.customerNotes ?? "",
  };
}

export function EditLeadDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: LeadDetailData;
}) {
  const form = useForm<LeadUpdateInput, unknown, LeadUpdateValues>({
    resolver: zodResolver(leadUpdateSchema),
    defaultValues: defaultsFor(data),
  });
  const {
    register,
    control,
    handleSubmit,
    watch,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  // Fresh values each time the dialog opens (the lead may have changed).
  React.useEffect(() => {
    if (open) reset(defaultsFor(data));
  }, [open, data, reset]);

  const err = (k: keyof LeadUpdateInput) => {
    const e = errors[k];
    return e && "message" in e ? (e.message as string | undefined) : undefined;
  };

  const source = watch("lead_source");
  const subSources = data.options.picklists.lead_sub_source.filter(
    (o) => (o.active !== false || o.value === data.lead.leadSubSource) && o.parent === source,
  );
  const { options } = data;

  async function onSubmit() {
    const result = await updateLead(form.getValues());
    if (result.ok) {
      toast.success("Lead saved.");
      onOpenChange(false);
      return;
    }
    for (const [key, messages] of Object.entries(result.error.fieldErrors ?? {})) {
      setError(key as keyof LeadUpdateInput, { message: messages[0] });
    }
    toast.error(result.error.message);
  }

  const text = (
    name: keyof LeadUpdateInput,
    labelText: string,
    props: React.ComponentProps<typeof Input> = {},
    required = false,
  ) => (
    <Field id={`edit-${name}`} label={labelText} error={err(name)} required={required}>
      <Input {...register(name)} {...props} {...fieldAria(`edit-${name}`, err(name))} />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit lead</DialogTitle>
          <DialogDescription>
            Changes are saved to the lead and the score is recalculated.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Contact</legend>
            {text("first_name", "First name", {}, true)}
            {text("last_name", "Last name")}
            {text("company", "Company")}
            {text("mobile", "Mobile", { inputMode: "tel", autoComplete: "off" })}
            {text("phone", "Other phone", { inputMode: "tel", autoComplete: "off" })}
            {text("email", "Email", { type: "email", autoComplete: "off" })}
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Property</legend>
            {text("street", "Street")}
            {text("unit", "Unit")}
            {text("city", "City")}
            <div className="grid grid-cols-2 gap-4">
              {text("state", "State", { maxLength: 2 })}
              {text("zip", "ZIP", { inputMode: "numeric", maxLength: 10 })}
            </div>
            {text("year_built", "Year built", { inputMode: "numeric", maxLength: 4 })}
            <Field id="edit-home_built" label="Built before 1978?" error={err("home_built")}>
              <select
                {...register("home_built", { setValueAs: nullIfEmpty })}
                className={selectClass}
                {...fieldAria("edit-home_built", err("home_built"))}
              >
                <option value="">Not asked yet</option>
                {HOME_BUILT.map((h) => (
                  <option key={h} value={h}>
                    {HOME_BUILT_LABELS[h]}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="edit-property_type" label="Property type" error={err("property_type")}>
              <select
                {...register("property_type")}
                className={selectClass}
                {...fieldAria("edit-property_type", err("property_type"))}
              >
                <option value="">—</option>
                {choices(options, "property_type", data.lead.propertyType).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="edit-stories" label="Stories" error={err("stories")}>
              <select
                {...register("stories")}
                className={selectClass}
                {...fieldAria("edit-stories", err("stories"))}
              >
                <option value="">—</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </Field>
            <Field id="edit-siding_type" label="Siding" error={err("siding_type")}>
              <select
                {...register("siding_type")}
                className={selectClass}
                {...fieldAria("edit-siding_type", err("siding_type"))}
              >
                <option value="">—</option>
                {choices(options, "siding_type", data.lead.sidingType).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="edit-has_hoa" label="HOA" error={err("has_hoa")}>
              <Controller
                control={control}
                name="has_hoa"
                render={({ field }) => (
                  <select
                    id="edit-has_hoa"
                    className={selectClass}
                    value={field.value === true ? "yes" : field.value === false ? "no" : ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "yes" ? true : e.target.value === "no" ? false : null,
                      )
                    }
                    onBlur={field.onBlur}
                  >
                    <option value="">Not sure</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                )}
              />
            </Field>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Qualify</legend>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-sm font-medium" id="edit-services-label">
                Services
              </span>
              <Controller
                control={control}
                name="services"
                render={({ field }) => {
                  const value = (field.value ?? []) as Service[];
                  return (
                    <div
                      role="group"
                      aria-labelledby="edit-services-label"
                      className="flex flex-wrap gap-x-5 gap-y-2"
                    >
                      {SERVICES.map((s) => (
                        <div key={s} className="flex items-center gap-2">
                          <Checkbox
                            id={`edit-service-${s}`}
                            checked={value.includes(s)}
                            onCheckedChange={(on) =>
                              field.onChange(
                                on === true ? [...value, s] : value.filter((x) => x !== s),
                              )
                            }
                          />
                          <Label htmlFor={`edit-service-${s}`} className="font-normal">
                            {SERVICE_LABELS[s]}
                          </Label>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
            </div>
            <Field id="edit-timeline" label="Timeline" error={err("timeline")}>
              <select
                {...register("timeline", { setValueAs: nullIfEmpty })}
                className={selectClass}
                {...fieldAria("edit-timeline", err("timeline"))}
              >
                <option value="">Not asked yet</option>
                {TIMELINES.map((t) => (
                  <option key={t} value={t}>
                    {TIMELINE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="edit-lead_source" label="Source" required error={err("lead_source")}>
              <select
                {...register("lead_source", {
                  onChange: () => form.setValue("lead_sub_source", ""),
                })}
                className={selectClass}
                {...fieldAria("edit-lead_source", err("lead_source"))}
              >
                {choices(options, "lead_source", data.lead.leadSource).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="edit-lead_sub_source" label="Sub-source" error={err("lead_sub_source")}>
              <select
                {...register("lead_sub_source")}
                className={selectClass}
                disabled={subSources.length === 0}
                {...fieldAria("edit-lead_sub_source", err("lead_sub_source"))}
              >
                <option value="">{subSources.length ? "—" : "None for this source"}</option>
                {subSources.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="edit-lead_set_by" label="Lead set by" error={err("lead_set_by")}>
              <select
                {...register("lead_set_by")}
                className={selectClass}
                {...fieldAria("edit-lead_set_by", err("lead_set_by"))}
              >
                <option value="">—</option>
                {options.users.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="edit-owner_id"
              label="Owner"
              error={err("owner_id")}
              description={
                data.can.assign ? undefined : "Only people who can assign leads change the owner."
              }
            >
              <select
                {...register("owner_id")}
                className={selectClass}
                disabled={!data.can.assign}
                {...fieldAria("edit-owner_id", err("owner_id"), !data.can.assign)}
              >
                <option value="">Unassigned</option>
                {!options.users.some((u) => u.value === data.lead.ownerId) && data.lead.ownerId && (
                  <option value={data.lead.ownerId}>
                    {data.lead.ownerName ?? "Current owner"}
                  </option>
                )}
                {options.users.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="edit-customer_notes"
              label="Customer notes"
              error={err("customer_notes")}
              className="sm:col-span-2"
            >
              <Textarea
                rows={3}
                {...register("customer_notes")}
                {...fieldAria("edit-customer_notes", err("customer_notes"))}
              />
            </Field>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
              Save lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
