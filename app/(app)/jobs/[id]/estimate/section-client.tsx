"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, HardHat, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { NativeSelect, TOUCH } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { addColor, createEstimate, updateColor } from "./actions";
import { createChangeOrder, createFieldChangeOrder } from "./change-order-actions";

export function NewEstimateButton({
  jobId,
  label = "Start the estimate",
  variant = "default",
}: {
  jobId: string;
  label?: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  return (
    <Button
      variant={variant}
      className={TOUCH}
      disabled={pending}
      onClick={() =>
        run(() => createEstimate({ job_id: jobId }), {
          success: "Estimate started.",
          onOk: (d) => d.versionId && router.push(`/jobs/${jobId}/estimate/${d.versionId}`),
        })
      }
    >
      <Plus aria-hidden />
      {label}
    </Button>
  );
}

export function NewChangeOrderButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  return (
    <>
      <Button variant="outline" className={TOUCH} onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Change order
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New change order</DialogTitle>
            <DialogDescription>
              Add the lines next. The customer signs it on their phone like the estimate.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => createChangeOrder({ job_id: jobId, title, reason }), {
                success: "Change order started.",
                onOk: (d) => router.push(`/jobs/${jobId}/change-orders/${d.id}`),
                onError: (er) => setErrors(firstErrors(er)),
              });
            }}
          >
            <Field id="nco-title" label="Title" required error={errors.title}>
              <Input
                {...fieldAria("nco-title", errors.title)}
                className={TOUCH}
                placeholder="e.g. Replace rotted fascia board"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field id="nco-reason" label="Why (the customer sees this)">
              <Textarea
                id="nco-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className={TOUCH}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className={TOUCH} disabled={pending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Crew leads: record what was found; an owner or estimator prices it. */
export function FieldChangeOrderButton({ jobId }: { jobId: string }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  React.useEffect(() => {
    if (open) {
      setTitle("");
      setNotes("");
      setErrors({});
    }
  }, [open]);
  return (
    <>
      <Button variant="outline" className={TOUCH} onClick={() => setOpen(true)}>
        <HardHat aria-hidden />
        Report a scope change
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report a scope change</DialogTitle>
            <DialogDescription>
              Hidden rot, extra prep, a customer request. The office prices it and sends it for
              signature before the extra work starts.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => createFieldChangeOrder({ job_id: jobId, title, field_notes: notes }), {
                success: (d) => `${d.number} sent to the office.`,
                onOk: () => setOpen(false),
                onError: (er) => setErrors(firstErrors(er)),
              });
            }}
          >
            <Field id="fco-title" label="What did you find?" required error={errors.title}>
              <Input
                {...fieldAria("fco-title", errors.title)}
                className="h-11"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field id="fco-notes" label="Details" required error={errors.field_notes}>
              <Textarea
                {...fieldAria("fco-notes", errors.field_notes)}
                rows={4}
                placeholder="Where, how much, what it needs"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="h-11" disabled={pending}>
                Send to the office
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type ColorRow = {
  id: string;
  area: string;
  surface: string;
  brand: string | null;
  colorName: string | null;
  colorCode: string | null;
  sheen: string | null;
  productId: string | null;
  notes: string | null;
  confirmed: boolean;
};

type Choice = { value: string; label: string };

