import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { SIGNATURE_HEADER, verifySignature } from "@/lib/intake/signature";

/**
 * Shared plumbing for the public intake routes: signature check, rate limits,
 * org lookup and plain JSON answers. Responses never include personal data.
 */

export const MAX_BODY_BYTES = 64 * 1024;

/** Per sending server (the website's backend): generous, stops floods. */
export const REMOTE_LIMIT = { limit: 120, windowSeconds: 60 } as const;
/** Per visitor (client_ip in the signed body): stops form spam. */
export const VISITOR_LIMIT = { limit: 5, windowSeconds: 600 } as const;
export const VISITOR_UPLOAD_LIMIT = { limit: 30, windowSeconds: 600 } as const;

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { ok: false, error, ...extra },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function jsonOk(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** The connecting address (Vercel sets x-forwarded-for / x-real-ip). */
export function remoteIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

export async function rateLimited(
  db: SupabaseClient<Database>,
  bucket: string,
  rule: { limit: number; windowSeconds: number },
): Promise<boolean> {
  const { data, error } = await db.rpc("consume_rate_limit", {
    p_bucket: bucket,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) throw error;
  return data === false;
}

export function tooMany(retryAfterSeconds: number) {
  const res = jsonError(429, "Too many requests. Please try again in a few minutes.");
  res.headers.set("retry-after", String(retryAfterSeconds));
  return res;
}

/** Reads the raw body (needed for the signature) with a size cap. */
export async function readBody(req: NextRequest): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  const raw = await req.text();
  return Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES ? null : raw;
}

export function checkSignature(req: NextRequest, raw: string, secret: string) {
  return verifySignature(req.headers.get(SIGNATURE_HEADER), raw, secret);
}

let orgCache: { slug: string; id: string; at: number } | null = null;

export async function intakeOrgId(
  db: SupabaseClient<Database>,
  slug: string,
): Promise<string | null> {
  if (orgCache && orgCache.slug === slug && Date.now() - orgCache.at < 300_000) return orgCache.id;
  const { data, error } = await db
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  orgCache = { slug, id: data.id, at: Date.now() };
  return data.id;
}

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;
