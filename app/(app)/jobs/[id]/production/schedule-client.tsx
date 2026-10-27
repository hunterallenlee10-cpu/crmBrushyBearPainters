"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import { addChecklist, decideOnTimeCredit, toggleChecklistItem } from "./actions";
import type { ChecklistView } from "@/lib/production/job";

/** Approve or waive a drafted on-time credit (credits:approve). */
export function CreditDecision({ creditId, amount }: { creditId: string; amount: string }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [note, setNote] = React.useState("");
  const decide = (decision: "approved" | "waived") =>
    run(() => decideOnTimeCredit({ id: creditId, decision, note: note || undefined }), {
      success:
        decision === "approved"
          ? `${amount} credit approved. It goes on the final invoice.`
          : "Credit waived.",
      onOk: () => router.refresh(),
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`credit-note-${creditId}`} className="sr-only">
        Decision note
      </label>
      <Input
        id={`credit-note-${creditId}`}
        className="h-9 w-56"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button size="sm" disabled={pending} onClick={() => decide("approved")}>
        Approve {amount} credit
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("waived")}>
        Waive
      </Button>
    </div>
  );
}

/** Job checklists: tick items; add one from a template. */
export function ChecklistsCard({
  jobId,
  checklists,
  templates,
  canAdd,
  canTick,
}: {
  jobId: string;
  checklists: ChecklistView[];
  templates: { id: string; name: string }[];
  canAdd: boolean;
  canTick: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [templateId, setTemplateId] = React.useState("");
  return (
    <section aria-label="Checklists" className="rounded-2xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Checklists</h3>
        {canAdd && templates.length > 0 && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!templateId) return;
              run(() => addChecklist({ jobId, templateId }), {
                success: "Checklist added.",
                onOk: () => {
                  setTemplateId("");
                  router.refresh();
                },
              });
            }}
          >
            <label htmlFor="add-checklist" className="sr-only">
              Checklist template
            </label>
            <NativeSelect
              id="add-checklist"
              className="w-52"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Add a checklist…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm" variant="outline" disabled={pending || !templateId}>
              <Plus aria-hidden /> Add
            </Button>
          </form>
        )}
      </div>
      {checklists.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No checklists on this job yet. Add the prep, lead-safe or final walkthrough checklist.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {checklists.map((c) => {
            const done = c.items.filter((i) => i.done).length;
            return (
              <div key={c.id} className="rounded-xl border p-3">
                <p className="mb-2 flex items-center justify-between text-sm font-medium">
                  {c.name}
                  <span className="text-xs text-muted-foreground">
                    {done}/{c.items.length}
                    {c.status === "completed" && (
                      <Check className="ml-1 inline size-3 text-success" aria-label="Complete" />
                    )}
                  </span>
                </p>
                <ul className="flex flex-col gap-1">
                  {c.items.map((i) => (
                    <li key={i.id}>
                      <label className="inline-flex min-h-9 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-5 accent-bb-forest"
                          checked={i.done}
                          disabled={!canTick || pending}
                          onChange={(e) =>
                            run(() => toggleChecklistItem({ id: i.id, done: e.target.checked }), {
                              onOk: () => router.refresh(),
                            })
                          }
                        />
                        <span className={i.done ? "text-muted-foreground line-through" : ""}>
                          {i.label}
                          {i.required ? "" : " (optional)"}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
