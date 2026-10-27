import {
  normalizeEmail,
  normalizePhone,
  phoneDigits,
  splitName,
} from "@/lib/domain/leads/normalize";
import { HOME_BUILT, SERVICES, TIMELINES } from "@/lib/domain/leads/constants";
import { normalizeZip } from "@/lib/domain/territory";
import {
  parseCustomInput,
  type CustomFieldDef,
  type CustomValues,
} from "@/lib/domain/custom-fields";

/**
 * Data Import (SPEC §8.19): CSV → field mapping → preview → review queue
 * (duplicates, errors) → apply. Pure: the fields each module accepts, header
 * auto-mapping, turning a CSV row into a record, and duplicate matching.
 * Consent is never imported as "opted in" (a CSV is not proof of consent).
 */

export const IMPORT_MODULES = ["leads", "accounts", "contacts"] as const;
export type ImportModule = (typeof IMPORT_MODULES)[number];

export const IMPORT_MODULE_LABELS: Record<ImportModule, string> = {
  leads: "Leads",
  accounts: "Accounts (customers)",
  contacts: "Contacts",
};

export type ImportField = {
  key: string;
  label: string;
  aliases: readonly string[];
  required?: boolean;
};

export const IMPORT_FIELDS: Record<ImportModule, readonly ImportField[]> = {
  leads: [
    { key: "full_name", label: "Full name", aliases: ["name", "customer name", "client"] },
    { key: "first_name", label: "First name", aliases: ["first", "firstname", "given name"] },
    {
      key: "last_name",
      label: "Last name",
      aliases: ["last", "lastname", "surname", "family name"],
    },
    { key: "company", label: "Company", aliases: ["business"] },
    { key: "email", label: "Email", aliases: ["e-mail", "email address"] },
    { key: "mobile", label: "Mobile", aliases: ["cell", "cell phone", "mobile phone"] },
    { key: "phone", label: "Phone", aliases: ["telephone", "home phone", "phone number"] },
    { key: "street", label: "Street", aliases: ["address", "street address", "address 1"] },
    { key: "city", label: "City", aliases: ["town"] },
    { key: "zip", label: "ZIP", aliases: ["zip code", "postal code", "zipcode", "postcode"] },
    { key: "services", label: "Services", aliases: ["service", "work type", "project type"] },
    { key: "timeline", label: "Timeline", aliases: ["when"] },
    { key: "home_built", label: "Home built", aliases: ["year built", "built"] },
    { key: "lead_source", label: "Lead source", aliases: ["source", "how did you hear"] },
    { key: "customer_notes", label: "Notes", aliases: ["note", "comments", "message"] },
  ],
  accounts: [
    {
      key: "display_name",
      label: "Account name",
      aliases: ["name", "customer", "household"],
      required: true,
    },
    { key: "account_type", label: "Type", aliases: ["account type"] },
    { key: "notes", label: "Notes", aliases: ["note", "comments"] },
    { key: "tags", label: "Tags", aliases: ["tag", "labels"] },
    { key: "street", label: "Street", aliases: ["address", "street address"] },
    { key: "city", label: "City", aliases: [] },
    { key: "zip", label: "ZIP", aliases: ["zip code", "postal code"] },
  ],
  contacts: [
    { key: "account_name", label: "Account name", aliases: ["account", "customer", "household"] },
    { key: "full_name", label: "Full name", aliases: ["name"] },
    { key: "first_name", label: "First name", aliases: ["first", "firstname"] },
    { key: "last_name", label: "Last name", aliases: ["last", "lastname", "surname"] },
    { key: "email", label: "Email", aliases: ["e-mail", "email address"] },
    { key: "mobile", label: "Mobile", aliases: ["cell", "cell phone"] },
    { key: "phone", label: "Phone", aliases: ["telephone", "home phone"] },
    { key: "role", label: "Role on account", aliases: ["role", "relationship"] },
    { key: "language", label: "Language", aliases: [] },
    { key: "notes", label: "Notes", aliases: ["note", "comments"] },
  ],
};

export const MAX_IMPORT_ROWS = 5000;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Header → field key, by key, label or alias; custom fields by label or "cf:<api_name>". */
export function autoMap(
  module: ImportModule,
  headers: readonly string[],
  custom: readonly Pick<CustomFieldDef, "apiName" | "label" | "active">[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const h of headers) {
    const n = norm(h);
    if (!n) continue;
    const f = IMPORT_FIELDS[module].find(
      (x) => norm(x.key) === n || norm(x.label) === n || x.aliases.some((a) => norm(a) === n),
    );
    const c = custom.find(
      (x) =>
        x.active &&
        (norm(x.label) === n || norm(x.apiName) === n || h.trim() === `cf:${x.apiName}`),
    );
    const key = f?.key ?? (c ? `cf:${c.apiName}` : null);
    if (key && !used.has(key)) {
      out[h] = key;
      used.add(key);
    }
  }
  return out;
}

