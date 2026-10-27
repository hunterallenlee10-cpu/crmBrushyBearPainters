"use client";

import * as React from "react";
import { CirclePause, CirclePlay, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, fieldAria } from "@/components/forms/field";
import { ReasonButton } from "@/components/leads/reason-button";
import type { Option } from "@/lib/leads/service";
import { placeHoldSchema } from "@/lib/validation/jobs";
import { formatDateTime } from "@/lib/format/dates";
import { placeHold, releaseHold } from "./actions";
import type { HoldItem } from "./types";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-invalid:border-destructive";

/**
 * Onboarding → Holds (SPEC §5.3, §6.2): holds overlay the stage and, when they
 * block scheduling, stop Ready to Schedule and later stages until released.
 */
export function HoldsPanel({
  jobId,
  holds,
  holdTypes,
  canEdit,
  editReason,
}: {
  jobId: string;
  holds: HoldItem[];
  holdTypes: Option[];
  canEdit: boolean;
  editReason: string | null;
}) {
  const [placing, setPlacing] = React.useState(false);
  const [releasing, setReleasing] = React.useState<HoldItem | null>(null);
  const active = holds.filter((h) => !h.releasedAt);
  const released = holds.filter((h) => h.releasedAt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Holds don&apos;t change the stage. A hold that blocks scheduling stops Ready to Schedule
          and later stages, even with an owner override.
        </p>
        <ReasonButton
          size="sm"
          variant="cta"
          disabledReason={editReason}
          onClick={() => setPlacing(true)}
        >
          <Plus aria-hidden />
          Place hold
        </ReasonButton>
      </div>

      <section aria-labelledby="holds-active-title" className="rounded-2xl border bg-card p-5">
        <h3 id="holds-active-title" className="mb-3 text-base font-semibold">
          Active holds ({active.length})
        </h3>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active holds. Place one when the job is waiting on something (HOA approval, the
            deposit, colors…).
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {active.map((h) => (
              <li key={h.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <CirclePause className="size-4 text-warning" aria-hidden />
                    {h.label}
                    <Badge variant={h.blocksScheduling ? "danger" : "neutral"}>
                      {h.blocksScheduling ? "Blocks scheduling" : "Doesn't block scheduling"}
                    </Badge>
                  </p>
                  <p className="text-sm">{h.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    Placed {formatDateTime(h.placedAt)}
                    {h.placedByName && ` by ${h.placedByName}`}
                  </p>
                </div>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => setReleasing(h)}>
                    <CirclePlay aria-hidden />
                    Release
                    <span className="sr-only"> {h.label}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {released.length > 0 && (
        <section aria-labelledby="holds-released-title" className="rounded-2xl border bg-card p-5">
          <h3 id="holds-released-title" className="mb-3 text-base font-semibold">
            Released ({released.length})
          </h3>
          <ul className="flex flex-col gap-2">
            {released.map((h) => (
              <li key={h.id} className="text-sm">
                <p>
                  <span className="font-medium">{h.label}</span> · {h.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  Released {formatDateTime(h.releasedAt)}
                  {h.releasedByName && ` by ${h.releasedByName}`}
                  {h.releaseNote && ` · “${h.releaseNote}”`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && (
        <>
          <PlaceHoldDialog
            open={placing}
            onOpenChange={setPlacing}
            jobId={jobId}
            holdTypes={holdTypes}
          />
          <ReleaseHoldDialog hold={releasing} onOpenChange={(o) => !o && setReleasing(null)} />
        </>
      )}
    </div>
  );
}

function PlaceHoldDialog({
  open,
  onOpenChange,
  jobId,
  holdTypes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  holdTypes: Option[];
}) {
  const [type, setType] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [blocks, setBlocks] = React.useState(true);
  const [errors, setErrors] = React.useState<{ type?: string; reason?: string }>({});
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => {
    if (open) {
      setType("");
      setReason("");
      setBlocks(true);
      setErrors({});
    }
  }, [open]);
  const choices = holdTypes.filter((o) => o.active !== false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Place a hold</DialogTitle>
          <DialogDescription>
            The team sees the hold next to the stage until someone releases it.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const input = { job_id: jobId, hold_type: type, reason, blocks_scheduling: blocks };
            const parsed = placeHoldSchema.safeParse(input);
            if (!parsed.success) {
              const issue = (k: string) =>
                parsed.error.issues.find((i) => i.path[0] === k)?.message;
              return setErrors({
                type: type ? issue("hold_type") : "Pick the kind of hold.",
                reason: issue("reason"),
              });
            }
            setErrors({});
            startTransition(async () => {
              const r = await placeHold(input);
              if (r.ok) {
                toast.success("Hold placed.");
                onOpenChange(false);
              } else {
                setErrors({
                  type: r.error.fieldErrors?.hold_type?.[0],
                  reason: r.error.fieldErrors?.reason?.[0],
                });
                toast.error(r.error.message);
              }
            });
          }}
        >
          <Field id="hold-type" label="Hold type" required error={errors.type}>
            <select
              className={selectClass}
              value={type}
              onChange={(e) => setType(e.target.value)}
              {...fieldAria("hold-type", errors.type)}
            >
              <option value="">Pick a hold type…</option>
              {choices.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="hold-reason" label="What is it waiting on?" required error={errors.reason}>
            <Textarea
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              {...fieldAria("hold-reason", errors.reason)}
            />
          </Field>
          <div className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
            <div>
              <label htmlFor="hold-blocks" className="text-sm font-medium">
                Blocks scheduling
              </label>
              <p id="hold-blocks-description" className="text-xs text-muted-foreground">
                Stops the job from moving to Ready to Schedule or later.
              </p>
            </div>
            <Switch
              id="hold-blocks"
              checked={blocks}
              onCheckedChange={setBlocks}
              aria-describedby="hold-blocks-description"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Place hold
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseHoldDialog({
  hold,
  onOpenChange,
}: {
  hold: HoldItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [note, setNote] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => {
    if (hold) setNote("");
  }, [hold]);
  return (
    <Dialog open={hold !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release the {hold?.label ?? "hold"}?</DialogTitle>
          <DialogDescription>{hold?.reason}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!hold) return;
            startTransition(async () => {
              const r = await releaseHold({ id: hold.id, note });
              if (r.ok) {
                toast.success("Hold released.");
                onOpenChange(false);
              } else toast.error(r.error.message);
            });
          }}
        >
          <Field
            id="release-note"
            label="Note (optional)"
            description="e.g. “HOA approved on 10/28.”"
          >
            <Textarea
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              {...fieldAria("release-note", undefined, true)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Keep the hold
            </Button>
            <Button type="submit" variant="cta" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Release hold
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
