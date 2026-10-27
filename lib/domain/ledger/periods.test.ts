import { describe, expect, it } from "vitest";
import {
  canCloseMonth,
  isLocked,
  isMonthKey,
  lockDecision,
  monthLabel,
  monthOf,
  monthStart,
  previousMonth,
} from "./periods";

describe("month close", () => {
  const closed = new Set(["2026-09", "2026-10"]);
  it("locks records dated in a closed month", () => {
    expect(isLocked("2026-10-31", closed)).toBe(true);
    expect(isLocked("2026-11-01", closed)).toBe(false);
    expect(isLocked(null, closed)).toBe(false);
    expect(monthOf("2026-10-05")).toBe("2026-10");
    expect(monthStart("2026-10")).toBe("2026-10-01");
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
    expect(isMonthKey("2026-13")).toBe(false);
  });
  it("needs an owner override with a reason in a closed month", () => {
    expect(lockDecision({ locked: false, canOverride: false })).toEqual({
      ok: true,
      override: false,
    });
    expect(lockDecision({ locked: true, canOverride: false })).toMatchObject({
      ok: false,
      needsReason: false,
    });
    expect(lockDecision({ locked: true, canOverride: true, reason: "short" })).toMatchObject({
      ok: false,
      needsReason: true,
    });
    expect(
      lockDecision({ locked: true, canOverride: true, reason: "Bank fixed a deposit date" }),
    ).toEqual({
      ok: true,
      override: true,
    });
  });
  it("closes only months that are over", () => {
    expect(canCloseMonth("2026-10", "2026-11-02")).toBeNull();
    expect(canCloseMonth("2026-11", "2026-11-02")).toMatch(/ended/);
    expect(canCloseMonth("2026-12", "2026-11-02")).toMatch(/ended/);
    expect(canCloseMonth("bad", "2026-11-02")).toBe("Pick a month.");
  });
});
