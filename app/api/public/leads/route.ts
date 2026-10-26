import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { websiteLeadSchema } from "@/lib/validation/intake";
import { bodyHash } from "@/lib/intake/signature";
import { processWebsiteLead } from "@/lib/intake/process";
import {
  IDEMPOTENCY_KEY_RE,
  REMOTE_LIMIT,
  VISITOR_LIMIT,
  checkSignature,
  intakeOrgId,
  jsonError,
  jsonOk,
  rateLimited,
  readBody,
  remoteIp,
  tooMany,
} from "@/lib/intake/http";
import { logError } from "@/lib/log";

/**
 * Website lead intake (SPEC §14). Contract: docs/WEBSITE_INTEGRATION.md.
 * Signed with X-BB-Signature, rate limited, idempotent, honeypot-aware,
 * deduped within 180 days. Answers { ok: true, leadId } and nothing else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const env = serverEnv();
  const secret = env.LEAD_INTAKE_HMAC_SECRET;
  if (!secret) return jsonError(503, "Lead intake is not configured.");

  try {
    const db = await createSupabaseServiceClient();

    if (await rateLimited(db, `intake:remote:${remoteIp(req)}`, REMOTE_LIMIT)) {
      return tooMany(REMOTE_LIMIT.windowSeconds);
    }

    const raw = await readBody(req);
    if (raw === null) return jsonError(413, "Request is too large.");

    const sig = checkSignature(req, raw, secret);
    if (!sig.ok) {
      return jsonError(
        401,
        sig.reason === "expired" ? "Signature has expired." : "Invalid signature.",
      );
    }

    const idempotencyKey = req.headers.get("idempotency-key");
    if (idempotencyKey !== null && !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      return jsonError(
        400,
        "Idempotency-Key must be 8–200 letters, digits, dots, dashes, colons or underscores.",
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return jsonError(400, "Body must be JSON.");
    }
    const parsed = websiteLeadSchema.safeParse(json);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return jsonError(422, "Some fields need a fix.", { fieldErrors });
    }

    if (
      parsed.data.client_ip &&
      (await rateLimited(db, `intake:visitor:${parsed.data.client_ip}`, VISITOR_LIMIT))
    ) {
      return tooMany(VISITOR_LIMIT.windowSeconds);
    }

    const orgId = await intakeOrgId(db, env.LEAD_INTAKE_ORG_SLUG);
    if (!orgId) return jsonError(503, "Lead intake is not configured.");

    const result = await processWebsiteLead(db, parsed.data, {
      orgId,
      idempotencyKey,
      requestHash: bodyHash(raw),
    });

    switch (result.kind) {
      case "created":
        return jsonOk({ leadId: result.leadId }, 201);
      case "duplicate":
      case "replay":
        return jsonOk({ leadId: result.leadId });
      case "ignored":
        return jsonOk({});
      case "invalid":
        return jsonError(422, result.message, { fieldErrors: result.fieldErrors });
      case "conflict":
        return jsonError(409, result.message);
    }
  } catch (error) {
    logError("public.leads", error);
    return jsonError(500, "Something went wrong. Please try again.");
  }
}
