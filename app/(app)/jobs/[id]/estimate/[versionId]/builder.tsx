"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  CopyPlus,
  FileDown,
  Layers,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect, TOUCH } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import {
  SAMPLE_BADGE,
  UNIT_LABELS,
  VERSION_STATUS_LABELS,
  type VersionStatus,
} from "@/lib/estimating/engine";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import {
  addArea,
  addOption,
  copyAreaToOption,
  deleteArea,
  deleteOption,
  discardVersion,
  duplicateOption,
  newVersion,
  requestDiscountApproval,
  sendEstimate,
  updateArea,
  updateOption,
  updateVersion,
} from "../actions";
import { CatalogPicker } from "../catalog-picker";
import { LineEditor } from "../line-editor";
import { SendDialog } from "../send-dialog";
import { MarginPanel, TotalsPanel } from "../totals-panel";
import type { BuilderLine } from "../types";
import type { BuilderData } from "./data";

const statusVariant = (s: string) =>
  s === "accepted"
    ? "success"
    : s === "draft"
      ? "neutral"
      : s === "declined" || s === "expired"
        ? "danger"
        : s === "superseded"
          ? "outline"
          : "info";

const statusLabel = (s: string) => VERSION_STATUS_LABELS[s as VersionStatus] ?? s;

/**
 * Estimate & Scope Builder (SPEC §7, §8.5 #4): tablet-first. Options are tabs;
 * each option has areas with lines; optional add-ons sit below; totals and
 * margin stay beside the scope on wide screens and below it on narrow ones.
 * Every change saves to the server, which re-prices the draft.
 */
