import { describe, expect, it } from "vitest";
import { caseVisitSchema, createCaseSchema, updateCaseSchema } from "./cases";

const JOB = "00000000-0000-4000-8000-000000000001";

describe("case schemas", () => {
  it("needs a job or a customer", () => {
    expect(createCaseSchema.safeParse({ type: "warranty", title: "Peeling trim" }).success).toBe(
      false,
    );
    const ok = createCaseSchema.parse({ jobId: JOB, type: "warranty", title: "Peeling trim" });
    expect(ok.priority).toBe("normal");
    expect(ok.acknowledge).toBe("none");
  });

  it("asks what was done before resolving", () => {
    expect(updateCaseSchema.safeParse({ id: JOB, status: "resolved" }).success).toBe(false);
    expect(
      updateCaseSchema.safeParse({
        id: JOB,
        status: "resolved",
        resolution: "Touched up the door.",
      }).success,
    ).toBe(true);
    // Closing a resolved case keeps its resolution.
    expect(updateCaseSchema.safeParse({ id: JOB, status: "closed" }).success).toBe(true);
  });

  it("books a visit with a date and time", () => {
    expect(caseVisitSchema.safeParse({ caseId: JOB, date: "", time: "09:00" }).success).toBe(false);
    const v = caseVisitSchema.parse({ caseId: JOB, date: "2026-11-02", time: "09:00" });
    expect(v.durationMinutes).toBe(60);
    expect(v.confirm).toBe("none");
  });
});
