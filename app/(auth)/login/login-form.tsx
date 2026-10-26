"use client";

import { useActionState, useState } from "react";
import { CircleCheck, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/db/browser";
import { requestMagicLink, type MagicLinkState } from "./actions";

const ERRORS: Record<string, string> = {
  link_expired: "That sign-in link has expired or was already used. Request a new one.",
  oauth_failed: "Google sign-in didn't finish. Try again, or use an email link.",
  no_account: "That account isn't set up for Brushy Bear CRM. Ask an owner for an invite.",
};

export function LoginForm({ next, error }: { next: string | null; error: string | null }) {
  const [state, formAction, pending] = useActionState<MagicLinkState, FormData>(requestMagicLink, {
    status: "idle",
  });
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googlePending, setGooglePending] = useState(false);

  async function signInWithGoogle() {
    setGoogleError(null);
    setGooglePending(true);
    const supabase = createSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthError) {
      setGooglePending(false);
      setGoogleError(
        /not enabled|unsupported provider/i.test(oauthError.message)
          ? "Google sign-in isn't set up yet. Use an email link for now."
          : "Google sign-in didn't start. Try again, or use an email link.",
      );
    }
  }

  const banner = error ? (ERRORS[error] ?? null) : null;

  if (state.status === "sent") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-4 text-center">
        <CircleCheck className="size-10 text-success" aria-hidden />
        <p className="font-semibold">Check your email</p>
        <p className="text-sm text-muted-foreground">{state.message}</p>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {banner && (
        <p
          role="alert"
          className="rounded-lg border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger"
        >
          {banner}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={signInWithGoogle}
        disabled={googlePending}
      >
        {googlePending ? <Loader2 className="animate-spin" aria-hidden /> : <GoogleMark />}
        Continue with Google
      </Button>
      {googleError && (
        <p role="alert" className="text-sm text-danger">
          {googleError}
        </p>
      )}

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={formAction} className="flex flex-col gap-2" noValidate>
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          required
          aria-invalid={state.status === "error"}
          aria-describedby={state.status === "error" ? "email-error" : undefined}
        />
        {next && <input type="hidden" name="next" value={next} />}
        {state.status === "error" && (
          <p id="email-error" role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}
        <Button type="submit" variant="brand" size="lg" className="mt-2 w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />}
          Email me a sign-in link
        </Button>
      </form>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6a5.1 5.1 0 0 1-2.2 3.3v2.8h3.6c2-1.9 3.2-4.7 3.2-8.2Z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.9A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.7 14c-.2-.7-.4-1.3-.4-2s.1-1.4.4-2V7.1H2a11 11 0 0 0 0 9.8L5.7 14Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2 7.1L5.7 10c.9-2.7 3.4-4.6 6.3-4.6Z"
      />
    </svg>
  );
}
