"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Paperclip,
  Phone,
  Save,
  ShieldAlert,
  Shuffle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Field, fieldAria } from "@/components/forms/field";
import { createSupabaseBrowserClient } from "@/lib/db/browser";
import { normalizeEmail, normalizePhone } from "@/lib/domain/leads/normalize";
import { normalizeZip, territoryForZip, type TerritoryLite } from "@/lib/domain/territory";
import {
  HOME_BUILT,
  HOME_BUILT_LABELS,
  SERVICES,
  SERVICE_LABELS,
  TIMELINES,
  TIMELINE_LABELS,
  type HomeBuilt,
} from "@/lib/domain/leads/constants";
import type { LeadCreateInput } from "@/lib/validation/leads";
import type { ActionError } from "@/lib/actions/errors";
import { leadCompletion } from "./completion";
import {
  PHOTO_ACCEPT,
  MAX_PHOTOS,
  addPhotos,
  formatBytes,
  homeBuiltFromYear,
  needsLeadSafe,
  photoContentType,
  resolveHomeBuilt,
  stepForField,
  subSourcesFor,
  wizardStep1Schema,
  wizardStep2Schema,
  wizardStep3Schema,
  type PhotoMeta,
  type SubSourceOption,
  type WizardStep,
} from "./helpers";
import {
  attachLeadPhotos,
  checkLeadDuplicates,
  createLead,
  createLeadPhotoUploads,
  type DuplicateNotice,
} from "./actions";
import {
  ChoiceGroup,
  CompletionMeter,
  DuplicateBanner,
  NativeSelect,
  STEP_TITLES,
  StepIndicator,
  TOUCH,
  UnavailableButton,
} from "./wizard-parts";

type Option = { value: string; label: string };

export type WizardOptions = {
  sources: Option[];
  subSources: (Option & SubSourceOption)[];
  propertyTypes: Option[];
  sidingTypes: Option[];
  users: Option[];
  territories: TerritoryLite[];
};

type FormValues = LeadCreateInput;

const AFTER_SAVE = "Available after the lead is saved";
const STORIES = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3+" },
] as const;
const HOA = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;
const HOME_BUILT_CHOICES = HOME_BUILT.map((v) => ({ value: v, label: HOME_BUILT_LABELS[v] }));