/** The color schedule (SPEC §7.8): seeded from the accepted estimate; editable here. */
export function ColorsTable({
  jobId,
  rows,
  canEdit,
  products,
  sheens,
  brands,
}: {
  jobId: string;
  rows: ColorRow[];
  canEdit: boolean;
  products: { id: string; label: string; sheens: string[] }[];
  sheens: Choice[];
  brands: Choice[];
}) {
  const [editing, setEditing] = React.useState<ColorRow | null>(null);
  const [adding, setAdding] = React.useState(false);
  const label = (list: Choice[], v: string | null) =>
    v ? (list.find((x) => x.value === v)?.label ?? v) : null;

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
          No colors yet. They fill in from the estimate once it&apos;s accepted
          {canEdit ? ", or add rows yourself" : ""}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Area</th>
                <th className="px-3 py-2 font-medium">Surface</th>
                <th className="px-3 py-2 font-medium">Color</th>
                <th className="px-3 py-2 font-medium">Sheen</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={canEdit ? "cursor-pointer hover:bg-bb-cream-light" : undefined}
                  onClick={canEdit ? () => setEditing(r) : undefined}
                >
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <button
                        type="button"
                        className="text-left font-medium text-bb-forest underline-offset-2 hover:underline"
                        aria-label={`Edit ${r.area} · ${r.surface}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(r);
                        }}
                      >
                        {r.area}
                      </button>
                    ) : (
                      r.area
                    )}
                  </td>
                  <td className="px-3 py-2">{r.surface}</td>
                  <td className="px-3 py-2">
                    {r.colorName || r.colorCode ? (
                      <>
                        {[label(brands, r.brand), r.colorName].filter(Boolean).join(" ")}
                        {r.colorCode ? (
                          <span className="text-muted-foreground"> · {r.colorCode}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not chosen</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{label(sheens, r.sheen) ?? "—"}</td>
                  <td className="px-3 py-2">
                    {r.confirmed ? (
                      <Badge variant="success">
                        <Check aria-hidden />
                        Confirmed
                      </Badge>
                    ) : r.colorName || r.colorCode ? (
                      <Badge variant="info">Selected</Badge>
                    ) : (
                      <Badge variant="neutral">Pending</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <Button variant="outline" className={`${TOUCH} w-fit`} onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Add color row
        </Button>
      )}
      {editing && (
        <ColorDialog
          row={editing}
          onClose={() => setEditing(null)}
          products={products}
          sheens={sheens}
          brands={brands}
        />
      )}
      {adding && <AddColorDialog jobId={jobId} onClose={() => setAdding(false)} />}
    </div>
  );
}

function ColorDialog({
  row,
  onClose,
  products,
  sheens,
  brands,
}: {
  row: ColorRow;
  onClose: () => void;
  products: { id: string; label: string; sheens: string[] }[];
  sheens: Choice[];
  brands: Choice[];
}) {
  const [f, setF] = React.useState({
    brand: row.brand ?? "",
    color_name: row.colorName ?? "",
    color_code: row.colorCode ?? "",
    sheen: row.sheen ?? "",
    paint_product_id: row.productId ?? "",
    finish_notes: row.notes ?? "",
    confirmed: row.confirmed,
  });
  const { pending, run } = useRunAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {row.area} · {row.surface}
          </DialogTitle>
          <DialogDescription>
            The crew and the paint store work from the color sheet.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateColor({ id: row.id, ...f }), {
              success: "Color saved.",
              onOk: onClose,
            });
          }}
        >
          <Field id="c-brand" label="Brand">
            <NativeSelect
              id="c-brand"
              value={f.brand}
              onChange={(e) => setF({ ...f, brand: e.target.value })}
            >
              <option value="">Not set</option>
              {brands.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="c-name" label="Color name">
            <Input
              id="c-name"
              className={TOUCH}
              value={f.color_name}
              onChange={(e) => setF({ ...f, color_name: e.target.value })}
            />
          </Field>
          <Field id="c-code" label="Color code">
            <Input
              id="c-code"
              className={TOUCH}
              value={f.color_code}
              onChange={(e) => setF({ ...f, color_code: e.target.value })}
            />
          </Field>
          <Field id="c-sheen" label="Sheen">
            <NativeSelect
              id="c-sheen"
              value={f.sheen}
              onChange={(e) => setF({ ...f, sheen: e.target.value })}
            >
              <option value="">Not set</option>
              {sheens.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="c-product" label="Product" className="sm:col-span-2">
            <NativeSelect
              id="c-product"
              value={f.paint_product_id}
              onChange={(e) => setF({ ...f, paint_product_id: e.target.value })}
            >
              <option value="">Not set</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="c-notes" label="Finish notes" className="sm:col-span-2">
            <Textarea
              id="c-notes"
              rows={2}
              value={f.finish_notes}
              onChange={(e) => setF({ ...f, finish_notes: e.target.value })}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="size-5"
              checked={f.confirmed}
              onChange={(e) => setF({ ...f, confirmed: e.target.checked })}
            />
            Customer confirmed this color
          </label>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" className={TOUCH} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className={TOUCH} disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddColorDialog({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [area, setArea] = React.useState("");
  const [surface, setSurface] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a color row</DialogTitle>
          <DialogDescription>
            One row per area and surface (e.g. Living room · Walls).
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addColor({ job_id: jobId, area, surface }), {
              success: "Row added.",
              onOk: onClose,
              onError: (er) => setErrors(firstErrors(er)),
            });
          }}
        >
          <Field id="ac-area" label="Area" required error={errors.area}>
            <Input
              {...fieldAria("ac-area", errors.area)}
              className={TOUCH}
              value={area}
              onChange={(e) => setArea(e.target.value)}
            />
          </Field>
          <Field id="ac-surface" label="Surface" required error={errors.surface}>
            <Input
              {...fieldAria("ac-surface", errors.surface)}
              className={TOUCH}
              value={surface}
              onChange={(e) => setSurface(e.target.value)}
            />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" className={TOUCH} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className={TOUCH} disabled={pending}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
