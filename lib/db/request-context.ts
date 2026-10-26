import "server-only";
import { headers } from "next/headers";

/**
 * Headers our server forwards to Supabase so the audit trigger can record who
 * did what from where (SPEC §5: ip, user_agent). PostgREST exposes request
 * headers to Postgres as `request.headers`.
 */
export async function auditHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  let h: Headers | null = null;
  try {
    h = await headers();
  } catch {
    // Outside a request (scripts, tests).
  }
  const ip = h?.get("x-forwarded-for")?.split(",")[0]?.trim() || h?.get("x-real-ip") || "";
  const ua = h?.get("user-agent") ?? "";
  const requestId = h?.get("x-vercel-id") || h?.get("x-request-id") || crypto.randomUUID();
  const out: Record<string, string> = { "x-bb-request-id": requestId.slice(0, 120), ...extra };
  if (ip) out["x-bb-client-ip"] = ip.slice(0, 64);
  if (ua) out["x-bb-user-agent"] = ua.slice(0, 400);
  return out;
}
