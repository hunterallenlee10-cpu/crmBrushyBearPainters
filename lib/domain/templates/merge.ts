import { formatInTimeZone } from "date-fns-tz";
import { formatCents } from "@/lib/format/money";

/**
 * Merge fields for message templates (SPEC §5.7, §11.3): `{{contact.first_name}}`,
 * `{{job.point_of_contact.first_name}}`, `{{company.phone}}`,
 * `{{appointment.start | date}}`, `{{estimate.link}}`. Pure: the same renderer
 * runs in the template editor preview (browser), the workflow dry-run and the
 * sends. Values come from a plain JSON context; dates are shown in Pacific.
 *
 * Syntax: `{{ path }}`, `{{ path | filter }}`, `{{ path | filter:"arg" | filter }}`.
 * Filters: date, short_date, time, datetime, weekday, money, default:"…",
 * first, upper, lower. A field with no value and no `default` is "missing":
 * sends refuse to go out with missing fields; the preview shows `[path]`.
 * Placeholders such as [PHONE] are ordinary values and pass through as-is.
 */

export const TEMPLATE_TZ = "America/Los_Angeles";

export type MergeValue = string | number | boolean | null | undefined | MergeContext | MergeValue[];
export type MergeContext = { [key: string]: MergeValue };

export const MERGE_FILTERS = [
  "date",
  "short_date",
  "time",
  "datetime",
  "weekday",
  "money",
  "default",
  "first",
  "upper",
  "lower",
] as const;
export type MergeFilter = (typeof MERGE_FILTERS)[number];

export type ParsedTag = {
  raw: string;
  path: string;
  filters: { name: string; arg: string | null }[];
  start: number;
  end: number;
};

const TAG_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const PATH_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

function splitFilters(expr: string): string[] {
  // Split on | outside quotes.
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of expr) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "|") {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

function parseFilter(part: string): { name: string; arg: string | null } {
  const i = part.indexOf(":");
  if (i < 0) return { name: part.trim(), arg: null };
  const name = part.slice(0, i).trim();
  let arg = part.slice(i + 1).trim();
  if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
    arg = arg.slice(1, -1);
  }
  return { name, arg };
}

/** Every `{{ … }}` tag in a template, in order. */
export function parseTags(text: string): ParsedTag[] {
  const out: ParsedTag[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const [path = "", ...rest] = splitFilters(m[1] ?? "");
    out.push({
      raw: m[0],
      path: path.trim(),
      filters: rest.filter(Boolean).map(parseFilter),
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }
  return out;
}

export function lookup(ctx: MergeContext, path: string): MergeValue {
  let cur: MergeValue = ctx;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as MergeContext)[seg];
  }
  return cur;
}

function isEmpty(v: MergeValue): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
  );
}

function toDate(v: MergeValue): { date: Date; dateOnly: boolean } | null {
  if (typeof v !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    // A calendar date: show it as that day, never shifted by time zone.
    return { date: new Date(`${v}T12:00:00Z`), dateOnly: true };
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : { date: d, dateOnly: false };
}

function fmt(v: MergeValue, pattern: string): string | null {
  const d = toDate(v);
  if (!d) return null;
  return formatInTimeZone(d.date, d.dateOnly ? "UTC" : TEMPLATE_TZ, pattern);
}

function asText(v: MergeValue): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ");
  if (typeof v === "object") return "";
  return String(v);
}

function applyFilter(v: MergeValue, f: { name: string; arg: string | null }): MergeValue {
  switch (f.name) {
    case "default":
      return isEmpty(v) ? (f.arg ?? "") : v;
    case "date":
      return isEmpty(v) ? v : (fmt(v, "EEEE, MMMM d") ?? asText(v));
    case "short_date":
      return isEmpty(v) ? v : (fmt(v, "EEE, MMM d") ?? asText(v));
    case "time": {
      if (isEmpty(v)) return v;
      const t = fmt(v, "h:mm a");
      return t ? t.replace("AM", "am").replace("PM", "pm") : asText(v);
    }
    case "datetime": {
      if (isEmpty(v)) return v;
      const t = fmt(v, "EEEE, MMMM d 'at' h:mm a");
      return t ? t.replace("AM", "am").replace("PM", "pm") : asText(v);
    }
    case "weekday":
      return isEmpty(v) ? v : (fmt(v, "EEEE") ?? asText(v));
    case "money":
      return typeof v === "number" ? formatCents(v) : v;
    case "first":
      return isEmpty(v) ? v : (asText(v).trim().split(/\s+/)[0] ?? "");
    case "upper":
      return isEmpty(v) ? v : asText(v).toUpperCase();
    case "lower":
      return isEmpty(v) ? v : asText(v).toLowerCase();
    default:
      return v;
  }
}

