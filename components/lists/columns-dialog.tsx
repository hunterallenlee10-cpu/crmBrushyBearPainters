"use client";

import type { ListModuleId } from "@/lib/lists/params";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Columns3, GripVertical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import type { ColumnDef } from "@/lib/lists/params";
import { saveListColumns } from "@/lib/lists/actions";

/**
 * Columns configurator (SPEC §8 "Lists"): drag to reorder, show/hide, reset.
 * Saved per user in their profile preferences. Keyboard: Space to pick up,
 * arrows to move, Space to drop.
 */

type Item = { id: string; label: string; visible: boolean; locked: boolean };

function Row({ item, onToggle }: { item: Item; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex min-h-10 items-center gap-2 rounded-lg border bg-card px-2 ${isDragging ? "z-10 shadow-md" : ""}`}
    >
      <button
        type="button"
        className="grid size-8 cursor-grab place-items-center rounded text-muted-foreground hover:bg-muted"
        aria-label={`Move ${item.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <label className="flex flex-1 items-center gap-2 text-sm">
        <input type="checkbox" checked={item.visible} disabled={item.locked} onChange={onToggle} />
        {item.label}
        {item.locked && <span className="text-xs text-muted-foreground">(always shown)</span>}
      </label>
    </li>
  );
}

export function ColumnsDialog({
  moduleId,
  allColumns,
  visibleIds,
}: {
  moduleId: ListModuleId;
  allColumns: readonly ColumnDef[];
  visibleIds: readonly string[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const initial = React.useCallback((): Item[] => {
    const byId = new Map(allColumns.map((c) => [c.id, c]));
    const shown = visibleIds.flatMap((id) => {
      const c = byId.get(id);
      return c ? [{ id: c.id, label: c.label, visible: true, locked: Boolean(c.locked) }] : [];
    });
    const hidden = allColumns
      .filter((c) => !visibleIds.includes(c.id))
      .map((c) => ({ id: c.id, label: c.label, visible: false, locked: Boolean(c.locked) }));
    return [...shown, ...hidden];
  }, [allColumns, visibleIds]);
  const [items, setItems] = React.useState<Item[]>(initial);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Reset the draft each time the dialog opens (not on every render).
  const initialRef = React.useRef(initial);
  initialRef.current = initial;
  React.useEffect(() => {
    if (open) setItems(initialRef.current());
  }, [open]);

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    setItems((list) => {
      const from = list.findIndex((i) => i.id === e.active.id);
      const to = list.findIndex((i) => i.id === e.over!.id);
      return arrayMove(list, from, to);
    });
  }

  async function save(columns: string[] | null) {
    setSaving(true);
    const result = await saveListColumns({ module: moduleId, columns });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <Columns3 aria-hidden />
          Columns
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Columns</DialogTitle>
          <DialogDescription>
            Choose and order the columns you see. Saved for you only.
          </DialogDescription>
        </DialogHeader>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul className="flex max-h-[55vh] flex-col gap-1.5 overflow-y-auto" aria-label="Columns">
              {items.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  onToggle={() =>
                    setItems((list) =>
                      list.map((i) => (i.id === item.id ? { ...i, visible: !i.visible } : i)),
                    )
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" disabled={saving} onClick={() => save(null)}>
            Reset to default
          </Button>
          <Button
            disabled={saving}
            onClick={() => save(items.filter((i) => i.visible || i.locked).map((i) => i.id))}
          >
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            Save columns
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
