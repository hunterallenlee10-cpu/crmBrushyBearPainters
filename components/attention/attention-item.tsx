"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Play, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AttentionCategoryIcon } from "./category-icon";
import { AttentionPriorityBadge } from "./priority-badge";
import { AssignMenu } from "./assign-menu";
import { SnoozeMenu } from "./snooze-menu";
import { ResolveDialog } from "./resolve-dialog";
import type { AttentionActions, AttentionItemView, PersonOption } from "./types";

const DUE_TONE = {
  overdue: "text-danger font-semibold",
  soon: "text-warning font-semibold",
  later: "text-muted-foreground",
} as const;

function OwnerChip({ owner }: { owner: AttentionItemView["owner"] }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm">
      <span
        aria-hidden
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
          owner
            ? "border-[1.5px] border-bb-ink bg-bb-honey text-bb-ink"
            : "border border-dashed border-muted-foreground/60 text-muted-foreground",
        )}
      >
        {owner ? owner.initials : "?"}
      </span>
      <span className="truncate">
        <span className="sr-only">Owner: </span>
        {owner ? owner.name : <span className="text-muted-foreground">Unassigned</span>}
      </span>
    </span>
  );
}

function StatusBadge({ item }: { item: AttentionItemView }) {
  if (item.status === "in_progress") return <Badge variant="info">In progress</Badge>;
  if (item.status === "snoozed") {
    return <Badge variant="neutral">Snoozed until {item.snoozedUntil ?? "later"}</Badge>;
  }
  if (item.status === "resolved") {
    return (
      <Badge variant="success">
        {item.resolution?.how === "auto" ? "Cleared automatically" : "Resolved"}
      </Badge>
    );
  }
  return null;
}

/**
 * One attention item: a dense row on desktop, a stacked card on phones (44px
 * targets). Times arrive pre-formatted from the server. Read-only while viewing
 * as another user or for resolved items.
 */
export function AttentionItem({
  item,
  people,
  actions,
  readOnly,
}: {
  item: AttentionItemView;
  people: readonly PersonOption[];
  actions: AttentionActions;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [resolveOpen, setResolveOpen] = React.useState(false);
  const [busy, startTransition] = React.useTransition();
  const titleId = React.useId();
  const editable = !readOnly && item.status !== "resolved";

  async function run(
    call: () => ReturnType<AttentionActions["start"]>,
    success: string,
  ): Promise<string | null> {
    const result = await call();
    if (!result.ok) {
      toast.error(result.error.message);
      return result.error.message;
    }
    toast.success(success);
    startTransition(() => router.refresh());
    return null;
  }

  const nameOf = (id: string | null) =>
    id ? (people.find((p) => p.id === id)?.name ?? "them") : null;

  return (
    <li
      aria-labelledby={titleId}
      data-testid="attention-item"
      data-item-id={item.id}
      data-status={item.status}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:p-4 lg:flex-row lg:items-center lg:gap-4",
        item.priority === "critical" && item.status !== "resolved" && "border-l-4 border-l-danger",
        busy && "opacity-70",
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <AttentionCategoryIcon category={item.category} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={titleId} className="min-w-0 font-semibold break-words text-bb-ink">
              {item.title}
            </h3>
            <AttentionPriorityBadge priority={item.priority} />
            <StatusBadge item={item} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <Link
              href={item.subject.href}
              className="font-medium text-bb-forest underline-offset-2 hover:underline"
            >
              {item.subject.label}
            </Link>
            <span aria-hidden>·</span>
            <span>{item.ruleLabel}</span>
            <span aria-hidden>·</span>
            <span title={item.opened.title}>{item.opened.label}</span>
            {item.due && item.status !== "resolved" && (
              <>
                <span aria-hidden>·</span>
                <span className={DUE_TONE[item.due.tone]} title={item.due.title}>
                  {item.due.label}
                </span>
              </>
            )}
          </p>
          {item.detail && <p className="text-sm break-words text-bb-ink/80">{item.detail}</p>}
          {item.resolution && (
            <p className="text-sm break-words text-bb-ink/80">
              <span className="font-medium">
                {item.resolution.how === "auto"
                  ? `Cleared automatically ${item.resolution.when}`
                  : `Resolved${item.resolution.by ? ` by ${item.resolution.by}` : ""} ${item.resolution.when}`}
                {item.resolution.note ? ": " : "."}
              </span>
              {item.resolution.note}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:shrink-0 lg:justify-end">
        <div className="sm:w-40 lg:w-36">
          <OwnerChip owner={item.owner} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Button asChild variant="outline" size="sm" className="h-11 sm:h-8">
            <Link href={item.subject.href} aria-label={`Open ${item.subject.label}`}>
              <ExternalLink aria-hidden />
              Open
            </Link>
          </Button>
          {editable && (
            <>
              <AssignMenu
                people={people}
                ownerId={item.owner?.id ?? null}
                onAssign={(ownerId) =>
                  void run(
                    () => actions.assign({ id: item.id, ownerId }),
                    ownerId ? `Assigned to ${nameOf(ownerId)}.` : "Unassigned.",
                  )
                }
              />
              {item.status === "pending" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 sm:h-8"
                  disabled={busy}
                  onClick={() =>
                    void run(() => actions.start({ id: item.id }), "Marked in progress.")
                  }
                >
                  <Play aria-hidden />
                  Start
                </Button>
              )}
              {item.status !== "pending" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 sm:h-8"
                  disabled={busy}
                  onClick={() =>
                    void run(() => actions.reopen({ id: item.id }), "Back to pending.")
                  }
                >
                  <RotateCcw aria-hidden />
                  {item.status === "snoozed" ? "Wake now" : "Back to pending"}
                </Button>
              )}
              <SnoozeMenu
                itemTitle={item.title}
                onSnooze={(until) => run(() => actions.snooze({ id: item.id, until }), "Snoozed.")}
              />
              <Button
                size="sm"
                className="col-span-2 h-11 sm:h-8"
                onClick={() => setResolveOpen(true)}
              >
                <CheckCircle2 aria-hidden />
                Resolve
              </Button>
            </>
          )}
        </div>
      </div>

      {editable && (
        <ResolveDialog
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          itemTitle={item.title}
          onResolve={(note) => run(() => actions.resolve({ id: item.id, note }), "Resolved.")}
        />
      )}
    </li>
  );
}
