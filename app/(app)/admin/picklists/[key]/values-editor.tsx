"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  DISPOSITION_CATEGORIES,
  DISPOSITION_CATEGORY_LABELS,
  isDispositionCategory,
  moveItem,
  normalizeColor,
  isHexColor,
} from "@/lib/validation/picklists";
import { reorderPicklistValues, updatePicklistValue } from "../actions";
import { AddValueDialog } from "./add-value-dialog";
import { selectClass, type ParentOption, type PicklistValueRow } from "./shared";

type Patch = Partial<
  Pick<PicklistValueRow, "label" | "active" | "category" | "parentValueId" | "color">
>;
type SaveFn = (
  patch: Patch,
  revert: Patch,
  success?: string,
  optimistic?: boolean,
) => Promise<string | null>;

export function PicklistValuesEditor({
  picklistId,
  picklistName,
  rows,
  hasCategory,
  parent,
}: {
  picklistId: string;
  picklistName: string;
  rows: PicklistValueRow[];
  hasCategory: boolean;
  parent: { name: string; options: ParentOption[] } | null;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState(rows);
  const [announcement, setAnnouncement] = React.useState("");
  const [pendingFocus, setPendingFocus] = React.useState<{ id: string; dir: "up" | "down" } | null>(
    null,
  );
  // Reorders are sent one after another so the last move always wins.
  const queue = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => setItems(rows), [rows]);

  React.useEffect(() => {
    if (!pendingFocus) return;
    const index = items.findIndex((i) => i.id === pendingFocus.id);
    let dir = pendingFocus.dir;
    if (dir === "up" && index === 0) dir = "down";
    if (dir === "down" && index === items.length - 1) dir = "up";
    document.getElementById(`move-${dir}-${pendingFocus.id}`)?.focus();
    setPendingFocus(null);
  }, [items, pendingFocus]);

  const extraColumn = hasCategory ? "Category" : parent ? `Parent (${parent.name})` : null;
  const gridColumns = extraColumn
    ? "2.25rem minmax(0,1fr) 12rem 9.5rem 7.5rem"
    : "2.25rem minmax(0,1fr) 9.5rem 7.5rem";

  function patchItem(id: string, patch: Patch) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function move(index: number, delta: -1 | 1) {
    const next = moveItem(items, index, delta);
    const moved = next[index + delta];
    if (!moved) return;
    const previous = items;
    setItems(next);
    setPendingFocus({ id: moved.id, dir: delta < 0 ? "up" : "down" });
    setAnnouncement(`Moved ${moved.label} to position ${index + delta + 1} of ${next.length}.`);
    const valueIds = next.map((i) => i.id);
    queue.current = queue.current.then(async () => {
      const result = await reorderPicklistValues({ picklistId, valueIds });
      if (!result.ok) {
        setItems(previous);
        setAnnouncement(`Couldn't move ${moved.label}.`);
        toast.error(result.error.message);
      }
    });
  }

  const activeCount = items.filter((i) => i.active).length;
  const takenKeys = items.map((i) => i.value);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-2xl border border-info/20 bg-info-bg p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="flex flex-col gap-1">
          <p>
            Changes apply everywhere this field is used. Values can be turned off but not deleted,
            so old records keep their meaning.
          </p>
          {parent && (
            <p className="text-muted-foreground">
              Each value can sit under a {parent.name} value, for example Website → Google Ads.
            </p>
          )}
        </div>
      </div>

      <section className="rounded-2xl border bg-card" aria-labelledby="values-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 id="values-heading" className="text-base font-semibold">
              Values
            </h2>
            <p className="text-xs text-muted-foreground">
              {activeCount} active of {items.length}. Drop-downs show active values in this order.
            </p>
          </div>
          <AddValueDialog
            picklistId={picklistId}
            picklistName={picklistName}
            takenKeys={takenKeys}
            hasCategory={hasCategory}
            parent={parent}
            onAdded={() => router.refresh()}
          />
        </div>

        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No values yet. Add the first one.
          </p>
        ) : (
          <>
            <div
              aria-hidden
              className="hidden gap-x-4 border-b px-4 py-2 text-xs font-medium text-muted-foreground lg:grid"
              style={{ gridTemplateColumns: gridColumns }}
            >
              <span>Order</span>
              <span>Label and key</span>
              {extraColumn && <span>{extraColumn}</span>}
              <span>Color (#RRGGBB)</span>
              <span>Active</span>
            </div>
            <ol className="divide-y" aria-label={`${picklistName} values`}>
              {items.map((item, index) => (
                <ValueRow
                  key={item.id}
                  item={item}
                  index={index}
                  count={items.length}
                  gridColumns={gridColumns}
                  hasCategory={hasCategory}
                  parent={parent}
                  onMove={move}
                  onPatch={(patch) => patchItem(item.id, patch)}
                />
              ))}
            </ol>
          </>
        )}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </section>
    </div>
  );
}

