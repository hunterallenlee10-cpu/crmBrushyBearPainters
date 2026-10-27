import { describe, expect, it } from "vitest";
import {
  dayCounts,
  filterProjects,
  isProjectRange,
  monthEnd,
  monthGrid,
  monthStart,
  projectWindow,
} from "./projects";

const P = (over: Partial<Parameters<typeof filterProjects>[0][number]> = {}) => ({
  name: "Park Residence",
  jobNumber: "J-1001",
  stage: "scheduled",
  city: "Redmond",
  published: [{ startsOn: "2026-07-13", endsOn: "2026-07-15" }],
  ...over,
});

describe("My Projects windows", () => {
  it("knows the ranges", () => {
    expect(isProjectRange("week")).toBe(true);
    expect(isProjectRange("year")).toBe(false);
  });
  it("month bounds handle December and leap years", () => {
    expect(monthStart("2026-07-13")).toBe("2026-07-01");
    expect(monthEnd("2026-12-05")).toBe("2026-12-31");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
  });
  it("day, week (Monday start), month, all", () => {
    expect(projectWindow("day", "2026-07-15")).toEqual({ from: "2026-07-15", to: "2026-07-15" });
    expect(projectWindow("week", "2026-07-15")).toEqual({ from: "2026-07-13", to: "2026-07-19" });
    expect(projectWindow("month", "2026-07-15")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(projectWindow("all", "2026-07-15")).toBeNull();
  });
  it("month grid pads to whole Monday-first weeks", () => {
    const g = monthGrid("2026-07-15"); // July 1 2026 is a Wednesday
    expect(g[0]).toEqual([
      null,
      null,
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter(Boolean)).toHaveLength(31);
  });
});

describe("My Projects counts and filters", () => {
  it("counts jobs on production days only", () => {
    const c = dayCounts(
      [P(), P({ published: [{ startsOn: "2026-07-15", endsOn: "2026-07-20" }] })],
      ["2026-07-15", "2026-07-18", "2026-07-20"],
      [1, 2, 3, 4, 5],
    );
    expect(c).toEqual({ "2026-07-15": 2, "2026-07-18": 0, "2026-07-20": 1 });
  });
  it("filters by search, stage, city and window", () => {
    const list = [
      P(),
      P({
        name: "Lee Home",
        jobNumber: "J-2",
        city: "Kirkland",
        stage: "in_progress",
        published: [],
      }),
    ];
    expect(filterProjects(list, { q: "lee", range: "all", anchor: "2026-07-01" })).toHaveLength(1);
    expect(filterProjects(list, { q: "j-1001", range: "all", anchor: "2026-07-01" })[0]?.name).toBe(
      "Park Residence",
    );
    expect(
      filterProjects(list, { stage: "in_progress", range: "all", anchor: "2026-07-01" }),
    ).toHaveLength(1);
    expect(
      filterProjects(list, { city: "Redmond", range: "all", anchor: "2026-07-01" }),
    ).toHaveLength(1);
    expect(filterProjects(list, { range: "week", anchor: "2026-07-17" })).toHaveLength(1);
    expect(filterProjects(list, { range: "day", anchor: "2026-07-16" })).toHaveLength(0);
    // Unscheduled jobs only show under All.
    expect(
      filterProjects(list, { range: "month", anchor: "2026-07-01" }).map((p) => p.name),
    ).toEqual(["Park Residence"]);
  });
});
