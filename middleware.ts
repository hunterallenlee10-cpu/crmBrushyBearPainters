import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isPublicPath, loginRedirectPath } from "@/lib/auth/paths";

/**
 * Refreshes the Supabase session on every request and sends signed-out
 * visitors to /login. Permission and MFA checks happen in the app layout and
 * in Postgres; this only decides "signed in or not".
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run code between createServerClient and getUser (session refresh).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  if (!user && !isPublicPath(pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    const next = loginRedirectPath(pathname + search);
    if (next) target.searchParams.set("next", next);
    return NextResponse.redirect(target);
  }
  if (user && pathname === "/login") {
    const target = request.nextUrl.clone();
    target.pathname = "/";
    target.search = "";
    return NextResponse.redirect(target);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
