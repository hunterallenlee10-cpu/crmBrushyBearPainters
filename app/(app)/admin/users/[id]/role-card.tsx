"use client";

import * as React from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { changeUserRole } from "../actions";
import { Card, NativeSelect, TOUCH } from "../_components/form-bits";

export function RoleCard({
  userId,
  currentRoleId,
  currentIsOwner,
  viewerIsOwner,
  roles,
}: {
  userId: string;
  currentRoleId: string;
  currentIsOwner: boolean;
  viewerIsOwner: boolean;
  roles: { id: string; name: string; grantsAll: boolean }[];
}) {
  const [value, setValue] = React.useState(currentRoleId);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Only owners see (and can assign) the Owner template; the database enforces it too.
  const options = roles.filter((r) => viewerIsOwner || !r.grantsAll || r.id === currentRoleId);
  const locked = currentIsOwner && !viewerIsOwner;

  async function save() {
    setSaving(true);
    setError(null);
    const result = await changeUserRole({ user_id: userId, role_template_id: value });
    setSaving(false);
    if (result.ok) {
      toast.success("Role updated. Their permissions change on their next page load.");
      return;
    }
    setError(result.error.message);
    toast.error(result.error.message);
  }

  return (
    <Card
      title="Role"
      headingId="role-card"
      description="The role template decides what this person can see and do. Fine-tune with per-user overrides below."
    >
      {locked ? (
        <p className="text-sm text-muted-foreground">
          Only an owner can change an owner&apos;s role.
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field
            id="role_template_id"
            label="Role template"
            error={error ?? undefined}
            className="sm:w-80"
          >
            <NativeSelect
              id="role_template_id"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "role_template_id-error" : undefined}
            >
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            type="button"
            className={TOUCH}
            onClick={save}
            disabled={saving || value === currentRoleId}
          >
            {saving ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <ShieldCheck aria-hidden />
            )}
            Change role
          </Button>
        </div>
      )}
    </Card>
  );
}
