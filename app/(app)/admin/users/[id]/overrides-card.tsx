"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Crown, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, fieldAria } from "@/components/forms/field";
import {
  CATEGORY_LABELS,
  PERMISSION_CATEGORIES,
  PERMISSIONS,
  SCOPE_LABELS,
  type Permission,
  type Scope,
} from "@/lib/permissions";
import {
  isScopedPermission,
  overrideSchema,
  type OverrideInput,
  type OverrideValues,
} from "@/lib/validation/users";
import { addPermissionOverride, removePermissionOverride } from "../actions";
import { Card, NativeSelect, TOUCH, applyFieldErrors } from "../_components/form-bits";

export type OverrideRow = {
  id: string;
  permission: Permission;
  effect: "grant" | "revoke";
  scope: Scope;
  reason: string;
  added: string;
  addedBy: string;
};

const LABELS = new Map<string, string>(PERMISSIONS.map((p) => [p.key, p.label]));

export function permissionLabel(p: string): string {
  return LABELS.get(p) ?? p;
}

export function OverridesCard({
  userId,
  isOwner,
  canSee,
  canEdit,
  overrides,
}: {
  userId: string;
  isOwner: boolean;
  canSee: boolean;
  canEdit: boolean;
  overrides: OverrideRow[];
}) {
  return (
    <Card
      title="Permission overrides"
      headingId="overrides"
      description="Grant or remove single permissions for this person on top of their role. Each one needs a reason and is audit-logged."
    >
      {isOwner ? (
        <p className="flex items-center gap-2 text-sm">
          <Crown className="size-4 text-bb-honey" aria-hidden />
          Owners have every permission, so overrides don&apos;t apply.
        </p>
      ) : !canSee ? (
        <p className="text-sm text-muted-foreground">
          Only people who can edit roles and permissions can see overrides.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <OverrideList userId={userId} overrides={overrides} canEdit={canEdit} />
          {canEdit && (
            <AddOverrideForm userId={userId} taken={new Set(overrides.map((o) => o.permission))} />
          )}
        </div>
      )}
    </Card>
  );
}

function OverrideList({
  userId,
  overrides,
  canEdit,
}: {
  userId: string;
  overrides: OverrideRow[];
  canEdit: boolean;
}) {
  const [removing, setRemoving] = React.useState<string | null>(null);

  async function remove(o: OverrideRow) {
    setRemoving(o.id);
    const result = await removePermissionOverride({ user_id: userId, override_id: o.id });
    setRemoving(null);
    if (result.ok) toast.success(`Removed the override for "${permissionLabel(o.permission)}".`);
    else toast.error(result.error.message);
  }

  if (overrides.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No overrides. This person has exactly what their role gives them
        {canEdit ? " — add one below if they need an exception." : "."}
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y rounded-xl border" aria-label="Current overrides">
      {overrides.map((o) => (
        <li
          key={o.id}
          className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <Badge variant={o.effect === "grant" ? "success" : "danger"}>
                {o.effect === "grant" ? "Grant" : "Revoke"}
              </Badge>
              {permissionLabel(o.permission)}
              <code className="text-xs text-muted-foreground">{o.permission}</code>
              {o.effect === "grant" && isScopedPermission(o.permission) && (
                <span className="text-xs text-muted-foreground">· {SCOPE_LABELS[o.scope]}</span>
              )}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              &ldquo;{o.reason}&rdquo; — {o.addedBy}, {o.added}
            </p>
          </div>
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 sm:h-8"
              disabled={removing === o.id}
              onClick={() => remove(o)}
              aria-label={`Remove override for ${permissionLabel(o.permission)}`}
            >
              {removing === o.id ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Trash2 aria-hidden />
              )}
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddOverrideForm({ userId, taken }: { userId: string; taken: Set<Permission> }) {
  const empty: OverrideInput = {
    user_id: userId,
    permission: "",
    effect: "grant",
    scope: "all",
    reason: "",
  };
  const form = useForm<OverrideInput, unknown, OverrideValues>({
    resolver: zodResolver(overrideSchema),
    defaultValues: empty,
  });
  const {
    register,
    handleSubmit,
    setError,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = form;
  const err = (k: keyof OverrideInput) => errors[k]?.message;
  const permission = watch("permission");
  const effect = watch("effect");
  const showScope =
    effect === "grant" && permission !== "" && isScopedPermission(permission as Permission);

  async function onSubmit() {
    const result = await addPermissionOverride(form.getValues());
    if (result.ok) {
      toast.success("Override added.");
      reset(empty);
      return;
    }
    applyFieldErrors(setError, result.error);
    toast.error(result.error.message);
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="grid gap-4 rounded-xl bg-muted/40 p-4 sm:grid-cols-2"
      aria-label="Add an override"
    >
      <h3 className="text-sm font-semibold sm:col-span-2">Add an override</h3>
      <Field id="override-permission" label="Permission" required error={err("permission")}>
        <NativeSelect
          {...register("permission")}
          {...fieldAria("override-permission", err("permission"))}
        >
          <option value="">Choose a permission…</option>
          {PERMISSION_CATEGORIES.map((cat) => (
            <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
              {PERMISSIONS.filter((p) => p.category === cat && !taken.has(p.key)).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </Field>
      <Field id="override-effect" label="Effect" required error={err("effect")}>
        <NativeSelect {...register("effect")} {...fieldAria("override-effect", err("effect"))}>
          <option value="grant">Grant — add this permission</option>
          <option value="revoke">Revoke — take it away even if the role has it</option>
        </NativeSelect>
      </Field>
      {showScope && (
        <Field
          id="override-scope"
          label="Scope"
          error={err("scope")}
          description="Which records the permission covers."
        >
          <NativeSelect {...register("scope")} {...fieldAria("override-scope", err("scope"), true)}>
            {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field
        id="override-reason"
        label="Reason"
        required
        error={err("reason")}
        className={showScope ? undefined : "sm:col-span-2"}
      >
        <Input
          placeholder="e.g. Covering the office phones this month"
          className={TOUCH}
          {...register("reason")}
          {...fieldAria("override-reason", err("reason"))}
        />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" className={TOUCH} disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          Add override
        </Button>
      </div>
    </form>
  );
}
