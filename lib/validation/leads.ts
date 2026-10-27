import { z } from "zod";
import { optionalText, requiredText } from "@/lib/validation/common";
import { normalizeEmail, normalizePhone } from "@/lib/domain/leads/normalize";
import { normalizeZip } from "@/lib/domain/territory";
import {
  HOME_BUILT,
  LEAD_STATUSES,
  MANUAL_STATUS_CHOICES,
  SERVICES,
  TIMELINES,
} from "@/lib/domain/leads/constants";

/**
 * Lead form validation shared by the New Lead wizard, Lead Detail edits and
 * server actions (SPEC §8.4). Phones become E.164 and emails lowercase here,
 * so the database only ever sees clean values.
 */

const uuid = z.uuid({ message: "Pick someone from the list." });
const optionalUuid = z
  .union([uuid, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const phoneField = (label: string) =>
  z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (!v) return null;
      const e164 = normalizePhone(v);
      if (!e164) {
        ctx.addIssue({ code: "custom", message: `${label} doesn't look like a phone number.` });
        return z.NEVER;
      }
      return e164;
    });

const emailField = z
  .string()
  .trim()
  .max(254)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const email = normalizeEmail(v);
    if (!email) {
      ctx.addIssue({ code: "custom", message: "That email doesn't look right." });
      return z.NEVER;
    }
    return email;
  });

const zipField = z
  .string()
  .trim()
  .max(10)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const zip = normalizeZip(v);
    if (!zip) {
      ctx.addIssue({ code: "custom", message: "Enter a 5-digit ZIP code." });
      return z.NEVER;
    }
    return zip;
  });

const yearField = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1700 || n > new Date().getFullYear() + 1) {
      ctx.addIssue({ code: "custom", message: "Enter a year like 1962." });
      return z.NEVER;
    }
    return n;
  });

const storiesField = z
  .union([
    z.literal("1"),
    z.literal("2"),
    z.literal("3"),
    z.literal(""),
    z.number().int().min(1).max(3),
  ])
  .optional()
  .nullable()
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)));

/** Contact step (wizard step 1). */
export const leadContactSchema = z.object({
  first_name: requiredText("First name", 80),
  last_name: requiredText("Last name", 80),
  company: optionalText(160),
  mobile: phoneField("Mobile"),
  phone: phoneField("Phone"),
  email: emailField,
});

/** Property step (wizard step 2). */
export const leadPropertySchema = z.object({
  street: optionalText(200),
  unit: optionalText(40),
  city: optionalText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use the 2-letter state code.")
    .default("WA"),
  zip: zipField,
  year_built: yearField,
  home_built: z
    .enum(HOME_BUILT)
    .optional()
    .nullable()
    .transform((v) => v ?? null),
  property_type: optionalText(60),
  stories: storiesField,
  siding_type: optionalText(60),
  has_hoa: z
    .boolean()
    .optional()
    .nullable()
    .transform((v) => v ?? null),
});

/** Qualify step (wizard step 3). */
export const leadQualifySchema = z.object({
  services: z.array(z.enum(SERVICES)).max(5).default([]),
  timeline: z
    .enum(TIMELINES)
    .optional()
    .nullable()
    .transform((v) => v ?? null),
  lead_source: requiredText("Source", 60),
  lead_sub_source: optionalText(60),
  lead_set_by: optionalUuid,
  owner_id: optionalUuid,
  customer_notes: optionalText(5000),
});

const contactRule = (v: { mobile: string | null; phone: string | null; email: string | null }) =>
  Boolean(v.mobile || v.phone || v.email);
const contactRuleIssue = {
  message: "Add a mobile, phone or email so we can reach them.",
  path: ["mobile"],
};

export const leadCreateSchema = leadContactSchema
  .extend(leadPropertySchema.shape)
  .extend(leadQualifySchema.shape)
  .refine(contactRule, contactRuleIssue);
export type LeadCreateInput = z.input<typeof leadCreateSchema>;
export type LeadCreateValues = z.output<typeof leadCreateSchema>;

/** Editing an existing lead (Lead Detail → Edit). Same fields, plus the id. */
export const leadUpdateSchema = leadContactSchema
  .extend({ last_name: optionalText(80) })
  .extend(leadPropertySchema.shape)
  .extend(leadQualifySchema.shape)
  .extend({ id: z.uuid() })
  .refine(contactRule, contactRuleIssue);
export type LeadUpdateInput = z.input<typeof leadUpdateSchema>;
export type LeadUpdateValues = z.output<typeof leadUpdateSchema>;

/** Status change with the extra fields some statuses need. */
export const leadStatusSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(LEAD_STATUSES).refine((s) => MANUAL_STATUS_CHOICES.includes(s), {
      message: "That status is set by booking a walkthrough or converting the lead.",
    }),
    disposition: optionalText(60),
    lost_reason: optionalText(60),
    nurture_until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .nullable()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => v.status !== "lost" || v.lost_reason, {
    message: "Pick a lost reason.",
    path: ["lost_reason"],
  })
  .refine((v) => v.status !== "nurture" || v.nurture_until, {
    message: "Pick a date to check back in.",
    path: ["nurture_until"],
  });
export type LeadStatusInput = z.input<typeof leadStatusSchema>;

/** Book Walkthrough (Phase 2: stores the tentative date/time + owner; scheduling arrives in Phase 6). */
export const bookWalkthroughSchema = z.object({
  id: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time."),
  owner_id: optionalUuid,
  notes: optionalText(1000),
});
export type BookWalkthroughInput = z.input<typeof bookWalkthroughSchema>;

/** Convert to Job (SPEC §6.1). Work types default to the lead's services. */
export const convertLeadSchema = z.object({
  id: z.uuid(),
  work_types: z
    .array(z.string().regex(/^[a-z_]{1,40}$/))
    .max(6)
    .optional()
    .nullable(),
});
export type ConvertLeadInput = z.input<typeof convertLeadSchema>;

/** Live duplicate check in the wizard (SPEC §8.4: by phone, email or address). */
export const duplicateCheckSchema = z.object({
  mobile: z.string().max(40).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().max(254).optional().nullable(),
  street: z.string().max(200).optional().nullable(),
  zip: z.string().max(10).optional().nullable(),
  exclude_id: z.uuid().optional(),
});
export type DuplicateCheckInput = z.input<typeof duplicateCheckSchema>;

/** Bulk actions from the Lead List. */
export const bulkLeadIdsSchema = z.array(z.uuid()).min(1, "Select at least one lead.").max(200);
export const bulkAssignSchema = z.object({ ids: bulkLeadIdsSchema, owner_id: optionalUuid });
export const bulkStatusSchema = z.object({
  ids: bulkLeadIdsSchema,
  // Nurture needs a check-back date and Lost needs a reason, so they're set one lead at a time.
  status: z.enum(["new", "contacted", "unqualified"]),
});
