import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { DISPOSITION_GROUPS, type DispositionGroup } from "@/lib/domain/follow-ups";
import { loadListSettings } from "@/lib/follow-ups/lists";
import { DispositionsEditor, ListSettingsForm } from "./forms";

export const metadata: Metadata = { title: "Follow-up Lists & Dispositions" };

/**
 * Admin → Follow-up Lists & Dispositions (SPEC §8.19, §11.4): each list's
 * name, script, cooldown and on/off; the call outcomes grouped Positive /
 * Negative / Callback / No Contact / Won. The list rules themselves are
 * built in (DECISIONS: system-defined lists).
 */
export default async function FollowUpListsAdminPage() {
  const viewer = await requirePermission("settings:manage");
  const supabase = await createSupabaseServerClient();
  const [lists, dispositions, picklist] = await Promise.all([
    loadListSettings(supabase),
    supabase
      .from("follow_up_dispositions")
      .select(
        "id, key, label, disposition_group, lead_disposition, requires_callback, sets_do_not_contact, active, sort_order",
      )
      .order("sort_order"),
    supabase
      .from("picklist_values")
      .select("value, label, picklists!inner(key)")
      .eq("picklists.key", "lead_disposition")
      .order("sort_order"),
  ]);
  const readOnly = viewer.impersonating;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Follow-up Lists & Dispositions"
        description="The call lists in Leads → Follow-up Lists fill themselves from built-in rules. Here you name them, write the call script (drafts until an owner approves the wording) and set how long a record rests after a call."
      />
      <section aria-labelledby="lists-title" className="flex flex-col gap-3">
        <h2 id="lists-title" className="text-base font-semibold">
          Lists
        </h2>
        {lists.map((l) => (
          <ListSettingsForm key={l.key} list={l} readOnly={readOnly} />
        ))}
      </section>
      <section aria-labelledby="dispositions-title" className="flex flex-col gap-3">
        <h2 id="dispositions-title" className="text-base font-semibold">
          Dispositions
        </h2>
        <DispositionsEditor
          readOnly={readOnly}
          groups={[...DISPOSITION_GROUPS]}
          leadDispositions={(picklist.data ?? []).map((p) => ({ value: p.value, label: p.label }))}
          rows={(dispositions.data ?? []).map((d) => ({
            id: d.id,
            key: d.key,
            label: d.label,
            group: d.disposition_group as DispositionGroup,
            leadDisposition: d.lead_disposition ?? "",
            requiresCallback: d.requires_callback,
            setsDoNotContact: d.sets_do_not_contact,
            active: d.active,
          }))}
        />
      </section>
    </div>
  );
}
