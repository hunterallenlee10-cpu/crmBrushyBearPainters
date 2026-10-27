import { describe, expect, it } from "vitest";
import {
  addDaysToIsoDate,
  defaultCustomSnooze,
  dueCountdown,
  formatSpan,
  minCustomSnooze,
  openedLabel,
  pacificInputToIso,
  snoozePresets,
} from "./time";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatSpan", () => {
  it("rounds down to minutes, hours, then days", () => {
    expect(formatSpan(30_000)).toBe("under a minute");
    expect(formatSpan(5 * MIN)).toBe("5 min");
    expect(formatSpan(59 * MIN)).toBe("59 min");
    expect(formatSpan(2 * HOUR + 59 * MIN)).toBe("2 h");
    expect(formatSpan(23 * HOUR)).toBe("23 h");
    expect(formatSpan(DAY)).toBe("1 day");
    expect(formatSpan(47 * HOUR)).toBe("1 day");
    expect(formatSpan(3 * DAY + HOUR)).toBe("3 days");
    expect(formatSpan(-3 * DAY)).toBe("3 days");
  });
});

describe("dueCountdown", () => {
  const now = new Date("2026-10-27T17:00:00Z");
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();

  it("is null without a due time", () => {
    expect(dueCountdown(null, now)).toBeNull();
    expect(dueCountdown("not a date", now)).toBeNull();
  });

  it("counts down to the due time", () => {
    expect(dueCountdown(at(2 * HOUR), now)).toEqual({ label: "due in 2 h", tone: "soon" });
    expect(dueCountdown(at(20 * MIN), now)).toEqual({ label: "due in 20 min", tone: "soon" });
    expect(dueCountdown(at(5 * HOUR), now)).toEqual({ label: "due in 5 h", tone: "later" });
    expect(dueCountdown(at(3 * DAY), now)).toEqual({ label: "due in 3 days", tone: "later" });
  });

  it("says how overdue it is", () => {
    expect(dueCountdown(at(-DAY - HOUR), now)).toEqual({
      label: "overdue by 1 day",
      tone: "overdue",
    });
    expect(dueCountdown(at(-90 * MIN), now)).toEqual({ label: "overdue by 1 h", tone: "overdue" });
    expect(dueCountdown(at(-10_000), now)).toEqual({
      label: "overdue by under a minute",
      tone: "overdue",
    });
  });
});

describe("openedLabel", () => {
  const now = new Date("2026-10-27T17:00:00Z");
  it("reads naturally", () => {
    expect(openedLabel(new Date(now.getTime() - 3 * HOUR).toISOString(), now)).toBe(
      "opened 3 h ago",
    );
    expect(openedLabel(new Date(now.getTime() - 10_000).toISOString(), now)).toBe(
      "opened just now",
    );
    expect(openedLabel(new Date(now.getTime() - 30 * HOUR).toISOString(), now)).toBe(
      "opened yesterday",
    );
    expect(openedLabel("2026-08-01T17:00:00Z", now)).toBe("opened on Aug 1, 2026");
  });
});

describe("addDaysToIsoDate", () => {
  it("crosses months, years and DST without drifting", () => {
    expect(addDaysToIsoDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToIsoDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToIsoDate("2026-11-01", 7)).toBe("2026-11-08");
  });
});

describe("snoozePresets (Pacific time)", () => {
  const byId = (now: Date) => {
    const [hour, tomorrow, monday] = snoozePresets(now);
    if (!hour || !tomorrow || !monday) throw new Error("three presets expected");
    return { hour, tomorrow, monday };
  };

  it("offers 1 hour, tomorrow 8 AM and next Monday 8 AM", () => {
    // Tuesday Oct 27, 2026, 10:00 AM PDT (UTC-7).
    const now = new Date("2026-10-27T17:00:00Z");
    const p = byId(now);
    expect(p.hour.until.toISOString()).toBe("2026-10-27T18:00:00.000Z");
    expect(p.hour.detail).toBe("until 11:00 AM");
    expect(p.tomorrow.until.toISOString()).toBe("2026-10-28T15:00:00.000Z");
    expect(p.tomorrow.detail).toBe("Wed, Oct 28");
    // Next Monday is Nov 2, after the switch to PST (UTC-8).
    expect(p.monday.until.toISOString()).toBe("2026-11-02T16:00:00.000Z");
    expect(p.monday.detail).toBe("Mon, Nov 2");
  });

  it("uses the Pacific date, not the UTC date, late in the evening", () => {
    // Tuesday Oct 27, 11:30 PM PDT = Wednesday 06:30 UTC.
    const p = byId(new Date("2026-10-28T06:30:00Z"));
    expect(p.tomorrow.until.toISOString()).toBe("2026-10-28T15:00:00.000Z");
  });

  it("goes to the following week on a Monday", () => {
    // Monday Nov 2, 2026, 9:00 AM PST.
    const p = byId(new Date("2026-11-02T17:00:00Z"));
    expect(p.monday.until.toISOString()).toBe("2026-11-09T16:00:00.000Z");
  });

  it("goes to tomorrow from a Sunday", () => {
    // Sunday Nov 1, 2026, noon PST.
    const p = byId(new Date("2026-11-01T20:00:00Z"));
    expect(p.monday.until.toISOString()).toBe("2026-11-02T16:00:00.000Z");
    expect(p.tomorrow.until.toISOString()).toBe(p.monday.until.toISOString());
  });

  it("is always in the future", () => {
    for (let h = 0; h < 24 * 7; h += 5) {
      const now = new Date(Date.UTC(2026, 9, 26, h));
      for (const preset of snoozePresets(now)) {
        expect(preset.until.getTime()).toBeGreaterThan(now.getTime());
      }
    }
  });
});

describe("custom snooze input (Pacific)", () => {
  it("reads a datetime-local value as Pacific time", () => {
    expect(pacificInputToIso("2026-10-28T08:00")).toBe("2026-10-28T15:00:00.000Z");
    expect(pacificInputToIso("2026-12-01T13:30")).toBe("2026-12-01T21:30:00.000Z");
  });

  it("rejects malformed or impossible values", () => {
    expect(pacificInputToIso("")).toBeNull();
    expect(pacificInputToIso("2026-10-28")).toBeNull();
    expect(pacificInputToIso("2026-02-30T08:00")).toBeNull();
    expect(pacificInputToIso("tomorrow")).toBeNull();
  });

  it("defaults to tomorrow 8 AM and never earlier than now", () => {
    const now = new Date("2026-10-27T17:00:00Z");
    expect(defaultCustomSnooze(now)).toBe("2026-10-28T08:00");
    expect(minCustomSnooze(now)).toBe("2026-10-27T10:00");
  });
});
