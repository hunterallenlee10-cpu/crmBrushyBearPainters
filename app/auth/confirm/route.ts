import { NextResponse, type NextRequest } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loginRedirectPath } from "@/lib/auth/paths";

const TYPES: readonly EmailOtpType[] = ["email", "magiclink", "invite", "recovery", "email_change"];

/** Magic-link landing: verify the one-time token hash server-side and set the session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = loginRedirectPath(searchParams.get("next")) ?? "/";

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL("/login?error=link_expired", origin));
}
