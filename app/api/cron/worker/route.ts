import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runAttentionSweep } from "@/lib/attention/engine";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { serverEnv } from "@/lib/env";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { advanceIfGatePasses } from "@/lib/jobs/stage";
import { logError } from "@/lib/log";
import { sweepOnboarding } from "@/lib/onboarding/checks";
import { processEvents } from "@/lib/worker/events";
import { sweepProduction } from "@/lib/production/automation";
import { sweepDailyUpdates } from "@/lib/production/daily-log";
import { generateRecommendations } from "@/lib/production/recommendations";
import { refreshSubcontractorStatus } from "@/lib/production/subcontractors";

/**
 * Background worker (SPEC §2, §9, §11). Vercel Cron calls it every minute with
 * `Authorization: Bearer $CRON_SECRET`. Each run: process queued events,
 * auto-close jobs 3 days after Paid in Full, re-run onboarding checks, run the
 * production sweep (on-time guarantee, stage moves, daily updates,
 * subcontractor paperwork, recommendations), refresh job health, and run the
 * attention rules (open new items, auto-resolve cleared ones).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AUTO_CLOSE_DAYS = 3;

function authorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(request: NextRequest) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "The worker isn't configured (CRON_SECRET)." },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const now = new Date();
  const service = await createSupabaseServiceClient();
  const summary: Record<string, unknown> = {};

  try {
    summary.events = await processEvents(service);
  } catch (e) {
    logError("worker.events", e);
    summary.events = { error: true };
  }

  try {
    const { data: expired } = await service.rpc("expire_proposals");
    summary.expiredProposals = expired ?? 0;
  } catch (e) {
    logError("worker.expire_proposals", e);
  }

  try {
    const cutoff = new Date(now.getTime() - AUTO_CLOSE_DAYS * 24 * 3_600_000).toISOString();
    const { data: paid } = await service
      .from("jobs")
      .select("id")
      .eq("stage", "paid_in_full")
      .is("deleted_at", null)
      .lt("stage_entered_at", cutoff)
      .limit(100);
    let closed = 0;
    for (const j of paid ?? []) {
      if (await advanceIfGatePasses(service, j.id, "paid_in_full", "closed_won")) closed++;
    }
    summary.autoClosed = closed;
  } catch (e) {
    logError("worker.auto_close", e);
  }

  // Onboarding checks (SPEC §6.4): clear what the data shows, release the
  // Deposit Hold, and move cleared jobs to Ready to Schedule.
  try {
    summary.onboarding = await sweepOnboarding(service);
  } catch (e) {
    logError("worker.onboarding", e);
    summary.onboarding = { error: true };
  }

  // Production (SPEC §6.2 gates 6–9, §1.3): on-time guarantee, stage moves,
  // customer updates still waiting, subcontractor paperwork status, and
  // scheduling recommendations (every 15 minutes).
  try {
    summary.production = await sweepProduction(service, now);
  } catch (e) {
    logError("worker.production", e);
    summary.production = { error: true };
  }
  try {
    summary.dailyUpdates = await sweepDailyUpdates(service);
  } catch (e) {
    logError("worker.daily_updates", e);
  }
  try {
    summary.subcontractors = await refreshSubcontractorStatus(service, now);
  } catch (e) {
    logError("worker.subcontractors", e);
  }
  if (
    now.getUTCMinutes() % 15 === 0 ||
    request.nextUrl.searchParams.get("recommendations") === "1"
  ) {
    try {
      const { data: orgs } = await service.from("organizations").select("id");
      let created = 0;
      for (const o of orgs ?? [])
        created += (await generateRecommendations(service, o.id, now)).created;
      summary.recommendations = { created };
    } catch (e) {
      logError("worker.recommendations", e);
    }
  }

  try {
    const { data: open } = await service
      .from("jobs")
      .select("id")
      .is("deleted_at", null)
      .not("stage", "in", "(closed_won,closed_lost)")
      .order("health_checked_at", { ascending: true, nullsFirst: true })
      .limit(500);
    summary.health = await recomputeJobHealth(
      service,
      (open ?? []).map((j) => j.id),
      now,
    );
  } catch (e) {
    logError("worker.health", e);
  }

  try {
    summary.attention = await runAttentionSweep(service, now);
  } catch (e) {
    logError("worker.attention", e);
    summary.attention = { error: true };
  }

  return NextResponse.json({ ok: true, ms: Date.now() - started, ...summary });
}

export const GET = run;
export const POST = run;
