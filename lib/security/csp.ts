/**
 * Content-Security-Policy (SPEC §13.1). Nonce-based for scripts: only the
 * framework's own scripts (carrying the per-request nonce) and the scripts
 * they load run ('strict-dynamic'); no inline event handlers or injected
 * scripts. Styles allow inline (React style attributes, chart and toast
 * libraries). Connections only to this app and the Supabase project. Pure;
 * middleware builds the header for every page.
 */

export type CspOptions = {
  nonce: string;
  /** The Supabase project URL (REST, Storage signed URLs, Realtime). */
  supabaseUrl?: string | null;
  /** Next dev server needs eval for fast refresh. */
  dev?: boolean;
};

function origin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp({ nonce, supabaseUrl, dev = false }: CspOptions): string {
  const supabase = origin(supabaseUrl);
  const ws = supabase ? supabase.replace(/^http/, "ws") : null;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(supabase ? [supabase] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(supabase ? [supabase] : []),
      ...(ws ? [ws] : []),
      ...(dev ? ["ws:"] : []),
    ],
    "media-src": ["'self'", "blob:", ...(supabase ? [supabase] : [])],
    "frame-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  // Only when the site runs on HTTPS (production); a local production build
  // talks to Supabase over http://127.0.0.1 and must not be upgraded.
  if (!dev && supabase?.startsWith("https://")) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** A random nonce (base64 of 16 random bytes) using Web Crypto (Edge-safe). */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Paths that get the page CSP (documents), not API or file responses. */
export function wantsPageCsp(pathname: string): boolean {
  return !pathname.startsWith("/api/") && !pathname.startsWith("/_next/");
}