function ValueRow({
  item,
  index,
  count,
  gridColumns,
  hasCategory,
  parent,
  onMove,
  onPatch,
}: {
  item: PicklistValueRow;
  index: number;
  count: number;
  gridColumns: string;
  hasCategory: boolean;
  parent: { name: string; options: ParentOption[] } | null;
  onMove: (index: number, delta: -1 | 1) => void;
  onPatch: (patch: Patch) => void;
}) {
  const labelId = `label-${item.id}`;

  /** Optimistic save of one field; reverts and explains on failure. */
  async function save(
    patch: Patch,
    revert: Patch,
    success?: string,
    optimistic = true,
  ): Promise<string | null> {
    if (optimistic) onPatch(patch);
    const result = await updatePicklistValue({
      id: item.id,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.category !== undefined ? { category: patch.category ?? "" } : {}),
      ...(patch.parentValueId !== undefined ? { parentValueId: patch.parentValueId ?? "" } : {}),
      ...(patch.color !== undefined ? { color: patch.color ?? "" } : {}),
    });
    if (result.ok) {
      if (!optimistic) onPatch(patch);
      if (success) toast.success(success);
      return null;
    }
    if (optimistic) onPatch(revert);
    const fieldError = Object.values(result.error.fieldErrors ?? {})[0]?.[0];
    const message = fieldError ?? result.error.message;
    toast.error(message);
    return message;
  }

  return (
    <li
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 lg:grid lg:items-center lg:gap-x-4",
        !item.active && "bg-muted/40",
      )}
      style={{ gridTemplateColumns: gridColumns }}
      aria-labelledby={labelId}
    >
      <div className="flex flex-col">
        <Button
          id={`move-up-${item.id}`}
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
          aria-label={`Move ${item.label} up`}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          id={`move-down-${item.id}`}
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          disabled={index === count - 1}
          onClick={() => onMove(index, 1)}
          aria-label={`Move ${item.label} down`}
        >
          <ArrowDown aria-hidden />
        </Button>
      </div>

      <LabelField item={item} labelId={labelId} onSave={save} />

      {hasCategory && (
        <div className="w-full basis-full pl-10 sm:basis-auto sm:pl-0 lg:w-auto">
          <select
            className={selectClass}
            aria-label={`Category for ${item.label}`}
            value={item.category ?? ""}
            onChange={(e) => {
              const category = e.target.value === "" ? null : e.target.value;
              void save({ category }, { category: item.category }, "Category saved.");
            }}
          >
            <option value="">No category</option>
            {DISPOSITION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {DISPOSITION_CATEGORY_LABELS[c]}
              </option>
            ))}
            {item.category && !isDispositionCategory(item.category) && (
              <option value={item.category}>{item.category}</option>
            )}
          </select>
        </div>
      )}

      {!hasCategory && parent && (
        <div className="w-full basis-full pl-10 sm:basis-auto sm:pl-0 lg:w-auto">
          <select
            className={selectClass}
            aria-label={`Parent ${parent.name.toLowerCase()} for ${item.label}`}
            value={item.parentValueId ?? ""}
            onChange={(e) => {
              const parentValueId = e.target.value === "" ? null : e.target.value;
              void save({ parentValueId }, { parentValueId: item.parentValueId }, "Parent saved.");
            }}
          >
            <option value="">No parent</option>
            {parent.options
              .filter((o) => o.active || o.id === item.parentValueId)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                  {o.active ? "" : " (off)"}
                </option>
              ))}
          </select>
        </div>
      )}

      <ColorField item={item} onSave={save} />

      <div className="flex items-center gap-2 lg:justify-start">
        <Switch
          checked={item.active}
          onCheckedChange={(active) =>
            void save(
              { active },
              { active: item.active },
              active ? `${item.label} is on.` : `${item.label} is off. Old records keep it.`,
            )
          }
          aria-label={`Active: ${item.label}`}
        />
        <span className="text-xs text-muted-foreground" aria-hidden>
          {item.active ? "On" : "Off"}
        </span>
      </div>
    </li>
  );
}

