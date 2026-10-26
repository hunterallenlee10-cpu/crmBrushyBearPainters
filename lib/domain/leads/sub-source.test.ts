import { describe, expect, it } from "vitest";
import {
  SUB_SOURCE_MISMATCH,
  SUB_SOURCE_REQUIRED,
  subSourceIssue,
  subSourcesFor,
} from "./sub-source";

const SUBS = [
  { value: "organic", parent: "website", active: true },
  { value: "google_ads", parent: "website", active: true },
  { value: "old_thing", parent: "website", active: false },
  { value: "general", parent: null, active: true },
];

describe("sub-source rule", () => {
  it("lists only active sub-sources under the source", () => {
    expect(subSourcesFor("website", SUBS).map((o) => o.value)).toEqual(["organic", "google_ads"]);
    expect(subSourcesFor("yelp", SUBS)).toEqual([]);
    expect(subSourcesFor(null, SUBS)).toEqual([]);
  });

  it("is required only when the source has sub-sources", () => {
    expect(subSourceIssue("website", null, SUBS)).toBe(SUB_SOURCE_REQUIRED);
    expect(subSourceIssue("website", "organic", SUBS)).toBeNull();
    expect(subSourceIssue("yelp", null, SUBS)).toBeNull();
    expect(subSourceIssue(null, null, SUBS)).toBeNull();
  });

  it("refuses a sub-source from another source, allows unparented ones", () => {
    expect(subSourceIssue("yelp", "organic", SUBS)).toBe(SUB_SOURCE_MISMATCH);
    expect(subSourceIssue("yelp", "general", SUBS)).toBeNull();
  });

  it("still accepts an inactive sub-source already on a lead", () => {
    expect(subSourceIssue("website", "old_thing", SUBS)).toBeNull();
  });
});
