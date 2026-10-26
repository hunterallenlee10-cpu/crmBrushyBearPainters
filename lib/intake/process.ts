import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { territoryForZip, type TerritoryLite } from "@/lib/domain/territory";
import {
  normalizeEmail,
  normalizePhone,
  parseLocation,
  splitName,
} from "@/lib/domain/leads/normalize";
import { findDuplicate, dedupeWindowStart, type DedupeCandidate } from "@/lib/domain/leads/dedupe";
import { scoreLead, type ScoringRule } from "@/lib/domain/leads/scoring";
import {
  cityFromPagePath,
  inferLeadSource,
  mapHomeBuilt,
  mapServices,
  mapTimeline,
  serviceFromPagePath,
} from "@/lib/domain/leads/intake";
import { SERVICE_LABELS, TIMELINE_LABELS, type Service } from "@/lib/domain/leads/constants";
import type { WebsiteLead } from "@/lib/validation/intake";

/**
 * Website lead intake (SPEC §14). Runs with the service role after the route
 * has checked the signature and rate limit. Never echoes personal data back.
 */

type Db = SupabaseClient<Database>;

export const LEAD_PHOTO_BUCKET = "lead-attachments";

export type IntakeResult =
  | { kind: "created"; leadId: string }
  | { kind: "duplicate"; leadId: string }
  | { kind: "replay"; leadId: string; outcome: "created" | "duplicate" }
  | { kind: "ignored" }
  | { kind: "invalid"; fieldErrors: Record<string, string[]>; message: string }
  | { kind: "conflict"; message: string };

export type IntakeContext = {
  orgId: string;
  idempotencyKey: string | null;
  requestHash: string;
  now?: Date;
};

// Territories and scoring rules change rarely; cache them briefly per server instance.
const CACHE_MS = 60_000;
let territoryCache: { orgId: string; at: number; value: TerritoryLite[] } | null = null;
let rulesCache: { orgId: string; at: number; value: ScoringRule[] } | null = null;

async function territories(db: Db, orgId: string): Promise<TerritoryLite[]> {
  if (
    territoryCache &&
    territoryCache.orgId === orgId &&
    Date.now() - territoryCache.at < CACHE_MS
  ) {
    return territoryCache.value;
  }
  const { data, error } = await db
    .from("territories")
    .select("id, name, zip_codes, is_service_area, active")
    .eq("org_id", orgId)
    .is("deleted_at", null);
  if (error) throw error;
  const value = (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    zipCodes: t.zip_codes,
    isServiceArea: t.is_service_area,
    active: t.active,
  }));
  territoryCache = { orgId, at: Date.now(), value };
  return value;
}

async function scoringRules(db: Db, orgId: string): Promise<ScoringRule[]> {
  if (rulesCache && rulesCache.orgId === orgId && Date.now() - rulesCache.at < CACHE_MS) {
    return rulesCache.value;
  }
  const { data, error } = await db
    .from("lead_scoring_rules")
    .select("factor, label, points, active")
    .eq("org_id", orgId);
  if (error) throw error;
  const value = data ?? [];
  rulesCache = { orgId, at: Date.now(), value };
  return value;
}

/** Test hook: forget cached territories and rules. */
export function clearIntakeCaches(): void {
  territoryCache = null;
  rulesCache = null;
}

/** Keeps only photos uploaded for this org that really exist in Storage. */
async function verifiedPhotos(db: Db, orgId: string, photos: WebsiteLead["photos"]) {
  const ok: WebsiteLead["photos"] = [];
  for (const p of photos) {
    if (!p.path.startsWith(`${orgId}/`)) continue;
    const folder = p.path.slice(0, p.path.lastIndexOf("/"));
    const name = p.path.slice(p.path.lastIndexOf("/") + 1);
    const { data } = await db.storage
      .from(LEAD_PHOTO_BUCKET)
      .list(folder, { search: name, limit: 1 });
    if (data?.some((o) => o.name === name)) ok.push(p);
  }
  return ok;
}

async function finishClaim(
  db: Db,
  ctx: IntakeContext,
  leadId: string,
  outcome: "created" | "duplicate",
) {
  if (!ctx.idempotencyKey) return;
  await db
    .from("intake_requests")
    .update({ lead_id: leadId, outcome })
    .eq("org_id", ctx.orgId)
    .eq("idempotency_key", ctx.idempotencyKey);
}

