/** Routes reachable without signing in. Everything else requires a session. */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth/",
  "/api/health",
  "/api/public/",
  // The worker checks its own CRON_SECRET (Vercel Cron can't sign in).
  "/api/cron/",
  "/p/",
  "/dev/ui",
  "/setup-required",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Sanitizes a post-login redirect: only same-site relative paths, never
 * protocol-relative URLs or auth routes (prevents open redirects).
 */
export function loginRedirectPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\"))
    return null;
  if (next === "/" || next.startsWith("/login") || next.startsWith("/auth/")) return null;
  if (next.length > 500) return null;
  return next;
}