export type RenderResult = {
  text: string;
  /** Fields with no value (and no default), in order of first use. */
  missing: string[];
  /** Placeholders like [PHONE] that ended up in the text. */
  placeholders: string[];
};

export type RenderOptions = {
  /** "blank" (sends) leaves missing fields empty; "marker" (preview) shows `[path]`. */
  missingAs?: "blank" | "marker";
};

const PLACEHOLDER_RE = /\[[A-Z][A-Z0-9_]+(?:[^\]\n]{0,60})?\]/g;

/** Render a template against a context. */
export function renderTemplate(
  text: string,
  ctx: MergeContext,
  opts: RenderOptions = {},
): RenderResult {
  const missing: string[] = [];
  const out = text.replace(TAG_RE, (_raw, expr: string) => {
    const [path = "", ...rest] = splitFilters(expr);
    let v: MergeValue = lookup(ctx, path.trim());
    const filters = rest.filter(Boolean).map(parseFilter);
    for (const f of filters) v = applyFilter(v, f);
    // `| default:""` marks a field as optional: empty is fine, not "missing".
    if (isEmpty(v) && filters.some((f) => f.name === "default")) return "";
    if (isEmpty(v)) {
      if (!missing.includes(path.trim())) missing.push(path.trim());
      return opts.missingAs === "marker" ? `[${path.trim()}]` : "";
    }
    return asText(v);
  });
  // Tidy what blank fields leave behind: doubled spaces and " ." / " ,".
  const tidy =
    opts.missingAs === "marker"
      ? out
      : out
          .replace(/[ \t]{2,}/g, " ")
          .replace(/ +([.,!?])/g, "$1")
          .replace(/^ +| +$/gm, "");
  const placeholders = [...new Set(tidy.match(PLACEHOLDER_RE) ?? [])].filter(
    (p) => !missing.some((m) => p === `[${m}]`),
  );
  return { text: tidy, missing, placeholders };
}

// --- Field catalog (editor palette, validation, sample preview) ---------------

export type MergeFieldGroup =
  | "Contact"
  | "Company"
  | "Point of contact"
  | "Lead"
  | "Job"
  | "Appointment"
  | "Estimate"
  | "Invoice"
  | "Schedule"
  | "Daily update"
  | "Review & referral"
  | "Case"
  | "Subcontractor"
  | "Compliance";

export type MergeField = {
  path: string;
  label: string;
  group: MergeFieldGroup;
  /** Shown in the sample preview (never real customer data). */
  example: string | number;
  /** Suggested filter when inserting (e.g. "date"). */
  filter?: MergeFilter;
};

