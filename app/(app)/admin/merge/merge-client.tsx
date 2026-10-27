"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, GitMerge, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useRunAction } from "@/components/forms/use-run-action";
import type { MergeChoice, MergeChoices, MergeModule } from "@/lib/domain/merge";
import { mergeCustomers, undoMerge } from "./actions";

type FieldRow = { key: string; label: string; union: boolean; survivor: string; merged: string };

export function MergeCompare(props: {
  module: MergeModule;
  survivor: { id: string; name: string };
  merged: { id: string; name: string };
  swapHref: string;
  clearHref: string;
  fields: FieldRow[];
  defaults: MergeChoices;
  moves: { label: string; count: number }[];
  consentNote: string | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [choices, setChoices] = React.useState<MergeChoices>(props.defaults);
  const [reason, setReason] = React.useState("");
  const set = (k: string, c: MergeChoice) => setChoices((s) => ({ ...s, [k]: c }));

  return (
    <section className="rounded-2xl border bg-card p-5" aria-labelledby="compare-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="compare-heading" className="text-base font-semibold">
          Merge “{props.merged.name || "duplicate"}” into “{props.survivor.name || "survivor"}”
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={props.swapHref}>
              <ArrowLeftRight aria-hidden /> Swap
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={props.clearHref}>Pick other records</Link>
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                Field
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Stays: {props.survivor.name}
              </th>
              <th scope="col" className="py-2 font-medium">
                Duplicate: {props.merged.name}
              </th>
            </tr>
          </thead>
          <tbody>
            {props.fields.map((f) => {
              const c = choices[f.key] ?? "survivor";
              const group = `choice-${f.key}`;
              return (
                <tr key={f.key} className="border-b last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {f.label}
                  </th>
                  <td className="py-2 pr-3">
                    <label className="flex min-h-11 items-center gap-2 sm:min-h-0">
                      <input
                        type="radio"
                        name={group}
                        checked={c === "survivor"}
                        onChange={() => set(f.key, "survivor")}
                      />
                      <span className="break-words">{f.survivor}</span>
                    </label>
                  </td>
                  <td className="py-2">
                    <label className="flex min-h-11 items-center gap-2 sm:min-h-0">
                      <input
                        type="radio"
                        name={group}
                        checked={c === "merged"}
                        onChange={() => set(f.key, "merged")}
                      />
                      <span className="break-words">{f.merged}</span>
                    </label>
                    {f.union && (
                      <label className="flex min-h-11 items-center gap-2 text-xs sm:min-h-0">
                        <input
                          type="radio"
                          name={group}
                          checked={c === "union"}
                          onChange={() => set(f.key, "union")}
                        />
                        Keep both
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {props.consentNote && (
        <p className="mt-3 text-sm text-muted-foreground">{props.consentNote}</p>
      )}
      <div className="mt-4 rounded-xl bg-bb-cream-light p-3 text-sm">
        <p className="font-medium">What moves to “{props.survivor.name}”</p>
        {props.moves.length === 0 ? (
          <p className="text-muted-foreground">Nothing else is linked to the duplicate.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {props.moves.map((m) => (
              <li key={m.label}>
                {m.count} {m.label.toLowerCase()}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          The duplicate goes to Deleted Records; undo the merge to bring everything back.
        </p>
      </div>
      {!props.readOnly && (
        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor="merge-reason" className="text-sm font-medium">
            Note (optional)
          </label>
          <Textarea
            id="merge-reason"
            rows={2}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Same household, entered twice"
          />
          <div className="flex justify-end">
            <Button
              variant="cta"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    mergeCustomers({
                      module: props.module,
                      survivor_id: props.survivor.id,
                      merged_id: props.merged.id,
                      choices,
                      reason: reason || undefined,
                    }),
                  {
                    success: "Merged. You can undo it from the history below.",
                    onOk: () => router.push(`/admin/merge?module=${props.module}`),
                  },
                )
              }
            >
              <GitMerge aria-hidden /> Merge
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function UndoMergeButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Undo2 aria-hidden /> Undo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Undo this merge?</DialogTitle>
          <DialogDescription>
            “{label || "The duplicate"}” comes back with everything that moved, and the surviving
            record goes back to its own values.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={`undo-${id}`} className="text-sm font-medium">
          Why?
        </label>
        <Textarea
          id={`undo-${id}`}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep the merge
          </Button>
          <Button
            disabled={pending || reason.trim().length < 10}
            onClick={() =>
              run(() => undoMerge({ id, reason }), {
                success: "Merge undone.",
                onOk: () => {
                  setOpen(false);
                  router.refresh();
                },
              })
            }
          >
            Undo merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
