import { describe, expect, it } from "vitest";
import {
  formatPhone,
  normalizeEmail,
  normalizePhone,
  parseLocation,
  splitName,
} from "@/lib/domain/leads/normalize";
import {
  applicableFactors,
  gradeFor,
  scoreLead,
  scoreSummary,
  scoreInputFromLead,
  temperatureFor,
  type LeadScoreInput,
  type ScoringRule,
} from "@/lib/domain/leads/scoring";
import { describeMatch, findDuplicate, type DedupeCandidate } from "@/lib/domain/leads/dedupe";
import {
  businessSecondsBetween,
  formatDuration,
  isWithinBusinessHours,
} from "@/lib/domain/leads/speed-to-lead";
import {
  cityFromPagePath,
  inferWebsiteSubSource,
  mapHomeBuilt,
  mapServices,
  mapTimeline,
  serviceFromPagePath,
} from "@/lib/domain/leads/intake";
import type { BusinessHours } from "@/lib/domain/company-settings";

describe("normalizePhone", () => {
  it.each([
    ["(425) 555-0100", "+14255550100"],
    ["425.555.0100", "+14255550100"],
    ["1-425-555-0100", "+14255550100"],
    ["+1 425 555 0100", "+14255550100"],
    ["425-555-0100 x22", "+14255550100"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "   ", "555-0100", "123-456-7890", "abc", null, undefined, "+0123"])(
    "rejects %s",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );

  it("formats US numbers for display", () => {
    expect(formatPhone("+14255550100")).toBe("(425) 555-0100");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
    expect(formatPhone(null)).toBe("");
  });
});

describe("normalizeEmail / splitName", () => {
  it("lowercases and validates emails", () => {
    expect(normalizeEmail("  Jane.Smith@Example.COM ")).toBe("jane.smith@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });

  it.each([
    ["Jane Smith", "Jane", "Smith"],
    ["  Mary   Ann  Smith ", "Mary Ann", "Smith"],
    ["Smith, Jane", "Jane", "Smith"],
    ["Cher", "Cher", null],
  ])("splits %s", (full, first, last) => {
    expect(splitName(full)).toEqual({ first, last });
  });

  it("returns an empty first name for blank input", () => {
    expect(splitName("  ")).toEqual({ first: "", last: null });
  });
});

describe("parseLocation", () => {
  it("handles a ZIP alone", () => {
    expect(parseLocation("98033")).toEqual({ street: null, city: null, state: null, zip: "98033" });
  });
  it("handles a full address", () => {
    expect(parseLocation("123 Main St, Kirkland, WA 98033")).toEqual({
      street: "123 Main St",
      city: "Kirkland",
      state: "WA",
      zip: "98033",
    });
  });
  it("handles ZIP+4 and a spelled-out state", () => {
    expect(parseLocation("5 Elm Ave, bellevue, Washington 98004-1234")).toEqual({
      street: "5 Elm Ave",
      city: "Bellevue",
      state: "WA",
      zip: "98004",
    });
  });
  it("treats a single chunk with a house number as a street", () => {
    expect(parseLocation("123 Main St 98052")).toEqual({
      street: "123 Main St",
      city: null,
      state: null,
      zip: "98052",
    });
  });
  it("treats a single word as a city", () => {
    expect(parseLocation("sammamish")).toEqual({
      street: null,
      city: "Sammamish",
      state: null,
      zip: null,
    });
  });
  it("returns nothing for blank input", () => {
    expect(parseLocation("")).toEqual({ street: null, city: null, state: null, zip: null });
  });
});

const RULES: ScoringRule[] = [
  { factor: "in_service_area", label: "In area", points: 10, active: true },
  { factor: "out_of_area", label: "Out of area", points: -20, active: true },
  { factor: "has_mobile", label: "Mobile", points: 5, active: true },
  { factor: "has_email", label: "Email", points: 3, active: true },
  { factor: "full_address", label: "Address", points: 5, active: true },
  { factor: "timeline_asap", label: "ASAP", points: 15, active: true },
  { factor: "timeline_1_3_months", label: "1–3 months", points: 8, active: true },
  { factor: "timeline_just_planning", label: "Just planning", points: -10, active: true },
  { factor: "exterior_or_multiple", label: "Exterior or multiple", points: 5, active: true },
  { factor: "cabinets", label: "Cabinets", points: 5, active: true },
  { factor: "uploaded_photos", label: "Photos", points: 5, active: true },
  { factor: "referral_or_past_customer", label: "Referral", points: 15, active: true },
  { factor: "responded_to_text", label: "Replied", points: 10, active: true },
  { factor: "no_response_3_attempts", label: "No response", points: -15, active: true },
];

const BASE: LeadScoreInput = {
  inServiceArea: null,
  hasMobile: false,
  hasEmail: false,
  hasFullAddress: false,
  timeline: null,
  services: [],
  photoCount: 0,
  leadSource: null,
  respondedToText: false,
  unansweredAttempts: 0,
};

describe("scoreLead", () => {
  it("starts at 50 with no factors", () => {
    expect(scoreLead(BASE, RULES)).toEqual({
      score: 50,
      grade: "D",
      temperature: "cold",
      factors: [],
    });
  });

  it("scores a strong website lead as A / Hot with every factor listed", () => {
    const s = scoreLead(
      {
        ...BASE,
        inServiceArea: true,
        hasMobile: true,
        hasEmail: true,
        hasFullAddress: true,
        timeline: "asap",
        services: ["exterior"],
        photoCount: 2,
      },
      RULES,
    );
    // 50 + 10 + 5 + 3 + 5 + 15 + 5 + 5 = 98
    expect(s.score).toBe(98);
    expect(s.grade).toBe("A");
    expect(s.temperature).toBe("hot");
    expect(s.factors.map((f) => f.factor)).toEqual([
      "in_service_area",
      "has_mobile",
      "has_email",
      "full_address",
      "timeline_asap",
      "exterior_or_multiple",
      "uploaded_photos",
    ]);
  });

  it("penalizes out of area and just planning, and clamps at 0", () => {
    const s = scoreLead({ ...BASE, inServiceArea: false, timeline: "just_planning" }, RULES);
    expect(s.score).toBe(20);
    expect(s.grade).toBe("F");
    expect(
      scoreLead({ ...BASE, hasEmail: true }, [
        { factor: "has_email", label: "x", points: -100, active: true },
      ]).score,
    ).toBe(0);
  });

  it("clamps at 100", () => {
    expect(
      scoreLead({ ...BASE, hasEmail: true }, [
        { factor: "has_email", label: "x", points: 100, active: true },
      ]).score,
    ).toBe(100);
  });

  it("ignores inactive and zero-point rules", () => {
    const rules = RULES.map((r) =>
      r.factor === "has_mobile"
        ? { ...r, active: false }
        : r.factor === "has_email"
          ? { ...r, points: 0 }
          : r,
    );
    expect(scoreLead({ ...BASE, hasMobile: true, hasEmail: true }, rules).factors).toEqual([]);
  });

  it("counts several services (not just 'other') as multiple", () => {
    expect(
      applicableFactors({ ...BASE, services: ["interior", "cabinets"] }).has(
        "exterior_or_multiple",
      ),
    ).toBe(true);
    expect(
      applicableFactors({ ...BASE, services: ["interior", "other"] }).has("exterior_or_multiple"),
    ).toBe(false);
  });

  it("applies referral and response factors", () => {
    expect(
      applicableFactors({ ...BASE, leadSource: "past_customer" }).has("referral_or_past_customer"),
    ).toBe(true);
    expect(
      applicableFactors({ ...BASE, leadSource: "website" }).has("referral_or_past_customer"),
    ).toBe(false);
    expect(
      applicableFactors({ ...BASE, unansweredAttempts: 3 }).has("no_response_3_attempts"),
    ).toBe(true);
    expect(
      applicableFactors({ ...BASE, unansweredAttempts: 5, respondedToText: true }).has(
        "no_response_3_attempts",
      ),
    ).toBe(false);
  });

  it.each([
    [85, "A", "hot"],
    [84, "B", "warm"],
    [70, "B", "warm"],
    [69, "C", "warm"],
    [55, "C", "warm"],
    [54, "D", "cold"],
    [40, "D", "cold"],
    [39, "F", "cold"],
  ] as const)("grade boundaries: %i → %s / %s", (score, grade, temp) => {
    expect(gradeFor(score)).toBe(grade);
    expect(temperatureFor(grade)).toBe(temp);
  });

  it("summarizes the score the way the header shows it", () => {
    expect(scoreSummary(70, "warm")).toBe("70/100 · Warm Lead");
  });
});

describe("findDuplicate", () => {
  const now = new Date("2026-10-26T18:00:00Z");
  const lead = (over: Partial<DedupeCandidate>): DedupeCandidate => ({
    id: "x",
    mobile: null,
    phone: null,
    email: null,
    status: "new",
    created_at: "2026-10-01T00:00:00Z",
    last_activity_at: "2026-10-01T00:00:00Z",
    ...over,
  });

  it("matches on phone or email within 180 days", () => {
    const c = [
      lead({ id: "a", mobile: "+14255550100" }),
      lead({ id: "b", email: "j@example.com" }),
    ];
    expect(findDuplicate({ phones: ["+14255550100"], email: null }, c, now)?.lead.id).toBe("a");
    expect(findDuplicate({ phones: [], email: "j@example.com" }, c, now)?.lead.id).toBe("b");
    expect(findDuplicate({ phones: ["+14255550199"], email: "z@example.com" }, c, now)).toBeNull();
  });

  it("matches a landline against the stored phone or mobile", () => {
    const c = [lead({ id: "a", phone: "+14255550100" })];
    expect(
      findDuplicate({ phones: [null, "+14255550100"], email: null }, c, now)?.matchedOn,
    ).toEqual(["phone"]);
  });

  it("ignores leads older than the window", () => {
    const c = [lead({ id: "old", mobile: "+14255550100", created_at: "2026-01-01T00:00:00Z" })];
    expect(findDuplicate({ phones: ["+14255550100"], email: null }, c, now)).toBeNull();
  });

  it("prefers open leads, then the most recently active", () => {
    const c = [
      lead({
        id: "lost",
        mobile: "+14255550100",
        status: "lost",
        last_activity_at: "2026-10-25T00:00:00Z",
      }),
      lead({ id: "open-old", mobile: "+14255550100", last_activity_at: "2026-10-02T00:00:00Z" }),
      lead({ id: "open-new", email: "j@example.com", last_activity_at: "2026-10-20T00:00:00Z" }),
    ];
    expect(
      findDuplicate({ phones: ["+14255550100"], email: "j@example.com" }, c, now)?.lead.id,
    ).toBe("open-new");
  });

  it("needs at least one key", () => {
    expect(findDuplicate({ phones: [null, ""], email: null }, [lead({})], now)).toBeNull();
  });

  it("describes the match", () => {
    expect(describeMatch(["phone", "email"])).toBe("Same phone and email");
    expect(describeMatch(["email"])).toBe("Same email address");
  });
});

describe("businessSecondsBetween", () => {
  // Mon–Fri 8:00–17:00, Sat by appointment, Sun closed (SPEC §15.1 defaults).
  const HOURS: BusinessHours = {
    mon: { open: "08:00", close: "17:00" },
    tue: { open: "08:00", close: "17:00" },
    wed: { open: "08:00", close: "17:00" },
    thu: { open: "08:00", close: "17:00" },
    fri: { open: "08:00", close: "17:00" },
    sat: { by_appointment: true },
    sun: null,
  };
  // Pacific Daylight Time in late October 2026: UTC−7.
  const pdt = (iso: string) => new Date(`${iso}-07:00`);

  it("counts plain minutes inside business hours", () => {
    expect(
      businessSecondsBetween(pdt("2026-10-21T10:00:00"), pdt("2026-10-21T10:04:00"), HOURS),
    ).toBe(240);
  });

  it("skips the night: 9 pm lead, 8:05 am call = 5 minutes", () => {
    expect(
      businessSecondsBetween(pdt("2026-10-21T21:00:00"), pdt("2026-10-22T08:05:00"), HOURS),
    ).toBe(300);
  });

  it("skips the weekend: Friday 4:50 pm → Monday 8:10 am = 20 minutes", () => {
    expect(
      businessSecondsBetween(pdt("2026-10-23T16:50:00"), pdt("2026-10-26T08:10:00"), HOURS),
    ).toBe(1200);
  });

  it("returns 0 when nothing happened in business hours or end is before start", () => {
    expect(
      businessSecondsBetween(pdt("2026-10-24T09:00:00"), pdt("2026-10-24T12:00:00"), HOURS),
    ).toBe(0);
    expect(
      businessSecondsBetween(pdt("2026-10-21T12:00:00"), pdt("2026-10-21T11:00:00"), HOURS),
    ).toBe(0);
  });

  it("spans a daylight-saving change correctly (Nov 1, 2026)", () => {
    // Friday Oct 30 16:00 PDT → Monday Nov 2 09:00 PST = 1 h Fri + 1 h Mon.
    const start = new Date("2026-10-30T16:00:00-07:00");
    const end = new Date("2026-11-02T09:00:00-08:00");
    expect(businessSecondsBetween(start, end, HOURS)).toBe(7200);
  });

  it("knows when the office is open", () => {
    expect(isWithinBusinessHours(pdt("2026-10-21T08:00:00"), HOURS)).toBe(true);
    expect(isWithinBusinessHours(pdt("2026-10-21T17:00:00"), HOURS)).toBe(false);
    expect(isWithinBusinessHours(pdt("2026-10-24T10:00:00"), HOURS)).toBe(false);
  });

  it("formats durations", () => {
    expect(formatDuration(42)).toBe("42 sec");
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(3900)).toBe("1 h 5 min");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("website form mapping", () => {
  it("maps service checkboxes, ignoring unknown ones and duplicates", () => {
    expect(
      mapServices(["Interior", "Deck or fence", "Something else", "Roofing", "interior"]),
    ).toEqual(["interior", "deck_fence", "other"]);
    expect(mapServices(undefined)).toEqual([]);
  });

  it("maps timeline and home-built answers", () => {
    expect(mapTimeline("As soon as possible")).toBe("asap");
    expect(mapTimeline("In 1–3 months")).toBe("1_3_months");
    expect(mapTimeline("3+ months out")).toBe("3_plus_months");
    expect(mapTimeline("Just planning")).toBe("just_planning");
    expect(mapTimeline("someday")).toBeNull();
    expect(mapHomeBuilt("Before 1978")).toBe("before_1978");
    expect(mapHomeBuilt("1978 or later")).toBe("1978_or_later");
    expect(mapHomeBuilt("Not sure")).toBe("not_sure");
  });

  it("reads intent and city from the page path", () => {
    expect(serviceFromPagePath("/services/exterior-painting")).toBe("exterior");
    expect(serviceFromPagePath("/services/cabinet-refinishing")).toBe("cabinets");
    expect(serviceFromPagePath("/estimate")).toBeNull();
    expect(cityFromPagePath("/painters/kirkland-wa")).toBe("Kirkland");
    expect(cityFromPagePath("/painters/mercer-island-wa/")).toBe("Mercer Island");
    expect(cityFromPagePath("/services/interior")).toBeNull();
  });

  it.each([
    [{ ref: "BEAR-1234", utm_source: "google", utm_medium: "cpc" }, "referral_link"],
    [{ utm_source: "google", utm_medium: "cpc" }, "google_ads"],
    [{ gclid: "abc" }, "google_ads"],
    [{ utm_source: "google", utm_medium: "organic" }, "organic"],
    [{ utm_source: "gbp" }, "google_business_profile"],
    [{ utm_source: "google", utm_campaign: "local_services" }, "local_services_ads"],
    [{ utm_source: "facebook", utm_medium: "paid_social" }, "facebook_instagram"],
    [{ referrer: "https://l.facebook.com/l.php?u=x" }, "facebook_instagram"],
    [{ referrer: "https://nextdoor.com/p/abc" }, "nextdoor"],
    [{ referrer: "https://www.yelp.com/biz/brushy-bear" }, "yelp"],
    [{ referrer: "https://www.google.com/" }, "organic"],
    [{ referrer: "https://www.bing.com/search?q=painters" }, "organic"],
    [{}, "direct"],
    [{ referrer: "not a url" }, "direct"],
  ])("sub-source for %j is %s", (attribution, expected) => {
    expect(inferWebsiteSubSource(attribution)).toBe(expected);
  });
});

describe("scoreInputFromLead", () => {
  it("derives area, contact and address facts from the row", () => {
    const input = scoreInputFromLead(
      {
        zip: "98033",
        out_of_area: false,
        territory_id: "t1",
        mobile: "+14255550100",
        email: null,
        street: "1 Main St",
        timeline: "asap",
        services: ["interior"],
        lead_source: "website",
      },
      { photoCount: 1, respondedToText: false, unansweredAttempts: 0 },
    );
    expect(input).toMatchObject({
      inServiceArea: true,
      hasMobile: true,
      hasEmail: false,
      hasFullAddress: true,
      photoCount: 1,
    });
    expect(
      scoreInputFromLead(
        {
          zip: null,
          out_of_area: false,
          territory_id: null,
          mobile: null,
          email: "a@b.co",
          street: null,
          timeline: null,
          services: [],
          lead_source: null,
        },
        { photoCount: 0, respondedToText: false, unansweredAttempts: 0 },
      ).inServiceArea,
    ).toBeNull();
  });
});
