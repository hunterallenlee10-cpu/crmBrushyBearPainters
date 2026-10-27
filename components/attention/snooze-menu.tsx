"use client";

import * as React from "react";
import { AlarmClock, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Field, fieldAria } from "@/components/forms/field";
import { cn } from "@/lib/utils";
import {
  defaultCustomSnooze,
  minCustomSnooze,
  pacificInputToIso,
  snoozePresets,
  type SnoozePreset,
} from "./time";

/**
 * "Snooze until…": 1 hour, tomorrow 8 AM, next Monday 8 AM (Pacific), or a
 * custom date and time. A snoozed item leaves Pending and comes back on its own
 * when the time passes (the worker wakes it if the problem is still there).
 */
export function SnoozeMenu({
  itemTitle,
  onSnooze,
  className,
}: {
  itemTitle: string;
  /** Returns an error message to show, or null on success. */
  onSnooze: (untilIso: string) => Promise<string | null>;
  className?: string;
}) {
  const [presets, setPresets] = React.useState<SnoozePreset[]>([]);
  const [customOpen, setCustomOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [min, setMin] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  const [pending, setPending] = React.useState(false);
  const id = React.useId();
  const inputId = `${id}-until`;

  function openCustom() {
    const now = new Date();
    setValue(defaultCustomSnooze(now));
    setMin(minCustomSnooze(now));
    setError(undefined);
    setCustomOpen(true);
  }

  async function submitCustom(e: React.FormEvent) {
    e.preventDefault();
    const iso = pacificInputToIso(value);
    if (!iso) {
      setError("Pick a date and time.");
      return;
    }
    if (new Date(iso).getTime() <= Date.now()) {
      setError("Pick a time in the future.");
      return;
    }
    setPending(true);
    const message = await onSnooze(iso);
    setPending(false);
    if (message) setError(message);
    else setCustomOpen(false);
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          // Times are worked out when the menu opens, so "1 hour" means 1 hour from now.
          if (open) setPresets(snoozePresets(new Date()));
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-11 sm:h-8", className)}>
            <AlarmClock aria-hidden />
            Snooze
            <ChevronDown className="size-3" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Snooze until… (Pacific time)</DropdownMenuLabel>
          {presets.map((p) => (
            <DropdownMenuItem
              key={p.id}
              className="min-h-11 sm:min-h-8"
              onSelect={() => void onSnooze(p.until.toISOString())}
            >
              <span className="flex-1">{p.label}</span>
              <span className="text-xs text-muted-foreground">{p.detail}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11 sm:min-h-8" onSelect={openCustom}>
            Custom date and time…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Snooze until…</DialogTitle>
            <DialogDescription>
              {itemTitle}. It leaves the Pending list and comes back at this time if it still needs
              attention.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCustom} noValidate className="flex flex-col gap-4">
            <Field id={inputId} label="Date and time (Pacific)" required error={error}>
              <Input
                {...fieldAria(inputId, error)}
                type="datetime-local"
                value={value}
                min={min}
                onChange={(e) => setValue(e.target.value)}
                className="h-11 sm:h-9"
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-9"
                onClick={() => setCustomOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="h-11 sm:h-9" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                Snooze
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
