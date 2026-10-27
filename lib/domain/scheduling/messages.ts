import { formatDay, formatRange, type IsoDate } from "./dates";

/**
 * Draft production messages (SPEC §11.2 #8 schedule published, #9 rain delay,
 * #11 daily update). Plain, friendly, specific, short sentences, signed by the
 * job's point of contact (SPEC §11.3). The rain-delay text is the SPEC's own
 * wording. Draft wording – owner to approve; Phase 8 templates replace these.
 * Everything goes through the outbox as simulated.
 */

export const SCHEDULE_TEMPLATE_KEY = "schedule_published";
export const RAIN_DELAY_TEMPLATE_KEY = "rain_delay";
export const DAILY_UPDATE_TEMPLATE_KEY = "daily_update";

export type NoticeContext = {
  customerFirstName: string | null;
  /** The point of contact's name (signature). */
  signerName: string;
  companyName: string;
  crewLeadName: string | null;
  arrivalWindow: string | null;
};

function hi(name: string | null): string {
  return name ? `Hi ${name}` : "Hi";
}

function first(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export type CustomerNotice = { sms: string; emailSubject: string; emailBody: string };

/** Customer notice after Publish: new dates, moved dates, or taken off the schedule. */
export function scheduleNotice(
  change: "scheduled" | "moved" | "unscheduled" | "crew_changed",
  dates: { startsOn: IsoDate | null; endsOn: IsoDate | null },
  c: NoticeContext,
): CustomerNotice {
  const sign = `${first(c.signerName)}, ${c.companyName}`;
  const when =
    dates.startsOn && dates.endsOn ? formatRange(dates.startsOn, dates.endsOn) : "your dates";
  const start = dates.startsOn ? formatDay(dates.startsOn) : "the start day";
  const arrive = c.arrivalWindow ? ` We'll arrive between ${c.arrivalWindow}.` : "";
  const lead = c.crewLeadName ? ` ${first(c.crewLeadName)} leads your crew.` : "";
  const rain =
    " If rain gets in the way, you're first on the schedule when it clears, and the delay never costs you anything.";
  let sms: string;
  let subject: string;
  if (change === "unscheduled") {
    sms = `${hi(c.customerFirstName)}, we've taken your painting dates off the schedule for now. I'll call you to set new ones. – ${sign}`;
    subject = "Your painting dates";
  } else if (change === "crew_changed") {
    sms = `${hi(c.customerFirstName)}, a quick update: your dates stay ${when}.${lead} – ${sign}`;
    subject = "Your crew for the painting work";
  } else if (change === "moved") {
    sms = `${hi(c.customerFirstName)}, your painting dates have changed. We now start ${start} (${when}).${arrive}${lead} – ${sign}`;
    subject = `New start date: ${start}`;
  } else {
    sms = `${hi(c.customerFirstName)}, you're on the schedule! We start ${start} (${when}).${arrive}${lead}${rain} – ${sign}`;
    subject = `You're on the schedule: ${start}`;
  }
  const emailBody = [
    `${hi(c.customerFirstName)},`,
    "",
    sms.replace(/^Hi[^,]*, /, "").replace(/ – .*$/, ""),
    "",
    "Reply to this message or call us if anything changes on your side.",
    "",
    sign,
  ].join("\n");
  return { sms, emailSubject: subject, emailBody };
}

/** Crew notice (to the crew lead) after Publish. */
export function crewNotice(
  crewName: string,
  rows: readonly {
    jobLabel: string;
    city: string | null;
    before: string | null;
    after: string | null;
  }[],
): { subject: string; body: string } {
  const lines = rows.map((r) =>
    r.after
      ? `• ${r.jobLabel}${r.city ? ` (${r.city})` : ""}: ${r.before && r.before !== r.after ? `moved from ${r.before} to ${r.after}` : r.after}`
      : `• ${r.jobLabel}${r.city ? ` (${r.city})` : ""}: taken off your schedule${r.before ? ` (was ${r.before})` : ""}`,
  );
  return {
    subject: `Schedule update for ${crewName}`,
    body: [
      `Schedule changes for ${crewName}:`,
      ...lines,
      "",
      "Open My Projects for scope, colors and access notes.",
    ].join("\n"),
  };
}

/** Rain delay (SPEC §11.2 #9 wording). */
export function rainDelayText(
  date: IsoDate,
  c: Pick<NoticeContext, "customerFirstName" | "signerName" | "companyName">,
): string {
  const dow = formatDay(date).split(",")[0];
  return `${hi(c.customerFirstName)}, rain's coming in ${dowLong(dow ?? "")}. We'll move your start to the next dry day, and you're first on the list. No cost to you. – ${first(c.signerName)}, ${c.companyName}`;
}

function dowLong(d: string): string {
  const map: Record<string, string> = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday",
    Sat: "Saturday",
    Sun: "Sunday",
  };
  return map[d] ?? d;
}

/** The customer update from a daily log (SPEC §11.2 #11), signed by the point of contact. */
export function dailyUpdateText(
  log: { finishedToday: string; nextUp: string | null; photoCount: number },
  c: Pick<NoticeContext, "customerFirstName" | "signerName" | "companyName">,
): { sms: string; emailSubject: string; emailBody: string } {
  const photos = log.photoCount
    ? ` ${log.photoCount} photo${log.photoCount === 1 ? "" : "s"} from today are in your project.`
    : "";
  const next = log.nextUp?.trim() ? ` Next up: ${log.nextUp.trim()}` : "";
  const sms = `${hi(c.customerFirstName)}, today's update: ${log.finishedToday.trim()}${/[.!?]$/.test(log.finishedToday.trim()) ? "" : "."}${next}${next && !/[.!?]$/.test(next) ? "." : ""} The work area is cleaned up for the evening.${photos} – ${first(c.signerName)}, ${c.companyName}`;
  return {
    sms,
    emailSubject: "Today's update on your painting project",
    emailBody: [
      `${hi(c.customerFirstName)},`,
      "",
      `Finished today: ${log.finishedToday.trim()}`,
      log.nextUp?.trim() ? `Next up: ${log.nextUp.trim()}` : null,
      "The work area is cleaned up for the evening.",
      photos.trim() || null,
      "",
      `${first(c.signerName)}, ${c.companyName}`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
  };
}

/** "8:00–8:30 am" from the schedule settings. */
export function arrivalWindowLabel(dayStart: string, minutes: number): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(dayStart);
  if (!m) return null;
  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const fmt = (t: number, withSuffix: boolean) => {
    const h = Math.floor(t / 60) % 24;
    const mm = String(t % 60).padStart(2, "0");
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm}${withSuffix ? (h < 12 ? " am" : " pm") : ""}`;
  };
  if (minutes <= 0) return fmt(startMin, true);
  const end = startMin + minutes;
  const samePeriod = Math.floor(startMin / 720) === Math.floor(end / 720);
  return `${fmt(startMin, !samePeriod)}–${fmt(end, true)}`;
}
