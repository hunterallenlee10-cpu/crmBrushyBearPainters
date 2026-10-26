"use client";

import * as React from "react";
import { Loader2, NotebookPen, Pencil, Pin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { Field, fieldAria } from "@/components/forms/field";
import { formatDateTime } from "@/lib/format/dates";
import { selectClass } from "./labels";
import { addNote, deleteNote, updateNote } from "./actions";
import { NOTE_PRIORITIES, type NotePriority } from "./schemas";
import type { LeadDetailData, NoteItem } from "./types";

const PRIORITY_LABELS: Record<NotePriority, string> = {
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

function NoteForm({
  idPrefix,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  initial: { body: string; priority: NotePriority; pinned: boolean };
  submitLabel: string;
  onSubmit: (v: { body: string; priority: NotePriority; pinned: boolean }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [body, setBody] = React.useState(initial.body);
  const [priority, setPriority] = React.useState<NotePriority>(initial.priority);
  const [pinned, setPinned] = React.useState(initial.pinned);
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return setError("Write a note first.");
        setError(undefined);
        startTransition(async () => {
          const ok = await onSubmit({ body, priority, pinned });
          if (ok && !onCancel) {
            setBody("");
            setPriority("normal");
            setPinned(false);
          }
        });
      }}
    >
      <Field id={`${idPrefix}-body`} label="Note" error={error}>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={10000}
          {...fieldAria(`${idPrefix}-body`, error)}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-4">
        <Field id={`${idPrefix}-priority`} label="Priority" className="w-36">
          <select
            id={`${idPrefix}-priority`}
            value={priority}
            onChange={(e) => setPriority(e.target.value as NotePriority)}
            className={selectClass}
          >
            {NOTE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex h-9 items-center gap-2">
          <Checkbox
            id={`${idPrefix}-pinned`}
            checked={pinned}
            onCheckedChange={(v) => setPinned(v === true)}
          />
          <Label htmlFor={`${idPrefix}-pinned`}>Pin to top</Label>
        </div>
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function NotesTab({ data }: { data: LeadDetailData }) {
  const leadId = data.lead.id;
  const [editing, setEditing] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<NoteItem | null>(null);
  const [pending, startTransition] = React.useTransition();
  const canWrite = data.can.writeNotes;

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <section aria-labelledby="add-note-title" className="rounded-2xl border bg-card p-5">
          <h2 id="add-note-title" className="mb-3 text-base font-semibold">
            Add a note
          </h2>
          <NoteForm
            idPrefix="new-note"
            initial={{ body: "", priority: "normal", pinned: false }}
            submitLabel="Add note"
            onSubmit={async (v) => {
              const r = await addNote({ lead_id: leadId, ...v });
              if (r.ok) toast.success("Note added.");
              else toast.error(r.error.message);
              return r.ok;
            }}
          />
        </section>
      )}

      {data.notes.length === 0 ? (
        <EmptyState icon={NotebookPen} title="No notes yet">
          {canWrite
            ? "No notes yet. Jot down what you learn about the home and the customer so the whole team sees it."
            : "No notes yet."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Notes">
          {data.notes.map((n) => (
            <li key={n.id} className="rounded-2xl border bg-card p-4">
              {editing === n.id ? (
                <NoteForm
                  idPrefix={`note-${n.id}`}
                  initial={{ body: n.body, priority: n.priority, pinned: n.pinned }}
                  submitLabel="Save note"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (v) => {
                    const r = await updateNote({ id: n.id, lead_id: leadId, ...v });
                    if (r.ok) {
                      toast.success("Note saved.");
                      setEditing(null);
                    } else toast.error(r.error.message);
                    return r.ok;
                  }}
                />
              ) : (
                <>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {n.pinned && (
                      <Badge variant="info">
                        <Pin aria-hidden />
                        Pinned
                      </Badge>
                    )}
                    {n.priority !== "normal" && (
                      <Badge variant={n.priority === "urgent" ? "danger" : "warning"}>
                        {PRIORITY_LABELS[n.priority]}
                      </Badge>
                    )}
                    <span>
                      {n.authorName ?? "Someone"} · {formatDateTime(n.createdAt)}
                      {new Date(n.updatedAt).getTime() - new Date(n.createdAt).getTime() > 2000 &&
                        " · edited"}
                    </span>
                    {n.mine && canWrite && (
                      <span className="ml-auto flex gap-1">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Edit note"
                          onClick={() => setEditing(n.id)}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Delete note"
                          onClick={() => setDeleting(n)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </span>
                    )}
                  </div>
                  <p className="text-sm break-words whitespace-pre-wrap">{n.body}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.truncated.notes && (
        <p className="text-xs text-muted-foreground">Showing the latest 200 notes.</p>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from the lead. An owner can still find it in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep note</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                const note = deleting;
                if (!note) return;
                startTransition(async () => {
                  const r = await deleteNote({ id: note.id, lead_id: leadId });
                  if (r.ok) {
                    toast.success("Note deleted.");
                    setDeleting(null);
                  } else toast.error(r.error.message);
                });
              }}
            >
              Delete note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
