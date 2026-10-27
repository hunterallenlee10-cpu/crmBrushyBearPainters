import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { toBusinessHours } from "@/lib/domain/company-settings";
import {
  ATTENTION_PRIORITIES,
  evaluateAttention,
  isAttentionRuleKey,
  type AttentionPriority,
  type AttentionRuleKey,
  type AttentionSettings,
  type RuleConfig,
  type SnapshotJob,
  type SnapshotWalkthrough,
} from "@/lib/domain/attention/rules";
import { planAttentionSync, type ExistingItem } from "@/lib/domain/attention/sync";
import { isJobStageId } from "@/lib/domain/stages";
import { checklistSummary, shortLabel } from "@/lib/domain/onboarding/checklist";
import { logError } from "@/lib/log";
import { loadWeather } from "@/lib/production/weather";
import { loadCommunicationSnapshot } from "./communication";
import { loadMoneySnapshot } from "./money";
import { loadProductionSnapshot } from "./production";

type Db = SupabaseClient<Database>;

/**
 * Attention sweep (SPEC §9): for each company, load what the rules read,
 * evaluate them, and open / refresh / auto-resolve attention items. Runs in
 * the worker every minute with the service client.
 */

export type SweepResult = {
  orgs: number;
  opened: number;
  updated: number;
  resolved: number;
};

const PAGE = 1000;
const MAX_ROWS = 20_000;

