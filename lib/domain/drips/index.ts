import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { PACIFIC } from "@/lib/domain/workflows/compliance";

/**
 * Drips (SPEC §5.8, §8.11, §11.2 #16): ordered steps, each after a delay or on
 * a calendar date, with exit conditions. Pure: the worker asks for the next
 * step and whether the enrollment should stop.
 *
 * Calendar-date steps ("on 02-01") belong to a season: when a step's date has
 * already passed this year but a later calendar step is still ahead, the step
 * is skipped (someone enrolled in March gets the March and April notes, not
 * February's a year later). Sends go out at 10:00 am Pacific.
 */

export type DripChannel = "sms" | "email" | "sms_or_email" | "email_or_sms";

export type DripStep = {
  delay_days?: number;
  on_date?: string;
  channel: DripChannel;
  template_key: string;
};

export const DRIP_EXIT_CONDITIONS = {
  replied: "They replied",
  booked: "A walkthrough is booked",
  converted: "The lead became a job",
  sold: "They signed an estimate",
  lost: "The lead or job was closed as lost",
  opted_out: "They opted out or asked not to be contacted",
} as const;
export type DripExitCondition = keyof typeof DRIP_EXIT_CONDITIONS;

export const DRIP_SEND_TIME = "10:00";

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const KEY = /^[a-z0-9][a-z0-9_]{0,59}$/;

export function validateDripSteps(raw: unknown): { steps: DripStep[]; errors: string[] } {
  const errors: string[] = [];
  const steps: DripStep[] = [];
  if (!Array.isArray(raw)) return { steps, errors: ["Steps must be a list."] };
  if (raw.length === 0) errors.push("Add at least one step.");
  if (raw.length > 20) errors.push("A drip can have up to 20 steps.");
  raw.forEach((s: unknown, i) => {
    const n = i + 1;
    if (!s || typeof s !== "object") {
      errors.push(`Step ${n} is empty.`);
      return;
    }
    const o = s as Record<string, unknown>;
    const hasDelay = typeof o.delay_days === "number";
    const hasDate = typeof o.on_date === "string";
    if (hasDelay === hasDate) errors.push(`Step ${n}: choose either a delay in days or a date.`);
    if (
      hasDelay &&
      (!Number.isInteger(o.delay_days) ||
        (o.delay_days as number) < 0 ||
        (o.delay_days as number) > 365)
    ) {
      errors.push(`Step ${n}: the delay is 0–365 days.`);
    }
    if (hasDate && !MMDD.test(o.on_date as string)) errors.push(`Step ${n}: the date is MM-DD.`);
    const channel = o.channel;
    if (
      channel !== "sms" &&
      channel !== "email" &&
      channel !== "sms_or_email" &&
      channel !== "email_or_sms"
    ) {
      errors.push(`Step ${n}: pick a channel.`);
    }
    if (typeof o.template_key !== "string" || !KEY.test(o.template_key)) {
      errors.push(`Step ${n}: pick a template.`);
    }
    steps.push({
      ...(hasDelay ? { delay_days: o.delay_days as number } : {}),
      ...(hasDate ? { on_date: o.on_date as string } : {}),
      channel: channel as DripChannel,
      template_key: String(o.template_key ?? ""),
    });
  });
  return { steps, errors };
}

function pacificParts(at: Date): { y: number; m: number; d: number } {
  const z = toZonedTime(at, PACIFIC);
  return { y: z.getFullYear(), m: z.getMonth() + 1, d: z.getDate() };
}

function at10(y: number, mmdd: string): Date {
  return fromZonedTime(`${y}-${mmdd}T${DRIP_SEND_TIME}:00`, PACIFIC);
}

function addDaysAt10(from: Date, days: number): Date {
  const p = pacificParts(from);
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  const iso = base.toISOString().slice(0, 10);
  return fromZonedTime(`${iso}T${DRIP_SEND_TIME}:00`, PACIFIC);
}

/**
 * The next step to send from `fromIndex` on, and when. Null when the drip is
 * finished. `from` is when the previous step went out (or the enrollment).
 */
export function nextDripStep(
  steps: readonly DripStep[],
  fromIndex: number,
  from: Date,
): { index: number; at: Date } | null {
  const year = pacificParts(from).y;
  for (let i = fromIndex; i < steps.length; i++) {
    const s = steps[i] as DripStep;
    if (typeof s.delay_days === "number") {
      return { index: i, at: s.delay_days === 0 ? from : addDaysAt10(from, s.delay_days) };
    }
    if (s.on_date) {
      const thisYear = at10(year, s.on_date);
      if (thisYear.getTime() >= from.getTime()) return { index: i, at: thisYear };
      const laterAhead = steps
        .slice(i + 1)
        .some((x) => x.on_date && at10(year, x.on_date).getTime() >= from.getTime());
      if (laterAhead) continue;
      return { index: i, at: at10(year + 1, s.on_date) };
    }
  }
  return null;
}

export type DripFacts = {
  repliedSinceEnrolled: boolean;
  walkthroughBooked: boolean;
  converted: boolean;
  sold: boolean;
  lost: boolean;
  optedOut: boolean;
};

/** Why an enrollment should stop now, or null. */
export function dripExitReason(conditions: readonly string[], facts: DripFacts): string | null {
  const hit = (k: DripExitCondition, v: boolean) =>
    conditions.includes(k) && v ? DRIP_EXIT_CONDITIONS[k] : null;
  return (
    hit("replied", facts.repliedSinceEnrolled) ??
    hit("booked", facts.walkthroughBooked) ??
    hit("converted", facts.converted) ??
    hit("sold", facts.sold) ??
    hit("lost", facts.lost) ??
    hit("opted_out", facts.optedOut)
  );
}

export function describeDripStep(s: DripStep): string {
  const when =
    typeof s.delay_days === "number"
      ? s.delay_days === 0
        ? "Right away"
        : `After ${s.delay_days} day${s.delay_days === 1 ? "" : "s"}`
      : `On ${new Date(`2026-${s.on_date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}`;
  const how =
    s.channel === "sms"
      ? "text"
      : s.channel === "email"
        ? "email"
        : s.channel === "sms_or_email"
          ? "text (else email)"
          : "email (else text)";
  return `${when}: ${how} “${s.template_key}”`;
}

export { DEFAULT_DRIPS } from "./defaults";
