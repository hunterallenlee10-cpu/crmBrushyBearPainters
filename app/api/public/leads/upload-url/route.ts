import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { safeFileName, uploadUrlSchema } from "@/lib/validation/intake";
import { LEAD_PHOTO_BUCKET } from "@/lib/intake/process";
import {
  REMOTE_LIMIT,
  VISITOR_UPLOAD_LIMIT,
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
 * Step 1 of the photo flow (SPEC §14): returns a one-time signed upload URL in
 * the private lead-photos bucket. The website uploads the file there, then
 * lists the returned `path` in the lead payload's `photos`.
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
    if (!sig.ok) return jsonError(401, "Invalid signature.");

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return jsonError(400, "Body must be JSON.");
    }
    const parsed = uploadUrlSchema.safeParse(json);
    if (!parsed.success) {
      return jsonError(422, parsed.error.issues[0]?.message ?? "Some fields need a fix.");
    }
    if (
      parsed.data.client_ip &&
      (await rateLimited(db, `intake:upload:${parsed.data.client_ip}`, VISITOR_UPLOAD_LIMIT))
    ) {
      return tooMany(VISITOR_UPLOAD_LIMIT.windowSeconds);
    }

    const orgId = await intakeOrgId(db, env.LEAD_INTAKE_ORG_SLUG);
    if (!orgId) return jsonError(503, "Lead intake is not configured.");

    const path = `${orgId}/${randomUUID()}/${safeFileName(parsed.data.file_name)}`;
    const { data, error } = await db.storage.from(LEAD_PHOTO_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("createSignedUploadUrl failed");
    return jsonOk({ path, uploadUrl: data.signedUrl, token: data.token }, 201);
  } catch (error) {
    logError("public.leads.upload-url", error);
    return jsonError(500, "Something went wrong. Please try again.");
  }
}
