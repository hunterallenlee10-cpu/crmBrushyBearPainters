/**
 * Merge Customers (SPEC §8.19): pick the record that stays, choose field by
 * field, move everything related, keep a record so the merge can be undone.
 * The move itself runs in the database (`merge_customers`, `undo_merge`).
 * Pure helpers: which fields can be chosen (the same list as
 * `app.merge_fields()`), sensible default choices, and the preview.
 */

export const MERGE_MODULES = ["accounts", "contacts"] as const;
export type MergeModule = (typeof MERGE_MODULES)[number];

export type MergeField = { key: string; label: string; union?: boolean };

/** Must agree with `app.merge_fields()`. Consent is never chosen: the stricter answer wins. */
export const MERGE_FIELDS: Record<MergeModule, readonly MergeField[]> = {
  accounts: [
    { key: "display_name", label: "Name" },
    { key: "account_type", label: "Type" },
    { key: "status", label: "Status" },
    { key: "owner_id", label: "Owner" },
    { key: "territory_id", label: "Territory" },
    { key: "primary_contact_id", label: "Primary contact" },
    { key: "notes", label: "Notes" },
    { key: "tags", label: "Tags", union: true },
  ],
  contacts: [
    { key: "first_name", label: "First name" },
    { key: "last_name", label: "Last name" },
    { key: "role", label: "Role on account" },
    { key: "mobile", label: "Mobile" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "preferred_channel", label: "Preferred channel" },
    { key: "language", label: "Language" },
    { key: "notes", label: "Notes" },
    { key: "account_id", label: "Account" },
  ],
};

/** What moves to the survivor, in words (preview). Must agree with `app.merge_references()`. */
export const MERGE_MOVES: Record<MergeModule, readonly { ref: string; label: string }[]> = {
  accounts: [
    { ref: "contacts.account_id", label: "Contacts" },
    { ref: "properties.account_id", label: "Properties" },
    { ref: "leads.account_id", label: "Leads" },
    { ref: "jobs.account_id", label: "Jobs" },
    { ref: "documents.account_id", label: "Documents" },
    { ref: "invoices.account_id", label: "Invoices" },
    { ref: "payments.account_id", label: "Payments" },
    { ref: "cases.account_id", label: "Warranty & service cases" },
    { ref: "referral_champions.account_id", label: "Bear Champion record" },
    { ref: "notes.subject_id", label: "Notes" },
    { ref: "comments.subject_id", label: "Comments" },
    { ref: "tasks.subject_id", label: "Tasks" },
    { ref: "attention_items.subject_id", label: "Attention items" },
  ],
  contacts: [
    { ref: "leads.contact_id", label: "Leads" },
    { ref: "jobs.primary_contact_id", label: "Jobs (as primary contact)" },
    { ref: "accounts.primary_contact_id", label: "Accounts (as primary contact)" },
    { ref: "message_threads.contact_id", label: "Conversations" },
    { ref: "messages.contact_id", label: "Messages" },
    { ref: "cases.contact_id", label: "Warranty & service cases" },
    { ref: "review_requests.contact_id", label: "Review requests" },
    { ref: "campaign_recipients.contact_id", label: "Campaign sends" },
    { ref: "referral_champions.contact_id", label: "Bear Champion record" },
    { ref: "notes.subject_id", label: "Notes" },
    { ref: "comments.subject_id", label: "Comments" },
    { ref: "tasks.subject_id", label: "Tasks" },
    { ref: "attention_items.subject_id", label: "Attention items" },
  ],
};

export type MergeChoice = "survivor" | "merged" | "union";
export type MergeChoices = Record<string, MergeChoice>;

function empty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * Default choices: keep the survivor's value, take the other record's value
 * where the survivor has none, combine tags. Custom fields ("cf:<key>") work
 * the same way.
 */
export function defaultMergeChoices(
  module: MergeModule,
  survivor: Record<string, unknown>,
  merged: Record<string, unknown>,
  customKeys: readonly string[] = [],
): MergeChoices {
  const out: MergeChoices = {};
  for (const f of MERGE_FIELDS[module]) {
    if (f.union) out[f.key] = "union";
    else out[f.key] = empty(survivor[f.key]) && !empty(merged[f.key]) ? "merged" : "survivor";
  }
  const sCf = (survivor.custom_field_values ?? {}) as Record<string, unknown>;
  const mCf = (merged.custom_field_values ?? {}) as Record<string, unknown>;
  for (const k of customKeys) {
    out[`cf:${k}`] = empty(sCf[k]) && !empty(mCf[k]) ? "merged" : "survivor";
  }
  return out;
}

/** The survivor's values after the merge (preview), field by field. */
export function previewMerge(
  module: MergeModule,
  survivor: Record<string, unknown>,
  merged: Record<string, unknown>,
  choices: MergeChoices,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of MERGE_FIELDS[module]) {
    const c = choices[f.key] ?? "survivor";
    if (c === "merged") out[f.key] = merged[f.key] ?? null;
    else if (c === "union" && f.union) {
      const a = Array.isArray(survivor[f.key]) ? (survivor[f.key] as string[]) : [];
      const b = Array.isArray(merged[f.key]) ? (merged[f.key] as string[]) : [];
      out[f.key] = [...new Set([...a, ...b])].sort();
    } else out[f.key] = survivor[f.key] ?? null;
  }
  if (module === "contacts") {
    out.do_not_contact = Boolean(survivor.do_not_contact) || Boolean(merged.do_not_contact);
    out.opted_out_at = survivor.opted_out_at ?? merged.opted_out_at ?? null;
  }
  return out;
}

/** Choices to send to the database (only valid keys; union only for tags). */
export function cleanMergeChoices(
  module: MergeModule,
  choices: MergeChoices,
  customKeys: readonly string[] = [],
): MergeChoices {
  const out: MergeChoices = {};
  for (const f of MERGE_FIELDS[module]) {
    const c = choices[f.key];
    if (c === "merged" || c === "survivor") out[f.key] = c;
    else if (c === "union" && f.union) out[f.key] = "union";
  }
  for (const k of customKeys) {
    if (choices[`cf:${k}`] === "merged") out[`cf:${k}`] = "merged";
  }
  return out;
}
