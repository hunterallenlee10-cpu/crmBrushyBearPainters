"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Check, ChevronDown, Eye, Loader2, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ViewConfig } from "@/lib/lists/params";
import { createSavedView, deleteSavedView, updateSavedView } from "@/lib/lists/actions";

/** Saved Views (personal + shared) for a list (SPEC §8 "Lists"). */

export type SavedViewItem = {
  id: string;
  name: string;
  shared: boolean;
  mine: boolean;
  config: ViewConfig;
};

export function ViewsMenu({
  moduleId,
  views,
  currentViewId,
  currentConfig,
  onApply,
  onClear,
}: {
  moduleId: "leads" | "accounts" | "contacts";
  views: readonly SavedViewItem[];
  currentViewId: string | null;
  currentConfig: ViewConfig;
  onApply: (view: SavedViewItem) => void;
  onClear: () => void;
}) {
  const router = useRouter();
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [shared, setShared] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const current = views.find((v) => v.id === currentViewId) ?? null;
  const mine = views.filter((v) => v.mine);
  const team = views.filter((v) => !v.mine);

  async function saveNew() {
    setBusy(true);
    setNameError(null);
    const result = await createSavedView({ module: moduleId, name, shared, config: currentConfig });
    setBusy(false);
    if (!result.ok) {
      setNameError(result.error.fieldErrors?.name?.[0] ?? result.error.message);
      return;
    }
    setSaveOpen(false);
    toast.success("View saved.");
    onApply({ id: result.data.id, name, shared, mine: true, config: currentConfig });
  }

  async function updateCurrent() {
    if (!current) return;
    const result = await updateSavedView({ id: current.id, config: currentConfig });
    if (!result.ok) return toast.error(result.error.message);
    toast.success(`Updated “${current.name}”.`);
    router.refresh();
  }

  async function removeCurrent() {
    if (!current) return;
    const result = await deleteSavedView({ id: current.id });
    if (!result.ok) return toast.error(result.error.message);
    toast.success(`Deleted “${current.name}”.`);
    onClear();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 max-w-56">
            <Eye aria-hidden />
            <span className="truncate">{current ? current.name : "Views"}</span>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={onClear}>
            {!current && <Check aria-hidden />}
            <span className={current ? "pl-6" : ""}>Default view</span>
          </DropdownMenuItem>
          {mine.length > 0 && <DropdownMenuLabel>My views</DropdownMenuLabel>}
          {mine.map((v) => (
            <DropdownMenuItem key={v.id} onSelect={() => onApply(v)}>
              {v.id === currentViewId ? <Check aria-hidden /> : <span className="w-4" />}
              <span className="truncate">{v.name}</span>
              {v.shared && <Users className="ml-auto text-muted-foreground" aria-label="Shared" />}
            </DropdownMenuItem>
          ))}
          {team.length > 0 && <DropdownMenuLabel>Shared with me</DropdownMenuLabel>}
          {team.map((v) => (
            <DropdownMenuItem key={v.id} onSelect={() => onApply(v)}>
              {v.id === currentViewId ? <Check aria-hidden /> : <span className="w-4" />}
              <span className="truncate">{v.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setName("");
              setShared(false);
              setNameError(null);
              setSaveOpen(true);
            }}
          >
            <BookmarkPlus aria-hidden />
            Save current view…
          </DropdownMenuItem>
          {current?.mine && (
            <>
              <DropdownMenuItem onSelect={updateCurrent}>
                <Check aria-hidden />
                Update “{current.name}”
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={removeCurrent} className="text-danger focus:text-danger">
                <Trash2 aria-hidden />
                Delete “{current.name}”
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>
              Saves the current tab, chips, filters, sort and columns.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveNew();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="view-name">Name</Label>
              <Input
                id="view-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "view-name-error" : undefined}
                autoFocus
              />
              {nameError && (
                <p id="view-name-error" role="alert" className="text-xs text-danger">
                  {nameError}
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              Share with everyone in the company
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || name.trim() === ""}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