async function releaseClaim(db: Db, ctx: IntakeContext) {
  if (!ctx.idempotencyKey) return;
  await db
    .from("intake_requests")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("idempotency_key", ctx.idempotencyKey)
    .eq("outcome", "pending");
}

/** Summary line for a repeat submission on an existing lead's timeline. */
function submissionSummary(
  services: Service[],
  timeline: string | null,
  notes: string | null,
): string {
  const parts: string[] = [];
  if (services.length) parts.push(`Services: ${services.map((s) => SERVICE_LABELS[s]).join(", ")}`);
  if (timeline && timeline in TIMELINE_LABELS) {
    parts.push(`Timeline: ${TIMELINE_LABELS[timeline as keyof typeof TIMELINE_LABELS]}`);
  }
  if (notes) parts.push(`Notes: ${notes}`);
  return parts.length ? parts.join("\n") : "Submitted the estimate form again.";
}

export async function processWebsiteLead(
  db: Db,
  input: WebsiteLead,
  ctx: IntakeContext,
): Promise<IntakeResult> {
  const now = ctx.now ?? new Date();

  // Honeypot: answer like a success so bots learn nothing, but store nothing.
  if (input.company) return { kind: "ignored" };

  const { first, last } = splitName(input.name);
  const mobile = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const fieldErrors: Record<string, string[]> = {};
  if (!first) fieldErrors.name = ["Name is required."];
  if (input.phone && !mobile) fieldErrors.phone = ["That phone number doesn't look right."];
  if (input.email && !email) fieldErrors.email = ["That email doesn't look right."];
  if (!mobile && !email && !fieldErrors.phone && !fieldErrors.email) {
    fieldErrors.phone = ["Add a phone number or an email so we can reach you."];
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { kind: "invalid", fieldErrors, message: "Some fields need a fix." };
  }

  // Claim the Idempotency-Key first so a retried request can never create a second lead.
  if (ctx.idempotencyKey) {
    const claim = await db.from("intake_requests").insert({
      org_id: ctx.orgId,
      idempotency_key: ctx.idempotencyKey,
      request_hash: ctx.requestHash,
      outcome: "pending",
    });
    if (claim.error) {
      if (claim.error.code !== "23505") throw claim.error;
      const { data: prior, error } = await db
        .from("intake_requests")
        .select("request_hash, lead_id, outcome")
        .eq("org_id", ctx.orgId)
        .eq("idempotency_key", ctx.idempotencyKey)
        .single();
      if (error) throw error;
      if (prior.request_hash !== ctx.requestHash) {
        return {
          kind: "conflict",
          message: "This Idempotency-Key was already used for a different request.",
        };
      }
      if (prior.lead_id && (prior.outcome === "created" || prior.outcome === "duplicate")) {
        return { kind: "replay", leadId: prior.lead_id, outcome: prior.outcome };
      }
      return {
        kind: "conflict",
        message: "This request is still being processed. Retry in a moment.",
      };
    }
  }

  try {
    const location = parseLocation(input.location);
    let services = mapServices(input.services);
    const fromPage = serviceFromPagePath(input.page_path);
    if (services.length === 0 && fromPage) services = [fromPage];
    const timeline = mapTimeline(input.timeline);
    const homeBuilt = mapHomeBuilt(input.home_built);
    const city = location.city ?? cityFromPagePath(input.page_path);
    const photos = await verifiedPhotos(db, ctx.orgId, input.photos);

    // Duplicate check: same phone or email in the last 180 days.
    const since = dedupeWindowStart(now).toISOString();
    const ors: string[] = [];
    if (mobile) ors.push(`mobile.eq."${mobile}"`, `phone.eq."${mobile}"`);
    if (email) ors.push(`email.eq."${email}"`);
    const { data: candidates, error: dupErr } = await db
      .from("leads")
      .select(
        "id, mobile, phone, email, status, created_at, last_activity_at, owner_id, zip, street, city",
      )
      .eq("org_id", ctx.orgId)
      .is("deleted_at", null)
      .gte("created_at", since)
      .or(ors.join(","))
      .limit(20);
    if (dupErr) throw dupErr;
    const match = findDuplicate<DedupeCandidate & (typeof candidates)[number]>(
      { phones: [mobile], email },
      candidates ?? [],
      now,
    );

    if (match) {
      const existing = match.lead;
      await db.from("messages").insert({
        org_id: ctx.orgId,
        channel: "portal",
        direction: "inbound",
        subject_type: "lead",
        subject_id: existing.id,
        body: submissionSummary(services, timeline, input.notes),
        status: "received",
        simulated: false,
      });
      // Fill in contact details the existing lead was missing (never overwrite).
      const fill: Database["public"]["Tables"]["leads"]["Update"] = {};
      if (!existing.mobile && !existing.phone && mobile) fill.mobile = mobile;
      if (!existing.email && email) fill.email = email;
      if (!existing.zip && location.zip) fill.zip = location.zip;
      if (!existing.street && location.street) fill.street = location.street;
      if (!existing.city && city) fill.city = city;
      if (Object.keys(fill).length > 0) await db.from("leads").update(fill).eq("id", existing.id);
      if (photos.length) {
        await db.from("lead_attachments").insert(
          photos.map((p) => ({
            org_id: ctx.orgId,
            lead_id: existing.id,
            storage_path: p.path,
            file_name: p.file_name,
            content_type: p.content_type,
            size_bytes: p.size_bytes,
            source: "website",
          })),
        );
      }
      if (existing.owner_id) {
        await db.from("notifications").insert({
          org_id: ctx.orgId,
          user_id: existing.owner_id,
          type: "lead_resubmitted",
          title: `${[first, last].filter(Boolean).join(" ")} sent the estimate form again`,
          link: `/leads/${existing.id}`,
        });
      }
      await finishClaim(db, ctx, existing.id, "duplicate");
      return { kind: "duplicate", leadId: existing.id };
    }

    const territory = location.zip
      ? territoryForZip(await territories(db, ctx.orgId), location.zip)
      : null;
    const inServiceArea = location.zip ? territory !== null : null;
    const { source, subSource } = inferLeadSource({
      utm_source: input.utm_source,
      utm_medium: input.utm_medium,
      utm_campaign: input.utm_campaign,
      referrer: input.referrer,
      ref: input.ref,
      gclid: input.gclid,
      fbclid: input.fbclid,
    });
    const score = scoreLead(
      {
        inServiceArea,
        hasMobile: Boolean(mobile),
        hasEmail: Boolean(email),
        hasFullAddress: Boolean(location.street && location.zip),
        timeline,
        services,
        photoCount: photos.length,
        leadSource: source,
        respondedToText: false,
        unansweredAttempts: 0,
      },
      await scoringRules(db, ctx.orgId),
    );

    const { data: lead, error: insErr } = await db
      .from("leads")
      .insert({
        org_id: ctx.orgId,
        first_name: first,
        last_name: last,
        mobile,
        email,
        street: location.street,
        city: city ?? territory?.name ?? null,
        state: location.state ?? "WA",
        zip: location.zip,
        services,
        timeline,
        home_built: homeBuilt,
        customer_notes: input.notes,
        lead_source: source,
        lead_sub_source: subSource,
        intake_channel: input.ref ? "referral" : "website",
        score: score.score,
        grade: score.grade,
        temperature: score.temperature,
        score_factors: score.factors,
        scored_at: now.toISOString(),
        utm_source: input.utm_source,
        utm_medium: input.utm_medium,
        utm_campaign: input.utm_campaign,
        utm_term: input.utm_term,
        utm_content: input.utm_content,
        landing_page: input.landing_page,
        page_path: input.page_path,
        referrer: input.referrer,
        referral_code: input.ref,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    if (photos.length) {
      const { error } = await db.from("lead_attachments").insert(
        photos.map((p) => ({
          org_id: ctx.orgId,
          lead_id: lead.id,
          storage_path: p.path,
          file_name: p.file_name,
          content_type: p.content_type,
          size_bytes: p.size_bytes,
          source: "website",
        })),
      );
      if (error) throw error;
    }
    await finishClaim(db, ctx, lead.id, "created");
    return { kind: "created", leadId: lead.id };
  } catch (error) {
    await releaseClaim(db, ctx);
    throw error;
  }
}
