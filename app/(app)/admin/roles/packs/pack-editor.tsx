"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection, fieldAria } from "@/components/forms/field";
import {
  CATEGORY_LABELS,
  PERMISSION_CATEGORIES,
  SCOPE_LABELS,
  type Permission,
  type PermissionCategory,
  type Scope,
} from "@/lib/permissions";
import { packFormSchema } from "@/lib/validation/roles";
import { createPack, updatePack } from "../actions";
import { CATALOG_BY_CATEGORY, type PackPermission } from "../model";

/** Permissions that let a holder widen their own access. */
const POWER_PERMISSIONS: readonly Permission[] = ["roles:manage", "users:manage", "users:view_as"];

const SCOPES: Scope[] = ["own", "team", "all"];

type Errors = Partial<
  Record<"name" | "description" | "category" | "permissions" | "_form", string>
>;

/** Create or edit a custom pack: details plus a checkbox per catalog permission. */
export function PackEditor({
  mode,
  pack,
}: {
  mode: "create" | "edit";
  pack?: {
    id: string;
    name: string;
    description: string;
    category: PermissionCategory;
    permissions: readonly PackPermission[];
  };
}) {
  const router = useRouter();
  const [name, setName] = React.useState(pack?.name ?? "");
  const [description, setDescription] = React.useState(pack?.description ?? "");
  const [category, setCategory] = React.useState<PermissionCategory>(
    pack?.category ?? "core_records",
  );
  const [perms, setPerms] = React.useState<ReadonlyMap<Permission, Scope>>(
    () => new Map((pack?.permissions ?? []).map((p) => [p.permission, p.scope])),
  );
  const [errors, setErrors] = React.useState<Errors>({});
  const [pending, startTransition] = React.useTransition();

  function setPerm(permission: Permission, scope: Scope | null) {
    setPerms((prev) => {
      const next = new Map(prev);
      if (scope === null) next.delete(permission);
      else next.set(permission, scope);
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      name,
      description,
      category,
      permissions: [...perms].map(([permission, scope]) => ({ permission, scope })),
    };
    const parsed = packFormSchema.safeParse(input);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const k = String(issue.path[0] ?? "_form") as keyof Errors;
        next[k] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result =
        mode === "edit" && pack
          ? await updatePack({ ...input, id: pack.id })
          : await createPack(input);
      if (!result.ok) {
        const fe = result.error.fieldErrors ?? {};
        setErrors({
          name: fe.name?.[0],
          description: fe.description?.[0],
          category: fe.category?.[0],
          permissions: fe.permissions?.[0],
          _form: Object.keys(fe).length === 0 ? result.error.message : undefined,
        });
        toast.error(result.error.message);
        return;
      }
      if (mode === "create" && "id" in result.data) {
        toast.success(`Created pack “${name.trim()}”.`);
        router.push(`/admin/roles/packs/${result.data.id}`);
      } else {
        toast.success("Pack saved.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <FormSection title="Details">
        <Field id="pack-name" label="Name" required error={errors.name}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoComplete="off"
            {...fieldAria("pack-name", errors.name)}
          />
        </Field>
        <Field id="pack-category" label="Category" required error={errors.category}>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as PermissionCategory)}
            className="h-9 w-full rounded-md border bg-card px-2 text-sm"
            {...fieldAria("pack-category", errors.category)}
          >
            {PERMISSION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="pack-description"
          label="Description"
          error={errors.description}
          className="sm:col-span-2"
        >
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            placeholder="What this pack lets someone do"
            {...fieldAria("pack-description", errors.description)}
          />
        </Field>
      </FormSection>

      <section aria-labelledby="pack-perms-heading" className="rounded-2xl border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="pack-perms-heading" className="text-base font-semibold">
              Permissions
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Tick what this pack grants. Where it applies, pick whose records: own, the
              team&apos;s, or everyone&apos;s.
            </p>
          </div>
          <span className="text-sm font-medium" aria-live="polite">
            {perms.size} selected
          </span>
        </div>
        {POWER_PERMISSIONS.some((p) => perms.has(p)) && (
          <p
            role="status"
            className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              This pack lets people manage users, change permissions or view the app as someone
              else. Anyone with it can give themselves more access. Only add it to templates for
              people you&apos;d trust as an owner.
            </span>
          </p>
        )}
        {errors.permissions && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {errors.permissions}
          </p>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          {CATALOG_BY_CATEGORY.map((group) => (
            <fieldset key={group.category} className="flex flex-col">
              <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group.label}
              </legend>
              {group.items.map((p) => {
                const id = `perm-${p.key.replace(":", "-")}`;
                const scope = perms.get(p.key);
                return (
                  <div
                    key={p.key}
                    className="flex min-h-9 items-center gap-3 rounded-lg px-2 hover:bg-muted/50"
                  >
                    <Checkbox
                      id={id}
                      checked={scope !== undefined}
                      onCheckedChange={(v) => setPerm(p.key, v === true ? "all" : null)}
                    />
                    <Label htmlFor={id} className="flex-1 cursor-pointer py-1.5 font-normal">
                      {p.label}
                    </Label>
                    {p.scoped && scope !== undefined && (
                      <select
                        aria-label={`${p.label}: whose records`}
                        value={scope}
                        onChange={(e) => setPerm(p.key, e.target.value as Scope)}
                        className="h-8 rounded-md border bg-card px-1.5 text-xs"
                      >
                        {SCOPES.map((s) => (
                          <option key={s} value={s}>
                            {SCOPE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
      </section>

      {errors._form && (
        <p role="alert" className="text-sm text-danger">
          {errors._form}
        </p>
      )}
      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button type="submit" variant="cta" size="lg" disabled={pending} className="shadow-md">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {mode === "create" ? "Create pack" : "Save pack"}
        </Button>
      </div>
    </form>
  );
}
