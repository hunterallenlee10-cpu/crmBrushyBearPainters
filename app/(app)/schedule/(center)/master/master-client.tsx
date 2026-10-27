"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Biohazard,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  GripVertical,
  Landmark,
  MoveHorizontal,
  PaintBucket,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import { cn } from "@/lib/utils";
import {
  CALENDAR_VIEWS,
  layoutRows,
  moveBar,
  resizeBar,
  shiftAnchor,
  type CalendarView,
} from "@/lib/domain/scheduling/calendar";
import {
  endAfterWorkingDays,
  formatDay,
  formatRange,
  isoDow,
  type IsoDate,
} from "@/lib/domain/scheduling/dates";
import type { Conflict } from "@/lib/domain/scheduling/conflicts";
import type { BoardBar, TrayCard } from "@/lib/production/board";
import {
  cancelEntry,
  discardDraft,
  overrideRules,
  publishChanges,
  saveDraftEntry,
} from "../../actions";

type CrewView = {
  id: string;
  name: string;
  active: boolean;
  color: string | null;
  crewType: "employee" | "subcontractor";
  leadName: string | null;
  skills: string[];
  timeOff: { startsOn: IsoDate; endsOn: IsoDate; who: string | null }[];
};

export type MasterBoard = {
  view: CalendarView;
  anchor: IsoDate;
  days: IsoDate[];
  today: IsoDate;
  productionDays: number[];
  crews: CrewView[];
  bars: BoardBar[];
  tray: TrayCard[];
  weatherConnected: boolean;
};

const VIEW_LABELS: Record<CalendarView, string> = { day: "Day", week: "Week", multi: "Multi-week" };
const REASON_LABELS = {
  company: "Our schedule change",
  weather: "Weather",
  customer: "Customer asked",
} as const;

function href(view: CalendarView, date: IsoDate) {
  return `/schedule/master?view=${view}&date=${date}`;
}

function ConflictList({ conflicts, className }: { conflicts: Conflict[]; className?: string }) {
  if (!conflicts.length) return null;
  return (
    <ul className={cn("flex flex-col gap-1 text-xs", className)}>
      {conflicts.map((c, i) => (
        <li
          key={`${c.code}-${i}`}
          className={c.severity === "block" && !c.overridden ? "text-danger" : "text-warning"}
        >
          {c.overridden ? "Overridden: " : c.severity === "warn" ? "Heads up: " : ""}
          {c.message}
        </li>
      ))}
    </ul>
  );
}

type EditTarget = { kind: "new"; card: TrayCard } | { kind: "bar"; bar: BoardBar };

