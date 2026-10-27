import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { serverEnv } from "@/lib/env";
import {
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
import { recordInbound } from "@/lib/messaging/inbound";
import { inboundMessageSchema } from "@/lib/validation/messaging";

/**
 * Inbound SMS / email stub (SPEC §13.2 "honor STOP/UNSUBSCRIBE (inbound
 * keyword handler stub)"). Nothing calls it in this build: when an SMS or
 * email provider is connected, its webhook adapter signs the normalized
 * message with INBOUND_MESSAGES_SECRET the same way the website signs leads
 * (`X-BB-Signature: t=<unix>,v1=<HMAC-SHA256("<t>.<raw body>")>`).
 * Idempotent on provider_message_id. Answers ids only, no personal data.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = { limit: 300, windowSeconds: 60 } as const;

export async function POST(req: NextRequest) {
  const env = serverEnv();
  const secret = env.INBOUND_MESSAGES_SECRET;
  if (!secret) return jsonError(503, "Inbound messages are not configured.");
  try {
    const db = await createSupabaseServiceClient();
    if (await rateLimited(db, `inbound:remote:${remoteIp(req)}`, LIMIT)) {
      return tooMany(LIMIT.windowSeconds);
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
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return jsonError(400, "Body must be JSON.");
    }
    const parsed = inboundMessageSchema.safeParse(json);
    if (!parsed.success) return jsonError(400, "Invalid message.");
    const orgId = await intakeOrgId(db, env.LEAD_INTAKE_ORG_SLUG);
    if (!orgId) return jsonError(503, "Inbound messages are not configured.");
    const r = await recordInbound(db, orgId, parsed.data);
    return jsonOk({
      ok: true,
      matched: r.matched,
      messageId: r.messageId,
      keyword: r.keyword,
      duplicate: r.duplicate,
    });
  } catch (e) {
    logError("api.inbound", e);
    return jsonError(500, "Something went wrong.");
  }
}
