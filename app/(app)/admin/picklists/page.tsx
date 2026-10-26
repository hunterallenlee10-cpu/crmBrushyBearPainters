import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/lib/auth/viewer";
import { check } from "@/lib/actions/errors";
import { createSupabaseServerClient } from "@/lib/db/server";

export const metadata: Metadata = { title: "Field Picklists" };

const MODULE_LABELS: Record<string, string> = {
  leads: "Leads",
  jobs: "Jobs",
  properties: "Properties",
  estimates: "Estimates",
};
/** Leads first: the order work flows through the CRM. */
const MODULE_ORDER = Object.keys(MODULE_LABELS);
const moduleRank = (m: string) => {
  const i = MODULE_ORDER.indexOf(m);
  return i === -1 ? MODULE_ORDER.length : i;
};

export default async function PicklistsPage() {
  await requirePermission("picklists:manage");
  const supabase = await createSupabaseServerClient();
  const picklists =
    check(
      await supabase
        .from("picklists")
        .select("id, key, name, module, description, picklist_values(active)")
        .order("name"),
    ) ?? [];
  picklists.sort((a, b) => moduleRank(a.module) - moduleRank(b.module));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Field Picklists"
        description="The choices offered in drop-downs across the CRM. Changes apply everywhere the field is used."
      />
      <section className="rounded-2xl border bg-card">
        <Table aria-label="Picklists">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Picklist</TableHead>
              <TableHead>Module</TableHead>
              <TableHead className="hidden md:table-cell">Used for</TableHead>
              <TableHead className="pr-4 text-right">Values</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {picklists.map((p) => {
              const total = p.picklist_values.length;
              const active = p.picklist_values.filter((v) => v.active).length;
              return (
                <TableRow key={p.id} className="relative">
                  <TableCell className="pl-4 whitespace-normal">
                    <Link
                      href={`/admin/picklists/${p.key}`}
                      className="font-medium text-bb-forest after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted-foreground md:hidden">{p.description}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">{MODULE_LABELS[p.module] ?? p.module}</Badge>
                  </TableCell>
                  <TableCell className="hidden whitespace-normal text-muted-foreground md:table-cell">
                    {p.description}
                  </TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <span>
                        {active} active
                        <span className="text-muted-foreground"> of {total}</span>
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
