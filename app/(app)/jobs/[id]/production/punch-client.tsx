"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, PenLine, Plus, RotateCcw, Trash2 } from "lucide-react";
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
import { Field, fieldAria } from "@/components/forms/field";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { SignaturePad } from "@/app/p/[token]/signature-pad";
import type { PunchItemView } from "@/lib/production/job";
import type { PhotoThumb } from "@/lib/photos/thumbs";
import { addPunchItem, captureSignoff, deletePunchItem, updatePunchItem } from "./actions";

const STATUS: Record<string, string> = {
  open: "Open",
  fixed: "Fixed",
  customer_waived: "Customer waived",
};

function PhotoPicker({
  photos,
  value,
  onChange,
  label,
}: {
  photos: PhotoThumb[];
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
}) {
  if (!photos.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Take photos in Camera first, then pick one here.
      </p>
    );
  }
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-6 gap-1">
        {photos.slice(0, 18).map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={value === p.id}
            aria-label={`${p.caption ?? "Photo"} ${p.createdAt.slice(0, 10)}`}
            onClick={() => onChange(value === p.id ? null : p.id)}
            className={`overflow-hidden rounded-md border-2 ${value === p.id ? "border-bb-forest" : "border-transparent"}`}
          >
            {p.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link
              <img src={p.thumbUrl} alt="" className="aspect-square w-full object-cover" />
            ) : (
              <span className="block aspect-square w-full bg-muted" />
            )}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function PunchList({
  jobId,
  items,
  photos,
  canManage,
}: {
  jobId: string;
  items: PunchItemView[];
  photos: PhotoThumb[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [area, setArea] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [photoId, setPhotoId] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [fixing, setFixing] = React.useState<PunchItemView | null>(null);
  const [fixedPhoto, setFixedPhoto] = React.useState<string | null>(null);
  const [waiving, setWaiving] = React.useState<PunchItemView | null>(null);
  const [waiveNote, setWaiveNote] = React.useState("");
  const areas = [...new Set(items.map((i) => i.area))];
  const byArea = areas.map((a) => [a, items.filter((i) => i.area === a)] as const);

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <form
          aria-label="Add punch item"
          className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                addPunchItem({
                  jobId,
                  area,
                  description,
                  photoId: photoId ?? undefined,
                }),
              {
                success: "Punch item added.",
                onOk: () => {
                  setDescription("");
                  setPhotoId(null);
                  setErrors({});
                  router.refresh();
                },
                onError: (err) => setErrors(firstErrors(err)),
              },
            );
          }}
        >
          <h3 className="text-base font-semibold">Add a touch-up</h3>
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <Field id="punch-area" label="Area" error={errors.area} required>
              <Input
                list="punch-areas"
                className="h-11"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="e.g. Kitchen"
                {...fieldAria("punch-area", errors.area)}
              />
            </Field>
            <datalist id="punch-areas">
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <Field id="punch-desc" label="What needs fixing" error={errors.description} required>
              <Input
                className="h-11"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                {...fieldAria("punch-desc", errors.description)}
              />
            </Field>
          </div>
          <PhotoPicker
            photos={photos}
            value={photoId}
            onChange={setPhotoId}
            label="Photo (optional)"
          />
          <Button type="submit" className="h-11 self-start" disabled={pending}>
            <Plus aria-hidden /> Add item
          </Button>
        </form>
      )}

      {items.length === 0 ? (
        <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          No punch items. Walk the job with the customer and add any touch-ups here.
        </p>
      ) : (
        byArea.map(([a, list]) => (
          <section key={a} aria-label={a} className="rounded-2xl border bg-card p-4">
            <h3 className="mb-2 text-base font-semibold">
              {a}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({list.filter((i) => i.status === "open").length} open)
              </span>
            </h3>
            <ul className="flex flex-col divide-y">
              {list.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {[i.photo, i.fixedPhoto].map((p, k) =>
                      p?.thumbUrl ? (
                        <a
                          key={k}
                          href={p.url ?? p.thumbUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link */}
                          <img
                            src={p.thumbUrl}
                            alt={k === 0 ? "Before" : "Fixed"}
                            className="size-14 rounded-lg object-cover"
                          />
                        </a>
                      ) : null,
                    )}
                    <div className="min-w-0">
                      <p
                        className={
                          i.status === "open" ? "font-medium" : "text-muted-foreground line-through"
                        }
                      >
                        {i.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <Badge variant={i.status === "open" ? "secondary" : "outline"}>
                          {STATUS[i.status] ?? i.status}
                        </Badge>
                        {i.waivedNote ? ` · ${i.waivedNote}` : ""}
                      </p>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-1">
                      {i.status === "open" ? (
                        <>
                          <Button
                            size="sm"
                            className="h-10"
                            disabled={pending}
                            onClick={() => {
                              setFixedPhoto(null);
                              setFixing(i);
                            }}
                          >
                            <Check aria-hidden /> Fixed
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-10"
                            disabled={pending}
                            onClick={() => {
                              setWaiveNote("");
                              setWaiving(i);
                            }}
                          >
                            Customer waived
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-10"
                          disabled={pending}
                          onClick={() =>
                            run(() => updatePunchItem({ id: i.id, status: "open" }), {
                              success: "Reopened.",
                              onOk: () => router.refresh(),
                            })
                          }
                        >
                          <RotateCcw aria-hidden /> Reopen
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-10"
                        aria-label={`Remove ${i.description}`}
                        disabled={pending}
                        onClick={() =>
                          run(() => deletePunchItem({ id: i.id }), {
                            success: "Removed.",
                            onOk: () => router.refresh(),
                          })
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Dialog open={!!fixing} onOpenChange={(o) => !o && setFixing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark fixed</DialogTitle>
            <DialogDescription>{fixing?.description}</DialogDescription>
          </DialogHeader>
          <PhotoPicker
            photos={photos}
            value={fixedPhoto}
            onChange={setFixedPhoto}
            label="Photo of the fix (optional)"
          />
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                fixing &&
                run(
                  () =>
                    updatePunchItem({
                      id: fixing.id,
                      status: "fixed",
                      fixedPhotoId: fixedPhoto ?? undefined,
                    }),
                  {
                    success: "Marked fixed.",
                    onOk: () => {
                      setFixing(null);
                      router.refresh();
                    },
                  },
                )
              }
            >
              <Check aria-hidden /> Mark fixed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!waiving} onOpenChange={(o) => !o && setWaiving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Customer waived it</DialogTitle>
            <DialogDescription>{waiving?.description}</DialogDescription>
          </DialogHeader>
          <Field id="waive-note" label="What the customer said" required>
            <Textarea
              id="waive-note"
              rows={3}
              value={waiveNote}
              onChange={(e) => setWaiveNote(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              disabled={pending || waiveNote.trim().length < 3}
              onClick={() =>
                waiving &&
                run(
                  () =>
                    updatePunchItem({
                      id: waiving.id,
                      status: "customer_waived",
                      waivedNote: waiveNote,
                    }),
                  {
                    success: "Marked as waived by the customer.",
                    onOk: () => {
                      setWaiving(null);
                      router.refresh();
                    },
                  },
                )
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Capture the customer's final-walkthrough sign-off on this device. */
export function SignoffCapture({
  jobId,
  defaultName,
  openItems,
  statement,
}: {
  jobId: string;
  defaultName: string;
  openItems: number;
  statement: string;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(defaultName);
  const [sig, setSig] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <>
      <Button className="h-11" onClick={() => setOpen(true)}>
        <PenLine aria-hidden /> Capture customer sign-off
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Final walkthrough sign-off</DialogTitle>
            <DialogDescription>Hand the device to the customer.</DialogDescription>
          </DialogHeader>
          <p className="rounded-xl bg-muted/60 p-3 text-sm">{statement}</p>
          {openItems > 0 && (
            <p className="text-sm text-warning">
              {openItems} punch item{openItems === 1 ? " is" : "s are"} still open.
            </p>
          )}
          <Field id="signer-name" label="Customer name" error={errors.signerName} required>
            <Input
              className="h-11"
              value={name}
              onChange={(e) => setName(e.target.value)}
              {...fieldAria("signer-name", errors.signerName)}
            />
          </Field>
          <div>
            <p id="signoff-sig-label" className="mb-1 text-sm font-medium">
              Signature
            </p>
            <SignaturePad labelId="signoff-sig-label" onChange={setSig} disabled={pending} />
            {errors.signaturePng && <p className="text-xs text-danger">{errors.signaturePng}</p>}
          </div>
          <Field id="signoff-note" label="Note (optional)">
            <Textarea
              id="signoff-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              disabled={pending || !sig}
              onClick={() =>
                sig &&
                run(
                  () =>
                    captureSignoff({
                      jobId,
                      signerName: name,
                      signaturePng: sig,
                      note: note || undefined,
                    }),
                  {
                    success: "Sign-off saved.",
                    onOk: () => {
                      setOpen(false);
                      router.refresh();
                    },
                    onError: (err) => setErrors(firstErrors(err)),
                  },
                )
              }
            >
              Save sign-off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
