import { describe, expect, it } from "vitest";
import { defaultJobName } from "./default-name";

describe("defaultJobName", () => {
  it("joins last name, city and work types", () => {
    expect(
      defaultJobName({
        lastName: "Sample",
        firstName: "Sam",
        city: "Kirkland",
        workTypeLabels: ["Interior", "Cabinets"],
      }),
    ).toBe("Sample – Kirkland – Interior, Cabinets");
  });

  it("falls back to the first name, then the account name, and skips empty parts", () => {
    expect(defaultJobName({ firstName: "Sam", workTypeLabels: [] })).toBe("Sam");
    expect(
      defaultJobName({
        lastName: " ",
        accountName: "Sample Residence",
        workTypeLabels: ["Exterior"],
      }),
    ).toBe("Sample Residence – Exterior");
    expect(defaultJobName({ workTypeLabels: [] })).toBe("");
  });

  it("caps the name at 200 characters", () => {
    expect(defaultJobName({ lastName: "x".repeat(300), workTypeLabels: [] })).toHaveLength(200);
  });
});
