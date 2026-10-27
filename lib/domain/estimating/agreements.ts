import type { AgreementDocType, InclusionWorkType } from "./constants";
import { INCLUSION_WORK_TYPES } from "./constants";

/**
 * BearSign agreement templates and proposal wording (SPEC §7.5, §7.6, §8.19,
 * §13.4). Pure. Templates are plain text with `{{merge.fields}}`, `## headings`
 * and `[SQUARE_BRACKET]` slots for wording the owners or their attorney still
 * have to provide. A template can only be published once every slot is filled
 * and its required merge fields are present.
 */

export const MERGE_FIELDS = [
  { key: "company.name", label: "Company name" },
  { key: "company.phone", label: "Company phone" },
  { key: "company.email", label: "Company email" },
  { key: "company.lni_number", label: "WA L&I contractor registration #" },
  { key: "company.ubi_number", label: "UBI #" },
  { key: "company.on_time_guarantee", label: "On-time guarantee amount" },
  { key: "company.estimate_sla_hours", label: "Estimate SLA (hours)" },
  { key: "customer.name", label: "Customer name" },
  { key: "property.address", label: "Property address" },
  { key: "job.number", label: "Job number" },
  { key: "job.point_of_contact", label: "Point of contact" },
  { key: "estimate.number", label: "Estimate number" },
  { key: "estimate.total", label: "Accepted total" },
  { key: "estimate.deposit", label: "Deposit amount" },
  { key: "estimate.expires", label: "Expiry date" },
  { key: "change_order.number", label: "Change order number" },
  { key: "change_order.reason", label: "Change order reason" },
  { key: "change_order.total", label: "Change order amount" },
  { key: "contract.total", label: "Contract total after changes" },
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number]["key"];

export type MergeValues = Partial<Record<MergeField, string | null>>;

const MERGE_RE = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g;
const SLOT_RE = /\[[A-Z][A-Z0-9_&]*(?:\s+[—–-][^\]]*)?\]/g;

export function isMergeField(v: string): v is MergeField {
  return MERGE_FIELDS.some((f) => f.key === v);
}

/** Merge fields used in a body (unique, in order). */
export function mergeFieldsIn(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(MERGE_RE)) {
    const k = m[1] as string;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** `[PLACEHOLDER — note]` slots still waiting for wording. */
export function placeholderSlots(body: string): string[] {
  return [...new Set(body.match(SLOT_RE) ?? [])];
}

/**
 * Replaces merge fields. Missing values become "—" so a document never shows a
 * raw `{{field}}`; unknown fields are left as typed (validation flags them).
 */
export function renderMergeFields(body: string, values: MergeValues): string {
  return body.replace(MERGE_RE, (whole, key: string) => {
    if (!isMergeField(key)) return whole;
    const v = values[key];
    return v && v.trim() ? v : "—";
  });
}

export type TemplateBlock =
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "placeholder"; text: string };

/** Splits a rendered body into headings and paragraphs for the page and the PDF. */
export function templateBlocks(rendered: string): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  for (const raw of rendered.split(/\n{2,}/)) {
    for (const part of splitHeadings(raw.trim())) {
      if (!part) continue;
      if (part.startsWith("## "))
        blocks.push({ kind: "heading", level: 2, text: part.slice(3).trim() });
      else if (part.startsWith("# "))
        blocks.push({ kind: "heading", level: 1, text: part.slice(2).trim() });
      else if (/^\[[A-Z]/.test(part) && part.endsWith("]"))
        blocks.push({ kind: "placeholder", text: part });
      else blocks.push({ kind: "paragraph", text: part });
    }
  }
  return blocks;
}

