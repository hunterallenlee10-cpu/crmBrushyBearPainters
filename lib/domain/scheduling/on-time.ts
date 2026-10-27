import { addDays, daysBetween, formatDay, type IsoDate } from "./dates";

/**
 * On-Time Guarantee (SPEC §1.3): "We start on the scheduled date or take $250
 * off. Rain delays don't count." Pure.
 *
 * - The guarantee date is set on the first publish. A later publish moves it
 *   only when the reason is weather or a customer request; when the company
 *   moves a start later, the guarantee still counts from the original date
 *   (moving it earlier makes the earlier date the promise).
 * - Started on or before the guarantee date → met.
 * - Late (started late, or not started and the date passed): if a rain delay
 *   was marked between the guarantee date and the start, it's weather (no
 *   credit). Otherwise a credit (amount from Company Settings) is drafted for
 *   owner approval; Phase 7 puts it on the final invoice.
 */

export type OnTimeStatus =
  "n/a" | "met" | "missed_weather" | "missed_credit_pending" | "credit_applied" | "waived_by_owner";

export type RescheduleReason = "company" | "weather" | "customer";

export const RESCHEDULE_REASON_LABELS: Record<RescheduleReason, string> = {
  company: "Our schedule change",
  weather: "Weather",
  customer: "Customer asked",
};

/** The guarantee date after a publish changes the job's first start. */
export function nextGuaranteeDate(
  current: IsoDate | null,
  newStart: IsoDate | null,
  reason: RescheduleReason,
): IsoDate | null {
  if (!newStart) return current;
  if (!current) return newStart;
  if (reason === "weather" || reason === "customer") return newStart;
  return newStart < current ? newStart : current;
}

export type OnTimeInput = {
  guaranteeDate: IsoDate | null;
  actualStartDate: IsoDate | null;
  today: IsoDate;
  rainDelayDates: readonly IsoDate[];
  currentStatus: OnTimeStatus;
  amountCents: number;
};

export type OnTimeResult = {
  status: OnTimeStatus;
  /** A credit should be drafted (for owner approval). */
  draftCredit: { amountCents: number; reason: string } | null;
  detail: string;
};

const DECIDED = new Set<OnTimeStatus>(["credit_applied", "waived_by_owner"]);

export function evaluateOnTime(i: OnTimeInput): OnTimeResult {
  if (DECIDED.has(i.currentStatus)) {
    return {
      status: i.currentStatus,
      draftCredit: null,
      detail:
        i.currentStatus === "credit_applied"
          ? "The on-time credit is on the invoice."
          : "An owner waived the on-time credit.",
    };
  }
  if (!i.guaranteeDate) {
    return { status: "n/a", draftCredit: null, detail: "No start date has been promised yet." };
  }
  const g = i.guaranteeDate;
  if (i.actualStartDate && i.actualStartDate <= g) {
    return {
      status: "met",
      draftCredit: null,
      detail: `Started on time (${formatDay(i.actualStartDate)}).`,
    };
  }
  if (!i.actualStartDate && i.today <= g) {
    return { status: "n/a", draftCredit: null, detail: `Promised start: ${formatDay(g)}.` };
  }
  const end = i.actualStartDate ?? i.today;
  const late = daysBetween(g, end);
  const weather = i.rainDelayDates.some((d) => d >= g && d <= end);
  if (weather) {
    return {
      status: "missed_weather",
      draftCredit: null,
      detail: `Start moved by a rain delay. Rain delays don't count, so no credit.`,
    };
  }
  if (i.amountCents <= 0) {
    return {
      status: "missed_credit_pending",
      draftCredit: null,
      detail: "The start slipped. The on-time credit amount in Company Settings is $0.",
    };
  }
  const reason = i.actualStartDate
    ? `Promised ${formatDay(g)}, started ${formatDay(i.actualStartDate)} (${late} day${late === 1 ? "" : "s"} late).`
    : `Promised ${formatDay(g)}; not started as of ${formatDay(i.today)}.`;
  return {
    status: "missed_credit_pending",
    draftCredit: { amountCents: i.amountCents, reason },
    detail: `${reason} An on-time credit waits for owner approval.`,
  };
}

/** Whether a reschedule from `from` to `to` keeps the job on its promise (for warnings). */
export function rescheduleCostsCredit(
  guaranteeDate: IsoDate | null,
  newStart: IsoDate,
  reason: RescheduleReason,
): boolean {
  return reason === "company" && guaranteeDate !== null && newStart > guaranteeDate;
}

/** The day after a rain day: when the job should be first in line. */
export function firstDayAfterRain(date: IsoDate): IsoDate {
  return addDays(date, 1);
}
