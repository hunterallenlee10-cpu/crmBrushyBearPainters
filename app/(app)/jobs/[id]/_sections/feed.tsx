"use client";

import * as React from "react";
import {
  AtSign,
  ListPlus,
  Loader2,
  MessagesSquare,
  NotebookPen,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { Field, fieldAria } from "@/components/forms/field";
import { ReasonButton } from "@/components/leads/reason-button";
import { formatDateTime, pacificIsoDate } from "@/lib/format/dates";
import type { Option } from "@/lib/leads/service";
import { cn } from "@/lib/utils";
import { selectClass } from "@/app/(app)/leads/[id]/labels";
import {
  COMMENT_CATEGORIES,
  NOTE_PRIORITIES,
  type CommentCategory,
  type NotePriority,
} from "@/app/(app)/leads/[id]/schemas";
import {
  addJobComment,
  addJobNote,
  addJobTask,
  deleteJobComment,
  deleteJobNote,
  setJobNotePinned,
  updateJobComment,
  updateJobNote,
} from "./actions";
import { EventEntry, MessageEntry } from "./entries";
import {
  FEED_FILTERS,
  countFeed,
  filterFeed,
  sortFeed,
  taskTitleFromPost,
  type FeedComment,
  type FeedFilter,
  type FeedItem,
  type FeedNote,
} from "./feed-utils";

const PRIORITY_LABELS: Record<NotePriority, string> = {
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

const CATEGORY_LABELS: Record<CommentCategory, string> = {
  general: "General",
  sales: "Sales",
  production: "Production",
  office: "Office",
  finance: "Finance",
};

const ATTACH_REASON = "Attachments arrive with Documents (Phase 5).";

type Person = { id: string; name: string };

export type FeedProps = {
  jobId: string;
  /** "notes": notes and comments only. "all": the whole Activity Log. */
  scope: "notes" | "all";
  items: FeedItem[];
  truncated: boolean;
  canReadNotes: boolean;
  canReadMessages: boolean;
  /** notes:write and not viewing as someone else. */
  canWrite: boolean;
  /** tasks:manage and not viewing as someone else. */
  canManageTasks: boolean;
  readOnly: boolean;
  viewerId: string;
  users: Option[];
  outcomeLabels: Record<string, string>;
};

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

function MentionChips({
  mentions,
  onRemove,
}: {
  mentions: Person[];
  onRemove: (id: string) => void;
}) {
  if (!mentions.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Mentioned">
      {mentions.map((m) => (
        <li key={m.id}>
          <Badge variant="info" className="gap-1 pr-1">
            @{m.name}
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-info/20"
              aria-label={`Remove mention of ${m.name}`}
              onClick={() => onRemove(m.id)}
            >
              <X className="size-3" aria-hidden />
            </button>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

// --- Composer ------------------------------------------------------------------------

type PostValues = {
  body: string;
  priority: NotePriority;
  pinned: boolean;
  category: CommentCategory;
  mentions: Person[];
};

const EMPTY_POST: PostValues = {
  body: "",
  priority: "normal",
  pinned: false,
  category: "general",
  mentions: [],
};

/**
 * Note | Comment form. Used for new posts (mode toggle shown) and for editing
 * one (mode fixed). Notes carry priority and pin; comments carry a category
 * and @mentions (a database trigger notifies the people mentioned).
 */
function PostForm({
  idPrefix,
  people,
  mode: fixedMode,
  initial = EMPTY_POST,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  people: Person[];
  mode?: "note" | "comment";
  initial?: PostValues;
  submitLabel?: string;
  onSubmit: (mode: "note" | "comment", v: PostValues) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [mode, setMode] = React.useState<"note" | "comment">(fixedMode ?? "note");
  const [v, setV] = React.useState<PostValues>(initial);
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const isNote = mode === "note";
  const set = <K extends keyof PostValues>(k: K, value: PostValues[K]) =>
    setV((prev) => ({ ...prev, [k]: value }));

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.body.trim())
          return setError(isNote ? "Write a note first." : "Write a comment first.");
        setError(undefined);
        startTransition(async () => {
          const ok = await onSubmit(mode, v);
          if (ok && !onCancel) setV(EMPTY_POST);
        });
      }}
    >
      {!fixedMode && (
        <div role="group" aria-label="Post type" className="flex flex-wrap gap-1.5">
          {(["note", "comment"] as const).map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={mode === m ? "default" : "outline"}
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                setError(undefined);
              }}
            >
              {m === "note" ? <NotebookPen aria-hidden /> : <MessagesSquare aria-hidden />}
              {m === "note" ? "Note" : "Comment"}
            </Button>
          ))}
        </div>
      )}
      {!isNote && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-bb-forest">
          <MessagesSquare className="size-4" aria-hidden />
          Team discussion – staff only
        </p>
      )}
      <Field
        id={`${idPrefix}-body`}
        label={isNote ? "Note" : "Comment"}
        error={error}
        description={
          isNote
            ? "Internal. Customers never see notes. Switch to Comment to @mention a teammate."
            : "Internal only. Customers never see comments. People you mention get a notification."
        }
      >
        <Textarea
          ref={bodyRef}
          value={v.body}
          onChange={(e) => set("body", e.target.value)}
          rows={3}
          maxLength={isNote ? 10000 : 5000}
          {...fieldAria(`${idPrefix}-body`, error, true)}
        />
      </Field>
      {!isNote && (
        <MentionChips
          mentions={v.mentions}
          onRemove={(id) =>
            set(
              "mentions",
              v.mentions.filter((x) => x.id !== id),
            )
          }
        />
      )}
      <div className="flex flex-wrap items-end gap-3">
        {isNote ? (
          <>
            <Field id={`${idPrefix}-priority`} label="Priority" className="w-36">
              <select
                id={`${idPrefix}-priority`}
                value={v.priority}
                onChange={(e) => set("priority", e.target.value as NotePriority)}
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
                checked={v.pinned}
                onCheckedChange={(c) => set("pinned", c === true)}
              />
              <Label htmlFor={`${idPrefix}-pinned`}>Pin to top</Label>
            </div>
          </>
        ) : (
          <>
            <Field id={`${idPrefix}-category`} label="Category" className="w-40">
              <select
                id={`${idPrefix}-category`}
                value={v.category}
                onChange={(e) => set("category", e.target.value as CommentCategory)}
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
              selected={v.mentions}
              onPick={(p) => {
                setV((prev) => ({
                  ...prev,
                  mentions: [...prev.mentions, p],
                  body: `${prev.body}${prev.body && !prev.body.endsWith(" ") ? " " : ""}@${p.name} `,
                }));
                requestAnimationFrame(() => bodyRef.current?.focus());
              }}
            />
          </>
        )}
        {!fixedMode && (
          <ReasonButton type="button" variant="outline" size="sm" disabledReason={ATTACH_REASON}>
            <Paperclip aria-hidden />
            Attach
          </ReasonButton>
        )}
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {submitLabel ?? (isNote ? "Add note" : "Add comment")}
          </Button>
        </div>
      </div>
    </form>
  );
}