export type ImportContext = {
  /** Lead source picklist (value + label); unknown sources fall back to `defaultSource`. */
  leadSources: readonly { value: string; label: string }[];
  defaultSource: string | null;
  custom: readonly CustomFieldDef[];
};

export type MappedRow = {
  data: Record<string, string | number | boolean | string[] | null> & {
    custom_field_values?: CustomValues;
  };
  errors: string[];
  /** Display label for the review queue. */
  label: string;
  email: string | null;
  phoneDigits: string | null;
};

function pickEnum<T extends string>(
  list: readonly T[],
  raw: string,
  words: Record<string, T> = {},
): T | null {
  const n = norm(raw).replace(/ /g, "_");
  const hit = list.find((v) => v === n);
  if (hit) return hit;
  for (const [w, v] of Object.entries(words)) if (norm(raw).includes(w)) return v;
  return null;
}

const SERVICE_WORDS: Record<string, (typeof SERVICES)[number]> = {
  interior: "interior",
  inside: "interior",
  exterior: "exterior",
  outside: "exterior",
  cabinet: "cabinets",
  deck: "deck_fence",
  fence: "deck_fence",
};

/** Turns one CSV row (cells by header) into a record for the module, with any errors. */
export function mapImportRow(
  module: ImportModule,
  raw: Record<string, string>,
  mapping: Record<string, string>,
  ctx: ImportContext,
): MappedRow {
  const get = (key: string): string => {
    const header = Object.keys(mapping).find((h) => mapping[h] === key);
    return header ? (raw[header] ?? "").trim() : "";
  };
  const errors: string[] = [];
  const data: MappedRow["data"] = {};

  // Custom fields
  const cf: CustomValues = {};
  for (const [header, key] of Object.entries(mapping)) {
    if (!key.startsWith("cf:")) continue;
    const def = ctx.custom.find((d) => d.apiName === key.slice(3) && d.active);
    if (!def) continue;
    const parsed = parseCustomInput(def, raw[header] ?? "");
    if ("error" in parsed) errors.push(parsed.error);
    else if (parsed.value !== null) cf[def.apiName] = parsed.value;
  }
  if (Object.keys(cf).length) data.custom_field_values = cf;

  const emailRaw = get("email");
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  if (emailRaw && !email) errors.push(`"${emailRaw}" isn't a valid email.`);
  const phones: Record<string, string | null> = {};
  for (const k of ["mobile", "phone"]) {
    const v = get(k);
    if (!v) continue;
    const p = normalizePhone(v);
    if (!p) errors.push(`"${v}" isn't a phone number we can use.`);
    phones[k] = p;
  }

  if (module === "accounts") {
    const name = get("display_name");
    if (!name) errors.push("Account name is required.");
    data.display_name = name.slice(0, 200) || null;
    const type = get("account_type");
    if (type) {
      const t = pickEnum(["residential", "property_manager", "hoa", "commercial"] as const, type, {
        hoa: "hoa",
        property: "property_manager",
        commercial: "commercial",
        business: "commercial",
        home: "residential",
        resid: "residential",
      });
      if (!t)
        errors.push(
          `Type "${type}" isn't one of residential, property manager, HOA or commercial.`,
        );
      data.account_type = t;
    }
    if (get("notes")) data.notes = get("notes").slice(0, 5000);
    if (get("tags"))
      data.tags = get("tags")
        .split(/[,;|]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    const zip = get("zip") ? normalizeZip(get("zip")) : null;
    if (get("zip") && !zip) errors.push(`ZIP "${get("zip")}" isn't a 5-digit ZIP.`);
    if (get("street")) data.street = get("street").slice(0, 200);
    if (get("city")) data.city = get("city").slice(0, 100);
    if (zip) data.zip = zip;
    return { data, errors, label: name || "(no name)", email: null, phoneDigits: null };
  }

  // Leads and contacts: a person.
  let first = get("first_name");
  let last = get("last_name") || null;
  if (!first && get("full_name")) {
    const split = splitName(get("full_name"));
    first = split.first;
    last = last ?? split.last;
  }
  if (!first) errors.push("A first name (or full name) is required.");
  data.first_name = first.slice(0, 100) || null;
  data.last_name = last ? last.slice(0, 100) : null;
  data.email = email;
  if ("mobile" in phones) data.mobile = phones.mobile ?? null;
  if ("phone" in phones) data.phone = phones.phone ?? null;
  const label = [first, last].filter(Boolean).join(" ") || "(no name)";
  const digits = phoneDigits(phones.mobile ?? phones.phone ?? "") || null;

  if (module === "contacts") {
    data.account_name = get("account_name").slice(0, 200) || null;
    const role = get("role");
    if (role) {
      const r = pickEnum(
        ["primary", "spouse_partner", "property_manager", "tenant", "billing", "other"] as const,
        role,
        {
          spouse: "spouse_partner",
          partner: "spouse_partner",
          wife: "spouse_partner",
          husband: "spouse_partner",
          manager: "property_manager",
          tenant: "tenant",
          renter: "tenant",
          billing: "billing",
          primary: "primary",
          owner: "primary",
        },
      );
      data.role = r ?? "other";
    }
    if (get("language")) data.language = get("language").slice(0, 40);
    if (get("notes")) data.notes = get("notes").slice(0, 5000);
    if (!email && !phones.mobile && !phones.phone) errors.push("Add an email or a phone number.");
    return { data, errors, label, email, phoneDigits: digits };
  }

  // Leads
  if (!email && !phones.mobile && !phones.phone) errors.push("Add an email or a phone number.");
  if (get("company")) data.company = get("company").slice(0, 200);
  if (get("street")) data.street = get("street").slice(0, 200);
  if (get("city")) data.city = get("city").slice(0, 100);
  if (get("zip")) {
    const zip = normalizeZip(get("zip"));
    if (!zip) errors.push(`ZIP "${get("zip")}" isn't a 5-digit ZIP.`);
    data.zip = zip;
  }
  if (get("services")) {
    const parts = get("services")
      .split(/[,;|/]| and /i)
      .map((p) => p.trim())
      .filter(Boolean);
    const services = [
      ...new Set(parts.map((p) => pickEnum(SERVICES, p, SERVICE_WORDS) ?? "other")),
    ];
    data.services = services;
  }
  if (get("timeline")) {
    data.timeline =
      pickEnum(TIMELINES, get("timeline"), {
        asap: "asap",
        soon: "asap",
        "1 3": "1_3_months",
        "3": "3_plus_months",
        plan: "just_planning",
      }) ?? null;
  }
  if (get("home_built")) {
    const hb = get("home_built");
    const year = /^\d{4}$/.test(hb) ? Number(hb) : null;
    data.home_built = year
      ? year < 1978
        ? "before_1978"
        : "1978_or_later"
      : (pickEnum(HOME_BUILT, hb, {
          before: "before_1978",
          after: "1978_or_later",
          later: "1978_or_later",
          sure: "not_sure",
        }) ?? "not_sure");
    if (year) data.year_built = year;
  }
  const sourceRaw = get("lead_source");
  const source = sourceRaw
    ? (ctx.leadSources.find((s) => s.value === sourceRaw || norm(s.label) === norm(sourceRaw))
        ?.value ?? null)
    : null;
  if (sourceRaw && !source && !ctx.defaultSource)
    errors.push(`Lead source "${sourceRaw}" isn't in the Lead Source picklist.`);
  data.lead_source = source ?? ctx.defaultSource;
  if (!data.lead_source) errors.push("Pick a lead source (or map a column to it).");
  if (get("customer_notes")) data.customer_notes = get("customer_notes").slice(0, 5000);
  return { data, errors, label, email, phoneDigits: digits };
}

export type ExistingRecord = {
  id: string;
  label: string;
  email: string | null;
  phoneDigits: string | null;
};

export type DuplicateHit = { of: string | null; reason: string };

/**
 * Same email or phone as an existing record (or as an earlier row in the
 * file) is a duplicate for review. Accounts match on the same name.
 */
export function findDuplicates(
  module: ImportModule,
  rows: readonly Pick<MappedRow, "label" | "email" | "phoneDigits">[],
  existing: readonly ExistingRecord[],
): (DuplicateHit | null)[] {
  const byEmail = new Map<string, ExistingRecord>();
  const byPhone = new Map<string, ExistingRecord>();
  const byName = new Map<string, ExistingRecord>();
  for (const e of existing) {
    if (e.email) byEmail.set(e.email, e);
    if (e.phoneDigits) byPhone.set(e.phoneDigits.slice(-10), e);
    byName.set(norm(e.label), e);
  }
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const seenName = new Map<string, number>();
  return rows.map((r, i) => {
    if (module === "accounts") {
      const n = norm(r.label);
      const hit = byName.get(n);
      if (hit) return { of: hit.id, reason: `Same name as the existing account "${hit.label}".` };
      if (seenName.has(n)) return { of: null, reason: `Same name as row ${seenName.get(n)! + 1}.` };
      seenName.set(n, i);
      return null;
    }
    const phone = r.phoneDigits ? r.phoneDigits.slice(-10) : null;
    const e = r.email ? byEmail.get(r.email) : undefined;
    if (e) return { of: e.id, reason: `Same email as ${e.label}.` };
    const p = phone ? byPhone.get(phone) : undefined;
    if (p) return { of: p.id, reason: `Same phone as ${p.label}.` };
    if (r.email && seenEmail.has(r.email))
      return { of: null, reason: `Same email as row ${seenEmail.get(r.email)! + 1}.` };
    if (phone && seenPhone.has(phone))
      return { of: null, reason: `Same phone as row ${seenPhone.get(phone)! + 1}.` };
    if (r.email) seenEmail.set(r.email, i);
    if (phone) seenPhone.set(phone, i);
    return null;
  });
}

/** Status of a row after mapping: errors win, then duplicates, else valid. */
export function rowStatus(
  errors: readonly string[],
  dup: DuplicateHit | null,
): "valid" | "error" | "duplicate" {
  if (errors.length) return "error";
  return dup ? "duplicate" : "valid";
}