async function all<T>(
  fetch: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await fetch(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function name(first: string | null | undefined, last: string | null | undefined): string {
  return [first, last].filter(Boolean).join(" ") || "Unnamed";
}

function isPriority(v: string): v is AttentionPriority {
  return (ATTENTION_PRIORITIES as readonly string[]).includes(v);
}

export async function runAttentionSweep(service: Db, now = new Date()): Promise<SweepResult> {
  const result: SweepResult = { orgs: 0, opened: 0, updated: 0, resolved: 0 };
  const { data: orgs, error } = await service.from("organizations").select("id");
  if (error) throw error;
  for (const org of orgs ?? []) {
    try {
      const r = await sweepOrg(service, org.id, now);
      result.orgs++;
      result.opened += r.opened;
      result.updated += r.updated;
      result.resolved += r.resolved;
    } catch (e) {
      logError("attention.sweep.org", e);
    }
  }
  return result;
}

async function sweepOrg(service: Db, orgId: string, now: Date) {
  const soon = new Date(now.getTime() + 3 * 24 * 3_600_000).toISOString();
  const [settingsRow, rules, leads, walkthroughs, jobs, approvals, existing, estimates] =
    await Promise.all([
      service
        .from("company_settings")
        .select(
          "business_hours, text_back_sla_minutes, estimate_sla_hours, estimate_sla_warn_hours, exterior_season_start, exterior_season_end, on_time_guarantee_cents",
        )
        .eq("org_id", orgId)
        .maybeSingle(),
      service.from("attention_rules").select("rule_key, enabled, thresholds").eq("org_id", orgId),
      all((from, to) =>
        service
          .from("leads")
          .select(
            "id, first_name, last_name, status, owner_id, created_at, first_contacted_at, last_activity_at",
          )
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .in("status", ["new", "contacted", "walkthrough_scheduled"])
          .order("id")
          .range(from, to),
      ),
      all((from, to) =>
        service
          .from("appointments")
          .select(
            "id, starts_at, status, job_id, lead_id, lead:leads(first_name, last_name, owner_id), job:jobs(name, owner_id, point_of_contact_id)",
          )
          .eq("org_id", orgId)
          .eq("type", "walkthrough")
          .is("deleted_at", null)
          .in("status", ["scheduled", "tentative"])
          .gt("starts_at", now.toISOString())
          .lt("starts_at", soon)
          .order("id")
          .range(from, to),
      ),
      all((from, to) =>
        service
          .from("jobs")
          .select(
            "id, name, job_number, stage, stage_entered_at, owner_id, point_of_contact_id, work_types, promised_start_date, actual_start_date, walkthrough_completed_at, estimate_sent_at, estimate_accepted_at, deposit_paid_at, on_time_guarantee_status, crew_id, guarantee_start_date",
          )
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .not("stage", "in", "(closed_won,closed_lost)")
          .order("id")
          .range(from, to),
      ),
      service
        .from("approval_requests")
        .select(
          "id, type, job_id, requested_at, job:jobs(name), requester:profiles!approval_requests_requested_by_fkey(full_name)",
        )
        .eq("org_id", orgId)
        .eq("status", "pending"),
      all((from, to) =>
        service
          .from("attention_items")
          .select(
            "id, dedupe_key, status, priority, title, detail, due_at, owner_id, snoozed_until, resolution, condition_cleared_at",
          )
          .eq("org_id", orgId)
          // Items a workflow opened (rule "workflow") stay until a person resolves them.
          .neq("rule_key", "workflow")
          .or("status.neq.resolved,and(resolution.eq.manual,condition_cleared_at.is.null)")
          .order("id")
          .range(from, to),
      ),
      all((from, to) =>
        service
          .from("estimates")
          .select(
            "id, estimate_number, status, sent_at, viewed_at, expires_at, owner_id, job:jobs!estimates_job_id_fkey(id, name, job_number, owner_id, point_of_contact_id, deleted_at)",
          )
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .in("status", ["sent", "viewed"])
          .order("id")
          .range(from, to),
      ),
    ]);
  if (settingsRow.error) throw settingsRow.error;
  if (rules.error) throw rules.error;
  if (approvals.error) throw approvals.error;
  const s = settingsRow.data;

  const ruleConfig: Partial<Record<AttentionRuleKey, RuleConfig>> = {};
  for (const r of rules.data ?? []) {
    if (!isAttentionRuleKey(r.rule_key)) continue;
    const thresholds: Record<string, number> = {};
    const raw = r.thresholds;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) if (typeof v === "number") thresholds[k] = v;
    }
    ruleConfig[r.rule_key] = { enabled: r.enabled, thresholds };
  }

  const settings: AttentionSettings = {
    businessHours: toBusinessHours(s?.business_hours ?? {}),
    textBackSlaMinutes: s?.text_back_sla_minutes ?? 10,
    estimateSlaHours: s?.estimate_sla_hours ?? 24,
    estimateSlaWarnHours: s?.estimate_sla_warn_hours ?? 20,
    exteriorSeasonStart: s?.exterior_season_start ?? "06-01",
    exteriorSeasonEnd: s?.exterior_season_end ?? "09-30",
    rules: ruleConfig,
    weatherConnected: (await loadWeather()).connected,
    onTimeCreditCents: Number(s?.on_time_guarantee_cents ?? 0),
  };

  const production = await loadProductionSnapshot(service, orgId, jobs, now);
  const money = await loadMoneySnapshot(service, orgId, jobs);
  const communication = await loadCommunicationSnapshot(service, orgId);

  // Jobs in Onboarding: what's still open on the checklist and what holds block them.
  const onboardingIds = jobs.filter((j) => j.stage === "onboarding").map((j) => j.id);
  const openByJob = new Map<string, string[]>();
  const holdsByJob = new Map<string, string[]>();
  for (let i = 0; i < onboardingIds.length; i += 200) {
    const ids = onboardingIds.slice(i, i + 200);
    const [reqs, holds, holdLabels] = await Promise.all([
      service
        .from("onboarding_requirements")
        .select("job_id, key, label, group_key, required, status, verified_auto")
        .in("job_id", ids),
      service
        .from("job_holds")
        .select("job_id, hold_type")
        .in("job_id", ids)
        .is("released_at", null)
        .eq("blocks_scheduling", true),
      service
        .from("picklist_values")
        .select("value, label, picklists!inner(key, org_id)")
        .eq("picklists.key", "hold_type")
        .eq("picklists.org_id", orgId),
    ]);
    if (reqs.error) throw reqs.error;
    if (holds.error) throw holds.error;
    const holdLabel = new Map((holdLabels.data ?? []).map((v) => [v.value, v.label]));
    const byJob = new Map<string, NonNullable<typeof reqs.data>>();
    for (const r of reqs.data ?? []) byJob.set(r.job_id, [...(byJob.get(r.job_id) ?? []), r]);
    for (const [jobId, rows] of byJob) {
      const summary = checklistSummary(
        rows.map((r) => ({
          key: r.key,
          label: r.label,
          group: r.group_key,
          required: r.required,
          status: r.status,
          verifiedAuto: r.verified_auto,
        })),
      );
      openByJob.set(
        jobId,
        summary.open.map((o) => shortLabel(o.key, o.label)),
      );
    }
    for (const h of holds.data ?? []) {
      holdsByJob.set(h.job_id, [
        ...(holdsByJob.get(h.job_id) ?? []),
        holdLabel.get(h.hold_type) ?? h.hold_type,
      ]);
    }
  }

  const snapshotJobs: SnapshotJob[] = jobs.flatMap((j) =>
    isJobStageId(j.stage)
      ? [
          {
            id: j.id,
            name: j.name,
            jobNumber: j.job_number,
            stage: j.stage,
            stageEnteredAt: j.stage_entered_at,
            ownerId: j.owner_id,
            pointOfContactId: j.point_of_contact_id,
            workTypes: j.work_types,
            promisedStartDate: j.promised_start_date,
            actualStartDate: j.actual_start_date,
            walkthroughCompletedAt: j.walkthrough_completed_at,
            estimateSentAt: j.estimate_sent_at,
            estimateAcceptedAt: j.estimate_accepted_at,
            depositPaidAt: j.deposit_paid_at,
            onTimeGuaranteeStatus: j.on_time_guarantee_status,
            guaranteeDate: j.guarantee_start_date,
            ...(production.byJob.get(j.id) ?? {}),
            ...(money.byJob.get(j.id) ?? {}),
            ...(j.stage === "onboarding"
              ? {
                  onboardingOpen: openByJob.get(j.id) ?? null,
                  blockingHolds: holdsByJob.get(j.id) ?? [],
                }
              : {}),
          },
        ]
      : [],
  );

  const desired = evaluateAttention(
    {
      leads: leads.map((l) => ({
        id: l.id,
        name: name(l.first_name, l.last_name),
        status: l.status,
        ownerId: l.owner_id,
        createdAt: l.created_at,
        firstContactedAt: l.first_contacted_at,
        lastActivityAt: l.last_activity_at,
      })),
      walkthroughs: walkthroughs.flatMap((w): SnapshotWalkthrough[] => {
        if (w.job_id && w.job) {
          return [
            {
              id: w.id,
              startsAt: w.starts_at,
              status: w.status,
              subjectType: "job",
              subjectId: w.job_id,
              subjectName: w.job.name,
              ownerId: w.job.point_of_contact_id ?? w.job.owner_id,
            },
          ];
        }
        if (w.lead_id && w.lead) {
          return [
            {
              id: w.id,
              startsAt: w.starts_at,
              status: w.status,
              subjectType: "lead",
              subjectId: w.lead_id,
              subjectName: name(w.lead.first_name, w.lead.last_name),
              ownerId: w.lead.owner_id,
            },
          ];
        }
        return [];
      }),
      jobs: snapshotJobs,
      estimates: estimates.flatMap((e) =>
        e.job && !e.job.deleted_at && e.sent_at
          ? [
              {
                id: e.id,
                number: e.estimate_number,
                jobId: e.job.id,
                jobName: e.job.name,
                jobNumber: e.job.job_number,
                status: e.status,
                sentAt: e.sent_at,
                viewedAt: e.viewed_at,
                expiresAt: e.expires_at,
                ownerId: e.job.point_of_contact_id ?? e.owner_id ?? e.job.owner_id,
              },
            ]
          : [],
      ),
      subcontractors: production.subcontractors,
      invoices: money.invoices,
      threads: communication.threads,
      cases: communication.cases,
      approvals: (approvals.data ?? []).map((a) => ({
        id: a.id,
        type: a.type,
        jobId: a.job_id,
        jobName: a.job?.name ?? "A job",
        requestedAt: a.requested_at,
        requesterName: a.requester?.full_name ?? "Someone",
      })),
    },
    settings,
    now,
  );

  const current: ExistingItem[] = existing.flatMap((e) =>
    isPriority(e.priority) &&
    (e.status === "pending" ||
      e.status === "in_progress" ||
      e.status === "snoozed" ||
      e.status === "resolved")
      ? [
          {
            id: e.id,
            dedupeKey: e.dedupe_key,
            status: e.status,
            priority: e.priority,
            title: e.title,
            detail: e.detail,
            dueAt: e.due_at,
            ownerId: e.owner_id,
            snoozedUntil: e.snoozed_until,
            resolution: e.resolution === "auto" || e.resolution === "manual" ? e.resolution : null,
            conditionClearedAt: e.condition_cleared_at,
          },
        ]
      : [],
  );

  const plan = planAttentionSync(desired, current, now);
  const stamp = now.toISOString();

  if (plan.inserts.length) {
    const { error } = await service.from("attention_items").insert(
      plan.inserts.map((d) => ({
        org_id: orgId,
        rule_key: d.ruleKey,
        category: d.category,
        priority: d.priority,
        title: d.title,
        detail: d.detail,
        subject_type: d.subjectType,
        subject_id: d.subjectId,
        owner_id: d.ownerId,
        due_at: d.dueAt,
        dedupe_key: d.dedupeKey,
        opened_at: stamp,
        last_seen_at: stamp,
      })),
    );
    if (error) throw error;
    // Critical and high items notify their owner.
    const notify = plan.inserts.filter(
      (d) => d.ownerId && (d.priority === "critical" || d.priority === "high"),
    );
    if (notify.length) {
      const { error: nError } = await service.from("notifications").insert(
        notify.map((d) => ({
          org_id: orgId,
          user_id: d.ownerId as string,
          type: "attention",
          title: d.title.slice(0, 200),
          body: d.detail?.slice(0, 1000) ?? null,
          link:
            d.subjectType === "job"
              ? `/jobs/${d.subjectId}`
              : d.subjectType === "subcontractor"
                ? `/admin/subcontractors?id=${d.subjectId}`
                : d.subjectType === "case"
                  ? `/cases/${d.subjectId}`
                  : `/leads/${d.subjectId}`,
        })),
      );
      if (nError) logError("attention.notify", nError);
    }
  }
  for (const u of plan.updates) {
    const { error } = await service
      .from("attention_items")
      .update({
        priority: u.priority,
        title: u.title,
        detail: u.detail,
        due_at: u.dueAt,
        last_seen_at: stamp,
        ...(u.unsnooze ? { status: "pending", snoozed_until: null } : {}),
      })
      .eq("id", u.id);
    if (error) throw error;
  }
  if (plan.autoResolve.length) {
    const { error } = await service
      .from("attention_items")
      .update({
        status: "resolved",
        resolution: "auto",
        resolved_at: stamp,
        resolution_note: "Cleared automatically: the condition is no longer true.",
        snoozed_until: null,
      })
      .in("id", plan.autoResolve);
    if (error) throw error;
  }
  if (plan.markCleared.length) {
    const { error } = await service
      .from("attention_items")
      .update({ condition_cleared_at: stamp })
      .in("id", plan.markCleared);
    if (error) throw error;
  }
  // last_seen_at for unchanged items: cheap bookkeeping, at most every 15 minutes.
  if (plan.seen.length && now.getUTCMinutes() % 15 === 0) {
    await service.from("attention_items").update({ last_seen_at: stamp }).in("id", plan.seen);
  }

  return {
    opened: plan.inserts.length,
    updated: plan.updates.length,
    resolved: plan.autoResolve.length,
  };
}
