import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { isSupabaseConfigured } from "@/lib/env";

/** POST-only sign out (a GET link could be triggered by prefetching or a malicious image). */
export async function POST(request: NextRequest) {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
}
