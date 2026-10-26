"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/db/browser";

type Phase =
  | { kind: "loading" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "challenge"; factorId: string }
  | { kind: "error"; message: string };

/**
 * TOTP enrollment (first time) or challenge (every sign-in) for roles that
 * require MFA (SPEC §4.3: Owner and Bookkeeper).
 */
export function MfaPanel() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        if (!cancelled)
          setPhase({
            kind: "error",
            message: "Couldn't load your sign-in settings. Refresh to try again.",
          });
        return;
      }
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) {
        if (!cancelled) setPhase({ kind: "challenge", factorId: verified.id });
        return;
      }
      // Clear abandoned enrollments so a fresh QR code can be issued.
      for (const f of data.all) {
        if (f.factor_type === "totp" && f.status === "unverified")
          await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (cancelled) return;
      if (enrollError || !enrolled) {
        setPhase({
          kind: "error",
          message: "Couldn't start two-step setup. Refresh to try again.",
        });
        return;
      }
      setPhase({
        kind: "enroll",
        factorId: enrolled.id,
        qr: enrolled.totp.qr_code,
        secret: enrolled.totp.secret,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (phase.kind !== "enroll" && phase.kind !== "challenge") return;
    setSubmitting(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: phase.factorId,
      code: code.replace(/\s/g, ""),
    });
    if (verifyError) {
      setSubmitting(false);
      setError("That code didn't work. Codes change every 30 seconds — try the current one.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  if (phase.kind === "loading") {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
      </div>
    );
  }
  if (phase.kind === "error") {
    return (
      <p role="alert" className="mt-4 text-sm text-danger">
        {phase.message}
      </p>
    );
  }

  return (
    <form onSubmit={verify} className="mt-4 flex flex-col gap-4">
      {phase.kind === "enroll" ? (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-bb-ink/80">
            <li>Open an authenticator app (Google Authenticator, 1Password, Authy…).</li>
            <li>Scan this code, or type the setup key.</li>
            <li>Enter the 6-digit code it shows.</li>
          </ol>
          <div className="flex justify-center rounded-xl border bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL from Supabase */}
            <img src={phase.qr} alt="QR code for your authenticator app" width={176} height={176} />
          </div>
          <div className="text-center text-xs text-muted-foreground">
            Setup key:{" "}
            <code
              data-testid="totp-secret"
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-bb-ink select-all"
            >
              {phase.secret}
            </code>
          </div>
        </>
      ) : (
        <p className="text-sm text-bb-ink/80">
          Enter the 6-digit code from your authenticator app.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">6-digit code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "code-error" : undefined}
          className="text-center font-mono text-lg tracking-[0.3em]"
        />
        {error && (
          <p id="code-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <Button
        type="submit"
        variant="brand"
        size="lg"
        disabled={submitting || code.replace(/\s/g, "").length !== 6}
      >
        {submitting ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <ShieldCheck aria-hidden />
        )}
        {phase.kind === "enroll" ? "Turn on two-step sign-in" : "Verify"}
      </Button>
    </form>
  );
}
