import type { FieldDef, QueryOp } from "@/lib/lists/filters";
import type { ListContext, ListModule } from "@/lib/lists/params";
import { quote } from "@/lib/lists/filters";
import { cleanSearchTerm } from "@/lib/lists/modules/accounts";
import {
  CONTACT_ROLES,
  CONTACT_ROLE_LABELS,
  PREFERRED_CHANNELS,
  PREFERRED_CHANNEL_LABELS,
} from "@/lib/validation/accounts";

/** Contacts list definition (SPEC §8 "Lists", §8.10). */

const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>) =>
  keys.map((k) => ({ value: k, label: labels[k] }));

export const CONTACT_FIELDS: readonly FieldDef[] = [
  { key: "name", label: "Name", type: "text", column: "first_name", searchColumn: "search_text" },
  { key: "last_name", label: "Last name", type: "text", column: "last_name" },
  { key: "email", label: "Email", type: "text", column: "email" },
  { key: "phone", label: "Phone", type: "text", column: "phone_digits" },
  {
    key: "role",
    label: "Role",
    type: "enum",
    column: "role",
    options: opts(CONTACT_ROLES, CONTACT_ROLE_LABELS),
  },
  {
    key: "preferred_channel",
    label: "Preferred channel",
    type: "enum",
    column: "preferred_channel",
    options: opts(PREFERRED_CHANNELS, PREFERRED_CHANNEL_LABELS),
  },
  { key: "sms_opt_in", label: "Opted in to texts", type: "boolean", column: "sms_opt_in" },
  { key: "email_opt_in", label: "Opted in to email", type: "boolean", column: "email_opt_in" },
  { key: "do_not_contact", label: "Do not contact", type: "boolean", column: "do_not_contact" },
  { key: "created", label: "Created", type: "date", column: "created_at" },
];

/** Name/email text, or phone digits (4+), as one or-group. */
export function contactSearchOps(q: string): QueryOp[] {
  const term = cleanSearchTerm(q);
  const digits = q.replace(/\D/g, "");
  const parts: string[] = [];
  if (term) parts.push(`search_text.ilike.${quote(`*${term}*`)}`);
  if (digits.length >= 4) parts.push(`phone_digits.ilike.${quote(`*${digits}*`)}`);
  return parts.length ? [{ kind: "or", expr: parts.join(",") }] : [];
}

/**
 * The list query embeds the account as `account:accounts!contacts_account_id_fkey!inner(...)`,
 * so "Mine" can filter on the account owner. Every visible contact has a
 * visible account (contacts RLS checks the account), so the inner join hides nothing.
 */
export const CONTACT_ACCOUNT_OWNER_COLUMN = "account.owner_id";

export const CONTACTS_LIST: ListModule = {
  id: "contacts",
  label: "Contacts",
  fields: CONTACT_FIELDS,
  columns: [
    { id: "name", label: "Name", defaultVisible: true, sortColumn: "first_name", locked: true },
    { id: "account", label: "Account", defaultVisible: true },
    { id: "role", label: "Role", defaultVisible: true, sortColumn: "role" },
    { id: "mobile", label: "Mobile", defaultVisible: true, sortColumn: "mobile" },
    { id: "email", label: "Email", defaultVisible: true, sortColumn: "email" },
    { id: "consent", label: "Consent", defaultVisible: true },
    { id: "created", label: "Created", defaultVisible: true, sortColumn: "created_at" },
    { id: "phone", label: "Other phone", defaultVisible: false, sortColumn: "phone" },
    { id: "preferred_channel", label: "Prefers", defaultVisible: false },
    { id: "last_name", label: "Last name", defaultVisible: false, sortColumn: "last_name" },
  ],
  tabs: [
    { id: "all", label: "All", countKey: "total" },
    { id: "sms", label: "Opted in to texts", countKey: "sms" },
    { id: "dnc", label: "Do not contact", countKey: "dnc" },
    { id: "mine", label: "Mine", countKey: "mine" },
  ],
  chips: [
    { id: "has_mobile", label: "Has mobile" },
    { id: "has_email", label: "Has email" },
    { id: "email_opt_in", label: "Opted in to email" },
    { id: "billing", label: "Billing contacts" },
  ],
  defaultTab: "all",
  defaultSort: { column: "created_at", dir: "desc" },
  searchPlaceholder: "Search name, email or phone…",
  searchOps: contactSearchOps,
  tabOps: (tab, ctx: ListContext) => {
    switch (tab) {
      case "sms":
        return [{ kind: "filter", column: "sms_opt_in", op: "eq", value: "true" }];
      case "dnc":
        return [{ kind: "filter", column: "do_not_contact", op: "eq", value: "true" }];
      case "mine":
        return [
          { kind: "filter", column: CONTACT_ACCOUNT_OWNER_COLUMN, op: "eq", value: ctx.userId },
        ];
      default:
        return [];
    }
  },
  chipOps: (chip) => {
    switch (chip) {
      case "has_mobile":
        return [{ kind: "filter", column: "mobile", op: "not.is", value: "null" }];
      case "has_email":
        return [{ kind: "filter", column: "email", op: "not.is", value: "null" }];
      case "email_opt_in":
        return [{ kind: "filter", column: "email_opt_in", op: "eq", value: "true" }];
      case "billing":
        return [{ kind: "filter", column: "role", op: "eq", value: "billing" }];
      default:
        return [];
    }
  },
};