export const MERGE_FIELDS: readonly MergeField[] = [
  { path: "contact.first_name", label: "First name", group: "Contact", example: "Jamie" },
  { path: "contact.last_name", label: "Last name", group: "Contact", example: "Rivera" },
  { path: "contact.full_name", label: "Full name", group: "Contact", example: "Jamie Rivera" },
  {
    path: "company.name",
    label: "Company name",
    group: "Company",
    example: "Brushy Bear Painters",
  },
  { path: "company.phone", label: "Phone", group: "Company", example: "[PHONE]" },
  { path: "company.email", label: "Email", group: "Company", example: "[EMAIL]" },
  { path: "company.hours", label: "Hours", group: "Company", example: "[HOURS]" },
  { path: "company.website", label: "Website", group: "Company", example: "brushybear.vercel.app" },
  {
    path: "poc.first_name",
    label: "Point of contact – first name (signature)",
    group: "Point of contact",
    example: "Hunter",
  },
  {
    path: "poc.full_name",
    label: "Point of contact – full name",
    group: "Point of contact",
    example: "Hunter Lee",
  },
  {
    path: "job.point_of_contact.first_name",
    label: "Job point of contact – first name",
    group: "Point of contact",
    example: "Hunter",
  },
  { path: "lead.first_name", label: "Lead first name", group: "Lead", example: "Jamie" },
  {
    path: "lead.services",
    label: "Services asked for",
    group: "Lead",
    example: "exterior painting",
  },
  { path: "lead.city", label: "City", group: "Lead", example: "Kirkland" },
  { path: "job.number", label: "Job number", group: "Job", example: "BB-2026-0042" },
  { path: "job.name", label: "Job name", group: "Job", example: "Rivera - Kirkland - Exterior" },
  { path: "job.city", label: "City", group: "Job", example: "Kirkland" },
  { path: "job.work_types", label: "Work types", group: "Job", example: "exterior painting" },
  {
    path: "job.start_date",
    label: "Promised start date",
    group: "Job",
    example: "2027-06-07",
    filter: "date",
  },
  {
    path: "job.prep_list",
    label: "Prep checklist (one line each)",
    group: "Job",
    example: "- Clear about 3 feet around the house.\n- Make sure we can use an outside spigot.",
  },
  {
    path: "job.crew_lead.first_name",
    label: "Crew lead – first name",
    group: "Job",
    example: "Sam",
  },
  { path: "job.link", label: "Link to the job (staff)", group: "Job", example: "/jobs/abc123" },
  { path: "job.owner.first_name", label: "Estimator – first name", group: "Job", example: "Erik" },
  { path: "job.owner.full_name", label: "Estimator – full name", group: "Job", example: "Erik" },
  {
    path: "appointment.start",
    label: "Start",
    group: "Appointment",
    example: "2026-11-03T17:00:00.000Z",
    filter: "datetime",
  },
  { path: "appointment.with", label: "Who's coming", group: "Appointment", example: "Erik" },
  {
    path: "appointment.type",
    label: "Type",
    group: "Appointment",
    example: "walkthrough",
  },
  {
    path: "estimate.number",
    label: "Estimate number",
    group: "Estimate",
    example: "EST-2026-0007",
  },
  {
    path: "estimate.link",
    label: "Proposal link (made when sent)",
    group: "Estimate",
    example: "https://crm.example/p/abc123",
  },
  {
    path: "estimate.sent_at",
    label: "Sent on",
    group: "Estimate",
    example: "2026-10-27T18:00:00.000Z",
    filter: "date",
  },
  {
    path: "estimate.expires_at",
    label: "Expires on",
    group: "Estimate",
    example: "2026-11-26T18:00:00.000Z",
    filter: "date",
  },
  { path: "invoice.number", label: "Invoice number", group: "Invoice", example: "INV-2026-0012" },
  {
    path: "invoice.balance_cents",
    label: "Balance due",
    group: "Invoice",
    example: 125000,
    filter: "money",
  },
  {
    path: "invoice.days_past_due",
    label: "Days past due",
    group: "Invoice",
    example: 7,
  },
  {
    path: "invoice.how_to_pay",
    label: "How to pay",
    group: "Invoice",
    example: "[HOW_TO_PAY — owner to provide]",
  },
  {
    path: "schedule.start_date",
    label: "Start date",
    group: "Schedule",
    example: "2027-06-07",
    filter: "date",
  },
  { path: "schedule.dates", label: "Dates", group: "Schedule", example: "Jun 7 - Jun 11" },
  {
    path: "schedule.arrival_window",
    label: "Arrival window",
    group: "Schedule",
    example: "8:00-8:30 am",
  },
  {
    path: "schedule.crew_lead_first_name",
    label: "Crew lead – first name",
    group: "Schedule",
    example: "Sam",
  },
  {
    path: "schedule.crew_changes",
    label: "Crew schedule changes (staff)",
    group: "Schedule",
    example: "- Rivera - Kirkland: Jun 7 - Jun 11",
  },
  {
    path: "daily_log.finished_today",
    label: "Finished today",
    group: "Daily update",
    example: "Washed and scraped the north side",
  },
  {
    path: "daily_log.next_up",
    label: "Next up",
    group: "Daily update",
    example: "Prime and caulk",
  },
  {
    path: "daily_log.photo_note",
    label: "Photo note",
    group: "Daily update",
    example: "6 photos from today are in your project.",
  },
  {
    path: "rain_delay.date",
    label: "Rain day",
    group: "Schedule",
    example: "2027-06-10",
    filter: "weekday",
  },
  {
    path: "review.link",
    label: "Review link (tracked)",
    group: "Review & referral",
    example: "https://crm.example/r/abc123",
  },
  {
    path: "referral.code",
    label: "Champion code",
    group: "Review & referral",
    example: "BEAR-7KQ2",
  },
  {
    path: "referral.reward",
    label: "Referral reward",
    group: "Review & referral",
    example: "[REFERRAL_REWARD]",
  },
  { path: "case.number", label: "Case number", group: "Case", example: "CASE-2026-0003" },
  { path: "case.title", label: "Case title", group: "Case", example: "Peeling on the back door" },
  {
    path: "subcontractor.company_name",
    label: "Company",
    group: "Subcontractor",
    example: "Cascade Coatings",
  },
  {
    path: "subcontractor.issues",
    label: "Paperwork issues",
    group: "Subcontractor",
    example: "Insurance (COI) expires Nov 30.",
  },
  {
    path: "unsubscribe.link",
    label: "Unsubscribe link (marketing email)",
    group: "Compliance",
    example: "https://crm.example/u/abc123",
  },
];

