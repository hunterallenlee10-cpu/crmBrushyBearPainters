import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadCustomFields } from "@/lib/custom-fields/server";
import { loadLeadOptions } from "@/lib/leads/service";
import { BULK_FIELDS, BULK_MODULES, MAX_BULK_ROWS } from "@/lib/domain/bulk";
import { BulkSelectionForm, type BulkFieldChoice } from "./bulk-selection-form";

export const metadata: Metadata = { title: "New bulk update" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const NOUN: Record<string, string> = {
  leads: "lead",
  jobs: "job",
  accounts: "account",
  contacts: "contact",
};

/** Bulk update from a list selection: pick fields and values, then preview. */
export default async function NewBulkUpdatePage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission("bulk:update");
  const sp = await searchParams;
  const mod = BULK_MODULES.find((m) => m === sp.module) ?? "leads";
  const ids = (typeof sp.ids === "string" ? sp.ids.split(",") : [])
    .filter((x) => z.uuid().safeParse(x).success)
    .slice(0, MAX_BULK_ROWS);
  const db = await createSupabaseServerClient();
  const [options, custom] = await Promise.all([loadLeadOptions(db), loadCustomFields(db, mod)]);
  const picklist = (key: string | undefined) =>
    key && key in options.picklists
      ? options.picklists[key as keyof typeof options.picklists].filter((o) => o.active !== false)
      : [];
  const choices: BulkFieldChoice[] = [
    ...BULK_FIELDS[mod].map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      nullable: f.nullable,
      options:
        f.kind === "user"
          ? options.users
          : f.kind === "territory"
            ? options.territories
            : f.kind === "picklist"
              ? picklist(f.picklist)
              : f.kind === "enum"
                ? [...(f.options ?? [])]
                : [],
    })),
    ...custom
      .filter((c) => c.active && c.type !== "long_text")
      .map((c) => ({
        key: `cf:${c.apiName}`,
        label: `${c.label} (custom)`,
        kind: (c.type === "picklist"
          ? "enum"
          : c.type === "user"
            ? "user"
            : c.type === "checkbox"
              ? "checkbox"
              : c.type === "date"
                ? "date"
                : "text") as BulkFieldChoice["kind"],
        nullable: true,
        options: c.type === "picklist" ? c.options : c.type === "user" ? options.users : [],
      })),
  ];
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/admin/bulk-update"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden /> Bulk Update
      </Link>
      <PageHeader
        title={`Bulk update ${ids.length} ${NOUN[mod]}${ids.length === 1 ? "" : "s"}`}
        description="Pick what to change. The next screen shows every record before and after; nothing changes until you apply."
      />
      {ids.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          No records were selected. Go back to a list, tick some records and choose Bulk update…
        </p>
      ) : (
        <BulkSelectionForm module={mod} ids={ids} choices={choices} />
      )}
    </div>
  );
}
