"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  AGREEMENT_DOC_TYPES,
  AGREEMENT_DOC_TYPE_LABELS,
  type AgreementDocType,
} from "@/lib/estimating/engine";
import { saveAgreementTemplate } from "./actions";

export function NewTemplateButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [docType, setDocType] = React.useState<AgreementDocType>("warranty");
  const [name, setName] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  return (
    <>
      <Button className={TOUCH} onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        New template
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>It starts as a draft. Write the wording next.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  saveAgreementTemplate({
                    doc_type: docType,
                    name,
                    body: `# ${name || AGREEMENT_DOC_TYPE_LABELS[docType]}\n\n[WORDING — owner/attorney to provide]`,
                  }),
                {
                  success: "Template created.",
                  onOk: (d) => router.push(`/admin/agreements/${d.id}`),
                  onError: (er) => setErrors(firstErrors(er)),
                },
              );
            }}
          >
            <Field id="nt-type" label="Document type">
              <NativeSelect
                id="nt-type"
                value={docType}
                onChange={(e) => setDocType(e.target.value as AgreementDocType)}
              >
                {AGREEMENT_DOC_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {AGREEMENT_DOC_TYPE_LABELS[d]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="nt-name" label="Name" required error={errors.name}>
              <Input
                {...fieldAria("nt-name", errors.name)}
                className={TOUCH}
                value={name}
                onChange={(e) => setName(e.target.value)}
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
