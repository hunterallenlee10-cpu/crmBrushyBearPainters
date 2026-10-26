"use client";

import * as React from "react";
import { CheckCircle2, Loader2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { type OpenWorkItem } from "@/lib/validation/users";
import { getOpenWork, setUserActive } from "../actions";
import { Card, NativeSelect, TOUCH } from "../_components/form-bits";

type OpenWork =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: OpenWorkItem[] };

export function StatusCard({
  userId,
  name,
  active,
  reassignTo,
}: {
  userId: string;
  name: string;
  active: boolean;
  reassignTo: { id: string; name: string }[];
}) {
  return (
    <Card
      title="Access"
      headingId="access"
      description={
        active
          ? "Deactivating signs them out everywhere and blocks sign-in. Their records and history stay."
          : "This person can't sign in. Reactivate to restore access with the same role."
      }
    >
      {active ? (
        <DeactivateDialog userId={userId} name={name} reassignTo={reassignTo} />
      ) : (
        <ReactivateDialog userId={userId} name={name} />
      )}
    </Card>
  );
}

function DeactivateDialog({
  userId,
  name,
  reassignTo,
}: {
  userId: string;
  name: string;
  reassignTo: { id: string; name: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [work, setWork] = React.useState<OpenWork>({ kind: "loading" });
  const [targets, setTargets] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setWork({ kind: "loading" });
    setError(null);
    const result = await getOpenWork({ user_id: userId });
    setWork(
      result.ok
        ? { kind: "ready", items: result.data.items }
        : { kind: "error", message: result.error.message },
    );
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    const result = await setUserActive({ user_id: userId, active: false });
    setSaving(false);
    if (result.ok) {
      toast.success(`${name} is deactivated and can no longer sign in.`);
      setOpen(false);
      return;
    }
    setError(result.error.message);
  }

  // Reassignment runs per module once modules own open work (Phase 2+). Until a
  // reassign RPC exists, open work blocks deactivation rather than being orphaned.
  const hasWork = work.kind === "ready" && work.items.length > 0;
  const ready = work.kind === "ready" && !hasWork;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className={TOUCH}>
          <UserX aria-hidden /> Deactivate user
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They&apos;ll be signed out and blocked from signing in. Their records, notes and history
            stay. You can reactivate them later.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <section aria-labelledby="open-work-heading" className="rounded-xl border p-3">
          <h3 id="open-work-heading" className="text-sm font-semibold">
            Open work to reassign
          </h3>
          {work.kind === "loading" && (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Checking their open work…
            </p>
          )}
          {work.kind === "error" && (
            <p className="mt-2 text-sm text-danger" role="alert">
              {work.message}
            </p>
          )}
          {work.kind === "ready" && work.items.length === 0 && (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" aria-hidden /> Nothing to reassign yet.
            </p>
          )}
          {hasWork && (
            <ul className="mt-2 flex flex-col gap-2">
              {work.items.map((item) => (
                <li key={item.key} className="flex flex-col gap-1 sm:flex-row sm:items-center">
                  <span className="text-sm sm:w-48">
                    {item.label}: <strong className="tabular-nums">{item.count}</strong>
                  </span>
                  <NativeSelect
                    aria-label={`Reassign ${item.label.toLowerCase()} to`}
                    value={targets[item.key] ?? ""}
                    onChange={(e) => setTargets((t) => ({ ...t, [item.key]: e.target.value }))}
                  >
                    <option value="">Reassign to…</option>
                    {reassignTo.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </li>
              ))}
              <li className="text-xs text-muted-foreground">
                Moving open work arrives with the modules that own it. Until then, reassign it from
                each record before deactivating.
              </li>
            </ul>
          )}
        </section>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel className={TOUCH}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            className={TOUCH}
            onClick={confirm}
            disabled={!ready || saving}
          >
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <UserX aria-hidden />}
            Deactivate
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReactivateDialog({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setError(null);
    const result = await setUserActive({ user_id: userId, active: true });
    setSaving(false);
    if (result.ok) {
      toast.success(`${name} can sign in again.`);
      setOpen(false);
      return;
    }
    setError(result.error.message);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button className={TOUCH}>
          <UserCheck aria-hidden /> Reactivate user
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reactivate {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They can sign in again with the same email and role. Check their role and overrides
            first if their job has changed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className={TOUCH}>Cancel</AlertDialogCancel>
          <Button className={TOUCH} onClick={confirm} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <UserCheck aria-hidden />}
            Reactivate
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
