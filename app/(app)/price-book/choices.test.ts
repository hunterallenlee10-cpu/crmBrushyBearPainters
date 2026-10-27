import { describe, expect, it } from "vitest";
import { humanize, surfaceLabels } from "./choices";

describe("price book choices", () => {
  it("labels surfaces from the first catalog item that uses them", () => {
    const m = surfaceLabels([
      { surface: "int_walls", name: "Walls" },
      { surface: "int_walls", name: "Accent walls" },
      { surface: null, name: "Fee" },
    ]);
    expect(m.get("int_walls")).toBe("Walls");
    expect(m.size).toBe(1);
  });
  it("humanizes keys", () => {
    expect(humanize("ext_siding_cedar")).toBe("Siding cedar");
    expect(humanize("fence")).toBe("Fence");
  });
});