const FIELD_PATHS = new Set(MERGE_FIELDS.map((f) => f.path));

export type TemplateIssue = { kind: "unknown_field" | "unknown_filter" | "syntax"; detail: string };

/** Problems with a template's tags (unknown fields or filters, stray braces). */
export function validateTemplate(text: string): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  for (const tag of parseTags(text)) {
    if (!PATH_RE.test(tag.path)) {
      issues.push({ kind: "syntax", detail: `"${tag.raw}" isn't a merge field.` });
      continue;
    }
    if (!FIELD_PATHS.has(tag.path)) {
      issues.push({ kind: "unknown_field", detail: `{{${tag.path}}} isn't a known merge field.` });
    }
    for (const f of tag.filters) {
      if (!(MERGE_FILTERS as readonly string[]).includes(f.name)) {
        issues.push({ kind: "unknown_filter", detail: `"${f.name}" isn't a known filter.` });
      }
    }
  }
  const stripped = text.replace(TAG_RE, "");
  if (stripped.includes("{{") || stripped.includes("}}")) {
    issues.push({ kind: "syntax", detail: "There's a {{ or }} without its pair." });
  }
  return issues;
}

/** The fields a template uses (for "needs" lists in the editor). */
export function fieldsUsed(text: string): string[] {
  return [...new Set(parseTags(text).map((t) => t.path))];
}

function setPath(ctx: MergeContext, path: string, value: MergeValue): void {
  const segs = path.split(".");
  let cur: MergeContext = ctx;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    if (!next || typeof next !== "object" || Array.isArray(next)) cur[seg] = {};
    cur = cur[seg] as MergeContext;
  }
  cur[segs[segs.length - 1] as string] = value;
}

/** A context filled with the catalog's examples (the editor's sample preview). */
export function sampleContext(overrides: MergeContext = {}): MergeContext {
  const ctx: MergeContext = {};
  for (const f of MERGE_FIELDS) setPath(ctx, f.path, f.example);
  return deepMerge(ctx, overrides);
}

function deepMerge(base: MergeContext, extra: MergeContext): MergeContext {
  const out: MergeContext = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const b = out[k];
    out[k] =
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      b &&
      typeof b === "object" &&
      !Array.isArray(b)
        ? deepMerge(b as MergeContext, v as MergeContext)
        : v;
  }
  return out;
}

export { deepMerge as mergeContexts };