/** Validates only the current step; step 3 validates everything (server re-validates too). */
function stepResolver(
  getStep: () => WizardStep,
  subSources: readonly SubSourceOption[],
): Resolver<FormValues> {
  const step1 = zodResolver(wizardStep1Schema);
  const step2 = zodResolver(wizardStep2Schema);
  const step3 = zodResolver(wizardStep3Schema(subSources));
  return async (values, context, options) => {
    const step = getStep();
    // `names` only filters which errors RHF shows; zodResolver doesn't read it.
    const opts = { ...options, names: undefined };
    const result =
      step === 1
        ? await step1(values, context, opts)
        : step === 2
          ? await step2(values, context, opts)
          : await step3(values, context, opts);
    if (Object.keys(result.errors).length > 0) return { values: {}, errors: result.errors };
    // The raw values go to the server action, which normalizes them.
    return { values, errors: {} };
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function NewLeadWizard({
  me,
  canAssign,
  readOnly,
  options,
}: {
  me: { id: string; name: string };
  canAssign: boolean;
  readOnly: boolean;
  options: WizardOptions;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<WizardStep>(1);
  const stepRef = React.useRef<WizardStep>(1);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const movedRef = React.useRef(false);
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [photoProblems, setPhotoProblems] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState<null | "save" | "book">(null);
  const [duplicates, setDuplicates] = React.useState<DuplicateNotice[]>([]);

  const resolver = React.useMemo(
    () => stepResolver(() => stepRef.current, options.subSources),
    [options.subSources],
  );
  const form = useForm<FormValues>({
    resolver,
    defaultValues: {
      first_name: "",
      last_name: "",
      company: "",
      mobile: "",
      phone: "",
      email: "",
      street: "",
      unit: "",
      city: "",
      state: "WA",
      zip: "",
      year_built: "",
      home_built: null,
      property_type: "",
      stories: "",
      siding_type: "",
      has_hoa: null,
      services: [],
      timeline: null,
      lead_source: "",
      lead_sub_source: "",
      lead_set_by: me.id,
      owner_id: me.id,
      customer_notes: "",
    },
  });
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    getValues,
    formState: { errors },
  } = form;
  const values = useWatch({ control });

  const err = (k: keyof FormValues): string | undefined => {
    const e = errors[k];
    return e && "message" in e && typeof e.message === "string" ? e.message : undefined;
  };

  // Step changes ---------------------------------------------------------------

  const goTo = React.useCallback((next: WizardStep) => {
    stepRef.current = next;
    movedRef.current = true;
    setStep(next);
  }, []);

  React.useEffect(() => {
    if (!movedRef.current) return;
    headingRef.current?.focus();
  }, [step]);

  // Live duplicate check (debounced) --------------------------------------------

  const dupInput = {
    mobile: str(values.mobile),
    phone: str(values.phone),
    email: str(values.email),
    street: str(values.street),
    zip: str(values.zip),
  };
  const dupKey = [
    normalizePhone(dupInput.mobile),
    normalizePhone(dupInput.phone),
    normalizeEmail(dupInput.email),
    normalizeZip(dupInput.zip) ? dupInput.street.trim().toLowerCase() : "",
    normalizeZip(dupInput.zip),
  ].join("|");
  const dupSeq = React.useRef(0);

  React.useEffect(() => {
    const [mobile, phone, email, street, zip] = dupKey.split("|");
    if (!mobile && !phone && !email && !(street && zip)) {
      setDuplicates([]);
      return;
    }
    const seq = ++dupSeq.current;
    const timer = setTimeout(async () => {
      const result = await checkLeadDuplicates({
        mobile: mobile || null,
        phone: phone || null,
        email: email || null,
        street: street || null,
        zip: zip || null,
      });
      if (seq !== dupSeq.current) return;
      setDuplicates(result.ok ? result.data : []);
    }, 500);
    return () => clearTimeout(timer);
  }, [dupKey]);

  // Derived display ------------------------------------------------------------

  const completion = leadCompletion({
    first_name: str(values.first_name),
    last_name: str(values.last_name),
    mobile: str(values.mobile),
    phone: str(values.phone),
    email: str(values.email),
    street: str(values.street),
    city: str(values.city),
    zip: str(values.zip),
    year_built: typeof values.year_built === "number" ? values.year_built : str(values.year_built),
    home_built: values.home_built ?? null,
    property_type: str(values.property_type),
    stories: typeof values.stories === "number" ? values.stories : str(values.stories),
    siding_type: str(values.siding_type),
    has_hoa: values.has_hoa ?? null,
    services: (values.services ?? []).filter((s): s is NonNullable<typeof s> => Boolean(s)),
    timeline: values.timeline ?? null,
    lead_source: str(values.lead_source),
    customer_notes: str(values.customer_notes),
    photoCount: photos.length,
  });

  const zip = normalizeZip(str(values.zip));
  const zipComplete = /^\d{5}$/.test(str(values.zip).trim()) && zip !== null;
  const territory = zipComplete ? territoryForZip(options.territories, zip) : null;
  const homeBuilt = resolveHomeBuilt(
    typeof values.year_built === "number" ? values.year_built : str(values.year_built),
    values.home_built ?? null,
  );
  const leadSafe = needsLeadSafe(homeBuilt);
  const source = str(values.lead_source);
  const subOptions = subSourcesFor(source, options.subSources);

  // Saving ---------------------------------------------------------------------

  function applyServerError(error: ActionError) {
    const entries = Object.entries(error.fieldErrors ?? {});
    let firstStep: WizardStep | null = null;
    for (const [key, messages] of entries) {
      if (!messages[0] || key === "_form") continue;
      setError(key as keyof FormValues, { message: messages[0] });
      const s = stepForField(key);
      firstStep = firstStep === null ? s : (Math.min(firstStep, s) as WizardStep);
    }
    if (firstStep !== null && firstStep !== stepRef.current) goTo(firstStep);
    toast.error(error.message);
  }

  async function uploadPhotos(leadId: string, files: File[]): Promise<number> {
    const meta: PhotoMeta[] = [];
    for (const f of files) {
      const type = photoContentType(f);
      if (type)
        meta.push({ file_name: f.name.slice(-200), content_type: type, size_bytes: f.size });
    }
    if (meta.length === 0) return files.length;
    const urls = await createLeadPhotoUploads({ lead_id: leadId, files: meta });
    if (!urls.ok) return files.length;
    const supabase = createSupabaseBrowserClient();
    const uploaded = await Promise.all(
      urls.data.uploads.map(async (u, i) => {
        const m = meta[i];
        const file = files[i];
        if (!m || !file) return null;
        const { error } = await supabase.storage
          .from(urls.data.bucket)
          .uploadToSignedUrl(u.path, u.token, file, { contentType: m.content_type });
        return error ? null : { ...m, path: u.path };
      }),
    );
    const done = uploaded.filter((u): u is PhotoMeta & { path: string } => u !== null);
    if (done.length === 0) return files.length;
    const attached = await attachLeadPhotos({ lead_id: leadId, photos: done });
    return attached.ok ? files.length - attached.data.attached : files.length;
  }

  async function save(book: boolean) {
    if (readOnly) return;
    setSaving(book ? "book" : "save");
    try {
      const result = await createLead(getValues());
      if (!result.ok) {
        applyServerError(result.error);
        return;
      }
      const id = result.data.id;
      if (photos.length > 0) {
        const failed = await uploadPhotos(id, photos);
        if (failed > 0) {
          toast.warning(
            `Lead saved, but ${failed === 1 ? "1 file" : `${failed} files`} didn't upload. Add them from the lead.`,
          );
        } else {
          toast.success("Lead saved with photos.");
        }
      } else {
        toast.success("Lead saved.");
      }
      router.push(book ? `/leads/${id}?book=1` : `/leads/${id}`);
    } catch {
      toast.error("Something went wrong. Try again, and tell an owner if it keeps happening.");
    } finally {
      setSaving(null);
    }
  }

  const onNext = handleSubmit(() => {
    if (stepRef.current < 3) goTo((stepRef.current + 1) as WizardStep);
  });
  const onSave = (book: boolean) => handleSubmit(() => save(book));

  function onFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (stepRef.current < 3) void onNext(e);
    else void onSave(false)(e);
  }

  // Render ---------------------------------------------------------------------

  const heading = STEP_TITLES[step].heading;
  const busy = saving !== null;
  // Step 3 has more footer buttons, so Call / SMS / Email show as icons (names stay for screen readers).
  const compactComms = step === 3;

  return (
    <form onSubmit={onFormSubmit} noValidate className="flex flex-col gap-5" aria-busy={busy}>
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <StepIndicator step={step} onGoTo={goTo} />
        <div className="sm:w-64">
          <CompletionMeter completion={completion} />
        </div>
      </div>

      {readOnly && (
        <p className="rounded-xl border border-warning/30 bg-warning-bg p-3 text-sm" role="note">
          You&apos;re viewing as another user, so saving is off. Exit View as user to add a lead.
        </p>
      )}

      <section
        className="flex flex-col gap-5 rounded-2xl border bg-card p-4 sm:p-5"
        aria-labelledby="wizard-step-heading"
      >
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Step {step} of 3
          </p>
          <h2
            id="wizard-step-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            {heading}
          </h2>
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="first_name" label="First name" required error={err("first_name")}>
                <Input
                  autoComplete="off"
                  className={TOUCH}
                  {...register("first_name")}
                  {...fieldAria("first_name", err("first_name"))}
                  aria-required
                />
              </Field>
              <Field id="last_name" label="Last name" required error={err("last_name")}>
                <Input
                  autoComplete="off"
                  className={TOUCH}
                  {...register("last_name")}
                  {...fieldAria("last_name", err("last_name"))}
                  aria-required
                />
              </Field>
              <Field
                id="company"
                label="Company"
                error={err("company")}
                description="Only for property managers, HOAs or businesses."
                className="sm:col-span-2"
              >
                <Input
                  autoComplete="off"
                  className={TOUCH}
                  {...register("company")}
                  {...fieldAria("company", err("company"), true)}
                />
              </Field>
            </div>
            <fieldset className="flex flex-col gap-3 rounded-xl border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">How to reach them</legend>
              <p id="contact-help" className="-mt-1 text-xs text-muted-foreground">
                Add at least one: mobile, phone or email.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="mobile" label="Mobile" error={err("mobile")}>
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    className={TOUCH}
                    {...register("mobile")}
                    {...fieldAria("mobile", err("mobile"))}
                  />
                </Field>
                <Field id="phone" label="Other phone" error={err("phone")}>
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    className={TOUCH}
                    {...register("phone")}
                    {...fieldAria("phone", err("phone"))}
                  />
                </Field>
                <Field id="email" label="Email" error={err("email")}>
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    className={TOUCH}
                    {...register("email")}
                    {...fieldAria("email", err("email"))}
                  />
                </Field>
              </div>
            </fieldset>
            <DuplicateBanner hits={duplicates} />
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-5">
            <p className="flex items-start gap-2 rounded-xl border bg-bb-cream-light p-3 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              Type the address. Address lookup and the map preview turn on once the maps integration
              is connected in Admin → Integrations.
            </p>
            <div className="grid gap-4 sm:grid-cols-6">
              <Field id="street" label="Street" error={err("street")} className="sm:col-span-4">
                <Input
                  autoComplete="off"
                  className={TOUCH}
                  {...register("street")}
                  {...fieldAria("street", err("street"))}
                />
              </Field>
              <Field id="unit" label="Unit" error={err("unit")} className="sm:col-span-2">
                <Input
                  autoComplete="off"
                  className={TOUCH}
                  {...register("unit")}
                  {...fieldAria("unit", err("unit"))}
                />
              </Field>
              <Field id="city" label="City" error={err("city")} className="sm:col-span-3">
                <Input
                  autoComplete="off"
                  className={TOUCH}
                  {...register("city")}
                  {...fieldAria("city", err("city"))}
                />
              </Field>
              <Field id="state" label="State" error={err("state")} className="sm:col-span-1">
                <Input
                  autoComplete="off"
                  maxLength={2}
                  className={TOUCH}
                  {...register("state")}
                  {...fieldAria("state", err("state"))}
                />
              </Field>
              <Field
                id="zip"
                label="ZIP"
                error={err("zip")}
                className="sm:col-span-2"
                description={
                  zipComplete ? (
                    territory ? (
                      <span data-testid="territory-note">Territory: {territory.name}</span>
                    ) : (
                      <span
                        data-testid="territory-note"
                        className="inline-flex items-center gap-1.5"
                      >
                        <Badge variant="warning">Out of area</Badge> Not in a service territory. It
                        still saves.
                      </span>
                    )
                  ) : (
                    "Sets the territory."
                  )
                }
              >
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  className={TOUCH}
                  {...register("zip")}
                  {...fieldAria("zip", err("zip"), true)}
                />
              </Field>
            </div>
            <DuplicateBanner hits={duplicates} />

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="year_built"
                label="Year built"
                error={err("year_built")}
                description="If they know it. Otherwise pick below."
              >
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  className={TOUCH}
                  {...register("year_built", {
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                      const derived = homeBuiltFromYear(e.target.value);
                      if (derived) setValue("home_built", derived);
                    },
                  })}
                  {...fieldAria("year_built", err("year_built"), true)}
                />
              </Field>
              <Controller
                control={control}
                name="home_built"
                render={({ field }) => (
                  <ChoiceGroup<HomeBuilt>
                    name="home_built"
                    legend="Home built"
                    choices={HOME_BUILT_CHOICES}
                    value={field.value ?? null}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
            {leadSafe && (
              <div
                className="flex items-start gap-2 rounded-xl border border-info/20 bg-info-bg p-3 text-sm text-info"
                role="note"
                data-testid="lead-safe-note"
              >
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  <span className="font-semibold">Lead-safe prep applies.</span> Homes built before
                  1978, or when the owner isn&apos;t sure, are planned with lead-safe work
                  practices. The details are confirmed at the walkthrough.
                </p>
              </div>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="property_type" label="Property type" error={err("property_type")}>
                <NativeSelect
                  {...register("property_type")}
                  {...fieldAria("property_type", err("property_type"))}
                >
                  <option value="">Not sure yet</option>
                  {options.propertyTypes.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="siding_type" label="Siding type" error={err("siding_type")}>
                <NativeSelect
                  {...register("siding_type")}
                  {...fieldAria("siding_type", err("siding_type"))}
                >
                  <option value="">Not sure yet</option>
                  {options.sidingTypes.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Controller
                control={control}
                name="stories"
                render={({ field }) => (
                  <ChoiceGroup<"1" | "2" | "3">
                    name="stories"
                    legend="Stories"
                    choices={STORIES}
                    value={
                      field.value === null || field.value === undefined || field.value === ""
                        ? null
                        : (String(field.value) as "1" | "2" | "3")
                    }
                    onChange={field.onChange}
                  />
                )}
              />
              <Controller
                control={control}
                name="has_hoa"
                render={({ field }) => (
                  <ChoiceGroup<"yes" | "no">
                    name="has_hoa"
                    legend="HOA"
                    choices={HOA}
                    value={field.value === true ? "yes" : field.value === false ? "no" : null}
                    onChange={(v) => field.onChange(v === "yes")}
                    description="HOAs often need color approval before work starts."
                  />
                )}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium">Services</legend>
              <div className="flex flex-wrap gap-2">
                {SERVICES.map((s) => (
                  <label
                    key={s}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-sm has-[:checked]:border-bb-forest has-[:checked]:bg-bb-cream sm:min-h-9"
                  >
                    <input
                      type="checkbox"
                      value={s}
                      className="size-4 accent-bb-forest"
                      {...register("services")}
                    />
                    {SERVICE_LABELS[s]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="timeline" label="Timeline" error={err("timeline")}>
                <NativeSelect
                  {...register("timeline", { setValueAs: (v: string) => (v ? v : null) })}
                  {...fieldAria("timeline", err("timeline"))}
                >
                  <option value="">Not sure yet</option>
                  {TIMELINES.map((t) => (
                    <option key={t} value={t}>
                      {TIMELINE_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <div className="hidden sm:block" />
              <Field id="lead_source" label="Source" required error={err("lead_source")}>
                <NativeSelect
                  {...register("lead_source", {
                    onChange: () => setValue("lead_sub_source", ""),
                  })}
                  {...fieldAria("lead_source", err("lead_source"))}
                  aria-required
                >
                  <option value="">Pick a source</option>
                  {options.sources.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {subOptions.length > 0 ? (
                <Field
                  id="lead_sub_source"
                  label="Sub-source"
                  required
                  error={err("lead_sub_source")}
                >
                  <NativeSelect
                    {...register("lead_sub_source")}
                    {...fieldAria("lead_sub_source", err("lead_sub_source"))}
                    aria-required
                  >
                    <option value="">Pick a sub-source</option>
                    {subOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : (
                <div className="hidden sm:block" />
              )}
              <Field id="lead_set_by" label="Lead set by" error={err("lead_set_by")}>
                <NativeSelect
                  {...register("lead_set_by")}
                  {...fieldAria("lead_set_by", err("lead_set_by"))}
                >
                  {options.users.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.value === me.id ? `${u.label} (you)` : u.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {canAssign ? (
                <Field id="owner_id" label="Owner" error={err("owner_id")}>
                  <NativeSelect
                    {...register("owner_id")}
                    {...fieldAria("owner_id", err("owner_id"))}
                  >
                    {options.users.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.value === me.id ? `${u.label} (you)` : u.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : (
                <Field
                  id="owner_id"
                  label="Owner"
                  error={err("owner_id")}
                  description="Leads you add are yours. Only people who can assign leads can pick someone else."
                >
                  <Input
                    readOnly
                    value={`${me.name} (you)`}
                    className={`${TOUCH} bg-muted`}
                    {...fieldAria("owner_id", err("owner_id"), true)}
                  />
                </Field>
              )}
              <Field
                id="customer_notes"
                label="Notes"
                error={err("customer_notes")}
                className="sm:col-span-2"
                description="What they told you: rooms, colors, problems, best time to call."
              >
                <Textarea
                  rows={4}
                  {...register("customer_notes")}
                  {...fieldAria("customer_notes", err("customer_notes"), true)}
                />
              </Field>
            </div>

            <PhotoPicker
              files={photos}
              problems={photoProblems}
              onAdd={(picked) => {
                const r = addPhotos(photos, picked);
                setPhotos(r.files);
                setPhotoProblems(r.problems);
              }}
              onRemove={(i) => {
                setPhotos(photos.filter((_, j) => j !== i));
                setPhotoProblems([]);
              }}
            />
          </div>
        )}
      </section>

      <div className="mb-14 flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-3 py-3 sm:sticky sm:bottom-0 sm:z-10 sm:mb-0 sm:bg-card/95 sm:px-4 sm:backdrop-blur">
        {step > 1 ? (
          <Button
            type="button"
            variant="outline"
            className={TOUCH}
            onClick={() => goTo((step - 1) as WizardStep)}
            disabled={busy}
          >
            <ArrowLeft aria-hidden />
            <span className="sr-only sm:not-sr-only">Previous</span>
          </Button>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <UnavailableButton reason={AFTER_SAVE}>
            <Phone aria-hidden />
            <span className={compactComms ? "sr-only" : "sr-only sm:not-sr-only"}>Call</span>
          </UnavailableButton>
          <UnavailableButton reason={AFTER_SAVE}>
            <MessageSquare aria-hidden />
            <span className={compactComms ? "sr-only" : "sr-only sm:not-sr-only"}>SMS</span>
          </UnavailableButton>
          <UnavailableButton reason={AFTER_SAVE}>
            <Mail aria-hidden />
            <span className={compactComms ? "sr-only" : "sr-only sm:not-sr-only"}>Email</span>
          </UnavailableButton>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button asChild variant="ghost" className={TOUCH}>
            <Link href="/leads/list">Cancel</Link>
          </Button>
          {step < 3 ? (
            <Button type="submit" variant="cta" className={TOUCH}>
              Next
              <ArrowRight aria-hidden />
            </Button>
          ) : (
            <>
              <UnavailableButton reason="Convert to Job arrives in Phase 3">
                <Shuffle aria-hidden />
                Save &amp; Convert
              </UnavailableButton>
              <Button
                type="button"
                variant="outline"
                className={TOUCH}
                disabled={busy || readOnly}
                onClick={(e) => void onSave(false)(e)}
              >
                {saving === "save" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Save aria-hidden />
                )}
                Save lead
              </Button>
              <Button
                type="button"
                variant="cta"
                className={TOUCH}
                disabled={busy || readOnly}
                onClick={(e) => void onSave(true)(e)}
              >
                {saving === "book" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <CalendarPlus aria-hidden />
                )}
                Save &amp; book walkthrough
              </Button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}

function PhotoPicker({
  files,
  problems,
  onAdd,
  onRemove,
}: {
  files: File[];
  problems: string[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium" id="photos-label">
            Photos
          </p>
          <p className="text-xs text-muted-foreground" id="photos-help">
            Optional. Up to {MAX_PHOTOS} photos or PDFs, 15 MB each. They upload when you save.
          </p>
        </div>
        <label
          className={`inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${TOUCH}`}
        >
          <Paperclip className="size-4" aria-hidden />
          Add photos
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={PHOTO_ACCEPT}
            className="sr-only"
            aria-describedby="photos-help"
            disabled={files.length >= MAX_PHOTOS}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) onAdd(picked);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        </label>
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-xs text-danger">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="flex flex-col divide-y rounded-xl border" aria-labelledby="photos-label">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatBytes(f.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 sm:size-8"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${f.name}`}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
