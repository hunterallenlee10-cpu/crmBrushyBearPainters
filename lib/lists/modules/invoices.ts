import { quote, type FieldDef } from "@/lib/lists/filters";
import type { ChipDef, ListModule } from "@/lib/lists/params";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  INVOICE_TYPES,
  INVOICE_TYPE_LABELS,
} from "@/lib/domain/ledger/types";

/**
 * Invoices list (SPEC §8 lists, §10). Reads public.invoice_ledger (a view
 * with the caller's row security), so balances, days past due and the
 * current status are computed in Postgres from the payments, never stored.
 */

export const INVOICE_FIELDS: readonly FieldDef[] = [
  { key: "number", label: "Invoice #", type: "text", column: "invoice_number" },
  { key: "job", label: "Job name", type: "text", column: "job_name" },
  { key: "account", label: "Customer", type: "text", column: "account_name" },
  {
    key: "type",
    label: "Type",
    type: "enum",
    column: "invoice_type",
    options: INVOICE_TYPES.map((t) => ({ value: t, label: INVOICE_TYPE_LABELS[t] })),
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    column: "display_status",
    options: INVOICE_STATUSES.map((s) => ({ value: s, label: INVOICE_STATUS_LABELS[s] })),
  },
  { key: "days_past_due", label: "Days past due", type: "number", column: "days_past_due" },
  { key: "created", label: "Created", type: "date", column: "created_at" },
];

export const INVOICE_CHIPS: readonly ChipDef[] = INVOICE_TYPES.map((t) => ({
  id: t,
  label: INVOICE_TYPE_LABELS[t],
  group: "type",
}));

export function cleanInvoiceSearch(q: string): string {
  return q
    .toLowerCase()
    .replace(/[*%(),"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const INVOICES_LIST: ListModule = {
  id: "invoices",
  label: "Invoices",
  fields: INVOICE_FIELDS,
  columns: [
    {
      id: "number",
      label: "Invoice #",
      defaultVisible: true,
      sortColumn: "invoice_number",
      locked: true,
    },
    { id: "job", label: "Job", defaultVisible: true, sortColumn: "job_name" },
    { id: "account", label: "Customer", defaultVisible: true, sortColumn: "account_name" },
    { id: "type", label: "Type", defaultVisible: true, sortColumn: "invoice_type" },
    { id: "status", label: "Status", defaultVisible: true, sortColumn: "display_status" },
    { id: "issued", label: "Issued", defaultVisible: true, sortColumn: "issue_date" },
    { id: "due", label: "Due", defaultVisible: true, sortColumn: "due_date" },
    { id: "total", label: "Total", defaultVisible: true, sortColumn: "total_cents" },
    { id: "paid", label: "Paid", defaultVisible: true, sortColumn: "collected_cents" },
    { id: "balance", label: "Balance", defaultVisible: true, sortColumn: "balance_cents" },
    { id: "late", label: "Days past due", defaultVisible: false, sortColumn: "days_past_due" },
    { id: "sync", label: "Accounting", defaultVisible: false },
    { id: "created", label: "Created", defaultVisible: false, sortColumn: "created_at" },
  ],
  tabs: [
    { id: "open", label: "Open", countKey: "open" },
    { id: "overdue", label: "Overdue", countKey: "overdue" },
    { id: "draft", label: "Drafts", countKey: "draft" },
    { id: "paid", label: "Paid", countKey: "paid" },
    { id: "all", label: "All", countKey: "all" },
  ],
  chips: INVOICE_CHIPS,
  defaultTab: "open",
  defaultSort: { column: "due_date", dir: "asc" },
  searchPlaceholder: "Search invoice #, job or customer…",
  searchOps: (q) => {
    const term = cleanInvoiceSearch(q);
    if (!term) return [];
    const like = quote(`*${term}*`);
    return [
      {
        kind: "or",
        expr: `invoice_number.ilike.${like},job_name.ilike.${like},account_name.ilike.${like}`,
      },
    ];
  },
  tabOps: (tab) => {
    switch (tab) {
      case "open":
        return [
          { kind: "filter", column: "issued", op: "is", value: "true" },
          { kind: "filter", column: "balance_cents", op: "gt", value: "0" },
        ];
      case "overdue":
        return [{ kind: "filter", column: "display_status", op: "eq", value: "overdue" }];
      case "draft":
        return [{ kind: "filter", column: "display_status", op: "eq", value: "draft" }];
      case "paid":
        return [{ kind: "filter", column: "display_status", op: "eq", value: "paid" }];
      default:
        return [];
    }
  },
  chipOps: (chip) =>
    (INVOICE_TYPES as readonly string[]).includes(chip)
      ? [{ kind: "filter", column: "invoice_type", op: "eq", value: chip }]
      : [],
};
