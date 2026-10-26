import { describe, expect, it } from "vitest";
import { leadCompletion } from "./completion";

describe("leadCompletion", () => {
  it("is 0% for an empty form and lists what's missing in form order", () => {
    const c = leadCompletion({});
    expect(c.percent).toBe(0);
    expect(c.filled).toBe(0);
    expect(c.total).toBe(17);
    expect(c.missing.slice(0, 3)).toEqual(["First name", "Last name", "Phone number"]);
  });

  it("treats blank strings, empty arrays and null HOA as not filled", () => {
    const c = leadCompletion({
      first_name: "  ",
      services: [],
      has_hoa: null,
      stories: "",
      photoCount: 0,
    });
    expect(c.filled).toBe(0);
  });

  it("counts mobile or phone once, and a year or a home-built choice once", () => {
    const one = leadCompletion({ mobile: "4255550100" });
    const both = leadCompletion({ mobile: "4255550100", phone: "4255550101" });
    expect(one.filled).toBe(1);
    expect(both.filled).toBe(1);
    expect(leadCompletion({ year_built: 1962 }).filled).toBe(1);
    expect(leadCompletion({ home_built: "not_sure" }).filled).toBe(1);
    expect(leadCompletion({ year_built: "1962", home_built: "before_1978" }).filled).toBe(1);
  });

  it("counts HOA = No as answered", () => {
    expect(leadCompletion({ has_hoa: false }).missing).not.toContain("HOA");
  });

  it("rounds to a whole percent", () => {
    const c = leadCompletion({ first_name: "Jane", last_name: "Smith", email: "j@example.com" });
    expect(c.filled).toBe(3);
    expect(c.percent).toBe(18); // 3 / 17 = 17.6%
  });

  it("reaches 100% when every useful field is filled", () => {
    const c = leadCompletion({
      first_name: "Jane",
      last_name: "Smith",
      mobile: "+14255550100",
      email: "jane@example.com",
      street: "123 Main St",
      city: "Kirkland",
      zip: "98033",
      home_built: "before_1978",
      property_type: "single_family",
      stories: 2,
      siding_type: "cedar_wood",
      has_hoa: true,
      services: ["exterior"],
      timeline: "asap",
      lead_source: "website",
      customer_notes: "Peeling on the south side.",
      photoCount: 2,
    });
    expect(c.percent).toBe(100);
    expect(c.missing).toEqual([]);
  });
});
