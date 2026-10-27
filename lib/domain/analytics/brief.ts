import {
  DAILY_BRIEF_METRICS,
  dailyBriefValue,
  formatMoney,
  ratio,
  type DailyBrief,
  type DailyBriefMetricId,
} from "@/lib/metrics/registry";

/**
 * Daily Brief (SPEC §8.14): a deterministic summary of what changed on a
 * Pacific day and what needs attention now. Every number is a registry
 * metric (cited by id); the sentences are templates, never generated text.
 */

export type BriefLine = { text: string; metricIds: readonly DailyBriefMetricId[]; href?: string };

export type DailyBriefSummary = {
  day: string;
  headline: string;
  changed: readonly BriefLine[];
  attention: readonly BriefLine[];
  /** Every metric id the brief used. */
  citations: readonly DailyBriefMetricId[];
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function summarizeDay(b: DailyBrief, dayLabel: string): DailyBriefSummary {
  const changed: BriefLine[] = [];
  const v = (id: DailyBriefMetricId) => dailyBriefValue(id, b).value ?? 0;
  if (b.leads_created) {
    changed.push({
      text: `${plural(b.leads_created, "new lead")} came in.`,
      metricIds: ["brief.leads_created"],
      href: "/leads/list",
    });
  }
  if (b.walkthroughs_completed) {
    changed.push({
      text: `${plural(b.walkthroughs_completed, "walkthrough")} done.`,
      metricIds: ["brief.walkthroughs_completed"],
    });
  }
  if (b.estimates_sent || b.estimates_accepted) {
    const accepted =
      b.estimates_accepted > 0
        ? ` ${plural(b.estimates_accepted, "estimate")} accepted${b.can_see_money ? ` (${formatMoney(b.accepted_value_cents)})` : ""}.`
        : "";
    changed.push({
      text: `${plural(b.estimates_sent, "estimate")} sent.${accepted}`,
      metricIds: b.can_see_money
        ? ["brief.estimates_sent", "brief.estimates_accepted", "brief.accepted_value"]
        : ["brief.estimates_sent", "brief.estimates_accepted"],
      href: "/estimates",
    });
  }
  if (b.jobs_started || b.jobs_completed) {
    changed.push({
      text: `${plural(b.jobs_started, "job")} started, ${plural(b.jobs_completed, "job")} completed.`,
      metricIds: ["brief.jobs_started", "brief.jobs_completed"],
    });
  }
  if (b.daily_logs) {
    changed.push({
      text: `${plural(b.daily_logs, "daily log")} submitted.`,
      metricIds: ["brief.daily_logs"],
    });
  }
  if (b.can_see_money && ((b.invoices_sent ?? 0) > 0 || (b.collected_cents ?? 0) > 0)) {
    changed.push({
      text: `${plural(b.invoices_sent ?? 0, "invoice")} sent, ${formatMoney(b.collected_cents ?? 0)} collected.`,
      metricIds: ["brief.invoices_sent", "brief.collected"],
      href: "/invoices",
    });
  }
  if (b.reviews_left) {
    changed.push({
      text: `${plural(b.reviews_left, "review")} left.`,
      metricIds: ["brief.reviews_left"],
      href: "/reviews",
    });
  }

  const attention: BriefLine[] = [];
  if (b.attention_now) {
    attention.push({
      text: `${plural(b.attention_now, "critical or high item")} in Attention.`,
      metricIds: ["brief.attention_now"],
      href: "/attention?priority=urgent",
    });
  }
  if (b.can_see_money && (b.overdue_invoices ?? 0) > 0) {
    attention.push({
      text: `${plural(b.overdue_invoices ?? 0, "invoice")} past due.`,
      metricIds: ["brief.overdue_invoices"],
      href: "/invoices/aging",
    });
  }
  if (b.approvals_pending) {
    attention.push({
      text: `${plural(b.approvals_pending, "approval")} waiting for an owner.`,
      metricIds: ["brief.approvals_pending"],
      href: "/jobs/approvals",
    });
  }
  if (b.unread_conversations) {
    attention.push({
      text: `${plural(b.unread_conversations, "customer conversation")} unread.`,
      metricIds: ["brief.unread_conversations"],
      href: "/messages",
    });
  }
  if (b.ready_to_schedule) {
    attention.push({
      text: `${plural(b.ready_to_schedule, "job")} ready to schedule.`,
      metricIds: ["brief.ready_to_schedule"],
      href: "/schedule/master",
    });
  }

  const activity =
    v("brief.leads_created") +
    v("brief.estimates_sent") +
    v("brief.estimates_accepted") +
    v("brief.jobs_started") +
    v("brief.jobs_completed") +
    v("brief.daily_logs") +
    v("brief.walkthroughs_completed");
  const headline =
    activity === 0 && changed.length === 0
      ? `Nothing changed on ${dayLabel}.`
      : `${dayLabel}: ${changed.length} kind${changed.length === 1 ? "" : "s"} of activity.`;
  const citations = [...new Set([...changed, ...attention].flatMap((l) => l.metricIds))];
  return {
    day: b.day,
    headline,
    changed,
    attention: attention.length
      ? attention
      : [{ text: "Nothing needs attention right now.", metricIds: ["brief.attention_now"] }],
    citations,
  };
}

/** Registry labels for the cited ids (shown under the brief). */
export function briefCitations(ids: readonly DailyBriefMetricId[]): string[] {
  return ids.map((id) => `${DAILY_BRIEF_METRICS[id].label} (${id})`);
}

// ---------------------------------------------------------------------------
// On Pace (SPEC §8.14 "On Pace – This Month")
// ---------------------------------------------------------------------------

export type PaceStatus = "ahead" | "on_pace" | "behind" | "no_goal" | "hidden";

export type PaceResult = {
  status: PaceStatus;
  /** Sold so far ÷ where the goal says we should be by today (0..). */
  paceRatio: number | null;
  /** Share of the month gone. */
  monthShare: number | null;
  /** Share of the goal sold so far. */
  goalShare: number | null;
  text: string;
};

/**
 * Month-to-date sold vs the month's goal, pro-rated by day. Within ±5% of
 * the pro-rated goal counts as on pace.
 */
export function onPace(input: {
  soldCents: number | null;
  goalCents: number | null;
  dayOfMonth: number;
  daysInMonth: number;
}): PaceResult {
  const { soldCents, goalCents, dayOfMonth, daysInMonth } = input;
  const monthShare = ratio(dayOfMonth, daysInMonth);
  if (soldCents === null) {
    return {
      status: "hidden",
      paceRatio: null,
      monthShare,
      goalShare: null,
      text: "Amounts hidden for your role",
    };
  }
  if (!goalCents || goalCents <= 0) {
    return {
      status: "no_goal",
      paceRatio: null,
      monthShare,
      goalShare: null,
      text: `${formatMoney(soldCents)} sold so far · no revenue goal configured`,
    };
  }
  const expected = (goalCents * dayOfMonth) / Math.max(1, daysInMonth);
  const paceRatio = expected > 0 ? soldCents / expected : null;
  const goalShare = soldCents / goalCents;
  const status: PaceStatus =
    paceRatio === null
      ? "on_pace"
      : paceRatio >= 1.05
        ? "ahead"
        : paceRatio >= 0.95
          ? "on_pace"
          : "behind";
  const pct = Math.round(goalShare * 100);
  const word = status === "ahead" ? "ahead of" : status === "behind" ? "behind" : "on";
  return {
    status,
    paceRatio,
    monthShare,
    goalShare,
    text: `${formatMoney(soldCents)} sold · ${pct}% of the ${formatMoney(goalCents)} goal with ${Math.round((monthShare ?? 0) * 100)}% of the month gone · ${word} pace`,
  };
}