function splitHeadings(chunk: string): string[] {
  // A heading followed by text on the next line becomes two blocks.
  const lines = chunk.split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) out.push(buf.join("\n").trim());
    buf = [];
  };
  for (const line of lines) {
    if (/^#{1,2} /.test(line)) {
      flush();
      out.push(line.trim());
    } else if (/^\[[A-Z]/.test(line.trim()) && line.trim().endsWith("]")) {
      flush();
      out.push(line.trim());
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** Merge fields each document type must include before it can be published. */
export const REQUIRED_MERGE_FIELDS: Partial<Record<AgreementDocType, readonly MergeField[]>> = {
  proposal: ["company.name", "company.lni_number", "company.ubi_number", "estimate.number"],
  contract: [
    "company.name",
    "company.lni_number",
    "company.ubi_number",
    "estimate.number",
    "estimate.total",
  ],
  change_order: ["change_order.number", "change_order.total"],
  lead_safe_ack: ["customer.name", "property.address"],
};

export type PublishCheck = { ok: boolean; problems: string[] };

/** Publish validation (SPEC §8.19): every slot filled, required fields present, no unknown fields. */
export function checkPublishable(input: {
  docType: AgreementDocType;
  body: string;
  clauses?: readonly { body: string }[];
  ownerConfirmed: boolean;
}): PublishCheck {
  const problems: string[] = [];
  const all = [input.body, ...(input.clauses ?? []).map((c) => c.body)].join("\n\n");
  const slots = placeholderSlots(all);
  if (slots.length) {
    problems.push(
      `Fill in ${slots.length === 1 ? "this slot" : `these ${slots.length} slots`} first: ${slots
        .map((s) => s.replace(/\s+[—–-].*\]$/, "]"))
        .join(", ")}.`,
    );
  }
  const used = mergeFieldsIn(all);
  const unknown = used.filter((f) => !isMergeField(f));
  if (unknown.length)
    problems.push(`Unknown merge fields: ${unknown.map((f) => `{{${f}}}`).join(", ")}.`);
  const missing = (REQUIRED_MERGE_FIELDS[input.docType] ?? []).filter((f) => !used.includes(f));
  if (missing.length)
    problems.push(`Add the required fields: ${missing.map((f) => `{{${f}}}`).join(", ")}.`);
  if (!input.ownerConfirmed) {
    problems.push(
      "Confirm that an owner (and, for legal wording, your attorney) approved this text.",
    );
  }
  return { ok: problems.length === 0, problems };
}

/** Clauses that apply to this job (e.g. "lead_safe", "hoa"). */
export function applicableClauses<T extends { when?: string | null }>(
  clauses: readonly T[],
  conditions: { leadSafe: boolean; hoa: boolean },
): T[] {
  return clauses.filter((c) => {
    if (!c.when) return true;
    if (c.when === "lead_safe") return conditions.leadSafe;
    if (c.when === "hoa") return conditions.hoa;
    return false;
  });
}

// ---------------------------------------------------------------------------
// What's included and guarantees (estimate_settings jsonb)
// ---------------------------------------------------------------------------

export type Inclusion = { items: string[]; status: "draft" | "approved"; source: string };

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseInclusions(raw: unknown): Record<InclusionWorkType, Inclusion> {
  const src = asObject(raw);
  const out = {} as Record<InclusionWorkType, Inclusion>;
  for (const wt of INCLUSION_WORK_TYPES) {
    const o = asObject(src[wt]);
    const items = Array.isArray(o.items)
      ? o.items.filter((i): i is string => typeof i === "string" && i.trim().length > 0)
      : [];
    out[wt] = {
      items,
      status: o.status === "approved" ? "approved" : "draft",
      source: typeof o.source === "string" ? o.source : "draft",
    };
  }
  return out;
}

export type Guarantee = { key: string; title: string; body: string; enabled: boolean };

export function parseGuarantees(raw: unknown): Guarantee[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((g) => {
    const o = asObject(g);
    if (typeof o.key !== "string" || typeof o.title !== "string") return [];
    return [
      {
        key: o.key,
        title: o.title,
        body: typeof o.body === "string" ? o.body : "",
        enabled: o.enabled !== false,
      },
    ];
  });
}

/** "plants covered …" → "Plants covered …" for display. */
export function sentenceCase(s: string): string {
  const t = s.trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

/**
 * What the customer agrees to when they tap Accept & Sign (stored with the
 * signature). Draft wording — owner/attorney to approve (DECISIONS 2026-10-27).
 */
export const ESIGN_CONSENT =
  "I have read this proposal and its terms. I accept the option and add-ons selected above, and I agree to sign electronically.";
export const ESIGN_CONSENT_CHANGE_ORDER =
  "I have read this change order. I accept it and the change to the contract total, and I agree to sign electronically.";
