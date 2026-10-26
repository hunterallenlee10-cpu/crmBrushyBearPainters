import type { FieldDef, QueryOp } from "@/lib/lists/filters";
import type { ListContext, ListModule } from "@/lib/lists/params";
import { quote } from "@/lib/lists/filters";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  isAccountStatus,
  isAccountType,
} from "@/lib/validation/accounts";

/** Accounts list definition (SPEC §8 "Lists", §8.10). */

const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>) =>
  keys.map((k) => ({ value: k, label: labels[k] }));

export const ACCOUNT_FIELDS: readonly FieldDef[] = [
  {
    key: "name",
    label: "Name",
    type: "text",
    column: "display_name",
    searchColumn: "search_text",
  },
  {
    key: "type",
    label: "Type",
    type: "enum",
    column: "account_type",
    options: opts(ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS),
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    column: "status",
    options: opts(ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS),
  },
  { key: "owner", label: "Owner", type: "user", column: "owner_id", optionSource: "users" },
  {
    key: "territory",
    label: "Territory",
    type: "enum",
    column: "territory_id",
    optionSource: "territories",
  },
  {
    key: "referral_champion",
    label: "Referral champion",
    type: "boolean",
    column: "is_referral_champion",
  },
  { key: "tags", label: "Tags", type: "array", column: "tags" },
  { key: "created", label: "Created", type: "date", column: "created_at" },
  { key: "updated", label: "Last updated", type: "date", column: "updated_at" },
];

/** Strips characters that would break a PostgREST or()-group or an ilike pattern. */
export function cleanSearchTerm(q: string): string {
  return q
    .toLowerCase()
    .replace(/[*%(),"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Search by display name, or by property address: the page looks up matching
 * properties first and passes their account ids here (one or-group).
 */
export function accountSearchOps(q: string, addressAccountIds: readonly string[] = []): QueryOp[] {
  const term = cleanSearchTerm(q);
  const parts: string[] = [];
  if (term) parts.push(`search_text.ilike.${quote(`*${term}*`)}`);
  if (addressAccountIds.length) parts.push(`id.in.(${addressAccountIds.map(quote).join(",")})`);
  return parts.length ? [{ kind: "or", expr: parts.join(",") }] : [];
}

export const ACCOUNTS_LIST: ListModule = {
  id: "accounts",
  label: "Accounts",
  fields: ACCOUNT_FIELDS,
  columns: [
    { id: "name", label: "Name", defaultVisible: true, sortColumn: "display_name", locked: true },
    { id: "type", label: "Type", defaultVisible: true, sortColumn: "account_type" },
    { id: "status", label: "Status", defaultVisible: true, sortColumn: "status" },
    { id: "primary_contact", label: "Primary contact", defaultVisible: true },
    { id: "city", label: "City / territory", defaultVisible: true },
    { id: "owner", label: "Owner", defaultVisible: true },
    { id: "leads", label: "Leads", defaultVisible: true },
    { id: "created", label: "Created", defaultVisible: true, sortColumn: "created_at" },
    { id: "tags", label: "Tags", defaultVisible: false },
    { id: "updated", label: "Last updated", defaultVisible: false, sortColumn: "updated_at" },
  ],
  tabs: [
    { id: "all", label: "All", countKey: "total" },
    { id: "prospect", label: "Prospects", countKey: "prospect" },
    { id: "active_customer", label: "Active customers", countKey: "active_customer" },
    { id: "past_customer", label: "Past customers", countKey: "past_customer" },
    { id: "inactive", label: "Inactive", countKey: "inactive" },
    { id: "mine", label: "My accounts", countKey: "mine" },
  ],
  chips: [
    { id: "residential", label: "Residential", group: "type" },
    { id: "property_manager", label: "Property manager", group: "type" },
    { id: "hoa", label: "HOA", group: "type" },
    { id: "commercial", label: "Commercial", group: "type" },
    { id: "referral_champions", label: "Referral champions" },
  ],
  defaultTab: "all",
  defaultSort: { column: "created_at", dir: "desc" },
  searchPlaceholder: "Search account name or address…",
  searchOps: (q) => accountSearchOps(q),
  tabOps: (tab, ctx: ListContext) => {
    if (tab === "mine")
      return [{ kind: "filter", column: "owner_id", op: "eq", value: ctx.userId }];
    if (isAccountStatus(tab)) return [{ kind: "filter", column: "status", op: "eq", value: tab }];
    return [];
  },
  chipOps: (chip) => {
    if (chip === "referral_champions") {
      return [{ kind: "filter", column: "is_referral_champion", op: "eq", value: "true" }];
    }
    if (isAccountType(chip)) {
      return [{ kind: "filter", column: "account_type", op: "eq", value: chip }];
    }
    return [];
  },
};
