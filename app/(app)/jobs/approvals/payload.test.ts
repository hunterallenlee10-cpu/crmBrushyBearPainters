import { describe, expect, it } from "vitest";
import {
  HISTORY_REASON_MAX,
  approvalTypeLabel,
  approvedReason,
  parseOverridePayload,
} from "./payload";

describe("parseOverridePayload", () => {
  it("reads stages, gate reasons and a lost reason", () => {
    expect(
      parseOverridePayload({
        from_stage: "walkthrough_complete",
        to_stage: "sold",
        gate_reasons: ["Skipping needs an override.", "", 3],
        lost_reason: "price",
      }),
    ).toEqual({
      fromStage: "walkthrough_complete",
      toStage: "sold",
      gateReasons: ["Skipping needs an override."],
      lostReason: "price",
    });
  });

  it("accepts `reasons` as the gate reason list", () => {
    expect(parseOverridePayload({ to_stage: "sold", reasons: ["x"] }).gateReasons).toEqual(["x"]);
  });

  it("treats unknown stages and junk as missing", () => {
    expect(parseOverridePayload({ to_stage: "nope", lost_reason: "DROP TABLE" })).toEqual({
      fromStage: null,
      toStage: null,
      gateReasons: [],
      lostReason: null,
    });
    expect(parseOverridePayload(null).toStage).toBeNull();
    expect(parseOverridePayload(["sold"]).toStage).toBeNull();
  });
});

describe("approvedReason", () => {
  it("appends the owner's name", () => {
    expect(approvedReason("Customer signed by phone ", "Olive Owner")).toBe(
      "Customer signed by phone (approved by Olive Owner)",
    );
  });

  it("never exceeds the stage history limit", () => {
    const r = approvedReason("x".repeat(1000), "Olive Owner");
    expect(r.length).toBeLessThanOrEqual(HISTORY_REASON_MAX);
    expect(r.endsWith("(approved by Olive Owner)")).toBe(true);
  });
});

describe("approvalTypeLabel", () => {
  it("labels known types and humanizes others", () => {
    expect(approvalTypeLabel("stage_override")).toBe("Stage override");
    expect(approvalTypeLabel("change_order")).toBe("change order");
  });
});
