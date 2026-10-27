import type { WorkspaceSummary } from "@/lib/metrics/registry";

/**
 * Ready Score (SPEC §8.3 "My Day"): how ready someone is for their day, 0–100,
 * deterministic and explained. It starts at 100 and loses points for what is
 * waiting on them, each with a cap so one kind of backlog can't hide the rest.
 */

export type ReadyFactor = {
  key: string;
  label: string;
  /** Points taken off (0 when nothing is waiting). */
  points: number;
  max: number;
  count: number;
  href: string;
};

const RULES: readonly {
  key: string;
  label: (n: number) => string;
  per: number;
  max: number;
  count: (s: WorkspaceSummary) => number;
  href: string;
}[] = [
  {
    key: "overdue_tasks",
    label: (n) => `${n} overdue task${n === 1 ? "" : "s"}`,
    per: 10,
    max: 30,
    count: (s) => s.tasks_overdue,
    href: "/workspace#my-tasks",
  },
  {
    key: "urgent_attention",
    label: (n) => `${n} critical or high Attention item${n === 1 ? "" : "s"}`,
    per: 10,
    max: 30,
    count: (s) => s.attention_urgent,
    href: "/attention?mine=1&priority=urgent",
  },
  {
    key: "leads_awaiting_contact",
    label: (n) => `${n} new lead${n === 1 ? "" : "s"} not reached yet`,
    per: 5,
    max: 20,
    count: (s) => s.leads_awaiting_contact,
    href: "/leads/list?tab=mine",
  },
  {
    key: "cases_overdue",
    label: (n) => `${n} case${n === 1 ? "" : "s"} past SLA`,
    per: 5,
    max: 10,
    count: (s) => s.cases_overdue,
    href: "/cases",
  },
  {
    key: "unread",
    label: (n) => `${n} unread customer conversation${n === 1 ? "" : "s"}`,
    per: 2,
    max: 10,
    count: (s) => s.unread_sms + s.unread_email,
    href: "/messages",
  },
];

export type ReadyScore = {
  score: number;
  grade: "ready" | "busy" | "behind";
  label: string;
  factors: ReadyFactor[];
};

export function readyScore(s: WorkspaceSummary): ReadyScore {
  const factors = RULES.map((r) => {
    const count = Math.max(0, r.count(s));
    return {
      key: r.key,
      label: r.label(count),
      points: Math.min(r.max, count * r.per),
      max: r.max,
      count,
      href: r.href,
    };
  });
  const score = Math.max(0, 100 - factors.reduce((t, f) => t + f.points, 0));
  const grade = score >= 80 ? "ready" : score >= 50 ? "busy" : "behind";
  return {
    score,
    grade,
    label: grade === "ready" ? "Ready" : grade === "busy" ? "Busy" : "Behind",
    factors: factors.filter((f) => f.points > 0),
  };
}

/** "2 appts today · 3 jobs · 5 new leads · 1 approval · 2 awaiting reply · 0 at risk" */
export function countsLine(s: WorkspaceSummary): string {
  const p = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return [
    `${p(s.appointments_today, "appt")} today`,
    p(s.jobs_active, "job"),
    p(s.leads_new, "new lead"),
    p(s.approvals_pending, "approval"),
    `${s.estimates_awaiting_reply} awaiting reply`,
    `${s.jobs_at_risk} at risk`,
  ].join(" · ");
}

/** "Good morning", "Good afternoon" or "Good evening" for a Pacific hour. */
export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
