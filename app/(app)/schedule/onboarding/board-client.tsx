"use client";

import * as React from "react";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  AlertTriangle,
  ArrowRight,
  Biohazard,
  CloudRain,
  GripVertical,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { useRunAction } from "@/components/forms/use-run-action";
import {
  BOARD_LANES,
  LANE_LABELS,
  boardMove,
  type BoardLane,
  type PlacedCard,
} from "@/lib/domain/onboarding/board";
import type { BoardStats } from "@/lib/metrics/registry";
import { formatMoney } from "@/lib/metrics/registry";
import { moveOnBoard } from "./actions";

/** Cards shown per lane; the rest are a link to the job list. */
const LANE_CAP = 60;

const WORK_TYPE_LABELS: Record<string, string> = {
  interior: "Interior",
  exterior: "Exterior",
  cabinets: "Cabinets",
  deck_fence: "Deck & Fence",
  add_on_only: "Add-on",
};

/**
 * The kanban (SPEC §8.7). Drag a card (mouse, touch or keyboard: space to
 * pick up, arrows to move, space to drop) or use its button. Drops that a
 * gate doesn't allow say why instead of moving.
 */
export function BoardClient({
  cards,
  lanes,
  canSeeMoney,
  canAdvance,
  empty,
}: {
  cards: PlacedCard[];
  lanes: BoardStats["lanes"];
  canSeeMoney: boolean;
  canAdvance: boolean;
  empty: boolean;
}) {
  const { pending, run } = useRunAction();
  const [message, setMessage] = React.useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const tryMove = (card: PlacedCard, to: BoardLane) => {
    const m = boardMove(card, to);
    if (!m.allowed) {
      if (card.lane !== to) {
        setMessage(m.reason);
        toast.error(m.reason);
      }
      return;
    }
    if (!canAdvance) {
      const why = "You don't have permission to move job stages.";
      setMessage(why);
      toast.error(why);
      return;
    }
    run(() => moveOnBoard({ jobId: card.id, to }), {
      success: `${card.jobNumber}: ${m.message}`,
      onOk: () => setMessage(`${card.jobNumber} moved to Ready to Schedule.`),
      onError: (e) => setMessage(e.message),
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const card = cards.find((c) => c.id === e.active.id);
    const to = e.over?.id as BoardLane | undefined;
    if (!card || !to) return;
    tryMove(card, to);
  };

  if (empty) {
    return (
      <EmptyState icon={ClipboardList} title="Nothing on the board yet">
        <p>
          Jobs appear here when a customer accepts an estimate. Send an estimate from a job&apos;s
          Estimate &amp; Scope section to get started.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="sr-only" role="status" aria-live="assertive">
        {message}
      </p>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
          <div className="flex min-w-max gap-3">
            {BOARD_LANES.map((lane) => {
              const laneCards = cards.filter((c) => c.lane === lane);
              const sum = lanes.find((l) => l.lane === lane);
              return (
                <Lane
                  key={lane}
                  lane={lane}
                  count={sum?.count ?? laneCards.length}
                  valueCents={canSeeMoney ? (sum?.valueCents ?? null) : null}
                  avgDays={sum?.avgDays ?? null}
                  overdue={sum?.overdue ?? 0}
                >
                  {laneCards.slice(0, LANE_CAP).map((c) => (
                    <Card
                      key={c.id}
                      card={c}
                      canSeeMoney={canSeeMoney}
                      pending={pending}
                      onAdvance={
                        canAdvance && c.lane === "needs_onboarding" && c.readyToSchedule
                          ? () => tryMove(c, "ready")
                          : undefined
                      }
                    />
                  ))}
                  {laneCards.length > LANE_CAP && (
                    <Link
                      href="/jobs/list"
                      className="text-xs font-semibold text-bb-forest underline"
                    >
                      {laneCards.length - LANE_CAP} more in the Job List
                    </Link>
                  )}
                  {laneCards.length === 0 && (
                    <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
                      No jobs
                    </p>
                  )}
                </Lane>
              );
            })}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

function Lane({
  lane,
  count,
  valueCents,
  avgDays,
  overdue,
  children,
}: {
  lane: BoardLane;
  count: number;
  valueCents: number | null;
  avgDays: number | null;
  overdue: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane });
  const headingId = `lane-${lane}`;
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-2xl border bg-muted/40 p-3 ${isOver ? "ring-2 ring-bb-forest" : ""}`}
      data-testid={`lane-${lane}`}
    >
      <header>
        <h2 id={headingId} className="flex items-center justify-between text-sm font-semibold">
          {LANE_LABELS[lane]}
          <span className="rounded-full bg-card px-2 text-xs tabular-nums">{count}</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          {[
            valueCents !== null ? formatMoney(valueCents) : null,
            avgDays !== null ? `avg ${avgDays} d` : null,
            overdue ? `${overdue} overdue` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
      </header>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Card({
  card,
  canSeeMoney,
  pending,
  onAdvance,
}: {
  card: PlacedCard;
  canSeeMoney: boolean;
  pending: boolean;
  onAdvance?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const weather = card.holds.some((h) => h.type === "weather");
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border bg-card p-3 text-sm shadow-xs ${isDragging ? "z-10 opacity-80 shadow-lg" : ""} ${card.overdue ? "border-warning" : ""}`}
      data-testid={`board-card-${card.jobNumber}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="-ml-1 grid size-8 shrink-0 cursor-grab place-items-center rounded text-muted-foreground hover:bg-muted"
          aria-label={`Move ${card.jobNumber}`}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <Link
            href={`/jobs/${card.id}?section=onboarding`}
            className="block truncate font-semibold text-bb-forest hover:underline"
          >
            {card.accountName ?? card.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {card.jobNumber}
            {card.city ? ` · ${card.city}` : ""}
          </p>
        </div>
        <span className="flex shrink-0 gap-1 text-muted-foreground">
          {card.hasHoa && <Landmark className="size-4" aria-label="HOA" />}
          {card.leadSafe && <Biohazard className="size-4" aria-label="Lead-safe" />}
          {weather && <CloudRain className="size-4" aria-label="Weather hold" />}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {card.workTypes.map((w) => (
          <span key={w} className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {WORK_TYPE_LABELS[w] ?? w}
          </span>
        ))}
        {card.holds.map((h) => (
          <span
            key={h.type + h.placedAt}
            className="rounded bg-warning-bg px-1.5 py-0.5 text-xs text-warning"
          >
            {h.label}
          </span>
        ))}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-2 text-xs">
        <dt className="text-muted-foreground">In lane</dt>
        <dd className="text-right tabular-nums">
          {card.daysInLane} d
          {card.overdue && (
            <AlertTriangle className="ml-1 inline size-3 text-warning" aria-label="Overdue" />
          )}
        </dd>
        {canSeeMoney && (
          <>
            <dt className="text-muted-foreground">Value</dt>
            <dd className="text-right tabular-nums">{formatMoney(card.contractCents)}</dd>
            <dt className="text-muted-foreground">Collected</dt>
            <dd className="text-right tabular-nums">
              {card.collectedShare === null ? "—" : `${Math.round(card.collectedShare * 100)}%`}
            </dd>
          </>
        )}
        {card.onboarding && (
          <>
            <dt className="text-muted-foreground">Onboarding</dt>
            <dd className="text-right tabular-nums">
              {card.onboarding.cleared}/{card.onboarding.required}
            </dd>
          </>
        )}
      </dl>
      {onAdvance && (
        <Button
          type="button"
          size="sm"
          className="mt-2 w-full"
          onClick={onAdvance}
          disabled={pending}
        >
          Ready to Schedule <ArrowRight aria-hidden />
        </Button>
      )}
    </li>
  );
}
