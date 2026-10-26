import { z } from "zod";
import { optionalText, requiredText } from "@/lib/validation/common";
import { normalizeEmail, normalizePhone } from "@/lib/domain/leads/normalize";
import { HOME_BUILT } from "@/lib/domain/leads/constants";

/**
 * Accounts, contacts and properties (SPEC §5.1, §8.10, §13.2). Shared by the
 * forms (react-hook-form + zodResolver) and the server actions, so phones are
 * E.164 and emails lowercase before they reach the database, and consent is
 * always recorded with where it came from.
 */

// -----------------------------------------------------------------------------
// Choices and labels
// -----------------------------------------------------------------------------

export const ACCOUNT_TYPES = ["residential", "property_manager", "hoa", "commercial"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  residential: "Residential",
  property_manager: "Property manager",
  hoa: "HOA",
  commercial: "Commercial",
};

export const ACCOUNT_STATUSES = [
  "prospect",
  "active_customer",
  "past_customer",
  "inactive",
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  prospect: "Prospect",
  active_customer: "Active customer",
  past_customer: "Past customer",
  inactive: "Inactive",
};

export const CONTACT_ROLES = [
  "primary",
  "spouse_partner",
  "property_manager",
  "tenant",
  "billing",
  "other",
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  primary: "Primary",
  spouse_partner: "Spouse / partner",
  property_manager: "Property manager",
  tenant: "Tenant",
  billing: "Billing",
  other: "Other",
};

export const PREFERRED_CHANNELS = ["sms", "call", "email"] as const;
export type PreferredChannel = (typeof PREFERRED_CHANNELS)[number];
export const PREFERRED_CHANNEL_LABELS: Record<PreferredChannel, string> = {
  sms: "Text",
  call: "Call",
  email: "Email",
};

export const OCCUPANCY = ["occupied", "vacant", "tenant_occupied"] as const;
export type Occupancy = (typeof OCCUPANCY)[number];
export const OCCUPANCY_LABELS: Record<Occupancy, string> = {
  occupied: "Owner-occupied",
  vacant: "Vacant",
  tenant_occupied: "Tenant-occupied",
};

export const STORIES_LABELS: Record<1 | 2 | 3, string> = { 1: "1", 2: "2", 3: "3+" };

export function isAccountType(v: string): v is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(v);
}
export function isAccountStatus(v: string): v is AccountStatus {
  return (ACCOUNT_STATUSES as readonly string[]).includes(v);
}
export function isContactRole(v: string): v is ContactRole {
  return (CONTACT_ROLES as readonly string[]).includes(v);
}
export function isPreferredChannel(v: string): v is PreferredChannel {
  return (PREFERRED_CHANNELS as readonly string[]).includes(v);
}
export function isOccupancy(v: string): v is Occupancy {
  return (OCCUPANCY as readonly string[]).includes(v);
}

// -----------------------------------------------------------------------------
// Field helpers
// -----------------------------------------------------------------------------

const uuid = z.uuid({ message: "Missing record." });

const optionalUuid = z
  .union([z.uuid({ message: "Pick someone from the list." }), z.literal(""), z.null()])
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

/** Empty string or one of the keys → key or null. */
const optionalChoice = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z
    .union([z.enum(values, { message }), z.literal(""), z.null()])
    .optional()
    .transform((v): T[number] | null => (v ? v : null));

/** Picklist key (checked by the database against Field Picklists). */
const picklistKey = z
  .string()
  .trim()
  .max(80)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const MAX_TAGS = 30;

/** "repeat, referral champ" → ["repeat", "referral champ"] (trimmed, unique). */
export function parseTags(input: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const raw of (input ?? "").split(",")) {
    const tag = raw.replace(/\s+/g, " ").trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

const tagsField = z
  .string()
  .max(2000)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    const tags = parseTags(v);
    if (tags.length > MAX_TAGS) {
      ctx.addIssue({ code: "custom", message: `Use at most ${MAX_TAGS} tags.` });
      return z.NEVER;
    }
    if (tags.some((t) => t.length > 40)) {
      ctx.addIssue({ code: "custom", message: "Keep each tag under 40 characters." });
      return z.NEVER;
    }
    return tags;
  });

/** Year built: 1700 through next year. Empty → null. */
export function yearBuiltRange(now: Date = new Date()): { min: number; max: number } {
  return { min: 1700, max: now.getFullYear() + 1 };
}

const yearField = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
    const n = Number(typeof v === "string" ? v.trim() : v);
    const { min, max } = yearBuiltRange();
    if (!Number.isInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `Enter a year between ${min} and ${max}.` });
      return z.NEVER;
    }
    return n;
  });

