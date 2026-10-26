import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { check } from "@/lib/actions/errors";
import { createSupabaseServerClient } from "@/lib/db/server";
import { DISPOSITION_PICKLIST_KEY } from "@/lib/validation/picklists";
import { type ParentOption, type PicklistValueRow } from "./shared";
import { PicklistValuesEditor } from "./values-editor";

type Params = { key: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { key } = await params;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("picklists").select("name").eq("key", key).maybeSingle();
  return { title: data?.name ?? "Field Picklists" };
}

export default async function PicklistValuesPage({ params }: { params: Promise<Params> }) {
  await requirePermission("picklists:manage");
  const { key } = await params;
  const supabase = await createSupabaseServerClient();

  const picklist = check(
    await supabase
      .from("picklists")
      .select("id, key, name, description, module, parent_picklist_id")
      .eq("key", key)
      .maybeSingle(),
  );
  if (!picklist) notFound();

  const values =
    check(
      await supabase
        .from("picklist_values")
        .select("id, value, label, category, parent_value_id, color, active, is_system, sort_order")
        .eq("picklist_id", picklist.id)
        .order("sort_order")
        .order("label"),
    ) ?? [];

  let parent: { name: string; options: ParentOption[] } | null = null;
  if (picklist.parent_picklist_id) {
    const parentList = check(
      await supabase
        .from("picklists")
        .select("name, picklist_values(id, label, active, sort_order)")
        .eq("id", picklist.parent_picklist_id)
        .maybeSingle(),
    );
    if (parentList) {
      parent = {
        name: parentList.name,
        options: [...parentList.picklist_values]
          .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
          .map((o) => ({ id: o.id, label: o.label, active: o.active })),
      };
    }
  }

  const rows: PicklistValueRow[] = values.map((v) => ({
    id: v.id,
    value: v.value,
    label: v.label,
    category: v.category,
    parentValueId: v.parent_value_id,
    color: v.color,
    active: v.active,
    isSystem: v.is_system,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/picklists"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Field Picklists
        </Link>
        <PageHeader title={picklist.name} description={picklist.description ?? undefined} />
      </div>
      <PicklistValuesEditor
        picklistId={picklist.id}
        picklistName={picklist.name}
        rows={rows}
        hasCategory={picklist.key === DISPOSITION_PICKLIST_KEY}
        parent={parent}
      />
    </div>
  );
}
