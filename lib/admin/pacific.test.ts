import { describe, expect, it } from "vitest";
import { formatPacific, isIsoDate, pacificDateRangeToUtc } from "@/lib/admin/pacific";

describe("pacificDateRangeToUtc", () => {
  it("uses Pacific midnight in daylight time (UTC-7)", () => {
    expect(pacificDateRangeToUtc("2026-10-01", "2026-10-26")).toEqual({
      gte: "2026-10-01T07:00:00.000Z",
      lt: "2026-10-27T07:00:00.000Z",
    });
  });

  it("uses Pacific midnight in standard time (UTC-8) and across the DST change", () => {
    expect(pacificDateRangeToUtc("2026-11-01", "2026-11-01")).toEqual({
      gte: "2026-11-01T07:00:00.000Z",
      lt: "2026-11-02T08:00:00.000Z",
    });
    expect(pacificDateRangeToUtc(null, "2026-12-31")).toEqual({ lt: "2027-01-01T08:00:00.000Z" });
  });

  it("ignores invalid dates and swaps a reversed range", () => {
    expect(pacificDateRangeToUtc("2026-02-30", "nope")).toEqual({});
    expect(pacificDateRangeToUtc("2026-10-26", "2026-10-01")).toEqual({
      gte: "2026-10-01T07:00:00.000Z",
      lt: "2026-10-27T07:00:00.000Z",
    });
  });
});

describe("formatPacific", () => {
  it("formats UTC in Pacific time", () => {
    expect(formatPacific("2026-10-26T16:05:00Z")).toBe("Oct 26, 2026, 9:05 AM PDT");
    expect(formatPacific("2026-12-01T20:00:00Z")).toBe("Dec 1, 2026, 12:00 PM PST");
    expect(formatPacific("garbage")).toBe("—");
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-1-01")).toBe(false);
  });
});
