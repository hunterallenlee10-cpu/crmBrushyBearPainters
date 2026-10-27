import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadCustomFields, loadLayout, loadValidationRules } from "@/lib/custom-fields/server";
import {
  CUSTOM_FIELD_MODULES,
  CUSTOM_FIELD_MODULE_LABELS,
  VALIDATION_STANDARD_FIELDS,
  type CustomFieldModule,
} from "@/lib/domain/custom-fields";
import { cn } from "@/lib/utils";
import { ModuleManager } from "./module-manager";

export const metadata: Metadata = { title: "Module Manager" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Admin → Module Manager (SPEC §8.19): custom fields, page layouts and
 * validation rules for Leads, Jobs, Accounts and Contacts.
 */
export default async function ModuleManagerPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("settings:manage");
  const sp = await searchParams;
  const mod: CustomFieldModule = CUSTOM_FIELD_MODULES.find((m) => m === sp.module) ?? "leads";
  const db = await createSupabaseServerClient();
  const [fields, rules, layout] = await Promise.all([
    loadCustomFields(db, mod),
    loadValidationRules(db, mod),
    loadLayout(db, mod),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Module Manager"
        description="Add your own fields to leads, jobs, accounts and contacts, choose the order of the sections on their pages, and set rules the CRM checks when someone saves."
      />
      <nav aria-label="Modules" className="flex flex-wrap gap-2">
        {CUSTOM_FIELD_MODULES.map((m) => (
          <Link
            key={m}
            href={`/admin/modules?module=${m}`}
            aria-current={m === mod ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium sm:min-h-9",
              m === mod
                ? "border-bb-forest bg-bb-forest text-white"
                : "bg-card text-foreground hover:bg-muted",
            )}
          >
            {CUSTOM_FIELD_MODULE_LABELS[m]}
          </Link>
        ))}
      </nav>
      <ModuleManager
        key={mod}
        module={mod}
        moduleLabel={CUSTOM_FIELD_MODULE_LABELS[mod]}
        fields={fields}
        rules={rules}
        layout={layout}
        standardFields={[...VALIDATION_STANDARD_FIELDS[mod]]}
        readOnly={viewer.impersonating}
      />
    </div>
  );
}
