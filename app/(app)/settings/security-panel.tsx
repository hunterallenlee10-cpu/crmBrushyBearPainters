"use client";

import * as React from "react";
import { KeyRound, Loader2, LogOut, ShieldCheck, ShieldPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type Factor } from "@supabase/supabase-js";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/db/browser";
import { canRemoveFactor } from "@/lib/validation/users";
import { TOUCH } from "../admin/users/_components/form-bits";

type Factors = { kind: "loading" } | { kind: "error" } | { kind: "ready"; all: Factor[] };
type Enroll = { factorId: string; qr: string; secret: string } | null;

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/**
 * Two-step sign-in factors and sessions (SPEC §4.3, §8.18). Runs in the browser
 * against Supabase Auth; the database still requires AAL2 for MFA roles.
 * Setup happens inline because /mfa only serves the sign-in gate.
 */
export function SecurityPanel({
  requiresMfa,
  readOnly,
}: {
  requiresMfa: boolean;
  readOnly: boolean;
}) {
  const [factors, setFactors] = React.useState<Factors>({ kind: "loading" });
  const [enroll, setEnroll] = React.useState<Enroll>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { data, error } = await createSupabaseBrowserClient().auth.mfa.listFactors();
    setFactors(error ? { kind: "error" } : { kind: "ready", all: data.all });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const all = factors.kind === "ready" ? factors.all : [];
  const verifiedCount = all.filter((f) => f.status === "verified").length;

  async function startEnroll() {
    setBusy("enroll");
    const supabase = createSupabaseBrowserClient();
    // Clear abandoned setups so a fresh code can be issued.
    for (const f of all) {
      if (f.factor_type === "totp" && f.status === "unverified")
        await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    });
    setBusy(null);
    if (error || !data) {
      toast.error("Couldn't start two-step setup. Refresh and try again.");
      return;
    }
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function remove(f: Factor) {
    setBusy(f.id);
    const { error } = await createSupabaseBrowserClient().auth.mfa.unenroll({ factorId: f.id });
    setBusy(null);
    if (error) {
      toast.error(
        /aal2|assurance/i.test(error.message)
          ? "Sign in again with your 6-digit code, then remove it."
          : "Couldn't remove it. Try again.",
      );
      return;
    }
    toast.success("Authenticator removed.");
    await load();
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border bg-card p-5" aria-labelledby="mfa-heading">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="mfa-heading" className="text-base font-semibold">
              Two-step sign-in
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {requiresMfa
                ? "Your role can see money and settings, so it requires a 6-digit code from an authenticator app."
                : "Optional for your role. Adds a 6-digit code from an authenticator app when you sign in."}
            </p>
          </div>
          {factors.kind === "ready" && !enroll && !readOnly && (
            <Button
              variant={verifiedCount === 0 ? "cta" : "outline"}
              className={TOUCH}
              onClick={startEnroll}
              disabled={busy !== null}
            >
              {busy === "enroll" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <ShieldPlus aria-hidden />
              )}
              {verifiedCount === 0 ? "Set up two-step sign-in" : "Add another authenticator"}
            </Button>
          )}
        </div>

        {factors.kind === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading your sign-in methods…
          </p>
        )}
        {factors.kind === "error" && (
          <p className="text-sm text-danger" role="alert">
            Couldn&apos;t load your sign-in methods. Refresh to try again.
          </p>
        )}
        {factors.kind === "ready" && all.length === 0 && !enroll && (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No authenticator yet. Set one up to protect your account.
          </p>
        )}
        {factors.kind === "ready" && all.length > 0 && (
          <ul className="flex flex-col divide-y rounded-xl border" aria-label="Authenticators">
            {all.map((f) => {
              const removable = canRemoveFactor({
                requiresMfa,
                factorVerified: f.status === "verified",
                verifiedCount,
              });
              return (
                <li
                  key={f.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {f.friendly_name || "Authenticator app"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {f.factor_type.toUpperCase()} · added {fmt(f.created_at)}
                      </p>
                    </div>
                    {f.status === "verified" ? (
                      <Badge variant="success">Verified</Badge>
                    ) : (
                      <Badge variant="warning">Unfinished</Badge>
                    )}
                  </div>
                  {!readOnly &&
                    (removable ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 sm:h-8"
                        onClick={() => remove(f)}
                        disabled={busy !== null}
                        aria-label={`Remove ${f.friendly_name || "authenticator"}`}
                      >
                        {busy === f.id ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : (
                          <Trash2 aria-hidden />
                        )}
                        Remove
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground sm:max-w-56 sm:text-right">
                        Your role requires two-step sign-in. Add another authenticator before
                        removing this one.
                      </p>
                    ))}
                </li>
              );
            })}
          </ul>
        )}

        {enroll && (
          <EnrollForm
            enroll={enroll}
            onCancel={async () => {
              await createSupabaseBrowserClient().auth.mfa.unenroll({
                factorId: enroll.factorId,
              });
              setEnroll(null);
              await load();
            }}
            onDone={async () => {
              setEnroll(null);
              toast.success("Two-step sign-in is on.");
              await load();
            }}
          />
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="sessions-heading">
        <h2 id="sessions-heading" className="text-base font-semibold">
          Sessions
        </h2>
        <p className="mt-0.5 mb-4 text-sm text-muted-foreground">
          Lost a phone or used a shared computer? Sign out everywhere, including this device.
        </p>
        <SignOutEverywhere disabled={readOnly} />
      </section>
    </div>
  );
}

function EnrollForm({
  enroll,
  onCancel,
  onDone,
}: {
  enroll: NonNullable<Enroll>;
  onCancel: () => Promise<void>;
  onDone: () => Promise<void>;
}) {
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const clean = code.replace(/\s/g, "");

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: verifyError } = await createSupabaseBrowserClient().auth.mfa.challengeAndVerify({
      factorId: enroll.factorId,
      code: clean,
    });
    setSubmitting(false);
    if (verifyError) {
      setError("That code didn't work. Codes change every 30 seconds — try the current one.");
      return;
    }
    await onDone();
  }

  return (
    <form onSubmit={verify} className="mt-4 grid gap-4 rounded-xl bg-muted/40 p-4 sm:grid-cols-2">
      <div className="flex flex-col gap-3">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Open an authenticator app (Google Authenticator, 1Password, Authy…).</li>
          <li>Scan this code, or type the setup key.</li>
          <li>Enter the 6-digit code it shows.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Setup key:{" "}
          <code
            data-testid="settings-totp-secret"
            className="rounded bg-card px-1.5 py-0.5 font-mono break-all text-bb-ink select-all"
          >
            {enroll.secret}
          </code>
        </p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-xl border bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL from Supabase */}
          <img src={enroll.qr} alt="QR code for your authenticator app" width={160} height={160} />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="settings-mfa-code">6-digit code</Label>
        <Input
          id="settings-mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "settings-mfa-code-error" : undefined}
          className={`${TOUCH} max-w-48 font-mono tracking-[0.3em]`}
        />
        {error && (
          <p id="settings-mfa-code-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className={TOUCH} onClick={() => void onCancel()}>
          Cancel
        </Button>
        <Button type="submit" className={TOUCH} disabled={submitting || clean.length !== 6}>
          {submitting ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <ShieldCheck aria-hidden />
          )}
          Turn on two-step sign-in
        </Button>
      </div>
    </form>
  );
}

function SignOutEverywhere({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = React.useState(false);

  async function signOut() {
    setBusy(true);
    const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: "global" });
    if (error) {
      setBusy(false);
      toast.error("Couldn't sign out everywhere. Try again.");
      return;
    }
    window.location.assign("/login");
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className={TOUCH} disabled={disabled}>
          <LogOut aria-hidden /> Sign out of all devices
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out of all devices?</AlertDialogTitle>
          <AlertDialogDescription>
            Every browser and phone signed in as you is signed out, including this one. You&apos;ll
            sign in again with your email and, if you use two-step sign-in, your 6-digit code.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={TOUCH}>Cancel</AlertDialogCancel>
          <Button variant="destructive" className={TOUCH} onClick={signOut} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
            Sign out everywhere
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