// --- Create a task from a post ------------------------------------------------------------

function TaskFromPostDialog({
  jobId,
  post,
  users,
  viewerId,
  onClose,
}: {
  jobId: string;
  post: FeedNote | FeedComment | null;
  users: Option[];
  viewerId: string;
  onClose: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [assignee, setAssignee] = React.useState(viewerId);
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const hasMe = users.some((u) => u.value === viewerId);

  React.useEffect(() => {
    if (post) {
      setTitle(taskTitleFromPost(post.body));
      setDueDate("");
      setAssignee(viewerId);
      setError(undefined);
    }
  }, [post, viewerId]);

  return (
    <Dialog open={post !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a task from this post</DialogTitle>
          <DialogDescription>
            It shows up under Tasks &amp; Checklists on this job.
          </DialogDescription>
        </DialogHeader>
        <form
          id="task-from-post"
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return setError("Title is required.");
            startTransition(async () => {
              const r = await addJobTask({
                job_id: jobId,
                title,
                due_date: dueDate,
                due_time: "",
                assignee_id: assignee,
                priority: "normal",
              });
              if (r.ok) {
                toast.success("Task added.");
                onClose();
              } else {
                setError(r.error.fieldErrors?.title?.[0]);
                toast.error(r.error.message);
              }
            });
          }}
        >
          <Field id="post-task-title" label="Task" required error={error}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              {...fieldAria("post-task-title", error)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="post-task-date" label="Due date">
              <Input
                id="post-task-date"
                type="date"
                value={dueDate}
                min={pacificIsoDate()}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
            <Field id="post-task-assignee" label="Assigned to">
              <select
                id="post-task-assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className={selectClass}
              >
                {!hasMe && <option value={viewerId}>Me</option>}
                {users.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.value === viewerId ? `${u.label} (me)` : u.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="task-from-post" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ListPlus aria-hidden />}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Entries ---------------------------------------------------------------------------------

function PostMeta({ item }: { item: FeedNote | FeedComment }) {
  const edited =
    item.kind === "note"
      ? new Date(item.updatedAt).getTime() - new Date(item.at).getTime() > 2000
      : item.editedAt !== null;
  return (
    <span>
      {item.authorName ?? "Someone"} · <time dateTime={item.at}>{formatDateTime(item.at)}</time>
      {edited && " · edited"}
    </span>
  );
}

function PostActions({
  item,
  canWrite,
  canManageTasks,
  onEdit,
  onDelete,
  onPin,
  onTask,
  pending,
}: {
  item: FeedNote | FeedComment;
  canWrite: boolean;
  canManageTasks: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onTask: () => void;
  pending: boolean;
}) {
  const what = item.kind === "note" ? "note" : "comment";
  const mine = item.mine && canWrite;
  if (!mine && !canManageTasks) return null;
  return (
    <span className="ml-auto flex gap-1">
      {canManageTasks && (
        <Button size="icon-xs" variant="ghost" aria-label="Create task from post" onClick={onTask}>
          <ListPlus aria-hidden />
        </Button>
      )}
      {mine && item.kind === "note" && (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={item.pinned ? "Unpin note" : "Pin note"}
          onClick={onPin}
          disabled={pending}
        >
          {item.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        </Button>
      )}
      {mine && (
        <>
          <Button size="icon-xs" variant="ghost" aria-label={`Edit ${what}`} onClick={onEdit}>
            <Pencil aria-hidden />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label={`Delete ${what}`} onClick={onDelete}>
            <Trash2 aria-hidden />
          </Button>
        </>
      )}
    </span>
  );
}

function PostEntry({
  item,
  props,
  people,
  onDelete,
  onTask,
}: {
  item: FeedNote | FeedComment;
  props: FeedProps;
  people: Person[];
  onDelete: () => void;
  onTask: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const isNote = item.kind === "note";

  if (editing) {
    return (
      <div className="rounded-2xl border bg-card p-4">
        <PostForm
          idPrefix={`edit-${item.id}`}
          people={people}
          mode={item.kind}
          initial={{
            ...EMPTY_POST,
            body: item.body,
            ...(item.kind === "note"
              ? { priority: item.priority, pinned: item.pinned }
              : { category: item.category, mentions: item.mentions }),
          }}
          submitLabel={isNote ? "Save note" : "Save comment"}
          onCancel={() => setEditing(false)}
          onSubmit={async (_mode, v) => {
            const r = isNote
              ? await updateJobNote({
                  id: item.id,
                  job_id: props.jobId,
                  body: v.body,
                  priority: v.priority,
                  pinned: v.pinned,
                })
              : await updateJobComment({
                  id: item.id,
                  job_id: props.jobId,
                  body: v.body,
                  category: v.category,
                  mentions: v.mentions.map((m) => m.id),
                });
            if (r.ok) {
              toast.success(isNote ? "Note saved." : "Comment saved.");
              setEditing(false);
            } else toast.error(r.error.message);
            return r.ok;
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4",
        item.kind === "comment" && "border-l-4 border-l-bb-forest/50",
        item.kind === "note" && item.pinned && "border-bb-honey",
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {item.kind === "note" ? (
          <>
            <Badge variant="outline">
              <NotebookPen aria-hidden />
              Note
            </Badge>
            {item.pinned && (
              <Badge variant="info">
                <Pin aria-hidden />
                Pinned
              </Badge>
            )}
            {item.priority !== "normal" && (
              <Badge variant={item.priority === "urgent" ? "danger" : "warning"}>
                {PRIORITY_LABELS[item.priority]}
              </Badge>
            )}
          </>
        ) : (
          <>
            <Badge variant="outline">
              <MessagesSquare aria-hidden />
              Comment · staff only
            </Badge>
            <Badge variant="neutral">{CATEGORY_LABELS[item.category]}</Badge>
          </>
        )}
        <PostMeta item={item} />
        <PostActions
          item={item}
          canWrite={props.canWrite}
          canManageTasks={props.canManageTasks}
          pending={pending}
          onEdit={() => setEditing(true)}
          onDelete={onDelete}
          onTask={onTask}
          onPin={() =>
            item.kind === "note" &&
            startTransition(async () => {
              const r = await setJobNotePinned({
                id: item.id,
                job_id: props.jobId,
                pinned: !item.pinned,
              });
              if (r.ok) toast.success(item.pinned ? "Note unpinned." : "Note pinned.");
              else toast.error(r.error.message);
            })
          }
        />
      </div>
      <p className="text-sm break-words whitespace-pre-wrap">{item.body}</p>
      {item.kind === "comment" && item.mentions.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Mentioned:
          {item.mentions.map((m) => (
            <Badge key={m.id} variant="info">
              @{m.name}
            </Badge>
          ))}
        </p>
      )}
    </div>
  );
}

// --- Feed ----------------------------------------------------------------------------------

export function JobFeed(props: FeedProps) {
  const { jobId, scope, items, canWrite, readOnly } = props;
  const [filter, setFilter] = React.useState<FeedFilter>("all");
  const [query, setQuery] = React.useState("");
  const [deleting, setDeleting] = React.useState<FeedNote | FeedComment | null>(null);
  const [taskFrom, setTaskFrom] = React.useState<FeedNote | FeedComment | null>(null);
  const [pending, startTransition] = React.useTransition();

  const people = React.useMemo(
    () =>
      props.users
        .filter((u) => u.value !== props.viewerId)
        .map((u) => ({ id: u.value, name: u.label })),
    [props.users, props.viewerId],
  );
  const counts = React.useMemo(() => countFeed(items), [items]);
  const visible = React.useMemo(
    () => sortFeed(filterFeed(items, filter, query)),
    [items, filter, query],
  );
  const chips = FEED_FILTERS.filter(
    (f) => scope === "all" || f.id === "all" || f.id === "notes" || f.id === "comments",
  );
  const headingId = `${scope}-feed-title`;

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <section
          aria-labelledby={`${scope}-composer-title`}
          className="rounded-2xl border bg-card p-4 sm:p-5"
        >
          <h2 id={`${scope}-composer-title`} className="mb-3 text-base font-semibold">
            Add a note or comment
          </h2>
          <PostForm
            idPrefix={`${scope}-new`}
            people={people}
            onSubmit={async (mode, v) => {
              const r =
                mode === "note"
                  ? await addJobNote({
                      job_id: jobId,
                      body: v.body,
                      priority: v.priority,
                      pinned: v.pinned,
                    })
                  : await addJobComment({
                      job_id: jobId,
                      body: v.body,
                      category: v.category,
                      mentions: v.mentions.map((m) => m.id),
                    });
              if (r.ok) toast.success(mode === "note" ? "Note added." : "Comment added.");
              else toast.error(r.error.message);
              return r.ok;
            }}
          />
        </section>
      ) : (
        props.canReadNotes && (
          <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
            {readOnly
              ? "You're viewing as another user. Exit View as user to add notes or comments."
              : "You can read the team's notes but not add them. Ask an owner for the “Write notes and comments” permission."}
          </p>
        )
      )}

      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={headingId} className="text-base font-semibold">
            {scope === "notes" ? "Notes & comments" : "Everything on this job"}
          </h2>
          <span className="text-xs text-muted-foreground">Newest first · Pacific time</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div role="group" aria-label="Filter the feed" className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <Button
                key={c.id}
                type="button"
                size="xs"
                variant={filter === c.id ? "default" : "outline"}
                aria-pressed={filter === c.id}
                className="h-8 px-2.5"
                onClick={() => setFilter(c.id)}
              >
                {c.label}
                <span className="tabular-nums opacity-80">
                  {c.id === "all" && scope === "notes"
                    ? counts.notes + counts.comments
                    : counts[c.id]}
                </span>
              </Button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this feed…"
              aria-label="Search the feed"
              className="pl-8"
            />
          </div>
        </div>

        {!props.canReadNotes && (
          <p className="text-xs text-muted-foreground">
            Notes and comments are hidden for your role.
          </p>
        )}
        {scope === "all" && !props.canReadMessages && (
          <p className="text-xs text-muted-foreground">
            Customer messages are hidden for your role; system activity is shown.
          </p>
        )}

        {visible.length === 0 ? (
          <EmptyState
            icon={scope === "notes" ? NotebookPen : MessagesSquare}
            title={items.length === 0 ? "Nothing here yet" : "No matches"}
            className="py-8"
          >
            {items.length === 0
              ? scope === "notes"
                ? "No notes yet. Jot down what you learn about the home and the customer so the whole team sees it."
                : "No activity yet. Notes, messages and changes on this job show up here."
              : filter === "documents" || filter === "photos"
                ? "Documents and photos arrive in Phase 5."
                : "Nothing matches that filter or search."}
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-3" aria-label={scope === "notes" ? "Notes" : "Activity"}>
            {visible.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                {item.kind === "note" || item.kind === "comment" ? (
                  <PostEntry
                    item={item}
                    props={props}
                    people={people}
                    onDelete={() => setDeleting(item)}
                    onTask={() => setTaskFrom(item)}
                  />
                ) : item.kind === "message" ? (
                  <MessageEntry item={item} outcomeLabels={props.outcomeLabels} />
                ) : (
                  <div className="px-1">
                    <EventEntry item={item} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {props.truncated && (
          <p className="text-xs text-muted-foreground">
            Showing the latest 200 entries of each kind.
          </p>
        )}
      </section>

      <TaskFromPostDialog
        jobId={jobId}
        post={taskFrom}
        users={props.users}
        viewerId={props.viewerId}
        onClose={() => setTaskFrom(null)}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this {deleting?.kind === "comment" ? "comment" : "note"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from the job. An owner can still find it in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                const post = deleting;
                if (!post) return;
                startTransition(async () => {
                  const ref = { id: post.id, job_id: jobId };
                  const r =
                    post.kind === "note" ? await deleteJobNote(ref) : await deleteJobComment(ref);
                  if (r.ok) {
                    toast.success(post.kind === "note" ? "Note deleted." : "Comment deleted.");
                    setDeleting(null);
                  } else toast.error(r.error.message);
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
