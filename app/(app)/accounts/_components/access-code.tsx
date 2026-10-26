"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { removeAccessCode, revealAccessCode, setAccessCode } from "../actions";

/**
 * Gate / lockbox code on a property. The code is never in the page: "Show
 * code" asks the server, which reads the encrypted row as this user (RLS) and
 * decrypts it. Viewing, setting and removing are recorded on the timeline.
 */
export function AccessCodeControl({
  propertyId,
  hasCode,
  canEdit,
  keyMissing,
}: {
  propertyId: string;
  hasCode: boolean;
  canEdit: boolean;
  keyMissing: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const inputId = `access-code-${propertyId.slice(0, 8)}`;

  React.useEffect(() => setCode(null), [hasCode]);

  if (keyMissing) {
    return (
      <p className="text-xs text-warning">
        Gate codes can&apos;t be saved until FIELD_ENCRYPTION_KEY is set.
      </p>
    );
  }

  async function show() {
    setBusy(true);
    const result = await revealAccessCode({ property_id: propertyId });
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    setCode(result.data.code);
    // The view is logged on the timeline; refresh so it shows.
    router.refresh();
  }

  async function save() {
    if (!draft.trim()) return setError("Enter the code.");
    setBusy(true);
    const result = await setAccessCode({ property_id: propertyId, code: draft });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setEditing(false);
    setDraft("");
    setError(null);
    setCode(null);
    toast.success("Code saved (encrypted).");
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const result = await removeAccessCode({ property_id: propertyId });
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    setCode(null);
    toast.success("Code removed.");
    router.refresh();
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-xs font-medium">
          Gate / lockbox code
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={inputId}
            value={draft}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
            className="h-9 w-44"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
          />
          <Button size="sm" onClick={save} disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Save code
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setDraft("");
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {error && (
          <p id={`${inputId}-error`} role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <KeyRound className="size-4 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">Gate / lockbox code:</span>
      {hasCode ? (
        <>
          <span className="font-mono tabular-nums" data-testid="access-code-value">
            {code ?? "••••••"}
          </span>
          {code === null ? (
            <Button size="xs" variant="outline" onClick={show} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Eye aria-hidden />}
              Show code
            </Button>
          ) : (
            <Button size="xs" variant="outline" onClick={() => setCode(null)}>
              <EyeOff aria-hidden />
              Hide code
            </Button>
          )}
          {canEdit && (
            <>
              <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
                Replace
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-danger"
                onClick={remove}
                disabled={busy}
              >
                Remove
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <span className="text-muted-foreground">none saved</span>
          {canEdit && (
            <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
              Set code
            </Button>
          )}
        </>
      )}
    </div>
  );
}
