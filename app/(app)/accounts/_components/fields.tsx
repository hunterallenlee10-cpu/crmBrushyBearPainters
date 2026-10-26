"use client";

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { formatDate } from "@/lib/format/dates";
import { HOME_BUILT, HOME_BUILT_LABELS } from "@/lib/domain/leads/constants";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  CONTACT_ROLES,
  CONTACT_ROLE_LABELS,
  OCCUPANCY,
  OCCUPANCY_LABELS,
  PREFERRED_CHANNELS,
  PREFERRED_CHANNEL_LABELS,
  needsLeadSafe,
  type AccountInput,
  type ContactInput,
  type PropertyInput,
} from "@/lib/validation/accounts";
import { LeadSafeBadge } from "./badges";
import {
  CheckboxRow,
  NativeSelect,
  TOUCH,
  visibleOptions,
  type AccountFormOptions,
} from "./form-bits";

/**
 * Field groups shared by "New account" and the edit dialogs. Each reads the
 * surrounding react-hook-form (FormProvider) under its own key: `account`,
 * `contact` or `property`, so server field errors ("contact.email") line up.
 */

type AccountShape = { account: AccountInput };
type ContactShape = { contact: ContactInput };
type PropertyShape = { property: PropertyInput };

export function AccountFields({
  idPrefix,
  options,
}: {
  idPrefix: string;
  options: AccountFormOptions;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<AccountShape>();
  const e = errors.account;
  const id = (k: string) => `${idPrefix}-account-${k}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        id={id("display_name")}
        label="Account name"
        required
        error={e?.display_name?.message}
        description='Usually the household, like "Smith Residence".'
        className="sm:col-span-2"
      >
        <Input
          className={TOUCH}
          autoComplete="off"
          {...register("account.display_name")}
          {...fieldAria(id("display_name"), e?.display_name?.message, true)}
        />
      </Field>
      <Field id={id("account_type")} label="Type" required error={e?.account_type?.message}>
        <NativeSelect
          {...register("account.account_type")}
          {...fieldAria(id("account_type"), e?.account_type?.message)}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={id("status")} label="Status" required error={e?.status?.message}>
        <NativeSelect
          {...register("account.status")}
          {...fieldAria(id("status"), e?.status?.message)}
        >
          {ACCOUNT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ACCOUNT_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={id("owner_id")} label="Owner" error={e?.owner_id?.message}>
        <NativeSelect
          {...register("account.owner_id")}
          {...fieldAria(id("owner_id"), e?.owner_id?.message)}
        >
          <option value="">Unassigned</option>
          {options.users.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        id={id("tags")}
        label="Tags"
        error={e?.tags?.message}
        description="Separate tags with commas."
      >
        <Input
          className={TOUCH}
          autoComplete="off"
          {...register("account.tags")}
          {...fieldAria(id("tags"), e?.tags?.message, true)}
        />
      </Field>
      <CheckboxRow
        id={id("is_referral_champion")}
        label="Referral champion"
        hint="Sends us referrals. Shows a star on the account."
        className="sm:col-span-2"
        {...register("account.is_referral_champion")}
      />
      <Field id={id("notes")} label="Notes" error={e?.notes?.message} className="sm:col-span-2">
        <Textarea
          rows={3}
          {...register("account.notes")}
          {...fieldAria(id("notes"), e?.notes?.message)}
        />
      </Field>
    </div>
  );
}

export function ContactFields({
  idPrefix,
  optedOutAt,
  smsOptInAt,
  emailOptInAt,
  hideRole = false,
}: {
  idPrefix: string;
  /** Set when the person replied STOP; consent can't be turned back on here. */
  optedOutAt?: string | null;
  smsOptInAt?: string | null;
  emailOptInAt?: string | null;
  hideRole?: boolean;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<ContactShape>();
  const e = errors.contact;
  const id = (k: string) => `${idPrefix}-contact-${k}`;
  const [sms, email, dnc] = useWatch({
    control,
    name: ["contact.sms_opt_in", "contact.email_opt_in", "contact.do_not_contact"],
  });
  const consentLocked = Boolean(dnc) || Boolean(optedOutAt);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={id("first_name")} label="First name" required error={e?.first_name?.message}>
        <Input
          className={TOUCH}
          autoComplete="off"
          {...register("contact.first_name")}
          {...fieldAria(id("first_name"), e?.first_name?.message)}
        />
      </Field>
      <Field id={id("last_name")} label="Last name" error={e?.last_name?.message}>
        <Input
          className={TOUCH}
          autoComplete="off"
          {...register("contact.last_name")}
          {...fieldAria(id("last_name"), e?.last_name?.message)}
        />
      </Field>
      <Field id={id("mobile")} label="Mobile" error={e?.mobile?.message}>
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          className={TOUCH}
          {...register("contact.mobile")}
          {...fieldAria(id("mobile"), e?.mobile?.message)}
        />
      </Field>
      <Field id={id("email")} label="Email" error={e?.email?.message}>
        <Input
          type="email"
          autoComplete="off"
          className={TOUCH}
          {...register("contact.email")}
          {...fieldAria(id("email"), e?.email?.message)}
        />
      </Field>
      <Field id={id("phone")} label="Other phone" error={e?.phone?.message}>
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          className={TOUCH}
          {...register("contact.phone")}
          {...fieldAria(id("phone"), e?.phone?.message)}
        />
      </Field>
      <Field id={id("preferred_channel")} label="Prefers" error={e?.preferred_channel?.message}>
        <NativeSelect
          {...register("contact.preferred_channel")}
          {...fieldAria(id("preferred_channel"), e?.preferred_channel?.message)}
        >
          <option value="">No preference</option>
          {PREFERRED_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {PREFERRED_CHANNEL_LABELS[c]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {!hideRole && (
        <Field id={id("role")} label="Role on the account" required error={e?.role?.message}>
          <NativeSelect {...register("contact.role")} {...fieldAria(id("role"), e?.role?.message)}>
            {CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {CONTACT_ROLE_LABELS[r]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field
        id={id("language")}
        label="Language"
        error={e?.language?.message}
        description="Code like en or es."
      >
        <Input
          className={TOUCH}
          autoComplete="off"
          {...register("contact.language")}
          {...fieldAria(id("language"), e?.language?.message, true)}
        />
      </Field>

      <fieldset className="flex flex-col gap-3 rounded-xl border p-3 sm:col-span-2">
        <legend className="px-1 text-sm font-semibold">Marketing consent</legend>
        {optedOutAt ? (
          <p className="text-xs text-danger">
            Replied STOP on {formatDate(optedOutAt)}. They have to opt back in themselves.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only check these when the person agreed. Write down where they agreed.
          </p>
        )}
        <CheckboxRow
          id={id("sms_opt_in")}
          label="Opted in to marketing texts"
          hint={smsOptInAt && sms ? `Since ${formatDate(smsOptInAt)}` : undefined}
          disabled={consentLocked}
          {...register("contact.sms_opt_in")}
        />
        {sms && !consentLocked && (
          <Field
            id={id("sms_opt_in_source")}
            label="Where did they agree to texts?"
            required
            error={e?.sms_opt_in_source?.message}
            description="For example: website form checkbox, or verbally on a call with Erik."
          >
            <Input
              className={TOUCH}
              autoComplete="off"
              {...register("contact.sms_opt_in_source")}
              {...fieldAria(id("sms_opt_in_source"), e?.sms_opt_in_source?.message, true)}
            />
          </Field>
        )}
        <CheckboxRow
          id={id("email_opt_in")}
          label="Opted in to marketing email"
          hint={emailOptInAt && email ? `Since ${formatDate(emailOptInAt)}` : undefined}
          disabled={consentLocked}
          {...register("contact.email_opt_in")}
        />
        {email && !consentLocked && (
          <Field
            id={id("email_opt_in_source")}
            label="Where did they agree to email?"
            required
            error={e?.email_opt_in_source?.message}
          >
            <Input
              className={TOUCH}
              autoComplete="off"
              {...register("contact.email_opt_in_source")}
              {...fieldAria(id("email_opt_in_source"), e?.email_opt_in_source?.message)}
            />
          </Field>
        )}
        <CheckboxRow
          id={id("do_not_contact")}
          label="Do not contact"
          hint="Blocks all marketing and turns off both opt-ins."
          {...register("contact.do_not_contact")}
        />
      </fieldset>

      <Field
        id={id("notes")}
        label="Notes about this person"
        error={e?.notes?.message}
        className="sm:col-span-2"
      >
        <Textarea
          rows={2}
          {...register("contact.notes")}
          {...fieldAria(id("notes"), e?.notes?.message)}
        />
      </Field>
    </div>
  );
}

export function PropertyFields({
  idPrefix,
  options,
  compact = false,
  showPrimary = false,
}: {
  idPrefix: string;
  options: AccountFormOptions;
  /** Address and the basics only (New account). */
  compact?: boolean;
  showPrimary?: boolean;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<PropertyShape>();
  const e = errors.property;
  const id = (k: string) => `${idPrefix}-property-${k}`;
  const [yearRaw, homeBuilt, hasHoa, propertyType, sidingType] = useWatch({
    control,
    name: [
      "property.year_built",
      "property.home_built",
      "property.has_hoa",
      "property.property_type",
      "property.siding_type",
    ],
  });
  const year = Number(typeof yearRaw === "string" ? yearRaw.trim() : yearRaw);
  const leadSafe = needsLeadSafe({
    year_built:
      yearRaw !== "" && yearRaw !== null && yearRaw !== undefined && Number.isInteger(year)
        ? year
        : null,
    home_built: homeBuilt ?? null,
  });

  const text = (
    key:
      | "street"
      | "unit"
      | "city"
      | "state"
      | "zip"
      | "year_built"
      | "approx_sqft"
      | "hoa_name"
      | "hoa_contact"
      | "pets"
      | "parking"
      | "alarm"
      | "water_power_access",
    label: string,
    extra: {
      required?: boolean;
      description?: string;
      className?: string;
      inputMode?: "numeric" | "text";
      autoComplete?: string;
    } = {},
  ) => {
    const msg = e?.[key]?.message;
    return (
      <Field
        id={id(key)}
        label={label}
        required={extra.required}
        error={msg}
        description={extra.description}
        className={extra.className}
      >
        <Input
          className={TOUCH}
          inputMode={extra.inputMode}
          autoComplete={extra.autoComplete ?? "off"}
          {...register(`property.${key}`)}
          {...fieldAria(id(key), msg, Boolean(extra.description))}
        />
      </Field>
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      {text("street", "Street address", { className: "sm:col-span-4" })}
      {text("unit", "Unit", { className: "sm:col-span-2" })}
      {text("city", "City", { className: "sm:col-span-3" })}
      {text("state", "State", { className: "sm:col-span-1" })}
      {text("zip", "ZIP", {
        required: true,
        inputMode: "numeric",
        className: "sm:col-span-2",
        description: "Sets the territory.",
      })}
      {text("year_built", "Year built", {
        inputMode: "numeric",
        className: "sm:col-span-2",
      })}
      <Field
        id={id("home_built")}
        label="If the year isn't known"
        error={e?.home_built?.message}
        className="sm:col-span-2"
      >
        <NativeSelect
          {...register("property.home_built")}
          {...fieldAria(id("home_built"), e?.home_built?.message)}
        >
          <option value="">—</option>
          {HOME_BUILT.map((h) => (
            <option key={h} value={h}>
              {HOME_BUILT_LABELS[h]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="flex items-end pb-2 sm:col-span-2" aria-live="polite">
        {leadSafe && <LeadSafeBadge />}
      </div>
      <Field
        id={id("property_type")}
        label="Home type"
        error={e?.property_type?.message}
        className="sm:col-span-2"
      >
        <NativeSelect
          {...register("property.property_type")}
          {...fieldAria(id("property_type"), e?.property_type?.message)}
        >
          <option value="">—</option>
          {visibleOptions(options.propertyTypes, propertyType).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        id={id("siding_type")}
        label="Siding"
        error={e?.siding_type?.message}
        className="sm:col-span-2"
      >
        <NativeSelect
          {...register("property.siding_type")}
          {...fieldAria(id("siding_type"), e?.siding_type?.message)}
        >
          <option value="">—</option>
          {visibleOptions(options.sidingTypes, sidingType).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        id={id("stories")}
        label="Stories"
        error={e?.stories?.message}
        className="sm:col-span-2"
      >
        <NativeSelect
          {...register("property.stories")}
          {...fieldAria(id("stories"), e?.stories?.message)}
        >
          <option value="">—</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3 or more</option>
        </NativeSelect>
      </Field>

      {!compact && (
        <>
          {text("approx_sqft", "Approx. square feet", {
            inputMode: "numeric",
            className: "sm:col-span-3",
          })}
          <Field
            id={id("occupancy")}
            label="Occupancy"
            error={e?.occupancy?.message}
            className="sm:col-span-3"
          >
            <NativeSelect
              {...register("property.occupancy")}
              {...fieldAria(id("occupancy"), e?.occupancy?.message)}
            >
              <option value="">—</option>
              {OCCUPANCY.map((o) => (
                <option key={o} value={o}>
                  {OCCUPANCY_LABELS[o]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <fieldset className="flex flex-col gap-3 rounded-xl border p-3 sm:col-span-6">
            <legend className="px-1 text-sm font-semibold">HOA</legend>
            <CheckboxRow id={id("has_hoa")} label="Has an HOA" {...register("property.has_hoa")} />
            {hasHoa && (
              <div className="grid gap-4 sm:grid-cols-2">
                {text("hoa_name", "HOA name")}
                {text("hoa_contact", "HOA contact")}
                <CheckboxRow
                  id={id("hoa_color_approval_required")}
                  label="Colors need HOA approval"
                  className="sm:col-span-2"
                  {...register("property.hoa_color_approval_required")}
                />
              </div>
            )}
          </fieldset>
          <Field
            id={id("access_notes")}
            label="Access notes"
            error={e?.access_notes?.message}
            description="Where to park, which door, who lets the crew in. Put gate codes in the code field, not here."
            className="sm:col-span-6"
          >
            <Textarea
              rows={2}
              {...register("property.access_notes")}
              {...fieldAria(id("access_notes"), e?.access_notes?.message, true)}
            />
          </Field>
          {text("pets", "Pets", { className: "sm:col-span-3" })}
          {text("parking", "Parking", { className: "sm:col-span-3" })}
          {text("alarm", "Alarm", { className: "sm:col-span-3" })}
          {text("water_power_access", "Water / power for washing", {
            className: "sm:col-span-3",
          })}
        </>
      )}
      {showPrimary && (
        <CheckboxRow
          id={id("is_primary")}
          label="Primary property"
          hint="The account's territory follows its primary property."
          className="sm:col-span-6"
          {...register("property.is_primary")}
        />
      )}
    </div>
  );
}
