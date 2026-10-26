"use client";

import * as React from "react";
import { AtSign, Loader2, MessagesSquare, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { EmptyState } from "@/components/layout/empty-state";
import { Field, fieldAria } from "@/components/forms/field";
import { formatDateTime } from "@/lib/format/dates";
import { selectClass } from "./labels";
import { addComment, updateComment } from "./actions";
import { COMMENT_CATEGORIES, type CommentCategory } from "./schemas";
import type { LeadDetailData } from "./types";

const CATEGORY_LABELS: Record<CommentCategory, string> = {
  general: "General",
  sales: "Sales",
  production: "Production",
  office: "Office",
  finance: "Finance",
};

type Person = { id: string; name: string };
type Values = { body: string; category: CommentCategory; mentions: Person[] };

function MentionPicker({
  people,
  selected,
  onPick,
}: {
  people: Person[];
  selected: Person[];
  onPick: (p: Person) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const chosen = new Set(selected.map((s) => s.id));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <AtSign aria-hidden />
          Mention someone
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command label="Find a teammate">
          <CommandInput placeholder="Find a teammate…" />
          <CommandList>
            <CommandEmpty>No one by that name.</CommandEmpty>
            {people
              .filter((p) => !chosen.has(p.id))
              .map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => {
                    onPick(p);
                    setOpen(false);
                  }}
                >
                  {p.name}
                </CommandItem>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CommentForm({
  idPrefix,
  people,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  people: Person[];
  initial: Values;
  submitLabel: string;
  onSubmit: (v: Values) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [body, setBody] = React.useState(initial.body);
  const [category, setCategory] = React.useState<CommentCategory>(initial.category);
  const [mentions, setMentions] = React.useState<Person[]>(initial.mentions);
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return setError("Write a comment first.");
        setError(undefined);
        startTransition(async () => {
          const ok = await onSubmit({ body, category, mentions });
          if (ok && !onCancel) {
            setBody("");
            setMentions([]);
            setCategory("general");
          }
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field id={`${idPrefix}-category`} label="Category" className="w-40">
          <select
            id={`${idPrefix}-category`}
            value={category}
            onChange={(e) => setCategory(e.target.value as CommentCategory)}
            className={selectClass}
          >
            {COMMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <MentionPicker
          people={people}
          selected={mentions}
          onPick={(p) => {
            setMentions((m) => [...m, p]);
            setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${p.name} `);
            requestAnimationFrame(() => bodyRef.current?.focus());
          }}
        />
      </div>
      <Field
        id={`${idPrefix}-body`}
        label="Comment"
        error={error}
        description="Internal only. Customers never see comments. People you mention get a notification."
      >
        <Textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={5000}
          {...fieldAria(`${idPrefix}-body`, error, true)}
        />
      </Field>
      {mentions.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Mentioned">
          {mentions.map((m) => (
            <li key={m.id}>
              <Badge variant="info" className="gap-1 pr-1">
                @{m.name}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-info/20"
                  aria-label={`Remove mention of ${m.name}`}
                  onClick={() => setMentions((all) => all.filter((x) => x.id !== m.id))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
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
    </form>
  );
}

export function CommentsTab({ data }: { data: LeadDetailData }) {
  const leadId = data.lead.id;
  const [editing, setEditing] = React.useState<string | null>(null);
  const people = React.useMemo(
    () =>
      data.options.users
        .filter((u) => u.value !== data.viewerId)
        .map((u) => ({ id: u.value, name: u.label })),
    [data.options.users, data.viewerId],
  );
  const canWrite = data.can.writeNotes;
  const save = async (v: Values, id?: string) => {
    const input = {
      lead_id: leadId,
      body: v.body,
      category: v.category,
      mentions: v.mentions.map((m) => m.id),
    };
    const r = id ? await updateComment({ ...input, id }) : await addComment(input);
    if (r.ok) toast.success(id ? "Comment saved." : "Comment added.");
    else toast.error(r.error.message);
    return r.ok;
  };

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <section aria-labelledby="add-comment-title" className="rounded-2xl border bg-card p-5">
          <h2 id="add-comment-title" className="mb-3 text-base font-semibold">
            Add an internal comment
          </h2>
          <CommentForm
            idPrefix="new-comment"
            people={people}
            initial={{ body: "", category: "general", mentions: [] }}
            submitLabel="Add comment"
            onSubmit={(v) => save(v)}
          />
        </section>
      )}

      {data.comments.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="No comments yet">
          Talk it over with the team here. Mention someone with @ to get their attention.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Comments">
          {data.comments.map((c) => (
            <li key={c.id} className="rounded-2xl border bg-card p-4">
              {editing === c.id ? (
                <CommentForm
                  idPrefix={`comment-${c.id}`}
                  people={people}
                  initial={{ body: c.body, category: c.category, mentions: c.mentions }}
                  submitLabel="Save comment"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (v) => {
                    const ok = await save(v, c.id);
                    if (ok) setEditing(null);
                    return ok;
                  }}
                />
              ) : (
                <>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="neutral">{CATEGORY_LABELS[c.category]}</Badge>
                    <span>
                      {c.authorName ?? "Someone"} · {formatDateTime(c.createdAt)}
                      {c.editedAt && " · edited"}
                    </span>
                    {c.mine && canWrite && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="ml-auto"
                        aria-label="Edit comment"
                        onClick={() => setEditing(c.id)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    )}
                  </div>
                  <p className="text-sm break-words whitespace-pre-wrap">{c.body}</p>
                  {c.mentions.length > 0 && (
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      Mentioned:
                      {c.mentions.map((m) => (
                        <Badge key={m.id} variant="info">
                          @{m.name}
                        </Badge>
                      ))}
                    </p>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.truncated.comments && (
        <p className="text-xs text-muted-foreground">Showing the latest 200 comments.</p>
      )}
    </div>
  );
}
