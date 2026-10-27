"use client";

import * as React from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/db/browser";

const MIN = 10;

/** Set or change your own sign-in password (Supabase Auth, in the browser). */
export function ChangePassword({ readOnly }: { readOnly: boolean }) {
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN) return setError(`Use at least ${MIN} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    const { error: err } = await createSupabaseBrowserClient().auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(
        /reauth|recent/i.test(err.message)
          ? "Sign out and back in, then try again."
          : "Couldn't change the password. Try a different one.",
      );
      return;
    }
    setPassword("");
    setConfirm("");
    toast.success("Password changed.");
  }

  return (
    <section aria-labelledby="pw-heading" className="rounded-2xl border bg-card p-5">
      <h2 id="pw-heading" className="flex items-center gap-2 font-semibold">
        <KeyRound className="size-4" aria-hidden /> Password
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign in with your email and this password, or with an email link. Two-step sign-in still
        applies.
      </p>
      <form onSubmit={save} className="mt-4 grid max-w-sm gap-2" noValidate>
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={readOnly}
        />
        <Label htmlFor="confirm-password" className="mt-2">
          Confirm new password
        </Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={readOnly}
          aria-invalid={!!error}
          aria-describedby={error ? "pw-error" : undefined}
        />
        {error && (
          <p id="pw-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="mt-2 w-fit" disabled={readOnly || busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Change password
        </Button>
      </form>
    </section>
  );
}
