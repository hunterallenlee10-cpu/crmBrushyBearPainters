"use client";

import * as React from "react";
import Link from "next/link";
import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { EmptyState } from "@/components/layout/empty-state";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_TABS,
  isDocumentCategory,
  previewKind,
  tabCategories,
  type DocumentCategory,
  type DocumentTabId,
} from "@/lib/domain/documents";
import { formatBytes } from "@/lib/domain/photos";
import { formatDateTime } from "@/lib/format/dates";
import { deleteDocument, updateDocument } from "@/app/(app)/documents/actions";
import { UploadDocumentDialog, type UploadTarget } from "./upload-dialog";

export type DocumentItem = {
  id: string;
  title: string;
  fileName: string;
  category: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  source: string;
  createdAt: string;
  uploadedByName: string | null;
  jobId: string | null;
  jobLabel: string | null;
  accountId: string | null;
  accountName: string | null;
};

export const fileHref = (id: string, download = false) =>
  `/api/files/documents/${id}${download ? "?download=1" : ""}`;

const STATUS_LABELS: Record<string, string> = {
  active: "",
  awaiting_signature: "Awaiting signature",
  signed: "Signed",
  superseded: "Superseded",
};

const categoryLabel = (c: string) =>
  isDocumentCategory(c) ? DOCUMENT_CATEGORY_LABELS[c] : "Other";

/**
 * Document list (SPEC §8.5 #7): category tabs, list or grid, preview, and the
 * row actions (download, rename, recategorize, move to another job of the
 * same customer, delete → soft). Shared by the job, the customer page and the
 * Documents page (which filters on the server instead of with tabs).
 */