export function EstimateBuilder({ data }: { data: BuilderData }) {
  const { job, estimate, version, can } = data;
  const draft = version.status === "draft";
  const readOnly = !can.edit;
  const [optionId, setOptionId] = React.useState<string | null>(
    () => (data.options.find((o) => o.isRecommended) ?? data.options[0])?.id ?? null,
  );
  React.useEffect(() => {
    if (!data.options.some((o) => o.id === optionId)) {
      setOptionId((data.options.find((o) => o.isRecommended) ?? data.options[0])?.id ?? null);
    }
  }, [data.options, optionId]);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [justSent, setJustSent] = React.useState(false);
  const editingLine = data.lines.find((l) => l.id === editing) ?? null;

  const option = data.options.find((o) => o.id === optionId) ?? null;
  const areas = data.areas.filter((a) => a.optionId === optionId);
  const addOns = data.lines.filter((l) => l.optionId === null);
  const totals = data.totals.find((t) => t.optionId === optionId) ?? null;
  const errors = [
    ...data.issues.filter((i) => i.severity === "error"),
    ...data.lines.flatMap((l) => l.issues.filter((i) => i.severity === "error")),
  ];
  const needsApproval =
    draft &&
    data.limitPercent !== null &&
    data.maxDiscountPercent > data.limitPercent &&
    (version.discountApprovedPercent ?? -1) < data.maxDiscountPercent;
  const sendBlocked = !data.sendable
    ? "Fix the problems marked in red first."
    : needsApproval
      ? "The discount needs an owner's approval first."
      : !data.contact
        ? "Add a primary contact to the job first."
        : null;
  const backHref = `/jobs/${job.id}?section=estimate`;
  const pdfHref = `/jobs/${job.id}/estimate/${version.id}/pdf`;

  return (
    <div className="flex flex-col gap-4">
      <BuilderHeader data={data} backHref={backHref} pdfHref={pdfHref}>
        {(can.send || justSent) && (
          <SendDialog
            id={version.id}
            title={`Send ${estimate.number} for signature`}
            contact={data.contact}
            messages={data.messages}
            disabledReason={can.send ? sendBlocked : "Already sent."}
            onSent={() => setJustSent(true)}
            send={sendEstimate}
          />
        )}
      </BuilderHeader>

      {!draft && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-info/30 bg-info-bg px-4 py-3 text-sm text-info">
          <Lock className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {version.status === "superseded"
              ? "A newer version replaced this one."
              : `Sent ${formatDateTime(version.sentAt)}${version.viewedAt ? `, viewed ${formatDateTime(version.viewedAt)}` : ""}${version.acceptedAt ? `, accepted ${formatDateTime(version.acceptedAt)}` : ""}. Sent versions are frozen.`}
            {version.expiresAt && version.status !== "accepted"
              ? ` Link expires ${formatDate(version.expiresAt)}.`
              : ""}
          </span>
        </div>
      )}
      {draft && data.settings.isSample && (
        <p className="rounded-xl border border-bb-honey bg-bb-honey/10 px-4 py-2 text-sm">
          <Badge variant="sample" className="mr-2">
            Sample
          </Badge>
          Labor rates, production rates and paint costs are samples ({SAMPLE_BADGE}). Prices are for
          trying the builder until Erik sets the real numbers in Estimate Setup.
        </p>
      )}
      {draft && errors.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" aria-hidden />
            Fix before sending
          </p>
          <ul className="mt-1 list-disc pl-6">
            {[...new Set(errors.map((e) => e.message))].map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <OptionTabs data={data} selected={optionId} onSelect={setOptionId} readOnly={readOnly} />
          {option ? (
            <>
              {areas.length === 0 && (
                <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No areas yet. Add a room or side of the house to start the scope.
                </p>
              )}
              {areas.map((a) => (
                <AreaCard
                  key={a.id}
                  data={data}
                  area={a}
                  lines={data.lines.filter((l) => l.areaId === a.id)}
                  readOnly={readOnly}
                  onEdit={setEditing}
                />
              ))}
              {!readOnly && <AddAreaForm data={data} optionId={option.id} />}
              <LooseLines
                lines={data.lines.filter((l) => l.optionId === option.id && l.areaId === null)}
                onEdit={setEditing}
              />
            </>
          ) : (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Add an option to start.
            </p>
          )}

          <section aria-labelledby="addons-h" className="rounded-2xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="addons-h" className="text-base font-semibold">
                  Optional add-ons
                </h2>
                <p className="text-sm text-muted-foreground">
                  The customer can switch these on or off on the proposal page, with any option.
                </p>
              </div>
              {!readOnly && (
                <CatalogPicker
                  catalog={data.catalog}
                  target={{ kind: "version", versionId: version.id, optionId: null, areaId: null }}
                  title="Add an optional add-on"
                  label="Add add-on"
                  onAdded={setEditing}
                />
              )}
            </div>
            {addOns.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No add-ons.</p>
            ) : (
              <ul className="mt-3 divide-y rounded-xl border">
                {addOns.map((l) => (
                  <LineRow key={l.id} line={l} onEdit={setEditing} />
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          {totals ? (
            <>
              <TotalsPanel
                summary={totals.summary}
                withAllAddOns={totals.withAllAddOns}
                hasAddOns={addOns.length > 0}
                taxConfirmed={data.settings.taxConfirmed}
              />
              <MarginPanel
                summary={totals.summary}
                floorPercent={data.settings.marginFloorPercent}
                effectiveDiscountPercent={totals.summary.effectiveDiscountPercent}
                isSample={data.settings.isSample}
              />
            </>
          ) : (
            <p className="rounded-2xl border p-4 text-sm text-muted-foreground">
              Totals appear once the option has lines.
            </p>
          )}
          <DiscountApproval data={data} needsApproval={needsApproval} />
          <TermsForm data={data} readOnly={readOnly} />
        </aside>
      </div>

      {editingLine && (
        <LineEditor
          key={editingLine.id}
          line={editingLine}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          products={data.products}
          sheens={data.sheens}
          settings={data.settings}
          readOnly={readOnly}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {totals ? `Total ${formatCents(totals.summary.totalCents)}` : ""}
      </span>
    </div>
  );
}

function BuilderHeader({
  data,
  backHref,
  pdfHref,
  children,
}: {
  data: BuilderData;
  backHref: string;
  pdfHref: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const { job, estimate, version, versions, can } = data;
  const { pending, run } = useRunAction();
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const draft = version.status === "draft";
  const hasDraft = versions.some((v) => v.status === "draft");
  const canWrite = can.edit || (!draft && data.can.send);
  return (
    <header className="flex flex-col gap-3">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1 text-sm text-bb-forest hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {job.number} · {job.name}
      </Link>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-bb-ink">
            {estimate.number}
            {estimate.title ? <span className="font-normal">· {estimate.title}</span> : null}
            <Badge variant={statusVariant(version.status)}>{statusLabel(version.status)}</Badge>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <label htmlFor="version-pick">Version</label>
            <NativeSelect
              id="version-pick"
              className="w-auto"
              value={version.id}
              onChange={(e) => router.push(`/jobs/${job.id}/estimate/${e.target.value}`)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNo} · {statusLabel(v.status)}
                  {v.sentAt ? ` · ${formatDate(v.sentAt)}` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className={TOUCH}>
            <a href={pdfHref} target="_blank" rel="noreferrer">
              <FileDown aria-hidden />
              {draft ? "Preview PDF" : "PDF"}
            </a>
          </Button>
          {!hasDraft && canWrite && version.status !== "accepted" && (
            <Button
              variant="outline"
              className={TOUCH}
              disabled={pending}
              onClick={() =>
                run(() => newVersion({ version_id: version.id }), {
                  success: "New draft version started.",
                  onOk: (d) => router.push(`/jobs/${job.id}/estimate/${d.versionId}`),
                })
              }
            >
              <CopyPlus aria-hidden />
              New version
            </Button>
          )}
          {draft && can.edit && versions.length > 1 && (
            <Button
              variant="ghost"
              className={cn(TOUCH, "text-danger")}
              onClick={() => setConfirmDiscard(true)}
            >
              <Trash2 aria-hidden />
              Discard draft
            </Button>
          )}
          {children}
        </div>
      </div>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Version {version.versionNo} and its lines are deleted. Earlier versions stay as they
              were.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                run(() => discardVersion({ version_id: version.id }), {
                  success: "Draft discarded.",
                  onOk: (d) =>
                    router.push(d.versionId ? `/jobs/${job.id}/estimate/${d.versionId}` : backHref),
                })
              }
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

function OptionTabs({
  data,
  selected,
  onSelect,
  readOnly,
}: {
  data: BuilderData;
  selected: string | null;
  onSelect: (id: string) => void;
  readOnly: boolean;
}) {
  const { pending, run } = useRunAction();
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const option = data.options.find((o) => o.id === selected) ?? null;
  const total = (id: string) => data.totals.find((t) => t.optionId === id)?.summary.totalCents;

  return (
    <section aria-label="Options" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {data.options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={o.id === selected}
            onClick={() => onSelect(o.id)}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm",
              o.id === selected
                ? "border-bb-forest bg-bb-forest text-white"
                : "border-bb-border bg-card hover:bg-bb-cream-light",
            )}
          >
            {o.isRecommended && <Star className="size-4 fill-current" aria-label="Recommended" />}
            <span className="font-medium">{o.name}</span>
            <span className="tabular-nums opacity-80">{formatCents(total(o.id) ?? 0)}</span>
          </button>
        ))}
        {!readOnly &&
          (adding ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => addOption({ version_id: data.version.id, name }), {
                  success: "Option added.",
                  onOk: (d) => {
                    setAdding(false);
                    setName("");
                    onSelect(d.id);
                  },
                });
              }}
            >
              <Input
                aria-label="New option name"
                placeholder="e.g. Better"
                className={cn(TOUCH, "w-40")}
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" className={TOUCH} disabled={pending || !name.trim()}>
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                className={TOUCH}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <Button variant="outline" className={TOUCH} onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Option
            </Button>
          ))}
        {option && !readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={TOUCH} aria-label={`${option.name} actions`}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{option.name}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil aria-hidden />
                Rename and describe
              </DropdownMenuItem>
              {!option.isRecommended && (
                <DropdownMenuItem
                  onSelect={() =>
                    run(() => updateOption({ id: option.id, is_recommended: true }), {
                      success: "Marked as recommended.",
                    })
                  }
                >
                  <Star aria-hidden />
                  Mark recommended
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  run(() => duplicateOption({ id: option.id }), {
                    success: "Option duplicated.",
                    onOk: (d) => onSelect(d.id),
                  })
                }
              >
                <Copy aria-hidden />
                Duplicate
              </DropdownMenuItem>
              {data.options.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    <Trash2 aria-hidden />
                    Delete option
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {option?.description && !editing && (
        <p className="text-sm text-muted-foreground">{option.description}</p>
      )}
      {option && editing && <OptionForm option={option} onDone={() => setEditing(false)} />}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {option?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its areas and lines are deleted too. Add-ons stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                option && run(() => deleteOption({ id: option.id }), { success: "Option deleted." })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function OptionForm({
  option,
  onDone,
}: {
  option: BuilderData["options"][number];
  onDone: () => void;
}) {
  const [name, setName] = React.useState(option.name);
  const [description, setDescription] = React.useState(option.description ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  return (
    <form
      className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateOption({ id: option.id, name, description }), {
          success: "Option saved.",
          onOk: onDone,
          onError: (er) => setErrors(firstErrors(er)),
        });
      }}
    >
      <Field id="opt-name" label="Option name" error={errors.name}>
        <Input
          {...fieldAria("opt-name", errors.name)}
          className={TOUCH}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field id="opt-desc" label="What's different about it (customer sees this)">
        <Input
          id="opt-desc"
          className={TOUCH}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className={TOUCH} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" className={TOUCH} disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

function LineRow({ line, onEdit }: { line: BuilderLine; onEdit: (id: string) => void }) {
  const hasError = line.issues.some((i) => i.severity === "error");
  const hasWarning = !hasError && line.issues.length > 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => onEdit(line.id)}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-bb-cream-light"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium">
            {(hasError || hasWarning) && (
              <AlertTriangle
                className={cn("size-4 shrink-0", hasError ? "text-danger" : "text-warning")}
                aria-label={hasError ? "Needs fixing" : "Check this line"}
              />
            )}
            <span className="truncate">{line.name}</span>
            {line.leadSafe && <Badge variant="warning">Lead-safe</Badge>}
            {line.overridePriceCents !== null && <Badge variant="outline">Override</Badge>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {line.description.startsWith(`${line.name} — `)
              ? line.description.slice(line.name.length + 3)
              : line.description}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm tabular-nums">
            {line.quantity.toLocaleString("en-US")} {UNIT_LABELS[line.unit]}
          </span>
          <span className="block text-sm font-semibold tabular-nums">
            {formatCents(line.priceCents)}
          </span>
        </span>
      </button>
    </li>
  );
}

function AreaCard({
  data,
  area,
  lines,
  readOnly,
  onEdit,
}: {
  data: BuilderData;
  area: BuilderData["areas"][number];
  lines: BuilderLine[];
  readOnly: boolean;
  onEdit: (id: string) => void;
}) {
  const { pending, run } = useRunAction();
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(area.name);
  const [workType, setWorkType] = React.useState(area.workType ?? "");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const others = data.options.filter((o) => o.id !== area.optionId);
  const subtotal = lines.reduce((s, l) => s + (l.priceCents ?? 0), 0);
  const workTypeLabel = data.workTypes.find((w) => w.value === area.workType)?.label;

  return (
    <section aria-label={area.name} className="rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        {renaming ? (
          <form
            className="flex flex-1 flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => updateArea({ id: area.id, name, work_type: workType }), {
                success: "Area saved.",
                onOk: () => setRenaming(false),
              });
            }}
          >
            <Input
              aria-label="Area name"
              className={cn(TOUCH, "w-48")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <NativeSelect
              aria-label="Work type"
              className="w-40"
              value={workType}
              onChange={(e) => setWorkType(e.target.value)}
            >
              <option value="">Work type…</option>
              {data.workTypes.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" className={TOUCH} disabled={pending}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={TOUCH}
              onClick={() => setRenaming(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{area.name}</h2>
            <p className="text-xs text-muted-foreground">
              {workTypeLabel ? `${workTypeLabel} · ` : ""}
              {lines.length} {lines.length === 1 ? "line" : "lines"} · {formatCents(subtotal)}
            </p>
          </div>
        )}
        {!readOnly && !renaming && (
          <div className="flex items-center gap-1">
            <CatalogPicker
              catalog={data.catalog}
              target={{
                kind: "version",
                versionId: data.version.id,
                optionId: area.optionId,
                areaId: area.id,
              }}
              title={`Add to ${area.name}`}
              onAdded={onEdit}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className={TOUCH} aria-label={`${area.name} actions`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRenaming(true)}>
                  <Pencil aria-hidden />
                  Rename
                </DropdownMenuItem>
                {others.length > 0 && <DropdownMenuLabel>Copy to</DropdownMenuLabel>}
                {others.map((o) => (
                  <DropdownMenuItem
                    key={o.id}
                    onSelect={() =>
                      run(() => copyAreaToOption({ id: area.id, to_option_id: o.id }), {
                        success: `Copied to ${o.name}.`,
                      })
                    }
                  >
                    <Layers aria-hidden />
                    {o.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden />
                  Delete area
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {lines.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No lines yet{readOnly ? "." : " — add walls, trim, doors or a custom line."}
        </p>
      ) : (
        <ul className="divide-y">
          {lines.map((l) => (
            <LineRow key={l.id} line={l} onEdit={onEdit} />
          ))}
        </ul>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {area.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {lines.length} lines are deleted too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => run(() => deleteArea({ id: area.id }), { success: "Area deleted." })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function LooseLines({ lines, onEdit }: { lines: BuilderLine[]; onEdit: (id: string) => void }) {
  if (lines.length === 0) return null;
  return (
    <section aria-label="Other lines" className="rounded-2xl border bg-card">
      <h2 className="border-b px-4 py-3 text-base font-semibold">Other lines</h2>
      <ul className="divide-y">
        {lines.map((l) => (
          <LineRow key={l.id} line={l} onEdit={onEdit} />
        ))}
      </ul>
    </section>
  );
}

function AddAreaForm({ data, optionId }: { data: BuilderData; optionId: string }) {
  const [name, setName] = React.useState("");
  const [workType, setWorkType] = React.useState(
    data.workTypes.find((w) => data.job.workTypes.includes(w.value))?.value ?? "",
  );
  const { pending, run } = useRunAction();
  return (
    <form
      aria-label="Add an area"
      className="flex flex-wrap items-end gap-2 rounded-2xl border border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            addArea({
              version_id: data.version.id,
              option_id: optionId,
              name,
              work_type: workType,
            }),
          { success: "Area added.", onOk: () => setName("") },
        );
      }}
    >
      <Field id="area-name" label="New area" className="min-w-48 flex-1">
        <Input
          id="area-name"
          className={TOUCH}
          placeholder="Living room, North side, Kitchen cabinets…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field id="area-wt" label="Work type">
        <NativeSelect id="area-wt" value={workType} onChange={(e) => setWorkType(e.target.value)}>
          <option value="">Not set</option>
          {data.workTypes.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" className={TOUCH} disabled={pending || !name.trim()}>
        <Plus aria-hidden />
        Add area
      </Button>
    </form>
  );
}

function DiscountApproval({ data, needsApproval }: { data: BuilderData; needsApproval: boolean }) {
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  const { version } = data;
  if (data.pendingApproval) {
    return (
      <p className="rounded-2xl border border-warning/30 bg-warning-bg p-4 text-sm text-warning">
        Waiting on an owner to approve a {data.pendingApproval.percent ?? data.maxDiscountPercent}%
        discount in Approvals.
      </p>
    );
  }
  if (version.discountApprovedPercent !== null && !needsApproval && data.maxDiscountPercent > 0) {
    return (
      <p className="rounded-2xl border border-success/30 bg-success-bg p-4 text-sm text-success">
        Discount up to {version.discountApprovedPercent}% approved.
      </p>
    );
  }
  if (!needsApproval) return null;
  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning-bg/50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => requestDiscountApproval({ version_id: version.id, reason }), {
          success: "Sent to Approvals.",
          onOk: () => setReason(""),
          onError: (er) => setErrors(firstErrors(er)),
        });
      }}
    >
      <p className="text-sm">
        This version is <strong>{data.maxDiscountPercent}%</strong> below the computed price; your
        limit is {data.limitPercent}%. An owner needs to approve it before it can be sent.
      </p>
      <Field id="disc-reason" label="Why the discount" error={errors.reason}>
        <Textarea
          {...fieldAria("disc-reason", errors.reason)}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Button type="submit" className={TOUCH} disabled={pending || !data.can.edit}>
        Ask for approval
      </Button>
    </form>
  );
}

function TermsForm({ data, readOnly }: { data: BuilderData; readOnly: boolean }) {
  const { version } = data;
  const saved = {
    discount_type: (version.discountType ?? "none") as "none" | "amount" | "percent",
    discount_value:
      version.discountValue === null
        ? ""
        : version.discountType === "amount"
          ? (version.discountValue / 100).toFixed(2)
          : String(version.discountValue),
    discount_reason: version.discountReason ?? "",
    deposit_percent: version.depositPercent === null ? "" : String(version.depositPercent),
    customer_notes: version.customerNotes ?? "",
    internal_notes: version.internalNotes ?? "",
  };
  // Reset only when the saved values change, not on every refresh (a line
  // saved elsewhere refreshes the page and used to wipe unsaved typing here).
  const savedKey = JSON.stringify(saved);
  const [form, setForm] = React.useState(saved);
  React.useEffect(() => {
    setForm(JSON.parse(savedKey) as typeof saved);
  }, [savedKey]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      aria-label="Discount, deposit and notes"
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErrors({});
        run(() => updateVersion({ version_id: version.id, ...form }), {
          success: "Saved.",
          onError: (er) => setErrors(firstErrors(er)),
        });
      }}
    >
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        Discount, deposit & notes
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <Field id="disc-type" label="Discount">
          <NativeSelect
            id="disc-type"
            value={form.discount_type}
            disabled={readOnly}
            onChange={(e) => set("discount_type", e.target.value as typeof form.discount_type)}
          >
            <option value="none">None</option>
            <option value="percent">Percent</option>
            <option value="amount">Dollar amount</option>
          </NativeSelect>
        </Field>
        <Field
          id="disc-value"
          label={form.discount_type === "amount" ? "Amount ($)" : "Percent"}
          error={errors.discount_value}
        >
          <Input
            {...fieldAria("disc-value", errors.discount_value)}
            className={TOUCH}
            inputMode="decimal"
            value={form.discount_value}
            disabled={readOnly || form.discount_type === "none"}
            onChange={(e) => set("discount_value", e.target.value)}
          />
        </Field>
      </div>
      {form.discount_type !== "none" && (
        <Field id="disc-why" label="Reason (internal)" error={errors.discount_reason}>
          <Input
            {...fieldAria("disc-why", errors.discount_reason)}
            className={TOUCH}
            value={form.discount_reason}
            disabled={readOnly}
            onChange={(e) => set("discount_reason", e.target.value)}
          />
        </Field>
      )}
      <Field
        id="dep"
        label="Deposit %"
        description={`Blank uses the company default (${data.settings.depositPercent}%).`}
        error={errors.deposit_percent}
      >
        <Input
          {...fieldAria("dep", errors.deposit_percent, true)}
          className={TOUCH}
          inputMode="decimal"
          value={form.deposit_percent}
          disabled={readOnly}
          onChange={(e) => set("deposit_percent", e.target.value)}
        />
      </Field>
      <Field id="cust-notes" label="Notes for the customer">
        <Textarea
          id="cust-notes"
          rows={3}
          value={form.customer_notes}
          disabled={readOnly}
          onChange={(e) => set("customer_notes", e.target.value)}
        />
      </Field>
      <Field id="int-notes" label="Internal notes">
        <Textarea
          id="int-notes"
          rows={2}
          value={form.internal_notes}
          disabled={readOnly}
          onChange={(e) => set("internal_notes", e.target.value)}
        />
      </Field>
      {!readOnly && (
        <Button type="submit" className={TOUCH} disabled={pending}>
          Save
        </Button>
      )}
    </form>
  );
}
