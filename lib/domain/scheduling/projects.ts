import { addDays, eachDay, isoDow, overlaps, weekStart, type IsoDate } from "./dates";
import { isProductionDay } from "./daily-updates";

/**
 * My Projects (SPEC §8.8): the Day / Week / Month / All window, the mini
 * calendar (month grid with job counts per production day) and the list
 * filters. Pure so the portal and its tests agree.
 */

export const PROJECT_RANGES = ["day", "week", "month", "all"] as const;
export type ProjectRange = (typeof PROJECT_RANGES)[number];

export function isProjectRange(v: unknown): v is ProjectRange {
  return typeof v === "string" && (PROJECT_RANGES as readonly string[]).includes(v);
}

export function monthStart(d: IsoDate): IsoDate {
  return `${d.slice(0, 7)}-01`;
}

export function monthEnd(d: IsoDate): IsoDate {
  const [y, m] = d.split("-").map(Number);
  const next =
    (m ?? 1) === 12
      ? `${(y ?? 2000) + 1}-01-01`
      : `${y}-${String((m ?? 1) + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

/** The inclusive window for a range (null for All). */
export function projectWindow(
  range: ProjectRange,
  anchor: IsoDate,
): { from: IsoDate; to: IsoDate } | null {
  switch (range) {
    case "day":
      return { from: anchor, to: anchor };
    case "week": {
      const from = weekStart(anchor);
      return { from, to: addDays(from, 6) };
    }
    case "month":
      return { from: monthStart(anchor), to: monthEnd(anchor) };
    case "all":
      return null;
  }
}

/** Month grid (Monday-first weeks) covering the anchor's month; days outside it are null. */
export function monthGrid(anchor: IsoDate): (IsoDate | null)[][] {
  const first = monthStart(anchor);
  const last = monthEnd(anchor);
  const cells: (IsoDate | null)[] = [];
  for (let i = 1; i < isoDow(first); i++) cells.push(null);
  for (const d of eachDay(first, last)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks: (IsoDate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export type ProjectLike = {
  name: string;
  jobNumber: string;
  stage: string;
  city: string | null;
  published: readonly { startsOn: IsoDate; endsOn: IsoDate }[];
};

/** Jobs working on each day of the window (production days only). */
export function dayCounts(
  projects: readonly ProjectLike[],
  days: readonly IsoDate[],
  workdays: readonly number[],
): Record<IsoDate, number> {
  const out: Record<IsoDate, number> = {};
  for (const d of days) {
    out[d] = projects.filter((p) => isProductionDay(d, p.published, workdays)).length;
  }
  return out;
}

export function filterProjects<T extends ProjectLike>(
  projects: readonly T[],
  f: { q?: string; stage?: string; city?: string; range: ProjectRange; anchor: IsoDate },
): T[] {
  const q = f.q?.trim().toLowerCase() ?? "";
  const win = projectWindow(f.range, f.anchor);
  return projects.filter(
    (p) =>
      (!q || p.name.toLowerCase().includes(q) || p.jobNumber.toLowerCase().includes(q)) &&
      (!f.stage || p.stage === f.stage) &&
      (!f.city || p.city === f.city) &&
      (!win || p.published.some((r) => overlaps(r.startsOn, r.endsOn, win.from, win.to))),
  );
}
