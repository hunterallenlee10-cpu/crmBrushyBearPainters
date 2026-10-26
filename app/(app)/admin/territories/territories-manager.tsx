"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, fieldAria } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { findZipConflicts, parseZipList, type TerritoryLite } from "@/lib/domain/territory";
import {
  deleteTerritorySchema,
  describeZipConflicts,
  formatZipList,
  invalidZipMessage,
  lookupZip,
  territoryFormSchema,
} from "@/lib/validation/territories";
import { deleteTerritory, saveTerritory } from "./actions";

export function TerritoriesManager({ territories }: { territories: TerritoryLite[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<TerritoryLite | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<TerritoryLite | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <ZipLookup territories={territories} />

      <section className="rounded-2xl border bg-card" aria-labelledby="territories-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 id="territories-heading" className="text-base font-semibold">
              Territories
            </h2>
            <p className="text-xs text-muted-foreground">
              Owners: verify these ZIP lists. They came from the spec and haven&apos;t been
              confirmed.
            </p>
          </div>
          <Button variant="cta" size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add territory
          </Button>
        </div>

        {territories.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No territories yet. Add the cities you serve and their ZIP codes.
          </p>
        ) : (
          <ul className="divide-y" aria-label="Territories">
            {territories.map((t) => (
              <li key={t.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{t.name}</h3>
                    {t.isServiceArea ? (
                      <Badge variant="success">Service area</Badge>
                    ) : (
                      t.name.toLowerCase() !== "outside service area" && (
                        <Badge variant="neutral">Outside service area</Badge>
                      )
                    )}
                    {!t.active && <Badge variant="warning">Off</Badge>}
                  </div>
                  {t.zipCodes.length > 0 ? (
                    <ul aria-label={`ZIP codes in ${t.name}`} className="flex flex-wrap gap-1.5">
                      {t.zipCodes.map((z) => (
                        <li
                          key={z}
                          className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-xs tabular-nums"
                        >
                          {z}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t.isServiceArea
                        ? "No ZIP codes yet. Leads won't match this territory."
                        : "No ZIP codes. Leads that match no territory are flagged Out of area."}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(t)}
                    aria-label={`Edit ${t.name}`}
                  >
                    <Pencil aria-hidden /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                    onClick={() => setDeleting(t)}
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 aria-hidden /> Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <TerritoryDialog
          key={editing === "new" ? "new" : editing.id}
          territory={editing === "new" ? null : editing}
          territories={territories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      {deleting && (
        <DeleteTerritoryDialog
          key={deleting.id}
          territory={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ZipLookup({ territories }: { territories: readonly TerritoryLite[] }) {
  const [query, setQuery] = React.useState("");
  const result = lookupZip(territories, query);

  return (
    <section className="rounded-2xl border bg-card p-4" aria-labelledby="zip-lookup-heading">
      <h2 id="zip-lookup-heading" className="flex items-center gap-2 text-base font-semibold">
        <Search className="size-4 text-muted-foreground" aria-hidden /> ZIP lookup
      </h2>
      <p className="mt-0.5 mb-3 text-sm text-muted-foreground">
        Check where a lead will land. Uses the active service areas below.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="98033 or 123 Main St, Kirkland WA 98033"
          aria-label="ZIP code or address"
          className="sm:max-w-sm"
          inputMode="text"
          autoComplete="off"
        />
        <div aria-live="polite" className="min-h-6 text-sm" data-testid="zip-lookup-result">
          {result.kind === "in_area" && (
            <p className="flex flex-wrap items-center gap-2">
              <MapPin className="size-4 text-success" aria-hidden />
              <span className="font-mono">{result.zip}</span>
              <span>is in</span>
              <Badge variant="success">{result.territory}</Badge>
            </p>
          )}
          {result.kind === "out_of_area" && (
            <div>
              <p>
                <span className="font-mono">{result.zip}</span>:{" "}
                <span className="font-medium text-warning">
                  Out of area — leads are flagged, not rejected.
                </span>
              </p>
              {result.listedUnder && (
                <p className="text-xs text-muted-foreground">
                  It&apos;s listed under {result.listedUnder}, which is turned off or isn&apos;t a
                  service area.
                </p>
              )}
            </div>
          )}
          {result.kind === "no_zip" && (
            <p className="text-muted-foreground">
              Type a 5-digit ZIP, or an address that ends in one.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

type FormErrors = Partial<Record<"name" | "zipText" | "_form", string>>;

function TerritoryDialog({
  territory,
  territories,
  onClose,
  onSaved,
}: {
  territory: TerritoryLite | null;
  territories: readonly TerritoryLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(territory?.name ?? "");
  const [zipText, setZipText] = React.useState(formatZipList(territory?.zipCodes ?? []));
  const [isServiceArea, setIsServiceArea] = React.useState(territory?.isServiceArea ?? true);
  const [active, setActive] = React.useState(territory?.active ?? true);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [submitting, setSubmitting] = React.useState(false);

  const parsed = parseZipList(zipText);
  const conflicts = describeZipConflicts(findZipConflicts(territories, parsed.zips, territory?.id));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      ...(territory ? { id: territory.id } : {}),
      name,
      zipText,
      isServiceArea,
      active,
    };
    const check = territoryFormSchema.safeParse(input);
    const next: FormErrors = {};
    if (!check.success) {
      for (const issue of check.error.issues) {
        const k = (issue.path[0] ?? "_form") as keyof FormErrors;
        next[k] ??= issue.message;
      }
    }
    // Pre-check against the other territories; the database checks again on save.
    if (!next.zipText && conflicts.length > 0) next.zipText = conflicts.join(" ");
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    setSubmitting(true);
    const result = await saveTerritory(input);
    setSubmitting(false);
    if (result.ok) {
      toast.success(territory ? `Saved ${name.trim()}.` : `Added ${name.trim()}.`);
      onSaved();
      return;
    }
    const fieldErrors: FormErrors = {};
    for (const [k, messages] of Object.entries(result.error.fieldErrors ?? {})) {
      fieldErrors[k as keyof FormErrors] = messages[0];
    }
    if (Object.keys(fieldErrors).length === 0) fieldErrors._form = result.error.message;
    setErrors(fieldErrors);
  }

  const zipHelpId = "territory-zips-help";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{territory ? `Edit ${territory.name}` : "Add territory"}</DialogTitle>
            <DialogDescription>Each ZIP code can belong to only one territory.</DialogDescription>
          </DialogHeader>

          <Field id="territory-name" label="Name" required error={errors.name}>
            <Input
              value={name}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => {
                setName(e.target.value);
                setErrors((x) => ({ ...x, name: undefined }));
              }}
              {...fieldAria("territory-name", errors.name)}
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <Field id="territory-zips" label="ZIP codes" error={errors.zipText}>
              <Textarea
                value={zipText}
                rows={3}
                spellCheck={false}
                className="font-mono"
                placeholder="98004, 98005, 98006"
                onChange={(e) => {
                  setZipText(e.target.value);
                  setErrors((x) => ({ ...x, zipText: undefined }));
                }}
                {...fieldAria("territory-zips", errors.zipText)}
                aria-describedby={errors.zipText ? "territory-zips-error" : zipHelpId}
              />
            </Field>
            <div id={zipHelpId} aria-live="polite" className="flex flex-col gap-1 text-xs">
              <p className="text-muted-foreground">
                Separate with commas, spaces or new lines.{" "}
                {parsed.zips.length === 1 ? "1 ZIP code." : `${parsed.zips.length} ZIP codes.`}
              </p>
              {!errors.zipText && parsed.invalid.length > 0 && (
                <p className="text-danger">{invalidZipMessage(parsed.invalid)}</p>
              )}
              {!errors.zipText &&
                conflicts.map((c) => (
                  <p key={c} className="text-danger">
                    {c}
                  </p>
                ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
            <div>
              <p id="territory-service-label" className="text-sm font-medium">
                Service area
              </p>
              <p className="text-xs text-muted-foreground">
                Off marks it Outside service area: its leads are flagged, not rejected.
              </p>
            </div>
            <Switch
              checked={isServiceArea}
              onCheckedChange={setIsServiceArea}
              aria-labelledby="territory-service-label"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
            <div>
              <p id="territory-active-label" className="text-sm font-medium">
                Active
              </p>
              <p className="text-xs text-muted-foreground">
                Turned-off territories keep their ZIP codes but stop matching new leads.
              </p>
            </div>
            <Switch
              checked={active}
              onCheckedChange={setActive}
              aria-labelledby="territory-active-label"
            />
          </div>

          {errors._form && (
            <p role="alert" className="text-sm text-danger">
              {errors._form}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden />}
              {territory ? "Save territory" : "Add territory"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTerritoryDialog({
  territory,
  onClose,
  onDeleted,
}: {
  territory: TerritoryLite;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = { id: territory.id, reason };
    const parsed = deleteTerritorySchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Add a reason.");
      return;
    }
    setSubmitting(true);
    const result = await deleteTerritory(input);
    setSubmitting(false);
    if (result.ok) {
      toast.success(`Deleted ${territory.name}. Restore it from Deleted Records if needed.`);
      onDeleted();
      return;
    }
    setError(result.error.fieldErrors?.reason?.[0] ?? result.error.message);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Delete {territory.name}?</DialogTitle>
            <DialogDescription>
              Its ZIP codes stop matching leads right away. It moves to Deleted Records, where an
              admin can restore it.
            </DialogDescription>
          </DialogHeader>
          <Field id="delete-reason" label="Reason" required error={error ?? undefined}>
            <Textarea
              value={reason}
              rows={2}
              maxLength={500}
              placeholder="e.g. Merged into Bellevue"
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              {...fieldAria("delete-reason", error ?? undefined)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden />}
              Delete territory
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