function LabelField({
  item,
  labelId,
  onSave,
}: {
  item: PicklistValueRow;
  labelId: string;
  onSave: SaveFn;
}) {
  const [draft, setDraft] = React.useState(item.label);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);

  React.useEffect(() => setDraft(item.label), [item.label]);

  async function commit() {
    const label = draft.trim();
    if (savingRef.current) return;
    if (label === item.label) {
      setDraft(item.label);
      setError(null);
      return;
    }
    if (label === "") {
      setError("Label is required.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    // Not optimistic: on a clash the typed label stays in the box next to the message.
    const message = await onSave({ label }, { label: item.label }, `Renamed to "${label}".`, false);
    savingRef.current = false;
    setSaving(false);
    setError(message);
  }

  const errorId = `${labelId}-error`;
  return (
    <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
      <div className="relative">
        <Input
          id={labelId}
          value={draft}
          maxLength={80}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              setDraft(item.label);
              setError(null);
            }
          }}
          aria-label={`Label for ${item.value}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn("h-9 pr-8", !item.active && "text-muted-foreground")}
        />
        {saving && (
          <Loader2
            className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <code
          className="font-mono text-xs break-all text-muted-foreground"
          title="Key (can't change)"
        >
          {item.value}
        </code>
        {item.isSystem && <Badge variant="neutral">Built-in</Badge>}
        {!item.active && <Badge variant="warning">Off</Badge>}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function ColorField({ item, onSave }: { item: PicklistValueRow; onSave: SaveFn }) {
  const [draft, setDraft] = React.useState(item.color ?? "");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setDraft(item.color ?? ""), [item.color]);

  async function commit() {
    const color = normalizeColor(draft);
    if (color === item.color) {
      setDraft(item.color ?? "");
      setError(null);
      return;
    }
    if (color !== null && !isHexColor(color)) {
      setError("Use #RRGGBB.");
      return;
    }
    setError(null);
    const message = await onSave(
      { color },
      { color: item.color },
      color ? "Color saved." : "Color cleared.",
    );
    if (message) setError(message);
  }

  const preview = normalizeColor(draft);
  const errorId = `color-${item.id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "size-6 shrink-0 rounded-md border",
            !(preview && isHexColor(preview)) &&
              "bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,var(--color-border)_3px,var(--color-border)_4px)]",
          )}
          style={preview && isHexColor(preview) ? { backgroundColor: preview } : undefined}
        />
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              setDraft(item.color ?? "");
              setError(null);
            }
          }}
          placeholder="None"
          maxLength={7}
          spellCheck={false}
          aria-label={`Color for ${item.label}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-9 w-24 font-mono text-xs uppercase"
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
