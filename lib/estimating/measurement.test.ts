import { describe, expect, it } from "vitest";
import { defaultMeasurementKind, quantityFromMeasurement } from "./measurement";

const s = { doorDeductionSqft: 21, windowDeductionSqft: 15, gableFactor: 1.15 };

describe("measurement helper", () => {
  it("computes quantities for each helper", () => {
    expect(
      quantityFromMeasurement(
        { kind: "room_walls", lengthFt: 14, widthFt: 12, heightFt: 8, doors: 2, windows: 3 },
        s,
      ),
    ).toBe(329);
    expect(quantityFromMeasurement({ kind: "room_ceiling", lengthFt: 14, widthFt: 12 }, s)).toBe(
      168,
    );
    expect(
      quantityFromMeasurement({ kind: "room_baseboard", lengthFt: 14, widthFt: 12, doors: 2 }, s),
    ).toBe(46);
    expect(quantityFromMeasurement({ kind: "exterior_wall", widthFt: 40, heightFt: 18 }, s)).toBe(
      828,
    );
    expect(
      quantityFromMeasurement(
        { kind: "exterior_wall", lengthFt: 40, heightFt: 18, gableFactor: 1 },
        s,
      ),
    ).toBe(720);
    expect(
      quantityFromMeasurement({ kind: "fence", lengthFt: 100, heightFt: 6, sides: 2 }, s),
    ).toBe(1200);
    expect(quantityFromMeasurement({ kind: "fence", lengthFt: 100, heightFt: 6 }, s)).toBe(600);
    expect(quantityFromMeasurement({ kind: "room_walls" }, s)).toBe(0);
    expect(quantityFromMeasurement({}, s)).toBeNull();
  });

  it("picks a helper that fits the surface", () => {
    expect(defaultMeasurementKind({ unit: "sqft", surface: "fence" })).toBe("fence");
    expect(defaultMeasurementKind({ unit: "sqft", surface: "ext_siding_cedar" })).toBe(
      "exterior_wall",
    );
    expect(defaultMeasurementKind({ unit: "sqft", surface: "int_ceilings" })).toBe("room_ceiling");
    expect(defaultMeasurementKind({ unit: "lf", surface: "int_baseboard" })).toBe("room_baseboard");
    expect(defaultMeasurementKind({ unit: "sqft", surface: "int_walls" })).toBe("room_walls");
    expect(defaultMeasurementKind({ unit: "sqft", surface: null })).toBe("room_walls");
    expect(defaultMeasurementKind({ unit: "each", surface: "int_door" })).toBeNull();
  });
});