export function DocumentList({
  items,
  canManage,
  uploadTarget,
  jobOptions = [],
  showLinked = false,
  showTabs = true,
  emptyTitle = "No documents yet",
  emptyText = "Upload HOA approvals, lead-safe acknowledgments, receipts and warranty papers here. Signed proposals and contracts land here on their own.",
}: {
  items: DocumentItem[];
  canManage: boolean;
  uploadTarget?: UploadTarget;
  /** Other jobs of the same customer a document can move to. */
  jobOptions?: { id: string; label: string }[];
  showLinked?: boolean;
  showTabs?: boolean;
  emptyTitle?: string;
  emptyText?: string;
}) {
  const [tab, setTab] = React.useState<DocumentTabId>("all");
  const [layout, setLayout] = React.useState<"list" | "grid">("list");
  const [uploading, setUploading] = React.useState(false);
  const [preview, setPreview] = React.useState<DocumentItem | null>(null);
  const [editing, setEditing] = React.useState<DocumentItem | null>(null);
  const [deleting, setDeleting] = React.useState<DocumentItem | null>(null);

  const counts = Object.fromEntries(
    DOCUMENT_TABS.map((t) => [
      t.id,
      t.id === "all"
        ? items.length
        : items.filter((d) => (tabCategories(t.id) as readonly string[]).includes(d.category))
            .length,
    ]),
  ) as Record<DocumentTabId, number>;
  const shown =
    tab === "all"
      ? items
      : items.filter((d) => (tabCategories(tab) as readonly string[]).includes(d.category));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showTabs ? (
          <div
            className="-mx-1 flex flex-wrap gap-1 px-1"
            role="group"
            aria-label="Document categories"
          >
            {DOCUMENT_TABS.filter((t) => t.id === "all" || counts[t.id] > 0).map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
                className={
                  tab === t.id
                    ? "inline-flex h-9 items-center gap-1 rounded-full bg-bb-forest px-3 text-sm font-medium text-white"
                    : "inline-flex h-9 items-center gap-1 rounded-full border bg-card px-3 text-sm font-medium hover:bg-accent"
                }
              >
                {t.label}
                <span className="tabular-nums opacity-80">{counts[t.id]}</span>
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border" role="group" aria-label="Layout">
            <Button
              type="button"
              size="icon"
              variant={layout === "list" ? "secondary" : "ghost"}
              aria-pressed={layout === "list"}
              aria-label="List"
              onClick={() => setLayout("list")}
            >
              <List aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant={layout === "grid" ? "secondary" : "ghost"}
              aria-pressed={layout === "grid"}
              aria-label="Grid"
              onClick={() => setLayout("grid")}
            >
              <LayoutGrid aria-hidden />
            </Button>
          </div>
          {canManage && uploadTarget && (
            <Button type="button" onClick={() => setUploading(true)}>
              <Upload aria-hidden /> Upload
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={FileText} title={emptyTitle}>
          <p>{emptyText}</p>
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          Nothing in this category.
        </p>
      ) : layout === "list" ? (
        <ul className="divide-y rounded-2xl border bg-card" aria-label="Documents">
          {shown.map((d) => (
            <li key={d.id} className="flex min-h-14 items-center gap-3 px-3 py-2 sm:px-4">
              <DocIcon mime={d.mimeType} />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="block max-w-full truncate text-left text-sm font-medium text-bb-forest hover:underline"
                  onClick={() => setPreview(d)}
                >
                  {d.title}
                </button>
                <p className="truncate text-xs text-muted-foreground">
                  {categoryLabel(d.category)} · {formatBytes(d.sizeBytes)} ·{" "}
                  {formatDateTime(d.createdAt)}
                  {d.uploadedByName
                    ? ` · ${d.uploadedByName}`
                    : d.source === "generated"
                      ? " · Generated"
                      : ""}
                </p>
                {showLinked && <Linked d={d} />}
              </div>
              {STATUS_LABELS[d.status] && (
                <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                  {STATUS_LABELS[d.status]}
                </Badge>
              )}
              <RowMenu
                d={d}
                canManage={canManage}
                onPreview={() => setPreview(d)}
                onEdit={() => setEditing(d)}
                onDelete={() => setDeleting(d)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" aria-label="Documents">
          {shown.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-3">
              <button
                type="button"
                onClick={() => setPreview(d)}
                className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-muted"
                aria-label={`Preview ${d.title}`}
              >
                {previewKind(d.mimeType) === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- permission-checked file route
                  <img
                    src={fileHref(d.id)}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <DocIcon mime={d.mimeType} large />
                )}
              </button>
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {categoryLabel(d.category)} · {formatBytes(d.sizeBytes)}
                  </p>
                  {showLinked && <Linked d={d} />}
                </div>
                <RowMenu
                  d={d}
                  canManage={canManage}
                  onPreview={() => setPreview(d)}
                  onEdit={() => setEditing(d)}
                  onDelete={() => setDeleting(d)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {uploadTarget && (
        <UploadDocumentDialog target={uploadTarget} open={uploading} onOpenChange={setUploading} />
      )}
      {preview && <PreviewDialog d={preview} onClose={() => setPreview(null)} />}
      {editing && (
        <EditDialog d={editing} jobOptions={jobOptions} onClose={() => setEditing(null)} />
      )}
      {deleting && <DeleteDialog d={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function Linked({ d }: { d: DocumentItem }) {
  return (
    <p className="truncate text-xs">
      {d.jobId ? (
        <Link href={`/jobs/${d.jobId}?section=documents`} className="text-bb-forest underline">
          {d.jobLabel ?? "Job"}
        </Link>
      ) : d.accountId ? (
        <Link href={`/accounts/${d.accountId}`} className="text-bb-forest underline">
          {d.accountName ?? "Customer"}
        </Link>
      ) : null}
    </p>
  );
}

function DocIcon({ mime, large }: { mime: string; large?: boolean }) {
  const cls = large ? "size-10 text-muted-foreground" : "size-5 shrink-0 text-muted-foreground";
  return mime.startsWith("image/") ? (
    <ImageIcon className={cls} aria-hidden />
  ) : (
    <FileText className={cls} aria-hidden />
  );
}

function RowMenu({
  d,
  canManage,
  onPreview,
  onEdit,
  onDelete,
}: {
  d: DocumentItem;
  canManage: boolean;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={`Actions for ${d.title}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onPreview}>
          <Eye aria-hidden /> Preview
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={fileHref(d.id, true)} download>
            <Download aria-hidden /> Download
          </a>
        </DropdownMenuItem>
        {canManage && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden /> Rename or move
          </DropdownMenuItem>
        )}
        {canManage && d.status !== "signed" && (
          <DropdownMenuItem onSelect={onDelete} className="text-danger">
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PreviewDialog({ d, onClose }: { d: DocumentItem; onClose: () => void }) {
  const kind = previewKind(d.mimeType);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{d.title}</DialogTitle>
          <DialogDescription>
            {categoryLabel(d.category)} · {d.fileName} · {formatBytes(d.sizeBytes)}
          </DialogDescription>
        </DialogHeader>
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- permission-checked file route
          <img
            src={fileHref(d.id)}
            alt={d.title}
            className="max-h-[70dvh] w-full rounded-xl bg-muted object-contain"
          />
        ) : kind === "pdf" ? (
          <iframe
            title={`Preview of ${d.title}`}
            src={fileHref(d.id)}
            className="h-[70dvh] w-full rounded-xl border"
          />
        ) : (
          <p className="rounded-xl border bg-muted p-6 text-sm text-muted-foreground">
            This file type can&apos;t be previewed here. Download it to open it.
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button asChild variant="outline">
            <a href={fileHref(d.id)} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden /> Open in a new tab
            </a>
          </Button>
          <Button asChild>
            <a href={fileHref(d.id, true)} download>
              <Download aria-hidden /> Download
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  d,
  jobOptions,
  onClose,
}: {
  d: DocumentItem;
  jobOptions: { id: string; label: string }[];
  onClose: () => void;
}) {
  const { pending, run } = useRunAction();
  const [title, setTitle] = React.useState(d.title);
  const [category, setCategory] = React.useState<DocumentCategory>(
    isDocumentCategory(d.category) ? d.category : "other",
  );
  const [jobId, setJobId] = React.useState(d.jobId ?? "");
  const [awaiting, setAwaiting] = React.useState(d.status === "awaiting_signature");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const generated = d.source === "generated";
  const canMove = !generated && d.accountId && jobOptions.length > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename or move</DialogTitle>
          <DialogDescription>{d.fileName}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field id="doc-edit-title" label="Title" error={errors.title}>
            <Input id="doc-edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="doc-edit-category" label="Category">
            <NativeSelect
              id="doc-edit-category"
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
          {canMove && (
            <Field id="doc-edit-job" label="Linked to" description="Jobs for the same customer.">
              <NativeSelect
                id="doc-edit-job"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
              >
                <option value="">The customer only (no job)</option>
                {jobOptions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {["active", "awaiting_signature"].includes(d.status) && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="doc-edit-awaiting"
                checked={awaiting}
                onCheckedChange={(v) => setAwaiting(v === true)}
              />
              <Label htmlFor="doc-edit-awaiting">Waiting for someone to sign it</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateDocument({
                    id: d.id,
                    title,
                    category,
                    ...(canMove ? { jobId: jobId || null } : {}),
                    awaitingSignature: awaiting,
                  }),
                {
                  success: "Document saved.",
                  onOk: onClose,
                  onError: (e) => setErrors(firstErrors(e)),
                },
              )
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ d, onClose }: { d: DocumentItem; onClose: () => void }) {
  const { pending, run } = useRunAction();
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{d.title}”?</DialogTitle>
          <DialogDescription>
            An owner can restore it from Admin → Deleted Records.
          </DialogDescription>
        </DialogHeader>
        <Field id="doc-delete-reason" label="Why?" error={errors.reason}>
          <Input
            id="doc-delete-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              run(() => deleteDocument({ id: d.id, reason }), {
                success: "Document deleted.",
                onOk: onClose,
                onError: (e) => setErrors(firstErrors(e)),
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
