import { describe, expect, it } from "vitest";
import { formatCents, formatDollars } from "./money";

describe("money formatting", () => {
  it("formats cents", () => {
    expect(formatCents(1250050)).toBe("$12,500.50");
    expect(formatCents(-8000)).toBe("−$80.00");
    expect(formatCents(null)).toBe("—");
    expect(formatDollars(1250050)).toBe("$12,501");
    expect(formatDollars(-8000)).toBe("−$80");
    expect(formatDollars(Number.NaN)).toBe("—");
  });
});
