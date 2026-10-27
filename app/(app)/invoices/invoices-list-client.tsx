"use client";

import { ListShell, type ListShellProps } from "@/components/lists/list-shell";

type Props = Omit<
  ListShellProps,
  "moduleId" | "noun" | "bulkActions" | "renderPreview" | "quickFilters" | "persistParams"
>;

/** The Invoices list on the shared list framework (no bulk actions: money changes on the job). */
export function InvoicesListClient(props: Props) {
  return <ListShell {...props} moduleId="invoices" noun="invoice" />;
}
