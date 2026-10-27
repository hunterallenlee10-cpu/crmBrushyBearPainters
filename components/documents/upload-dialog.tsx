"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { createSupabaseBrowserClient } from "@/lib/db/browser";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  guessCategory,
  titleFromFileName,
  uploadProblem,
  type DocumentCategory,
} from "@/lib/domain/documents";
import { finishDocumentUpload, startDocumentUpload } from "@/app/(app)/documents/actions";

/**
 * Upload a document (SPEC §8.5 #7): the file goes straight to the private
 * bucket through a one-time signed URL, then the server records it. Used by
 * Job → Documents, the customer page, the Documents page and onboarding items.
 */

export type UploadTarget = { jobId: string } | { accountId: string };

export function UploadDocumentDialog({
  target,
  open,
  onOpenChange,
  defaultCategory,
  title = "Upload a document",
  description,
  onUploaded,
}: {
  target: UploadTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCategory?: DocumentCategory;
  title?: string;
  description?: string;
  onUploaded?: (id: string) => void;
}) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [docTitle, setDocTitle] = React.useState("");
  const [category, setCategory] = React.useState<DocumentCategory>(defaultCategory ?? "other");
  const [awaiting, setAwaiting] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setFile(null);
      setDocTitle("");
      setCategory(defaultCategory ?? "other");
      setAwaiting(false);
      setNotes("");
      setError(null);
    }
  }, [open, defaultCategory]);

  const pick = (f: File | null) => {
    setFile(f);
    setError(f ? uploadProblem({ name: f.name, type: f.type, size: f.size }) : null);
    if (f) {
      setDocTitle((t) => t || titleFromFileName(f.name));
      if (!defaultCategory) setCategory(guessCategory(f.name));
    }
  };

  const submit = async () => {
    if (!file) {
      setError("Choose a file.");
      return;
    }
    const problem = uploadProblem({ name: file.name, type: file.type, size: file.size });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const start = await startDocumentUpload({
        ...target,
        fileName: file.name.slice(-200),
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!start.ok) {
        setError(start.error.message);
        return;
      }
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase.storage
        .from(start.data.bucket)
        .uploadToSignedUrl(start.data.path, start.data.token, file, { contentType: file.type });
      if (upErr) {
        setError("The upload didn't finish. Check your connection and try again.");
        return;
      }
      const done = await finishDocumentUpload({
        ...target,
        path: start.data.path,
        fileName: file.name.slice(-200),
        mimeType: file.type,
        title: docTitle.trim() || titleFromFileName(file.name),
        category,
        notes: notes.trim() || undefined,
        awaitingSignature: awaiting,
      });
      if (!done.ok) {
        setError(done.error.message);
        return;
      }
      toast.success("Document uploaded.");
      onUploaded?.(done.data.id);
      onOpenChange(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? "PDF, photo, Word, Excel, text or CSV, up to 25 MB. Stored privately."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field id="doc-file" label="File" required error={error ?? undefined}>
            <Input
              id="doc-file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.txt,.csv,.doc,.docx,.xls,.xlsx"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
              className="h-11 sm:h-9"
            />
          </Field>
          <Field id="doc-title" label="Title" required>
            <Input
              id="doc-title"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              maxLength={200}
            />
          </Field>
          <Field id="doc-category" label="Category">
            <NativeSelect
              id="doc-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as DocumentCategory)}
            >
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {DOCUMENT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="doc-notes" label="Notes (optional)">
            <Textarea
              id="doc-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Checkbox
              id="doc-awaiting"
              checked={awaiting}
              onCheckedChange={(v) => setAwaiting(v === true)}
            />
            <Label htmlFor="doc-awaiting">Waiting for someone to sign it</Label>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !file}>
            <Upload aria-hidden /> {busy ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
