import { addDays, differenceInCalendarDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { BusinessHours } from "@/lib/domain/company-settings";
import { isInSeason } from "@/lib/domain/company-settings";
import { BUSINESS_TZ, businessSecondsBetween } from "@/lib/domain/leads/speed-to-lead";
import { getStage, type JobStageId } from "@/lib/domain/stages";
import { isTerminal, stageOrder } from "@/lib/domain/jobs/gates";
import { daysBetween, formatDay } from "@/lib/domain/scheduling/dates";
import { missedDailyUpdates } from "@/lib/domain/scheduling/daily-updates";
import { formatCents } from "@/lib/format/money";

/**
 * Attention engine v1 (SPEC §9). Pure: a snapshot of open leads, jobs,
 * walkthroughs and approvals goes in; the items that should be open come out.
 * Rules whose data arrives in later phases (unread messages, warranty) are
 * added with those phases. Weather risk is present but dormant
 * until weather is connected.
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
    description:
      "A job sitting in Onboarding with required checklist items still open or a hold blocking it.",
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
      "The promised start date passed with no actual start (rain delays don't count). An On-Time Guarantee credit is drafted for owner approval.",
    thresholds: {},
  },
  missing_crew: {
    label: "Missing crew",
    category: "scheduling",
    description: "A job starting soon with no crew assigned.",
    thresholds: { days: 5 },
  },
  paint_not_ordered: {
    label: "Paint not ordered",
    category: "production",
    description: "A job starting soon whose paint order isn't placed.",
    thresholds: { days: 3 },
  },
  missed_daily_update: {
    label: "Missed daily update",
    category: "qa",
    description:
      "A scheduled production day with no daily log by the cutoff hour (Pacific). Rain days don't count.",
    thresholds: { cutoff_hour: 19, lookback_days: 3 },
  },
  punch_list_open: {
    label: "Punch list open",
    category: "qa",
    description: "A job in Final Walkthrough for a while with punch items still open.",
    thresholds: { days: 3 },
  },
  sub_compliance_expiring: {
    label: "Sub compliance expiring",
    category: "documents",
    description:
      "A subcontractor's L&I registration, insurance (COI), bond or RRP certificate expires soon, has expired, or is missing.",
    thresholds: { days: 30 },
  },
  overdue_invoice: {
    label: "Overdue invoice",
    category: "financial",
    description:
      "A sent invoice past its due date with money still owed: medium after the first threshold, high after the second.",
    thresholds: { medium_days: 7, high_days: 30 },
  },
  weather_risk: {
    label: "Weather risk",
    category: "scheduling",
    description:
      "An exterior or deck day with rain at or above the threshold in the forecast. Runs only when weather is connected.",
    thresholds: { rain_percent: 60 },
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
  /**
   * Jobs in Onboarding: required checklist items still open (short names) and
   * active holds that block scheduling. Undefined when not loaded.
   */
  onboardingOpen?: readonly string[] | null;
  blockingHolds?: readonly string[];
  /** Production (Phase 6). Undefined when not loaded. */
  crewId?: string | null;
  /** Lead of the job's crew (owns the missed-daily-update item). */
  crewLeadId?: string | null;
  /** First scheduled production day (published, else drafted), else the promised start. */
  startDate?: string | null;
  /** A paint order is placed (ordered or later); null when the job has none. */
  paintOrdered?: boolean | null;
  /** Published production days and the dates with a daily log. */
  productionDays?: readonly string[];
  logDates?: readonly string[];
  /** The date the on-time guarantee measures. */
  guaranteeDate?: string | null;
  rainDelayDates?: readonly string[];
  punchOpen?: number;
  /** Forecast days at risk (weather connected only). */
  weatherRiskDays?: readonly { date: string; precipProbability: number }[];
  /**
   * Money (Phase 7): the live deposit invoice and what's applied to it, and
   * whether a deposit is asked for at all (false when the accepted estimate
   * set a 0% deposit, so no deposit invoice was made). Undefined when not loaded.
   */
  deposit?: { number: string; totalCents: number; collectedCents: number } | null;
  depositRequired?: boolean;
};

