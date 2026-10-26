import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shell/logo";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Brand login screen (SPEC §16: cream/forest). Invite-only (SPEC §4.3).
 * The buttons are wired to Supabase Auth in Phase 1.
 */
export default function LoginPage() {
  return (
    <main className="brand-surface flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo href={null} size="lg" />
          <p className="text-sm text-bb-ink/80">
            Eastside house painting that holds up to the rain.
          </p>
        </div>

        <div className="rounded-2xl border border-bb-border bg-white p-6 shadow-sm">
          <h1 className="font-display text-2xl text-bb-forest">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            For the Brushy Bear team. Ask an owner for an invite.
          </p>

          <div className="mt-6 flex flex-col gap-4">
            <Button variant="outline" size="lg" className="w-full" disabled>
              <GoogleMark />
              Continue with Google
            </Button>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>

            <form className="flex flex-col gap-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                disabled
              />
              <Button type="submit" variant="brand" size="lg" className="mt-2 w-full" disabled>
                <Mail aria-hidden />
                Email me a sign-in link
              </Button>
            </form>
          </div>

          <p className="mt-6 rounded-lg bg-bb-cream-light px-3 py-2 text-center text-xs text-bb-ink/80">
            Sign-in is switched on in Phase 1.
          </p>
        </div>
      </div>
    </main>
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