function ScheduleDialog({
  target,
  crews,
  productionDays,
  can,
  onClose,
}: {
  target: EditTarget | null;
  crews: CrewView[];
  productionDays: number[];
  can: { manage: boolean; override: boolean };
  onClose: () => void;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [crewId, setCrewId] = React.useState("");
  const [startsOn, setStartsOn] = React.useState("");
  const [endsOn, setEndsOn] = React.useState("");
  const [split, setSplit] = React.useState(false);
  const [reason, setReason] = React.useState<"company" | "weather" | "customer">("company");
  const [note, setNote] = React.useState("");
  const [overrideReason, setOverrideReason] = React.useState("");
  const [conflicts, setConflicts] = React.useState<Conflict[]>([]);
  const targetKey = !target
    ? null
    : target.kind === "new"
      ? `new:${target.card.jobId}`
      : `bar:${target.bar.id}`;
  React.useEffect(() => {
    if (!target) return;
    if (target.kind === "new") {
      const rec = target.card.recommended;
      const start = rec?.startsOn ?? target.card.plannedStart ?? "";
      setCrewId(rec?.crewId ?? target.card.crewId ?? crews.find((c) => c.active)?.id ?? "");
      setStartsOn(start);
      setEndsOn(
        rec?.endsOn ??
          (start ? endAfterWorkingDays(start, target.card.workingDays, productionDays) : ""),
      );
      setSplit(false);
      setReason(target.card.priorityReschedule ? "weather" : "company");
      setConflicts(target.card.conflicts);
    } else {
      setCrewId(target.bar.crewId);
      setStartsOn(target.bar.startsOn);
      setEndsOn(target.bar.endsOn);
      setSplit(target.bar.allowSplit);
      setReason(target.bar.priorityReschedule ? "weather" : "company");
      setConflicts(target.bar.conflicts);
    }
    setNote("");
    setOverrideReason("");
    // Reset only when a different job or bar opens: a refresh after saving
    // hands us new objects for the same target and must not wipe the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the target's identity
  }, [targetKey]);
  if (!target) return null;
  const jobId = target.kind === "new" ? target.card.jobId : target.bar.jobId;
  const label = target.kind === "new" ? target.card.label : (target.bar.jobLabel ?? "Booked job");
  const published = target.kind === "bar" ? target.bar.published : null;
  const overridable = conflicts.filter((c) => c.overridable && c.severity === "block");
  const save = () =>
    run(
      () =>
        saveDraftEntry({
          entryId: target.kind === "bar" ? target.bar.id : undefined,
          jobId,
          crewId,
          startsOn,
          endsOn,
          allowSplit: split,
          reason: published ? reason : undefined,
          note: note || undefined,
        }),
      {
        onOk: (r) => {
          setConflicts(r.conflicts);
          const blocks = r.conflicts.filter((c) => c.severity === "block" && !c.overridden);
          if (blocks.length)
            toast.warning(
              `Saved as a draft with ${blocks.length} conflict${blocks.length === 1 ? "" : "s"}. It can't be published yet.`,
            );
          else {
            toast.success("Draft saved. Publish changes to tell the customer and crew.");
            onClose();
          }
          router.refresh();
        },
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {target.kind === "new" ? "Schedule job" : "Edit schedule entry"}
          </DialogTitle>
          <DialogDescription>
            {label}
            {published
              ? ` · published ${formatRange(published.startsOn, published.endsOn)}`
              : " · not published yet"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="sd-crew" label="Crew" className="sm:col-span-2">
            <NativeSelect
              id="sd-crew"
              value={crewId}
              onChange={(e) => setCrewId(e.target.value)}
              disabled={!can.manage}
            >
              {crews
                .filter((c) => c.active || c.id === crewId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {target.kind === "new"
                      ? (() => {
                          const r = target.card.ranking.find((x) => x.crewId === c.id);
                          return r ? ` · score ${r.score}` : "";
                        })()
                      : ""}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field id="sd-start" label="First day">
            <Input
              id="sd-start"
              type="date"
              value={startsOn}
              disabled={!can.manage}
              onChange={(e) => {
                const s = e.target.value;
                if (s && startsOn && endsOn) setEndsOn(moveBar({ startsOn, endsOn }, s).endsOn);
                setStartsOn(s);
              }}
            />
          </Field>
          <Field id="sd-end" label="Last day">
            <Input
              id="sd-end"
              type="date"
              value={endsOn}
              min={startsOn}
              disabled={!can.manage}
              onChange={(e) => setEndsOn(e.target.value)}
            />
          </Field>
          {published && (
            <Field
              id="sd-reason"
              label="Why the dates move"
              className="sm:col-span-2"
              description="Weather and customer requests move the on-time promise; our own changes don't."
            >
              <NativeSelect
                id="sd-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as typeof reason)}
              >
                {Object.entries(REASON_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:col-span-2 sm:min-h-0">
            <input
              type="checkbox"
              className="size-4 accent-bb-forest"
              checked={split}
              onChange={(e) => setSplit(e.target.checked)}
            />
            Split day (the crew may run another split job the same day)
          </label>
          <Field id="sd-note" label="Note (optional)" className="sm:col-span-2">
            <Input id="sd-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {conflicts.length > 0 && (
          <div role="status" className="rounded-xl border border-warning/40 bg-warning-bg/40 p-3">
            <p className="mb-1 text-sm font-medium">
              <AlertTriangle className="mr-1 inline size-4" aria-hidden /> Conflicts
            </p>
            <ConflictList conflicts={conflicts} />
          </div>
        )}
        {can.override && target.kind === "bar" && overridable.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border p-3">
            <Field
              id="sd-override"
              label="Owner override reason"
              description={`Overrides: ${overridable.map((c) => c.message.split(".")[0]).join("; ")}`}
            >
              <Textarea
                id="sd-override"
                rows={2}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            </Field>
            <Button
              variant="outline"
              disabled={pending || overrideReason.trim().length < 10}
              onClick={() =>
                run(
                  () =>
                    overrideRules({
                      entryId: target.bar.id,
                      rules: [
                        ...new Set([
                          ...target.bar.overrideRules,
                          ...overridable.map((c) => c.code),
                        ]),
                      ],
                      reason: overrideReason,
                    }),
                  {
                    success: "Override recorded.",
                    onOk: () => {
                      onClose();
                      router.refresh();
                    },
                  },
                )
              }
            >
              Override with this reason
            </Button>
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          {target.kind === "bar" && target.bar.pending && can.manage && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => discardDraft({ entryId: target.bar.id }), {
                  success: "Draft change discarded.",
                  onOk: () => {
                    onClose();
                    router.refresh();
                  },
                })
              }
            >
              Discard change
            </Button>
          )}
          {target.kind === "bar" &&
            target.bar.status === "published" &&
            target.bar.pending !== "cancel" &&
            can.manage && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => cancelEntry({ entryId: target.bar.id }), {
                    success: "Marked to come off the schedule when you publish.",
                    onOk: () => {
                      onClose();
                      router.refresh();
                    },
                  })
                }
              >
                Take off schedule
              </Button>
            )}
          {can.manage && (
            <Button disabled={pending || !crewId || !startsOn || !endsOn} onClick={save}>
              Save draft
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrayItem({
  card,
  canManage,
  onSchedule,
}: {
  card: TrayCard;
  canManage: boolean;
  onSchedule: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `tray:${card.jobId}`,
    disabled: !canManage,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const blocks = card.conflicts.filter((c) => c.severity === "block" && !c.overridden);
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`tray-${card.jobId}`}
      className={cn(
        "rounded-xl border bg-card p-3 text-sm shadow-xs",
        isDragging && "z-20 opacity-80 shadow-lg",
        card.priorityReschedule && "border-bb-honey ring-1 ring-bb-honey",
      )}
    >
      <div className="flex items-start gap-2">
        {canManage && (
          <button
            type="button"
            className="-ml-1 grid size-8 shrink-0 cursor-grab place-items-center rounded text-muted-foreground hover:bg-muted"
            aria-label={`Drag ${card.label} onto a crew and day`}
            {...listeners}
            {...attributes}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <Link
            href={`/jobs/${card.jobId}?section=schedule`}
            className="block font-semibold text-bb-forest hover:underline"
          >
            {card.label}
          </Link>
          <p className="text-xs text-muted-foreground">
            {[
              card.city,
              `${card.workingDays} day${card.workingDays === 1 ? "" : "s"}`,
              card.plannedStart ? `planned ${formatDay(card.plannedStart)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {card.priorityReschedule && (
          <Badge variant="warning">
            <CloudRain aria-hidden /> Rain reschedule
          </Badge>
        )}
        <Badge
          variant={
            card.materials === "ready" || card.materials === "none"
              ? "success"
              : card.materials === "ordered"
                ? "info"
                : "warning"
          }
        >
          <PaintBucket aria-hidden />
          {card.materials === "ready"
            ? "Paint ready"
            : card.materials === "ordered"
              ? "Paint ordered"
              : card.materials === "none"
                ? "No paint order"
                : "Paint not ordered"}
        </Badge>
        {card.hoaPending && (
          <Badge variant="warning">
            <Landmark aria-hidden /> HOA pending
          </Badge>
        )}
        {card.leadSafe && (
          <Badge variant="neutral">
            <Biohazard aria-hidden /> Lead-safe
          </Badge>
        )}
        <Badge variant="neutral">Calendar sync: not connected</Badge>
      </div>
      {card.recommended ? (
        <p className="mt-2 text-xs">
          Recommended: <span className="font-medium">{card.recommended.crewName}</span> ·{" "}
          {formatRange(card.recommended.startsOn, card.recommended.endsOn)} · score{" "}
          {card.recommended.score}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          No crew fits in the next 60 days. Check skills and time off.
        </p>
      )}
      {blocks.length > 0 && <ConflictList conflicts={blocks} className="mt-2" />}
      {canManage && (
        <Button size="sm" variant="outline" className="mt-2 w-full" onClick={onSchedule}>
          <CalendarPlus aria-hidden /> Schedule job
        </Button>
      )}
    </li>
  );
}

function DayCell({
  crewId,
  day,
  off,
  weekend,
  today,
}: {
  crewId: string;
  day: IsoDate;
  off: boolean;
  weekend: boolean;
  today: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${crewId}:${day}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-14 border-l",
        weekend && "bg-muted/40",
        off &&
          "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,0.05)_6px,rgba(0,0,0,0.05)_12px)]",
        today && "bg-bb-honey/10",
        isOver && "bg-accent",
      )}
      aria-hidden
    />
  );
}

function Bar({
  bar,
  col,
  span,
  lane,
  canManage,
  onOpen,
}: {
  bar: BoardBar;
  col: number;
  span: number;
  lane: number;
  canManage: boolean;
  onOpen: () => void;
}) {
  const move = useDraggable({
    id: `bar:${bar.id}`,
    disabled: !canManage || bar.pending === "cancel",
  });
  const resize = useDraggable({
    id: `resize:${bar.id}`,
    disabled: !canManage || bar.pending === "cancel",
  });
  const t = move.transform ?? resize.transform;
  const style: React.CSSProperties = {
    gridColumn: `${col + 1} / span ${span}`,
    gridRow: lane + 1,
    ...(t ? { transform: `translate3d(${t.x}px, ${t.y}px, 0)`, zIndex: 20 } : {}),
  };
  const tone = bar.blocked
    ? "border-danger bg-danger-bg"
    : bar.pending
      ? "border-dashed border-bb-honey bg-bb-honey/15"
      : bar.jobLabel
        ? "border-bb-forest/30 bg-accent"
        : "border-border bg-muted";
  const label = bar.jobLabel ?? "Booked";
  return (
    <div
      ref={move.setNodeRef}
      style={style}
      data-testid={`bar-${bar.id}`}
      className={cn(
        "relative m-0.5 flex min-w-0 items-center gap-1 rounded-lg border px-1.5 py-1 text-xs",
        tone,
        bar.pending === "cancel" && "line-through opacity-60",
      )}
    >
      {canManage && bar.pending !== "cancel" && (
        <button
          type="button"
          className="grid size-6 shrink-0 cursor-grab place-items-center rounded hover:bg-background/60"
          aria-label={`Move ${label}`}
          {...move.listeners}
          {...move.attributes}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 truncate text-left font-medium"
        title={bar.conflicts.map((c) => c.message).join("\n") || label}
      >
        {bar.conflicts.length > 0 && (
          <AlertTriangle
            className={cn("mr-0.5 inline size-3", bar.blocked ? "text-danger" : "text-warning")}
            aria-label="Conflict"
          />
        )}
        {bar.priorityReschedule && (
          <CloudRain className="mr-0.5 inline size-3 text-warning" aria-label="Rain reschedule" />
        )}
        {label}
        {bar.city ? ` · ${bar.city}` : ""}
        {bar.pending === "create"
          ? " · draft"
          : bar.pending === "update"
            ? " · moved (draft)"
            : bar.pending === "cancel"
              ? " · coming off"
              : ""}
      </button>
      {canManage && bar.pending !== "cancel" && (
        <button
          ref={resize.setNodeRef}
          type="button"
          className="grid h-6 w-4 shrink-0 cursor-ew-resize place-items-center rounded hover:bg-background/60"
          aria-label={`Change the last day of ${label}`}
          {...resize.listeners}
          {...resize.attributes}
        >
          <MoveHorizontal className="size-3" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function MasterSchedule({
  board,
  can,
}: {
  board: MasterBoard;
  can: { manage: boolean; publish: boolean; override: boolean };
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [edit, setEdit] = React.useState<EditTarget | null>(null);
  const [search, setSearch] = React.useState("");
  const [riskOnly, setRiskOnly] = React.useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const crews = board.crews.filter((c) => c.active || board.bars.some((b) => b.crewId === c.id));
  const rows = layoutRows(board.bars, board.days);
  const cols = board.days.length;
  const drafts = board.bars.filter((b) => b.pending);
  const blocked = drafts.filter((b) => b.blocked);
  const tray = board.tray.filter(
    (t) =>
      (!search || `${t.label} ${t.city ?? ""}`.toLowerCase().includes(search.toLowerCase())) &&
      (!riskOnly ||
        t.conflicts.some((c) => c.severity === "block") ||
        t.blockingHolds.length > 0 ||
        t.materials === "not_ordered"),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const over = typeof e.over?.id === "string" ? e.over.id : null;
    const active = String(e.active.id);
    if (!over?.startsWith("cell:")) return;
    const [, crewId, day] = over.split(":") as [string, string, IsoDate];
    if (active.startsWith("tray:")) {
      const card = board.tray.find((t) => t.jobId === active.slice(5));
      if (!card) return;
      const endsOn = endAfterWorkingDays(day, card.workingDays, board.productionDays);
      run(
        () =>
          saveDraftEntry({
            jobId: card.jobId,
            crewId,
            startsOn: day,
            endsOn,
            reason: card.priorityReschedule ? "weather" : undefined,
          }),
        {
          onOk: (r) => {
            const n = r.conflicts.filter((c) => c.severity === "block" && !c.overridden).length;
            if (n)
              toast.warning(
                `Draft added with ${n} conflict${n === 1 ? "" : "s"}. Open it to see why.`,
              );
            else toast.success("Draft added. Publish changes to tell the customer and crew.");
            router.refresh();
          },
        },
      );
      return;
    }
    const isResize = active.startsWith("resize:");
    const barId = active.slice(isResize ? 7 : 4);
    const bar = board.bars.find((b) => b.id === barId);
    if (!bar) return;
    const next = isResize ? resizeBar(bar, day) : moveBar(bar, day);
    const targetCrew = isResize ? bar.crewId : crewId;
    if (next.startsOn === bar.startsOn && next.endsOn === bar.endsOn && targetCrew === bar.crewId)
      return;
    run(
      () =>
        saveDraftEntry({
          entryId: bar.id,
          jobId: bar.jobId,
          crewId: targetCrew,
          startsOn: next.startsOn,
          endsOn: next.endsOn,
          reason: bar.priorityReschedule ? "weather" : undefined,
        }),
      {
        onOk: (r) => {
          const n = r.conflicts.filter((c) => c.severity === "block" && !c.overridden).length;
          if (n)
            toast.warning(`Moved, with ${n} conflict${n === 1 ? "" : "s"}. Open it to see why.`);
          else toast.success("Moved (draft). Publish changes to tell the customer and crew.");
          router.refresh();
        },
      },
    );
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="View" className="inline-flex rounded-lg border p-0.5">
            {CALENDAR_VIEWS.map((v) => (
              <Link
                key={v}
                href={href(v, board.anchor)}
                aria-current={v === board.view ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  v === board.view ? "bg-bb-forest text-white" : "hover:bg-muted",
                )}
              >
                {VIEW_LABELS[v]}
              </Link>
            ))}
          </div>
          <Button asChild variant="outline" size="icon" aria-label="Previous">
            <Link href={href(board.view, shiftAnchor(board.view, board.anchor, -1))}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={href(board.view, board.today)}>Today</Link>
          </Button>
          <Button asChild variant="outline" size="icon" aria-label="Next">
            <Link href={href(board.view, shiftAnchor(board.view, board.anchor, 1))}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
          <span className="text-sm font-medium">
            {formatRange(board.days[0] as IsoDate, board.days[cols - 1] as IsoDate)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {drafts.length} draft change{drafts.length === 1 ? "" : "s"}
            {blocked.length ? ` · ${blocked.length} blocked` : ""}
          </span>
          {can.publish && (
            <Button
              className="bg-bb-honey text-bb-ink hover:bg-bb-honey/90"
              disabled={pending || drafts.length === 0}
              onClick={() =>
                run(() => publishChanges({}), {
                  success: (r) =>
                    `Published ${r.published} change${r.published === 1 ? "" : "s"}: ${r.customerNotices} customer and ${r.crewNotices} crew notice${r.crewNotices === 1 ? "" : "s"} recorded (simulated).`,
                  onOk: () => router.refresh(),
                })
              }
            >
              <Send aria-hidden /> Publish changes
            </Button>
          )}
        </div>
      </div>
      {blocked.length > 0 && (
        <div
          role="status"
          className="rounded-2xl border border-danger/40 bg-danger-bg/40 p-3 text-sm"
        >
          <p className="font-medium text-danger">These drafts can&apos;t be published yet:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {blocked.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className="font-medium underline"
                  onClick={() => setEdit({ kind: "bar", bar: b })}
                >
                  {b.jobLabel ?? "Booked job"}
                </button>
                :{" "}
                {b.conflicts
                  .filter((c) => c.severity === "block" && !c.overridden)
                  .map((c) => c.message)
                  .join(" ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-4 xl:flex-row">
        <aside aria-labelledby="tray-title" className="flex flex-col gap-2 xl:w-80 xl:shrink-0">
          <h2 id="tray-title" className="text-base font-semibold">
            To be scheduled ({board.tray.length})
          </h2>
          <label htmlFor="tray-search" className="sr-only">
            Search the tray
          </label>
          <Input
            id="tray-search"
            placeholder="Search jobs or cities"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
            <input
              type="checkbox"
              className="size-4 accent-bb-forest"
              checked={riskOnly}
              onChange={(e) => setRiskOnly(e.target.checked)}
            />
            At risk only
          </label>
          {tray.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              Nothing waiting. Jobs land here when onboarding is cleared (Ready to Schedule) or a
              rain delay needs new dates.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tray.map((card) => (
                <TrayItem
                  key={card.jobId}
                  card={card}
                  canManage={can.manage}
                  onSchedule={() => setEdit({ kind: "new", card })}
                />
              ))}
            </ul>
          )}
        </aside>
        <section
          aria-label="Crew calendar"
          className="min-w-0 flex-1 overflow-x-auto rounded-2xl border bg-card"
        >
          <div
            style={{ minWidth: board.view === "multi" ? 1200 : board.view === "week" ? 760 : 360 }}
          >
            <div
              className="grid border-b text-xs font-medium"
              style={{ gridTemplateColumns: `11rem repeat(${cols}, minmax(0, 1fr))` }}
            >
              <div className="p-2 text-muted-foreground">Crew</div>
              {board.days.map((d) => (
                <div
                  key={d}
                  className={cn(
                    "border-l p-2 text-center",
                    d === board.today && "bg-bb-honey/20 font-semibold",
                  )}
                >
                  {board.view === "multi"
                    ? formatDay(d).split(", ")[1]?.split(" ")[1]
                    : formatDay(d)}
                </div>
              ))}
            </div>
            {crews.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No crews yet. Add crews and their skills in{" "}
                <Link href="/schedule/resources" className="text-bb-forest underline">
                  Resources
                </Link>
                .
              </p>
            ) : (
              crews.map((c) => {
                const row = rows.get(c.id);
                const lanes = Math.max(1, row?.lanes ?? 0);
                return (
                  <div
                    key={c.id}
                    className="grid border-b"
                    style={{ gridTemplateColumns: `11rem minmax(0, 1fr)` }}
                    data-testid={`crew-row-${c.name}`}
                  >
                    <div className="p-2 text-sm">
                      <span
                        className="mr-1 inline-block size-2.5 rounded-full"
                        style={{ background: c.color ?? "#1F4D3A" }}
                        aria-hidden
                      />
                      <span className="font-medium">{c.name}</span>
                      {!c.active && (
                        <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>
                      )}
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.crewType === "subcontractor" ? "Subcontractor · " : ""}
                        {c.leadName ?? "No lead"}
                      </span>
                    </div>
                    <div className="relative">
                      <div
                        className="absolute inset-0 grid"
                        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                      >
                        {board.days.map((d) => (
                          <DayCell
                            key={d}
                            crewId={c.id}
                            day={d}
                            today={d === board.today}
                            weekend={!board.productionDays.includes(isoDow(d))}
                            off={c.timeOff.some((t) => !t.who && t.startsOn <= d && d <= t.endsOn)}
                          />
                        ))}
                      </div>
                      <div
                        className="relative grid"
                        style={{
                          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                          gridTemplateRows: `repeat(${lanes}, minmax(3.25rem, auto))`,
                        }}
                      >
                        {(row?.bars ?? []).map((p) => (
                          <Bar
                            key={p.bar.id}
                            bar={p.bar}
                            col={p.col}
                            span={p.span}
                            lane={p.lane}
                            canManage={can.manage}
                            onOpen={() => setEdit({ kind: "bar", bar: p.bar })}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
      {!board.weatherConnected && (
        <p className="text-xs text-muted-foreground">
          Weather isn&apos;t connected, so the rain-forecast rule is off. Mark rain delays on the{" "}
          <Link href="/schedule/weather" className="underline">
            Weather
          </Link>{" "}
          screen.
        </p>
      )}
      <ScheduleDialog
        target={edit}
        crews={board.crews}
        productionDays={board.productionDays}
        can={can}
        onClose={() => setEdit(null)}
      />
    </DndContext>
  );
}