/** Exactly five digits (the ZIP decides the territory and Out-of-area flag). */
const zipField = z
  .string()
  .trim()
  .max(10)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v || !/^\d{5}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Enter a 5-digit ZIP code." });
      return z.NEVER;
    }
    return v;
  });

const storiesField = z
  .union([
    z.literal("1"),
    z.literal("2"),
    z.literal("3"),
    z.literal(""),
    z.number().int().min(1).max(3),
    z.null(),
  ])
  .optional()
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)));

const sqftField = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
    const n = Number(typeof v === "string" ? v.replace(/[,\s]/g, "") : v);
    if (!Number.isInteger(n) || n < 100 || n > 100_000) {
      ctx.addIssue({ code: "custom", message: "Enter square feet between 100 and 100,000." });
      return z.NEVER;
    }
    return n;
  });

// -----------------------------------------------------------------------------
// Account
// -----------------------------------------------------------------------------

export const accountSchema = z.object({
  display_name: requiredText("Account name", 160),
  account_type: z.enum(ACCOUNT_TYPES, { message: "Pick a type." }),
  status: z.enum(ACCOUNT_STATUSES, { message: "Pick a status." }),
  owner_id: optionalUuid,
  is_referral_champion: z.boolean().default(false),
  tags: tagsField,
  notes: optionalText(10_000),
});
export type AccountInput = z.input<typeof accountSchema>;
export type AccountValues = z.output<typeof accountSchema>;

export const updateAccountSchema = z.object({ id: uuid, account: accountSchema });
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;

// -----------------------------------------------------------------------------
// Contact (consent rules: SPEC §13.2)
// -----------------------------------------------------------------------------

const contactFields = z.object({
  first_name: requiredText("First name", 80),
  last_name: optionalText(80),
  role: z.enum(CONTACT_ROLES, { message: "Pick a role." }),
  mobile: phoneField("Mobile"),
  phone: phoneField("Phone"),
  email: emailField,
  preferred_channel: optionalChoice(PREFERRED_CHANNELS, "Pick a channel."),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Use a language code like en or es.")
    .default("en"),
  sms_opt_in: z.boolean().default(false),
  sms_opt_in_source: optionalText(200),
  email_opt_in: z.boolean().default(false),
  email_opt_in_source: optionalText(200),
  do_not_contact: z.boolean().default(false),
  notes: optionalText(10_000),
});

export const contactSchema = contactFields
  .superRefine((c, ctx) => {
    if (c.do_not_contact) return;
    if (c.sms_opt_in) {
      if (!c.mobile) {
        ctx.addIssue({
          code: "custom",
          path: ["mobile"],
          message: "Add a mobile number before opting them in to texts.",
        });
      }
      if (!c.sms_opt_in_source) {
        ctx.addIssue({
          code: "custom",
          path: ["sms_opt_in_source"],
          message:
            "Say where they agreed to texts (for example: website form, or verbally on a call).",
        });
      }
    }
    if (c.email_opt_in) {
      if (!c.email) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Add an email address before opting them in to email.",
        });
      }
      if (!c.email_opt_in_source) {
        ctx.addIssue({
          code: "custom",
          path: ["email_opt_in_source"],
          message:
            "Say where they agreed to email (for example: website form, or verbally on a call).",
        });
      }
    }
  })
  .transform((c) => {
    // Do Not Contact clears marketing consent (the database enforces this too).
    const sms = c.sms_opt_in && !c.do_not_contact;
    const email = c.email_opt_in && !c.do_not_contact;
    return {
      ...c,
      sms_opt_in: sms,
      sms_opt_in_source: sms ? c.sms_opt_in_source : null,
      email_opt_in: email,
      email_opt_in_source: email ? c.email_opt_in_source : null,
    };
  });
export type ContactInput = z.input<typeof contactSchema>;
export type ContactValues = z.output<typeof contactSchema>;

export const createContactSchema = z.object({ account_id: uuid, contact: contactSchema });
export type CreateContactInput = z.input<typeof createContactSchema>;
export const updateContactSchema = z.object({ id: uuid, contact: contactSchema });
export type UpdateContactInput = z.input<typeof updateContactSchema>;

/** Previous consent on the row, to decide which timestamps to keep, set or clear. */
export type ConsentState = {
  sms_opt_in: boolean;
  sms_opt_in_at: string | null;
  email_opt_in: boolean;
  email_opt_in_at: string | null;
};

/**
 * Consent columns to write. A new opt-in is stamped now; an unchanged opt-in
 * keeps its original time; turning consent off (or Do Not Contact) clears it.
 * Pure, so the rule is unit-tested.
 */
