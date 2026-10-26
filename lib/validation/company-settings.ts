import { z } from "zod";
import {
  WEEKDAYS,
  isValidMonthDay,
  isValidTime,
  type BusinessHours,
} from "@/lib/domain/company-settings";
import {
  moneyCents,
  optionalMoneyCents,
  optionalText,
  optionalUrl,
  requiredText,
} from "@/lib/validation/common";

/**
 * Company Settings form (SPEC §8.19). Placeholders like [PHONE] are allowed
 * on purpose: real values come from the owners.
 */

const placeholderOr = (label: string, check: (v: string) => boolean, hint: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required (use the placeholder until you have it).`)
    .refine((v) => /^\[[A-Z_]+\]$/.test(v) || check(v), hint);

const dayHours = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("closed") }),
  z.object({ mode: z.literal("by_appointment") }),
  z
    .object({ mode: z.literal("open"), open: z.string(), close: z.string() })
    .refine((d) => isValidTime(d.open) && isValidTime(d.close), "Use times like 08:00.")
    .refine((d) => d.open < d.close, "Closing time must be after opening time."),
]);

export const companySettingsSchema = z
  .object({
    company_name: requiredText("Company name", 120),
    tagline: optionalText(200),
    website_url: optionalUrl,
    service_area_note: optionalText(300),
    phone: placeholderOr(
      "Phone",
      (v) => /^[+\d()\-.\s]{7,20}$/.test(v),
      "Use a phone number like (425) 555-0100.",
    ),
    email: placeholderOr(
      "Email",
      (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
      "Use an email like hello@example.com.",
    ),
    hours_text: requiredText("Hours", 120),
    lni_number: requiredText("L&I registration #", 40),
    ubi_number: requiredText("UBI #", 40),
    rrp_firm_certification: optionalText(80),
    rrp_firm_cert_expires_on: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a date."),
    business_hours: z.object(
      Object.fromEntries(WEEKDAYS.map((d) => [d, dayHours])) as Record<
        (typeof WEEKDAYS)[number],
        typeof dayHours
      >,
    ),
    text_back_sla_minutes: z.coerce
      .number()
      .int()
      .min(1, "At least 1 minute.")
      .max(240, "At most 240 minutes."),
    estimate_sla_hours: z.coerce.number().int().min(1).max(168, "At most 168 hours."),
    estimate_sla_warn_hours: z.coerce.number().int().min(1).max(168),
    on_time_guarantee: moneyCents("On-time guarantee"),
    exterior_season_start: z.string().refine(isValidMonthDay, "Use MM-DD, like 06-01."),
    exterior_season_end: z.string().refine(isValidMonthDay, "Use MM-DD, like 09-30."),
    deposit_percent: z.coerce.number().min(0, "0 to 100.").max(100, "0 to 100."),
    estimate_expiry_days: z.coerce.number().int().min(1).max(365),
    auto_convert_on_walkthrough: z.boolean(),
    review_link: optionalUrl,
    referral_reward: optionalMoneyCents("Referral reward"),
  })
  .refine((v) => v.estimate_sla_warn_hours <= v.estimate_sla_hours, {
    path: ["estimate_sla_warn_hours"],
    message: "The warning must come before the deadline.",
  });

export type CompanySettingsInput = z.input<typeof companySettingsSchema>;
export type CompanySettingsValues = z.output<typeof companySettingsSchema>;

export type DayHoursForm = z.input<typeof dayHours>;

export function toFormHours(hours: BusinessHours): Record<(typeof WEEKDAYS)[number], DayHoursForm> {
  const out = {} as Record<(typeof WEEKDAYS)[number], DayHoursForm>;
  for (const d of WEEKDAYS) {
    const h = hours[d];
    out[d] =
      h === null
        ? { mode: "closed" }
        : "by_appointment" in h
          ? { mode: "by_appointment" }
          : { mode: "open", ...h };
  }
  return out;
}

export function fromFormHours(hours: CompanySettingsValues["business_hours"]): BusinessHours {
  const out = {} as BusinessHours;
  for (const d of WEEKDAYS) {
    const h = hours[d];
    out[d] =
      h.mode === "closed"
        ? null
        : h.mode === "by_appointment"
          ? { by_appointment: true }
          : { open: h.open, close: h.close };
  }
  return out;
}
