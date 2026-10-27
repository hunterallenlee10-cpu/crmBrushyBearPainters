import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isPublicPath, loginRedirectPath } from "@/lib/auth/paths";
import { buildCsp, makeNonce, wantsPageCsp } from "@/lib/security/csp";
import { SESSION_COOKIE_OPTIONS } from "@/lib/db/cookie-options";

/**
 * Refreshes the Supabase session on every request and sends signed-out
 * visitors to /login. Permission and MFA checks happen in the app layout and
 * in Postgres; this only decides "signed in or not".
 *
 * Also sets the nonce-based Content-Security-Policy on every page (SPEC §13.1):
 * Next.js reads the nonce from the request's CSP header and puts it on its own
 * scripts, so nothing else can run.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const csp = wantsPageCsp(pathname)
    ? buildCsp({
        nonce: makeNonce(),
        supabaseUrl: url,
        dev: process.env.NODE_ENV === "development",
      })
    : null;
  const requestHeaders = new Headers(request.headers);
  if (csp) {
    requestHeaders.set("content-security-policy", csp);
    requestHeaders.set("x-nonce", /'nonce-([^']+)'/.exec(csp)?.[1] ?? "");
  }
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  const withCsp = <R extends NextResponse>(res: R): R => {
    if (csp) res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  if (!url || !anonKey) return withCsp(next());

  let response = next();
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        // Rebuild the forwarded headers so the refreshed cookies reach the page.
        requestHeaders.set(
          "cookie",
          request.cookies
            .getAll()
            .map((c) => `${c.name}=${c.value}`)
            .join("; "),
        );
        response = next();
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run code between createServerClient and getUser (session refresh).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    const nextPath = loginRedirectPath(pathname + search);
    if (nextPath) target.searchParams.set("next", nextPath);
    return withCsp(NextResponse.redirect(target));
  }
  if (user && pathname === "/login") {
    const target = request.nextUrl.clone();
    target.pathname = "/";
    target.search = "";
    return withCsp(NextResponse.redirect(target));
  }
  return withCsp(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