export function consentPatch(
  next: Pick<
    ContactValues,
    "sms_opt_in" | "sms_opt_in_source" | "email_opt_in" | "email_opt_in_source" | "do_not_contact"
  >,
  prev: ConsentState | null,
  now: Date = new Date(),
): {
  sms_opt_in: boolean;
  sms_opt_in_at: string | null;
  sms_opt_in_source: string | null;
  email_opt_in: boolean;
  email_opt_in_at: string | null;
  email_opt_in_source: string | null;
  do_not_contact: boolean;
} {
  const sms = next.sms_opt_in && !next.do_not_contact;
  const email = next.email_opt_in && !next.do_not_contact;
  const stamp = now.toISOString();
  return {
    sms_opt_in: sms,
    sms_opt_in_at: sms
      ? prev?.sms_opt_in && prev.sms_opt_in_at
        ? prev.sms_opt_in_at
        : stamp
      : null,
    sms_opt_in_source: sms ? next.sms_opt_in_source : null,
    email_opt_in: email,
    email_opt_in_at: email
      ? prev?.email_opt_in && prev.email_opt_in_at
        ? prev.email_opt_in_at
        : stamp
      : null,
    email_opt_in_source: email ? next.email_opt_in_source : null,
    do_not_contact: next.do_not_contact,
  };
}

// -----------------------------------------------------------------------------
// Property
// -----------------------------------------------------------------------------

export const propertySchema = z
  .object({
    is_primary: z.boolean().default(false),
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
    home_built: optionalChoice(HOME_BUILT, "Pick one."),
    property_type: picklistKey,
    siding_type: picklistKey,
    stories: storiesField,
    approx_sqft: sqftField,
    has_hoa: z.boolean().default(false),
    hoa_name: optionalText(160),
    hoa_contact: optionalText(200),
    hoa_color_approval_required: z.boolean().default(false),
    access_notes: optionalText(2000),
    pets: optionalText(500),
    parking: optionalText(500),
    alarm: optionalText(500),
    occupancy: optionalChoice(OCCUPANCY, "Pick one."),
    water_power_access: optionalText(500),
  })
  .transform((p) =>
    p.has_hoa ? p : { ...p, hoa_name: null, hoa_contact: null, hoa_color_approval_required: false },
  );
export type PropertyInput = z.input<typeof propertySchema>;
export type PropertyValues = z.output<typeof propertySchema>;

export const createPropertySchema = z.object({ account_id: uuid, property: propertySchema });
export type CreatePropertyInput = z.input<typeof createPropertySchema>;
export const updatePropertySchema = z.object({ id: uuid, property: propertySchema });
export type UpdatePropertyInput = z.input<typeof updatePropertySchema>;

/** Same rule as the generated `lead_safe_required` column, for previews in forms. */
export function needsLeadSafe(p: {
  year_built: number | null;
  home_built: string | null;
}): boolean {
  if (p.year_built !== null) return p.year_built < 1978;
  return p.home_built === "before_1978" || p.home_built === "not_sure";
}

// -----------------------------------------------------------------------------
// New account (account + primary contact + primary property in one step)
// -----------------------------------------------------------------------------

export const createAccountSchema = z.object({
  account: accountSchema,
  contact: contactSchema,
  property: propertySchema,
});
export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type CreateAccountValues = z.output<typeof createAccountSchema>;

// -----------------------------------------------------------------------------
// Gate / lockbox code, deletes, bulk
// -----------------------------------------------------------------------------

export const accessCodeSchema = z.object({
  property_id: uuid,
  code: z.string().trim().min(1, "Enter the code.").max(100, "Keep it under 100 characters."),
});
export type AccessCodeInput = z.input<typeof accessCodeSchema>;

export const propertyIdSchema = z.object({ property_id: uuid });

export const deleteRecordSchema = z.object({
  id: uuid,
  reason: z
    .string()
    .trim()
    .min(3, "Give a short reason (at least 3 characters).")
    .max(500, "Keep it under 500 characters."),
});
export type DeleteRecordInput = z.input<typeof deleteRecordSchema>;

export const setPrimaryContactSchema = z.object({ account_id: uuid, contact_id: uuid });

export const bulkAssignAccountsSchema = z.object({
  ids: z.array(uuid).min(1, "Select at least one account.").max(200),
  owner_id: optionalUuid,
});
export type BulkAssignAccountsInput = z.input<typeof bulkAssignAccountsSchema>;

/** "Smith" → "Smith Residence" (suggested display name for a household). */
export function suggestDisplayName(
  type: AccountType,
  lastName: string | null | undefined,
  firstName?: string | null,
): string {
  const last = (lastName ?? "").trim();
  const first = (firstName ?? "").trim();
  if (type !== "residential") return "";
  if (last) return `${last} Residence`;
  if (first) return `${first} Residence`;
  return "";
}
