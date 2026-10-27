import { addDays, daysBetween, eachDay, weekStart, type IsoDate } from "./dates";

/**
 * Crew-row calendar layout for the Master Schedule (SPEC §8.6): Day / Week /
 * Multi-week windows, multi-day bars clipped to the window and stacked in
 * lanes when they overlap, and the date math for drag (move) and resize. Pure.
 */

export const CALENDAR_VIEWS = ["day", "week", "multi"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export function isCalendarView(v: unknown): v is CalendarView {
  return typeof v === "string" && (CALENDAR_VIEWS as readonly string[]).includes(v);
}

/** The visible days for a view around an anchor date. */
export function calendarWindow(view: CalendarView, anchor: IsoDate): IsoDate[] {
  if (view === "day") return [anchor];
  const start = weekStart(anchor);
  return eachDay(start, addDays(start, view === "week" ? 6 : 27));
}

/** Where "previous" / "next" go from the anchor. */
export function shiftAnchor(view: CalendarView, anchor: IsoDate, dir: -1 | 1): IsoDate {
  return addDays(anchor, dir * (view === "day" ? 1 : view === "week" ? 7 : 28));
}

export type CalendarBar = { id: string; crewId: string; startsOn: IsoDate; endsOn: IsoDate };

export type PlacedBar<B extends CalendarBar> = {
  bar: B;
  /** 0-based column of the first visible day. */
  col: number;
  span: number;
  lane: number;
  clippedStart: boolean;
  clippedEnd: boolean;
};

/** Bars per crew, clipped to the window, stacked into the fewest lanes. */
export function layoutRows<B extends CalendarBar>(
  bars: readonly B[],
  days: readonly IsoDate[],
): Map<string, { lanes: number; bars: PlacedBar<B>[] }> {
  const out = new Map<string, { lanes: number; bars: PlacedBar<B>[] }>();
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return out;
  const visible = bars
    .filter((b) => b.startsOn <= last && b.endsOn >= first)
    .sort(
      (a, b) =>
        a.startsOn.localeCompare(b.startsOn) ||
        b.endsOn.localeCompare(a.endsOn) ||
        a.id.localeCompare(b.id),
    );
  for (const b of visible) {
    const row = out.get(b.crewId) ?? { lanes: 0, bars: [] };
    const s = b.startsOn < first ? first : b.startsOn;
    const e = b.endsOn > last ? last : b.endsOn;
    const col = daysBetween(first, s);
    const span = daysBetween(s, e) + 1;
    let lane = 0;
    while (row.bars.some((p) => p.lane === lane && p.col < col + span && col < p.col + p.span))
      lane++;
    row.bars.push({
      bar: b,
      col,
      span,
      lane,
      clippedStart: b.startsOn < first,
      clippedEnd: b.endsOn > last,
    });
    row.lanes = Math.max(row.lanes, lane + 1);
    out.set(b.crewId, row);
  }
  return out;
}

/** Dropping a bar on a day keeps its length. */
export function moveBar(
  bar: { startsOn: IsoDate; endsOn: IsoDate },
  newStart: IsoDate,
): { startsOn: IsoDate; endsOn: IsoDate } {
  const len = daysBetween(bar.startsOn, bar.endsOn);
  return { startsOn: newStart, endsOn: addDays(newStart, len) };
}

/** Resizing changes the end (never before the start, at most 120 days). */
export function resizeBar(
  bar: { startsOn: IsoDate; endsOn: IsoDate },
  newEnd: IsoDate,
): { startsOn: IsoDate; endsOn: IsoDate } {
  const end = newEnd < bar.startsOn ? bar.startsOn : newEnd;
  const capped = daysBetween(bar.startsOn, end) > 120 ? addDays(bar.startsOn, 120) : end;
  return { startsOn: bar.startsOn, endsOn: capped };
}
