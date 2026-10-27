import { NextResponse, type NextRequest } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loginRedirectPath } from "@/lib/auth/paths";

const TYPES: readonly EmailOtpType[] = ["email", "magiclink", "invite", "recovery", "email_change"];

/**
 * Magic-link landing. Two link shapes arrive here:
 * - our custom email template: `?token_hash=…&type=email` → verify the token server-side;
 * - Supabase's default template (hosted free plan can't change templates without custom
 *   SMTP): Supabase verifies the link itself, then redirects with `?code=…` → exchange it
 *   (the PKCE verifier cookie was set when the link was requested).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = loginRedirectPath(searchParams.get("next")) ?? "/";

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  } else if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL("/login?error=link_expired", origin));
}