/** A sent invoice past due with money owed (from public.invoice_ledger). */
export type SnapshotInvoice = {
  id: string;
  number: string;
  jobId: string;
  jobName: string;
  jobNumber: string;
  balanceCents: number;
  daysPastDue: number;
  ownerId: string | null;
};

export type SnapshotSubcontractor = {
  id: string;
  name: string;
  /** Plain-English issues within the rule's window (from lib/domain/scheduling/subcontractors). */
  issues: readonly { level: "expired" | "expiring"; message: string; expiresOn: string | null }[];
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
  /** Overdue invoices (Phase 7). */
  invoices?: readonly SnapshotInvoice[];
  subcontractors?: readonly SnapshotSubcontractor[];
};

export type AttentionSettings = {
  businessHours: BusinessHours;
  textBackSlaMinutes: number;
  estimateSlaHours: number;
  estimateSlaWarnHours: number;
  exteriorSeasonStart: string;
  exteriorSeasonEnd: string;
  rules: Partial<Record<AttentionRuleKey, RuleConfig>>;
  /** Weather risk only runs when the weather integration is connected. */
  weatherConnected?: boolean;
  /** On-Time Guarantee amount (Company Settings), for the item text. */
  onTimeCreditCents?: number;
};

export type DesiredItem = {
  ruleKey: AttentionRuleKey;
  category: AttentionCategory;
  priority: AttentionPriority;
  title: string;
  detail: string | null;
  subjectType: "lead" | "job" | "subcontractor";
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

/** Calendar days from today (Pacific) until a YYYY-MM-DD date (negative when past). */
function daysUntil(date: string, now: Date): number {
  return daysBetween(pacificIso(now), date);
}

function startsWords(days: number, date: string): string {
  if (days < 0) return `Was due to start ${formatDay(date)}`;
  if (days === 0) return "Starts today";
  if (days === 1) return "Starts tomorrow";
  return `Starts in ${days} days (${formatDay(date)})`;
}

function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  return `${hh % 12 === 0 ? 12 : hh % 12}:00 ${hh < 12 ? "am" : "pm"}`;
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
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
    const depositPaid =
      !!j.depositPaidAt ||
      (!!j.deposit && j.deposit.totalCents > 0 && j.deposit.collectedCents >= j.deposit.totalCents);
    if (
      enabled(settings, "sold_no_deposit") &&
      order >= stageOrder("sold") &&
      !depositPaid &&
      j.depositRequired !== false
    ) {
      const soldAt = j.estimateAcceptedAt ?? (j.stage === "sold" ? j.stageEnteredAt : null);
      const days = threshold(settings, "sold_no_deposit", "days", 3);
      if (soldAt && now.getTime() - new Date(soldAt).getTime() >= days * DAY) {
        const d = j.deposit;
        items.push({
          ruleKey: "sold_no_deposit",
          category: "financial",
          priority: "high",
          title: `Sold, no deposit: ${label}`,
          detail: d
            ? `Sold ${plural(daysSince(soldAt, now), "day")} ago. Deposit invoice ${d.number} is ${formatCents(d.totalCents)}${d.collectedCents > 0 ? `, ${formatCents(d.collectedCents)} paid so far` : " and nothing is paid yet"}.`
            : `Sold ${plural(daysSince(soldAt, now), "day")} ago and the deposit isn't recorded as paid.`,
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
      const open = j.onboardingOpen;
      const holds = j.blockingHolds ?? [];
      // Everything cleared and nothing blocking: the worker moves it on its own.
      const waiting = open === undefined || open === null || open.length > 0 || holds.length > 0;
      if (age >= days && waiting) {
        const parts = [`${plural(age, "day")} in Onboarding.`];
        if (open === null) parts.push("No onboarding checklist yet.");
        else if (open?.length)
          parts.push(`Still open: ${open.slice(0, 5).join(", ")}${open.length > 5 ? "…" : "."}`);
        if (holds.length) parts.push(`On hold: ${holds.join(", ")}.`);
        items.push({
          ruleKey: "onboarding_stalled",
          category: "production",
          priority: "medium",
          title: `Onboarding stalled: ${label}`,
          detail: parts.join(" "),
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

    // Start date missed (rain delays don't count) → Critical, credit drafted.
    const promised = j.guaranteeDate ?? j.promisedStartDate;
    const todayIso = pacificIso(now);
    const rainSlip = (j.rainDelayDates ?? []).some(
      (d) => promised && d >= promised && d <= todayIso,
    );
    if (
      enabled(settings, "start_date_missed") &&
      promised &&
      !j.actualStartDate &&
      j.onTimeGuaranteeStatus !== "missed_weather" &&
      !rainSlip &&
      order < stageOrder("in_progress") &&
      promised < todayIso
    ) {
      const credit =
        settings.onTimeCreditCents && settings.onTimeCreditCents > 0
          ? ` An On-Time Guarantee credit of ${money(settings.onTimeCreditCents)} is drafted for owner approval.`
          : "";
      items.push({
        ruleKey: "start_date_missed",
        category: "qa",
        priority: "critical",
        title: `Start date missed: ${label}`,
        detail: `Promised to start ${promised}; stage is ${getStage(j.stage).label}.${credit}`,
        subjectType: "job",
        subjectId: j.id,
        ownerId: owner,
        dueAt: null,
        dedupeKey: `start_date_missed:${j.id}:${promised}`,
      });
    }

    const upcoming = j.stage === "ready_to_schedule" || j.stage === "scheduled";
    const daysToStart = j.startDate ? daysUntil(j.startDate, now) : null;

    // Missing crew: starts within N days and no crew.
    if (
      enabled(settings, "missing_crew") &&
      upcoming &&
      j.crewId === null &&
      daysToStart !== null
    ) {
      const days = threshold(settings, "missing_crew", "days", 5);
      if (daysToStart <= days) {
        items.push({
          ruleKey: "missing_crew",
          category: "scheduling",
          priority: "high",
          title: `No crew assigned: ${label}`,
          detail: `${startsWords(daysToStart, j.startDate as string)} and no crew is assigned.`,
          subjectType: "job",
          subjectId: j.id,
          ownerId: owner,
          dueAt: null,
          dedupeKey: `missing_crew:${j.id}`,
        });
      }
    }

    // Paint not ordered: starts within N days and no paint order placed.
    if (
      enabled(settings, "paint_not_ordered") &&
      upcoming &&
      j.paintOrdered !== undefined &&
      j.paintOrdered !== true &&
      daysToStart !== null
    ) {
      const days = threshold(settings, "paint_not_ordered", "days", 3);
      if (daysToStart <= days) {
        items.push({
          ruleKey: "paint_not_ordered",
          category: "production",
          priority: "high",
          title: `Paint not ordered: ${label}`,
          detail: `${startsWords(daysToStart, j.startDate as string)} and ${j.paintOrdered === null ? "there's no paint order" : "the paint order isn't placed"}.`,
          subjectType: "job",
          subjectId: j.id,
          ownerId: owner,
          dueAt: null,
          dedupeKey: `paint_not_ordered:${j.id}`,
        });
      }
    }

    // Missed daily update: a production day with no log by the cutoff (Pacific).
    if (enabled(settings, "missed_daily_update") && j.productionDays?.length) {
      const cutoff = threshold(settings, "missed_daily_update", "cutoff_hour", 19);
      const lookback = threshold(settings, "missed_daily_update", "lookback_days", 3);
      const missed = missedDailyUpdates(
        j.productionDays.filter((d) => !(j.rainDelayDates ?? []).includes(d)),
        j.logDates ?? [],
        now,
        { cutoffHour: cutoff, lookbackDays: lookback },
      );
      for (const d of missed) {
        items.push({
          ruleKey: "missed_daily_update",
          category: "qa",
          priority: "high",
          title: `No daily update ${d === todayIso ? "today" : `for ${formatDay(d)}`}: ${label}`,
          detail: `${formatDay(d)} was a production day and no daily log was posted by ${hourLabel(cutoff)}. The customer is promised a photo update every day.`,
          subjectType: "job",
          subjectId: j.id,
          ownerId: j.crewLeadId ?? owner,
          dueAt: null,
          dedupeKey: `missed_daily_update:${j.id}:${d}`,
        });
      }
    }

    // Punch list open: in Final Walkthrough N+ days with open items.
    if (
      enabled(settings, "punch_list_open") &&
      j.stage === "final_walkthrough" &&
      (j.punchOpen ?? 0) > 0
    ) {
      const days = threshold(settings, "punch_list_open", "days", 3);
      const age = daysSince(j.stageEnteredAt, now);
      if (age >= days) {
        items.push({
          ruleKey: "punch_list_open",
          category: "qa",
          priority: "medium",
          title: `Punch list open: ${label}`,
          detail: `${plural(j.punchOpen ?? 0, "punch item")} still open after ${plural(age, "day")} in Final Walkthrough.`,
          subjectType: "job",
          subjectId: j.id,
          ownerId: owner,
          dueAt: null,
          dedupeKey: `punch_list_open:${j.id}`,
        });
      }
    }

    // Weather risk (only when weather is connected).
    if (
      enabled(settings, "weather_risk") &&
      settings.weatherConnected &&
      j.weatherRiskDays?.length
    ) {
      const pct = threshold(settings, "weather_risk", "rain_percent", 60);
      const wet = j.weatherRiskDays.filter((d) => d.precipProbability >= pct);
      if (wet.length && j.workTypes.some((w) => SEASONAL.has(w))) {
        items.push({
          ruleKey: "weather_risk",
          category: "scheduling",
          priority: "high",
          title: `Weather risk: ${label}`,
          detail: `Rain ${Math.max(...wet.map((w) => w.precipProbability))}% forecast on ${wet.map((w) => formatDay(w.date)).join(", ")}. Mark a rain delay or move the day.`,
          subjectType: "job",
          subjectId: j.id,
          ownerId: owner,
          dueAt: null,
          dedupeKey: `weather_risk:${j.id}:${wet[0]?.date}`,
        });
      }
    }
  }

  // Sub compliance expiring (≤ N days, expired or missing).
  if (enabled(settings, "sub_compliance_expiring")) {
    for (const sub of snapshot.subcontractors ?? []) {
      if (!sub.issues.length) continue;
      const expired = sub.issues.some((i) => i.level === "expired");
      items.push({
        ruleKey: "sub_compliance_expiring",
        category: "documents",
        priority: expired ? "high" : "medium",
        title: `${expired ? "Sub paperwork expired" : "Sub paperwork expiring"}: ${sub.name}`,
        detail: sub.issues.map((i) => i.message).join(" "),
        subjectType: "subcontractor",
        subjectId: sub.id,
        ownerId: null,
        dueAt: null,
        dedupeKey: `sub_compliance_expiring:${sub.id}`,
      });
    }
  }

  // Overdue invoice: 7 / 30 days past due → medium / high (one item per invoice; it escalates).
  if (enabled(settings, "overdue_invoice")) {
    const medium = threshold(settings, "overdue_invoice", "medium_days", 7);
    const high = threshold(settings, "overdue_invoice", "high_days", 30);
    for (const inv of snapshot.invoices ?? []) {
      if (inv.balanceCents <= 0 || inv.daysPastDue < medium) continue;
      items.push({
        ruleKey: "overdue_invoice",
        category: "financial",
        priority: inv.daysPastDue >= high ? "high" : "medium",
        title: `Overdue invoice: ${inv.jobName} (${inv.number})`,
        detail: `${formatCents(inv.balanceCents)} is ${plural(inv.daysPastDue, "day")} past due. Call the customer or record the payment.`,
        subjectType: "job",
        subjectId: inv.jobId,
        ownerId: inv.ownerId,
        dueAt: null,
        dedupeKey: `overdue_invoice:${inv.id}`,
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
