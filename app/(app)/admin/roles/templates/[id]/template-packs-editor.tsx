"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { diffPermissions } from "@/lib/domain/permissions";
import { SCOPE_LABELS, type Permission } from "@/lib/permissions";
import { isScoped } from "@/lib/validation/roles";
import { setTemplatePacks } from "../../actions";
import { PermissionMatrix } from "../../_components/permission-matrix";
import { PackBadge } from "../../_components/badges";
import { PERMISSION_LABEL, groupPacks, plural, resolveTemplate, type PackView } from "../../model";

/**
 * Pack checklist for one template with a live "what changes" preview
 * (resolvePermissions + diffPermissions, the pure mirror of the SQL resolver).
 */
export function TemplatePacksEditor({
  templateId,
  savedPackIds,
  packs,
  activeUsers,
}: {
  templateId: string;
  savedPackIds: readonly string[];
  packs: readonly PackView[];
  activeUsers: number;
}) {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set(savedPackIds));
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const packsById = React.useMemo(() => new Map(packs.map((p) => [p.id, p])), [packs]);
  const before = React.useMemo(
    () => resolveTemplate({ grantsAll: false }, savedPackIds, packsById),
    [savedPackIds, packsById],
  );
  const proposedIds = React.useMemo(() => [...selected], [selected]);
  const after = React.useMemo(
    () => resolveTemplate({ grantsAll: false }, proposedIds, packsById),
    [proposedIds, packsById],
  );
  const diff = React.useMemo(() => diffPermissions(before, after), [before, after]);
  const packsChanged =
    selected.size !== savedPackIds.length || savedPackIds.some((id) => !selected.has(id));
  const permsChanged = diff.added.length + diff.removed.length + diff.rescoped.length > 0;

  const changes: Partial<Record<Permission, "added" | "removed" | "rescoped">> = {};
  for (const p of diff.added) changes[p] = "added";
  for (const p of diff.removed) changes[p] = "removed";
  for (const r of diff.rescoped) changes[r.permission] = "rescoped";

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setTemplatePacks({ template_id: templateId, pack_ids: proposedIds });
      if (!result.ok) {
        setError(result.error.message);
        toast.error(result.error.message);
        return;
      }
      toast.success("Template packs saved.");
    });
  }

  const withScope = (p: Permission) => {
    const s = after[p];
    return s && isScoped(p) ? ` (${SCOPE_LABELS[s]})` : "";
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="packs-heading" className="rounded-2xl border bg-card p-5">
          <h2 id="packs-heading" className="text-base font-semibold">
            Packs
          </h2>
          <p className="mt-0.5 mb-4 text-sm text-muted-foreground">
            Tick the packs this template includes. Nothing changes until you save.
          </p>
          <div className="flex flex-col gap-5">
            {groupPacks(packs).map((g) => (
              <fieldset key={g.category} className="flex flex-col gap-1">
                <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {g.label}
                </legend>
                {g.packs.map((p) => {
                  const id = `pack-${p.id}`;
                  return (
                    <div
                      key={p.id}
                      className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
                    >
                      <Checkbox
                        id={id}
                        checked={selected.has(p.id)}
                        onCheckedChange={(v) => toggle(p.id, v === true)}
                        className="mt-0.5"
                        aria-describedby={p.description ? `${id}-desc` : undefined}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Label htmlFor={id} className="cursor-pointer">
                            {p.name}
                          </Label>
                          <PackBadge pack={p} />
                          <Link
                            href={`/admin/roles/packs/${p.id}`}
                            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                          >
                            {plural(p.permissions.length, "permission")}
                          </Link>
                        </div>
                        {p.description && (
                          <p id={`${id}-desc`} className="text-xs text-muted-foreground">
                            {p.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </section>

        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <section
            aria-labelledby="changes-heading"
            aria-live="polite"
            className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
          >
            <h2 id="changes-heading" className="text-base font-semibold">
              What changes
            </h2>
            {!packsChanged ? (
              <p className="text-sm text-muted-foreground">
                No changes yet. Tick or untick packs to preview what this template gains or loses.
              </p>
            ) : !permsChanged ? (
              <p className="text-sm text-muted-foreground">
                The packs change, but the template ends up with the same permissions.
              </p>
            ) : (
              <>
                {diff.added.length > 0 && (
                  <ChangeList
                    title={`Adds ${diff.added.length}`}
                    tone="success"
                    testId="diff-added"
                  >
                    {diff.added.map((p) => (
                      <li key={p}>
                        {PERMISSION_LABEL[p]}
                        {withScope(p)}
                      </li>
                    ))}
                  </ChangeList>
                )}
                {diff.removed.length > 0 && (
                  <ChangeList
                    title={`Removes ${diff.removed.length}`}
                    tone="danger"
                    testId="diff-removed"
                  >
                    {diff.removed.map((p) => (
                      <li key={p}>{PERMISSION_LABEL[p]}</li>
                    ))}
                  </ChangeList>
                )}
                {diff.rescoped.length > 0 && (
                  <ChangeList
                    title={`Scope changes ${diff.rescoped.length}`}
                    tone="warning"
                    testId="diff-rescoped"
                  >
                    {diff.rescoped.map((r) => (
                      <li key={r.permission}>
                        {PERMISSION_LABEL[r.permission]}: {SCOPE_LABELS[r.from]} →{" "}
                        {SCOPE_LABELS[r.to]}
                      </li>
                    ))}
                  </ChangeList>
                )}
              </>
            )}
            {packsChanged && (
              <p className="text-xs text-muted-foreground">
                Applies right away to {plural(activeUsers, "active user")} on this template.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="cta"
                onClick={save}
                disabled={!packsChanged || pending}
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                Save packs
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelected(new Set(savedPackIds))}
                disabled={!packsChanged || pending}
              >
                <RotateCcw aria-hidden /> Undo changes
              </Button>
            </div>
          </section>
        </aside>
      </div>

      <PermissionMatrix
        map={after}
        changes={packsChanged ? changes : undefined}
        description={
          packsChanged
            ? "Includes your unsaved pack changes (green = added, red = removed, yellow = scope change)."
            : "What a user on this template can do, before any per-user overrides."
        }
      />
    </div>
  );
}

function ChangeList({
  title,
  tone,
  testId,
  children,
}: {
  title: string;
  tone: "success" | "danger" | "warning";
  testId: string;
  children: React.ReactNode;
}) {
  const color = { success: "text-success", danger: "text-danger", warning: "text-warning" }[tone];
  return (
    <div>
      <p className={`text-sm font-semibold ${color}`}>{title}</p>
      <ul data-testid={testId} className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {children}
      </ul>
    </div>
  );
}
