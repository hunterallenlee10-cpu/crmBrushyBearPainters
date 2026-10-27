import { addDays, differenceInCalendarDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { BusinessHours } from "@/lib/domain/company-settings";
import { isInSeason } from "@/lib/domain/company-settings";
import { BUSINESS_TZ, businessSecondsBetween } from "@/lib/domain/leads/speed-to-lead";
import { getStage, type JobStageId } from "@/lib/domain/stages";
import { isTerminal, stageOrder } from "@/lib/domain/jobs/gates";

/**
 * Attention engine v1 (SPEC §9). Pure: a snapshot of open leads, jobs,
 * walkthroughs and approvals goes in; the items that should be open come out.
 * Rules whose data arrives in later phases (weather, paint, crews, invoices,
 * warranty, daily logs) are added with those phases.
 */

export const ATTENTION_CATEGORIES = [
  "communication",
  "tasks",
  "scheduling",
  "sales",
  "approvals",
  "financial",
  "production",
  "qa",
  "customer",
  "documents",
] as const;
export type AttentionCategory = (typeof ATTENTION_CATEGORIES)[number];

export const ATTENTION_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type AttentionPriority = (typeof ATTENTION_PRIORITIES)[number];

export const CATEGORY_LABELS: Record<AttentionCategory, string> = {
  communication: "Communication",
  tasks: "Tasks",
  scheduling: "Scheduling",
  sales: "Sales",
  approvals: "Approvals",
  financial: "Financial",
  production: "Production",
  qa: "Quality",
  customer: "Customer",
  documents: "Documents",
};

export const PRIORITY_LABELS: Record<AttentionPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Rules in this build, with what they watch (shown in Admin → Attention Rules). */
export const ATTENTION_RULES = {
  untouched_lead: {
    label: "Untouched new lead",
    category: "communication",
    description:
      "A new lead with no call, text or email from a person within the text-back SLA (business minutes, from Company Settings).",
    thresholds: {},
  },
  aging_lead: {
    label: "Aging lead",
    category: "tasks",
    description: "An open lead with no activity for a while.",
    thresholds: { medium_days: 3, high_days: 7, stale_days: 14 },
  },
  walkthrough_unconfirmed: {
    label: "Walkthrough not confirmed",
    category: "scheduling",
    description: "A walkthrough tomorrow that isn't confirmed by the cutoff hour (Pacific).",
    thresholds: { cutoff_hour: 17 },
  },
  estimate_sla: {
    label: "Estimate SLA",
    category: "tasks",
    description:
      "Walkthrough complete with no estimate sent: warning and breach hours come from Company Settings.",
    thresholds: {},
  },
  estimate_awaiting_reply: {
    label: "Estimate awaiting reply",
    category: "communication",
    description: "An estimate sent a while ago that the customer hasn't opened or answered.",
    thresholds: { days: 3 },
  },
  estimate_expiring: {
    label: "Expiring estimate",
    category: "sales",
    description: "A sent estimate that expires soon without an answer.",
    thresholds: { days: 5 },
  },
  approval_pending: {
    label: "Approval needed",
    category: "approvals",
    description: "A request waiting for an owner's decision.",
    thresholds: { hours: 2 },
  },
  sold_no_deposit: {
    label: "Sold, no deposit",
    category: "financial",
    description: "A sold job whose deposit isn't recorded as paid.",
    thresholds: { days: 3 },
  },
  onboarding_stalled: {
    label: "Onboarding stalled",
    category: "production",
    description: "A job sitting in Onboarding.",
    thresholds: { days: 7 },
  },
  ready_not_scheduled: {
    label: "Ready, not scheduled",
    category: "scheduling",
    description:
      "A job in Ready to Schedule. Exterior and deck jobs only count during the exterior season.",
    thresholds: { days: 5 },
  },
  start_date_missed: {
    label: "Start date missed",
    category: "qa",
    description:
      "The promised start date passed with no actual start (not weather). The on-time credit is drafted once Money arrives (Phase 7).",
    thresholds: {},
  },
} as const satisfies Record<
  string,
  {
    label: string;
    category: AttentionCategory;
    description: string;
    thresholds: Record<string, number>;
  }
>;
export type AttentionRuleKey = keyof typeof ATTENTION_RULES;

export function isAttentionRuleKey(v: string): v is AttentionRuleKey {
  return v in ATTENTION_RULES;
}

export type RuleConfig = { enabled: boolean; thresholds: Record<string, number> };

export type SnapshotLead = {
  id: string;
  name: string;
  status: string;
  ownerId: string | null;
  createdAt: string;
  firstContactedAt: string | null;
  lastActivityAt: string;
};

export type SnapshotWalkthrough = {
  id: string;
  startsAt: string;
  status: string;
  subjectType: "lead" | "job";
  subjectId: string;
  subjectName: string;
  ownerId: string | null;
};

export type SnapshotJob = {
  id: string;
  name: string;
  jobNumber: string;
  stage: JobStageId;
  stageEnteredAt: string;
  ownerId: string | null;
  pointOfContactId: string | null;
  workTypes: readonly string[];
  promisedStartDate: string | null;
  actualStartDate: string | null;
  walkthroughCompletedAt: string | null;
  estimateSentAt: string | null;
  estimateAcceptedAt: string | null;
  depositPaidAt: string | null;
  onTimeGuaranteeStatus: string;
};

export type SnapshotEstimate = {
  id: string;
  number: string;
  jobId: string;
  jobName: string;
  jobNumber: string;
  /** "sent" or "viewed" (open estimates only). */
  status: string;
  sentAt: string;
  viewedAt: string | null;
  expiresAt: string | null;
  ownerId: string | null;
};

export type SnapshotApproval = {
  id: string;
  /** "stage_override" or "estimate_discount". */
  type?: string;
  jobId: string;
  jobName: string;
  requestedAt: string;
  requesterName: string;
};

export type AttentionSnapshot = {
  leads: readonly SnapshotLead[];
  walkthroughs: readonly SnapshotWalkthrough[];
  jobs: readonly SnapshotJob[];
  approvals: readonly SnapshotApproval[];
  /** Open (sent or viewed) estimates. */
  estimates?: readonly SnapshotEstimate[];
};

export type AttentionSettings = {
  businessHours: BusinessHours;
  textBackSlaMinutes: number;
  estimateSlaHours: number;
  estimateSlaWarnHours: number;
  exteriorSeasonStart: string;
  exteriorSeasonEnd: string;
  rules: Partial<Record<AttentionRuleKey, RuleConfig>>;
};

export type DesiredItem = {
  ruleKey: AttentionRuleKey;
  category: AttentionCategory;
  priority: AttentionPriority;
  title: string;
  detail: string | null;
  subjectType: "lead" | "job";
  subjectId: string;
  ownerId: string | null;
  dueAt: string | null;
  dedupeKey: string;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OPEN_LEAD = new Set(["new", "contacted", "walkthrough_scheduled"]);
const SEASONAL = new Set(["exterior", "deck_fence"]);

function pacificDay(at: Date): Date {
  const z = toZonedTime(at, BUSINESS_TZ);
  return new Date(z.getFullYear(), z.getMonth(), z.getDate());
}

function pacificIso(at: Date): string {
  const d = pacificDay(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysSince(iso: string, now: Date): number {
  return differenceInCalendarDays(pacificDay(now), pacificDay(new Date(iso)));
}

function threshold(
  settings: AttentionSettings,
  key: AttentionRuleKey,
  name: string,
  fallback: number,
): number {
  const v = settings.rules[key]?.thresholds[name];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function enabled(settings: AttentionSettings, key: AttentionRuleKey): boolean {
  return settings.rules[key]?.enabled ?? true;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Every item that should be open right now. */
export function evaluateAttention(
  snapshot: AttentionSnapshot,
  settings: AttentionSettings,
  now: Date,
): DesiredItem[] {
  const items: DesiredItem[] = [];
  const untouched = new Set<string>();

  // Untouched new lead: no human touch within the text-back SLA (business minutes).
  if (enabled(settings, "untouched_lead")) {
    for (const l of snapshot.leads) {
      if (l.status !== "new" || l.firstContactedAt) continue;
      const waited = businessSecondsBetween(new Date(l.createdAt), now, settings.businessHours);
      if (waited < settings.textBackSlaMinutes * 60) continue;
      untouched.add(l.id);
      items.push({
        ruleKey: "untouched_lead",
        category: "communication",
        priority: "critical",
        title: `Untouched new lead: ${l.name}`,
        detail: `No call, text or email from the team after ${Math.round(waited / 60)} business minutes (goal: ${settings.textBackSlaMinutes}).`,
        subjectType: "lead",
        subjectId: l.id,
        ownerId: l.ownerId,
        dueAt: l.createdAt,
        dedupeKey: `untouched_lead:${l.id}`,
      });
    }
  }

  // Aging lead: no activity for 3 / 7 / 14 days (Medium → High).
  if (enabled(settings, "aging_lead")) {
    const medium = threshold(settings, "aging_lead", "medium_days", 3);
    const high = threshold(settings, "aging_lead", "high_days", 7);
    const stale = threshold(settings, "aging_lead", "stale_days", 14);
    for (const l of snapshot.leads) {
      if (!OPEN_LEAD.has(l.status) || untouched.has(l.id)) continue;
      const days = daysSince(l.lastActivityAt, now);
      if (days < medium) continue;
      items.push({
        ruleKey: "aging_lead",
        category: "tasks",
        priority: days >= high ? "high" : "medium",
        title: `${days >= stale ? `${stale}+ days` : plural(days, "day")} without activity: ${l.name}`,
        detail: `Lead is ${l.status.replace(/_/g, " ")} with nothing logged since ${pacificIso(new Date(l.lastActivityAt))}.`,
        subjectType: "lead",
        subjectId: l.id,
        ownerId: l.ownerId,
        dueAt: null,
        dedupeKey: `aging_lead:${l.id}`,
      });
    }
  }

  // Walkthrough unconfirmed: from the cutoff hour the day before, until it starts.
  if (enabled(settings, "walkthrough_unconfirmed")) {
    const cutoff = threshold(settings, "walkthrough_unconfirmed", "cutoff_hour", 17);
    for (const w of snapshot.walkthroughs) {
      if (w.status !== "scheduled" && w.status !== "tentative") continue;
      const start = new Date(w.startsAt);
      if (start.getTime() <= now.getTime()) continue;
      const dayBefore = addDays(pacificDay(start), -1);
      const cutoffAt = fromZonedTime(
        new Date(dayBefore.getFullYear(), dayBefore.getMonth(), dayBefore.getDate(), cutoff, 0),
        BUSINESS_TZ,
      );
      if (now.getTime() < cutoffAt.getTime()) continue;
      items.push({
        ruleKey: "walkthrough_unconfirmed",
        category: "scheduling",
        priority: "high",
        title: `Walkthrough not confirmed: ${w.subjectName}`,
        detail: "Confirm the time with the customer.",
        subjectType: w.subjectType,
        subjectId: w.subjectId,
        ownerId: w.ownerId,
        dueAt: w.startsAt,
        dedupeKey: `walkthrough_unconfirmed:${w.id}`,
      });
    }
  }

  for (const j of snapshot.jobs) {
    if (isTerminal(j.stage)) continue;
    const owner = j.pointOfContactId ?? j.ownerId;
    const label = `${j.name} (${j.jobNumber})`;
    const order = stageOrder(j.stage);

    // Estimate SLA: walkthrough complete, no estimate sent (warn / breach hours).
    if (
      enabled(settings, "estimate_sla") &&
      j.stage === "walkthrough_complete" &&
      !j.estimateSentAt
    ) {
      const since = new Date(j.walkthroughCompletedAt ?? j.stageEnteredAt).getTime();
      const hours = (now.getTime() - since) / HOUR;
      if (hours >= settings.estimateSlaWarnHours) {
        const breached = hours >= settings.estimateSlaHours;
        items.push({
          ruleKey: "estimate_sla",
          category: "tasks",
          priority: breached ? "critical" : "high",
          title: breached ? `Estimate overdue: ${label}` : `Estimate due soon: ${label}`,
          detail: breached
            ? `Walkthrough finished ${Math.floor(hours)} h ago; the promise is an estimate within ${settings.estimateSlaHours} h.`
            : `Walkthrough finished ${Math.floor(hours)} h ago; the estimate is due within ${settings.estimateSlaHours} h.`,
          subjectType: "job",
          subjectId: j.id,
          ownerId: j.ownerId ?? owner,
          dueAt: new Date(since + settings.estimateSlaHours * HOUR).toISOString(),
          dedupeKey: `estimate_sla:${j.id}`,
        });
      }
    }

    // Sold, no deposit after N days.
    if (enabled(settings, "sold_no_deposit") && order >= stageOrder("sold") && !j.depositPaidAt) {
      const soldAt = j.estimateAcceptedAt ?? (j.stage === "sold" ? j.stageEnteredAt : null);
      const days = threshold(settings, "sold_no_deposit", "days", 3);
      if (soldAt && now.getTime() - new Date(soldAt).getTime() >= days * DAY) {
        items.push({
          ruleKey: "sold_no_deposit",
          category: "financial",
          priority: "high",
          title: `Sold, no deposit: ${label}`,
          detail: `Sold ${plural(daysSince(soldAt, now), "day")} ago and the deposit isn't recorded as paid.`,
          subjectType: "job",
          subjectId: j.id,
          ownerId: owner,
          dueAt: new Date(new Date(soldAt).getTime() + days * DAY).toISOString(),
          dedupeKey: `sold_no_deposit:${j.id}`,
        });
      }
    }

    // Onboarding stalled.
    if (enabled(settings, "onboarding_stalled") && j.stage === "onboarding") {
      const days = threshold(settings, "onboarding_stalled", "days", 7);
      const age = daysSince(j.stageEnteredAt, now);
      if (age >= days) {
        items.push({
          ruleKey: "onboarding_stalled",
          category: "production",
          priority: "medium",
          title: `Onboarding stalled: ${label}`,
          detail: `${plural(age, "day")} in Onboarding.`,
          subjectType: "job",
          subjectId: j.id,
          ownerId: owner,
          dueAt: null,
          dedupeKey: `onboarding_stalled:${j.id}`,
        });
      }
    }

    // Ready, not scheduled (exterior/deck only count in season).
    if (enabled(settings, "ready_not_scheduled") && j.stage === "ready_to_schedule") {
      const days = threshold(settings, "ready_not_scheduled", "days", 5);
      const age = daysSince(j.stageEnteredAt, now);
      const seasonal = j.workTypes.some((w) => SEASONAL.has(w));
      const inSeason = isInSeason(
        pacificIso(now),
        settings.exteriorSeasonStart,
        settings.exteriorSeasonEnd,
      );
      if (age >= days && (!seasonal || inSeason)) {
        items.push({
          ruleKey: "ready_not_scheduled",
          category: "scheduling",
          priority: "medium",
          title: `Ready, not scheduled: ${label}`,
          detail: `${plural(age, "day")} in Ready to Schedule.`,
          subjectType: "job",
          subjectId: j.id,
          ownerId: owner,
          dueAt: null,
          dedupeKey: `ready_not_scheduled:${j.id}`,
        });
      }
    }

    // Start date missed (not weather).
    if (
      enabled(settings, "start_date_missed") &&
      j.promisedStartDate &&
      !j.actualStartDate &&
      j.onTimeGuaranteeStatus !== "missed_weather" &&
      order < stageOrder("in_progress") &&
      j.promisedStartDate < pacificIso(now)
    ) {
      items.push({
        ruleKey: "start_date_missed",
        category: "qa",
        priority: "critical",
        title: `Start date missed: ${label}`,
        detail: `Promised to start ${j.promisedStartDate}; stage is ${getStage(j.stage).label}. The on-time guarantee credit is drafted once Money arrives (Phase 7).`,
        subjectType: "job",
        subjectId: j.id,
        ownerId: owner,
        dueAt: null,
        dedupeKey: `start_date_missed:${j.id}:${j.promisedStartDate}`,
      });
    }
  }

  // Estimate awaiting reply: sent N+ days ago and not opened (accepted/declined estimates aren't open).
  if (enabled(settings, "estimate_awaiting_reply")) {
    const days = threshold(settings, "estimate_awaiting_reply", "days", 3);
    for (const e of snapshot.estimates ?? []) {
      if (e.status !== "sent" || e.viewedAt) continue;
      const waited = (now.getTime() - new Date(e.sentAt).getTime()) / DAY;
      if (waited < days) continue;
      items.push({
        ruleKey: "estimate_awaiting_reply",
        category: "communication",
        priority: "medium",
        title: `Estimate awaiting reply: ${e.jobName} (${e.jobNumber})`,
        detail: `${e.number} was sent ${plural(Math.floor(waited), "day")} ago and the customer hasn't opened it. Follow up by phone or text.`,
        subjectType: "job",
        subjectId: e.jobId,
        ownerId: e.ownerId,
        dueAt: null,
        dedupeKey: `estimate_awaiting_reply:${e.id}`,
      });
    }
  }

  // Expiring estimate: expires within N days.
  if (enabled(settings, "estimate_expiring")) {
    const days = threshold(settings, "estimate_expiring", "days", 5);
    for (const e of snapshot.estimates ?? []) {
      if ((e.status !== "sent" && e.status !== "viewed") || !e.expiresAt) continue;
      const left = (new Date(e.expiresAt).getTime() - now.getTime()) / DAY;
      if (left < 0 || left > days) continue;
      const whole = Math.floor(left);
      items.push({
        ruleKey: "estimate_expiring",
        category: "sales",
        priority: "medium",
        title: `Estimate expiring: ${e.jobName} (${e.jobNumber})`,
        detail: `${e.number} expires ${whole === 0 ? "today" : `in ${plural(whole, "day")}`}. Check in with the customer or send a new version.`,
        subjectType: "job",
        subjectId: e.jobId,
        ownerId: e.ownerId,
        dueAt: e.expiresAt,
        dedupeKey: `estimate_expiring:${e.id}`,
      });
    }
  }

  // Approval needed for more than N hours.
  if (enabled(settings, "approval_pending")) {
    const hours = threshold(settings, "approval_pending", "hours", 2);
    for (const a of snapshot.approvals) {
      const waited = (now.getTime() - new Date(a.requestedAt).getTime()) / HOUR;
      if (waited < hours) continue;
      items.push({
        ruleKey: "approval_pending",
        category: "approvals",
        priority: "high",
        title: `Approval needed: ${a.jobName}`,
        detail: `${a.requesterName} asked ${Math.floor(waited)} h ago for ${a.type === "estimate_discount" ? "a discount over their limit" : "a stage override"}.`,
        subjectType: "job",
        subjectId: a.jobId,
        ownerId: null,
        dueAt: new Date(new Date(a.requestedAt).getTime() + hours * HOUR).toISOString(),
        dedupeKey: `approval_pending:${a.id}`,
      });
    }
  }

  return items;
}

const PRIORITY_WEIGHT: Record<AttentionPriority, number> = {
  critical: 1000,
  high: 100,
  medium: 10,
  low: 1,
};

/**
 * Deterministic urgency for "Prioritize" (not AI): priority first, then how
 * overdue (or close to due) it is, then age.
 */
export function urgencyScore(
  item: { priority: AttentionPriority; dueAt: string | null; openedAt: string },
  now: Date,
): number {
  let score = PRIORITY_WEIGHT[item.priority];
  if (item.dueAt) {
    const hoursToDue = (new Date(item.dueAt).getTime() - now.getTime()) / HOUR;
    score += hoursToDue <= 0 ? Math.min(50, 10 + -hoursToDue) : Math.max(0, 10 - hoursToDue / 2);
  }
  score += Math.min(20, (now.getTime() - new Date(item.openedAt).getTime()) / DAY);
  return Math.round(score * 100) / 100;
}
