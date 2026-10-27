/**
 * Safety check for `pnpm seed:demo` (SPEC §15.2). Demo data never goes into
 * production by accident: the script runs only when DEMO_DATA=true AND the
 * Supabase URL is a local stack, unless the operator passes the explicit
 * `--i-know-this-is-not-production` flag (a staging project, for example).
 * Pure so it can be tested.
 */

export const NOT_PRODUCTION_FLAG = "--i-know-this-is-not-production";

export type DemoGuardResult = { ok: true; local: boolean } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "host.docker.internal",
]);

export function isLocalSupabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "that project";
  }
}

export function demoGuard(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): DemoGuardResult {
  if (env.DEMO_DATA !== "true") {
    return {
      ok: false,
      reason: "Refusing to load demo data: set DEMO_DATA=true to confirm you want demo records.",
    };
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_URL is not set." };
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, reason: "SUPABASE_SERVICE_ROLE_KEY is not set." };
  }
  const local = isLocalSupabaseUrl(url);
  if (!local && !argv.includes(NOT_PRODUCTION_FLAG)) {
    return {
      ok: false,
      reason: `Refusing to load demo data into ${hostOf(url)}: it isn't a local Supabase stack. If this really is a non-production project, pass ${NOT_PRODUCTION_FLAG}.`,
    };
  }
  return { ok: true, local };
}
