"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
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
import { TOUCH } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { savePriceBook } from "./actions";

export function PriceBookForm({
  book,
}: {
  book?: { id: string; name: string; description: string | null; active: boolean };
}) {
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ name: "", description: "", active: true });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  const start = () => {
    setF({
      name: book?.name ?? "",
      description: book?.description ?? "",
      active: book?.active ?? true,
    });
    setErrors({});
    setOpen(true);
  };
  return (
    <>
      <Button variant={book ? "outline" : "default"} className={TOUCH} onClick={start}>
        {book ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {book ? "Edit price book" : "New price book"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{book ? "Edit price book" : "New price book"}</DialogTitle>
            <DialogDescription>Items are added on the price book&apos;s page.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => savePriceBook({ id: book?.id, ...f }), {
                success: "Price book saved.",
                onOk: () => setOpen(false),
                onError: (er) => setErrors(firstErrors(er)),
              });
            }}
          >
            <Field id="pb-name" label="Name" required error={errors.name}>
              <Input
                {...fieldAria("pb-name", errors.name)}
                className={TOUCH}
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </Field>
            <Field id="pb-desc" label="Description">
              <Textarea
                id="pb-desc"
                rows={2}
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
              />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={f.active}
                onChange={(e) => setF({ ...f, active: e.target.checked })}
              />
              Active
            </label>
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
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
