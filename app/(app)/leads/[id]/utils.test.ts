import { describe, expect, it } from "vitest";
import {
  mapsUrl,
  nameInitials,
  pacificToUtcIso,
  parseTab,
  scopeAllows,
  utcToPacificParts,
} from "./utils";

describe("pacific time conversion", () => {
  it("stores a standard-time walkthrough as UTC (PST = UTC−8)", () => {
    expect(pacificToUtcIso("2026-11-10", "09:30")).toBe("2026-11-10T17:30:00.000Z");
  });

  it("stores a daylight-time walkthrough as UTC (PDT = UTC−7)", () => {
    expect(pacificToUtcIso("2026-07-01", "14:00")).toBe("2026-07-01T21:00:00.000Z");
  });

  it("round-trips back to Pacific form values", () => {
    expect(utcToPacificParts("2026-11-10T17:30:00.000Z")).toEqual({
      date: "2026-11-10",
      time: "09:30",
    });
    expect(utcToPacificParts(null)).toEqual({ date: "", time: "" });
  });
});

describe("scopeAllows", () => {
  const me = { id: "me", territoryId: "t1" };
  const theirs = { ownerId: "other", createdBy: "other", territoryId: "t1" };

  it("follows own / team / all like the database", () => {
    expect(scopeAllows(undefined, theirs, me)).toBe(false);
    expect(scopeAllows("all", theirs, me)).toBe(true);
    expect(scopeAllows("own", theirs, me)).toBe(false);
    expect(scopeAllows("own", { ...theirs, ownerId: "me" }, me)).toBe(true);
    expect(scopeAllows("own", { ...theirs, createdBy: "me" }, me)).toBe(true);
    expect(scopeAllows("team", theirs, me)).toBe(true);
    expect(scopeAllows("team", { ...theirs, territoryId: "t2" }, me)).toBe(false);
    expect(
      scopeAllows("team", { ...theirs, territoryId: null }, { ...me, territoryId: null }),
    ).toBe(false);
  });
});

describe("small helpers", () => {
  it("builds initials", () => {
    expect(nameInitials("Sam", "Rivera")).toBe("SR");
    expect(nameInitials("Sam", null)).toBe("SA");
  });

  it("links to Google Maps without calling an API", () => {
    expect(mapsUrl("12 Main St, Kirkland, WA 98033")).toBe(
      "https://www.google.com/maps/search/?api=1&query=12%20Main%20St%2C%20Kirkland%2C%20WA%2098033",
    );
  });

  it("parses the tab param", () => {
    expect(parseTab("activity")).toBe("activity");
    expect(parseTab(["tasks"])).toBe("tasks");
    expect(parseTab("nope")).toBe("details");
    expect(parseTab(undefined)).toBe("details");
  });
});
