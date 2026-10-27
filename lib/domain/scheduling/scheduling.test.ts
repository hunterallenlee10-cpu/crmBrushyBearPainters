import { describe, expect, it } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import {
  addDays,
  daysBetween,
  eachDay,
  endAfterWorkingDays,
  formatDay,
  formatRange,
  isIsoDate,
  isoDow,
  nextProductionDay,
  overlapDays,
  pacificHour,
  pacificToday,
  productionDays,
  weekStart,
} from "./dates";
import { DEFAULT_WORK_RULES, LOCKED_RULES, resolveWorkRules, type WorkRuleKey } from "./rules";
import { crewCovers, missingSkills, productionWorkType, requiredSkills } from "./skills";
import {
  blockingConflicts,
  checkPlacement,
  isBlocked,
  type ConflictContext,
  type CrewFacts,
  type JobFacts,
  type Placement,
  type ScheduledBar,
} from "./conflicts";
import { firstOpenStart, rankCrews } from "./recommend";
import { dispatchReadiness, materialsStatus } from "./readiness";
import { evaluateOnTime, nextGuaranteeDate, rescheduleCostsCredit } from "./on-time";
import {
  dailyUpdateCompliance,
  dueDays,
  isProductionDay,
  jobProductionDays,
  missedDailyUpdates,
} from "./daily-updates";
import { complianceIssues, subcontractorStatus } from "./subcontractors";
import { effectiveSlot, planPublish, type EntryState } from "./publish";
import { calendarWindow, layoutRows, moveBar, resizeBar, shiftAnchor } from "./calendar";
import {
  arrivalWindowLabel,
  crewNotice,
  dailyUpdateText,
  rainDelayText,
  scheduleNotice,
} from "./messages";

const pacific = (local: string) => fromZonedTime(local, "America/Los_Angeles");

// 2027-07-12 is a Monday.
const MON = "2027-07-12";

function ctx(over: Partial<ConflictContext> = {}): ConflictContext {
  return {
    today: "2027-07-01",
    productionDays: [1, 2, 3, 4, 5],
    season: { start: "06-01", end: "09-30" },
    blackouts: [],
    rules: { ...DEFAULT_WORK_RULES },
    skillLabels: {
      spray_finish: "Spray finish / cabinets",
      exterior_high_access: "Exterior high-access (2-story+)",
      rrp_certified: "Lead-safe RRP certified renovator",
      carpentry: "Carpentry / rot repair",
    },
    workTypeSkills: { cabinet_shop: "spray_finish", rot_repair: "carpentry" },
    workTypeLabels: { cabinet_shop: "Cabinet Spray / Shop Day", rot_repair: "Rot Repair" },
    weather: { connected: false },
    ...over,
  };
}

function job(over: Partial<JobFacts> = {}): JobFacts {
  return {
    id: "job-1",
    label: "Lee – Kirkland",
    stage: "ready_to_schedule",
    workTypes: ["interior"],
    stories: 1,
    leadSafe: false,
    walkthroughDone: true,
    blockingHolds: [],
    hoaApprovalPending: false,
    ...over,
  };
}

function crew(over: Partial<CrewFacts> = {}): CrewFacts {
  return {
    id: "crew-a",
    name: "Crew A",
    active: true,
    crewType: "employee",
    maxJobsPerDay: 1,
    skills: [],
    timeOff: [],
    subcontractor: null,
    ...over,
  };
}

function place(over: Partial<Placement> = {}): Placement {
  return {
    entryId: "e-1",
    jobId: "job-1",
    crewId: "crew-a",
    workType: "interior_production",
    startsOn: MON,
    endsOn: addDays(MON, 2),
    allowSplit: false,
    overrideRules: [],
    ...over,
  };
}

const codes = (c: { code: string }[]) => c.map((x) => x.code);

describe("dates", () => {
  it("does calendar math on plain dates", () => {
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate(42)).toBe(false);
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(daysBetween("2027-07-01", "2027-07-12")).toBe(11);
    expect(isoDow(MON)).toBe(1);
    expect(isoDow("2027-07-18")).toBe(7);
    expect(eachDay(MON, addDays(MON, 2))).toEqual(["2027-07-12", "2027-07-13", "2027-07-14"]);
    expect(overlapDays(MON, addDays(MON, 4), addDays(MON, 3), addDays(MON, 9))).toEqual([
      "2027-07-15",
      "2027-07-16",
    ]);
    expect(overlapDays(MON, MON, "2027-08-01", "2027-08-02")).toEqual([]);
    expect(productionDays("2027-07-16", "2027-07-19", [1, 2, 3, 4, 5])).toEqual([
      "2027-07-16",
      "2027-07-19",
    ]);
    expect(weekStart("2027-07-15")).toBe(MON);
  });

  it("counts working days and skips weekends", () => {
    expect(endAfterWorkingDays("2027-07-15", 3, [1, 2, 3, 4, 5])).toBe("2027-07-19");
    expect(endAfterWorkingDays("2027-07-17", 1, [1, 2, 3, 4, 5])).toBe("2027-07-19");
    expect(endAfterWorkingDays(MON, 1, [])).toBe(MON);
    expect(nextProductionDay("2027-07-18", [1, 2, 3, 4, 5])).toBe("2027-07-19");
  });

  it("uses Pacific time for today and the hour", () => {
    // 11:30 pm Pacific on Jul 12 is already Jul 13 in UTC.
    const late = pacific("2027-07-12T23:30:00");
    expect(late.toISOString().slice(0, 10)).toBe("2027-07-13");
    expect(pacificToday(late)).toBe(MON);
    expect(pacificHour(pacific("2027-07-12T19:05:00"))).toBe(19);
  });

  it("formats days and ranges", () => {
    expect(formatDay(MON)).toBe("Mon, Jul 12");
    expect(formatRange(MON, MON)).toBe("Jul 12");
    expect(formatRange(MON, "2027-07-14")).toBe("Jul 12–14");
    expect(formatRange("2027-07-30", "2027-08-02")).toBe("Jul 30 – Aug 2");
  });
});

describe("work rules", () => {
  it("fills missing rows with defaults and keeps the deposit rule on", () => {
    const rules = resolveWorkRules([
      { key: "deposit_before_scheduling", enabled: false, severity: "block" },
      {
        key: "weather_forecast",
        enabled: true,
        severity: "warn",
        params: { rain_percent: 70, x: {} },
      },
      { key: "unknown_rule", enabled: true, severity: "block" },
    ]);
    expect(rules.deposit_before_scheduling.enabled).toBe(true);
    expect(LOCKED_RULES.has("deposit_before_scheduling")).toBe(true);
    expect(rules.weather_forecast.severity).toBe("warn");
    expect(rules.weather_forecast.params.rain_percent).toBe(70);
    expect(rules.weather_forecast.params).not.toHaveProperty("x");
    expect(rules.crew_time_off).toEqual(DEFAULT_WORK_RULES.crew_time_off);
  });
});

describe("skills", () => {
  const rules = DEFAULT_WORK_RULES;
  it("needs spray for cabinets, high access for 2-story exteriors and a renovator for lead-safe homes", () => {
    const needs = requiredSkills(
      {
        workTypes: ["exterior", "cabinets"],
        stories: 2,
        leadSafe: true,
        workOrderPhases: ["repair"],
      },
      rules,
      { rot_repair: "carpentry" },
    );
    expect(needs.map((n) => n.skill)).toEqual([
      "spray_finish",
      "exterior_high_access",
      "rrp_certified",
      "carpentry",
    ]);
    expect(
      requiredSkills({ workTypes: ["exterior"], stories: 1, leadSafe: false }, rules, {}),
    ).toEqual([]);
  });

  it("skips rules that are switched off", () => {
    const off = { ...rules, spray_for_cabinets: { ...rules.spray_for_cabinets, enabled: false } };
    expect(
      requiredSkills({ workTypes: ["cabinets"], stories: null, leadSafe: false }, off, {}),
    ).toEqual([]);
  });

  it("finds missing and expired skills", () => {
    const needs = requiredSkills(
      { workTypes: ["interior"], stories: 1, leadSafe: true },
      rules,
      {},
    );
    expect(missingSkills(needs, [], MON)).toEqual([{ need: needs[0], expired: false }]);
    expect(
      missingSkills(needs, [{ key: "rrp_certified", expiresOn: "2027-07-01" }], MON)[0]?.expired,
    ).toBe(true);
    expect(crewCovers(needs, [{ key: "rrp_certified", expiresOn: "2028-01-01" }], MON)).toBe(true);
    expect(crewCovers(needs, [{ key: "rrp_certified", expiresOn: null }], null)).toBe(true);
  });

  it("picks the production work type from the job", () => {
    expect(productionWorkType(["exterior", "interior"])).toBe("exterior_production");
    expect(productionWorkType(["cabinets"])).toBe("cabinet_shop");
    expect(productionWorkType(["deck_fence"])).toBe("deck_fence");
    expect(productionWorkType(["interior", "cabinets"])).toBe("interior_production");
  });
});

describe("conflict detection", () => {
  it("passes a clean placement", () => {
    expect(checkPlacement(place(), job(), crew(), [], ctx())).toEqual([]);
  });

  it("blocks double-booking with a clear reason, unless both are split", () => {
    const other: ScheduledBar = {
      id: "e-2",
      jobId: "job-2",
      jobLabel: "Park – Redmond",
      crewId: "crew-a",
      startsOn: addDays(MON, 1),
      endsOn: addDays(MON, 5),
      allowSplit: false,
    };
    const c = checkPlacement(place(), job(), crew(), [other], ctx());
    expect(codes(c)).toEqual(["max_jobs_per_crew_day"]);
    expect(c[0]?.message).toBe(
      'Crew A is already booked on Park – Redmond Jul 13–14 (2 days). Pick another crew or day, or mark both entries "split".',
    );
    expect(isBlocked(c)).toBe(true);
    expect(
      checkPlacement(
        place({ allowSplit: true }),
        job(),
        crew(),
        [{ ...other, allowSplit: true }],
        ctx(),
      ),
    ).toEqual([]);
    // The same job's own bars and the entry itself don't count; a 2-job crew has room.
    expect(checkPlacement(place(), job(), crew(), [{ ...other, jobId: "job-1" }], ctx())).toEqual(
      [],
    );
    expect(checkPlacement(place(), job(), crew({ maxJobsPerDay: 2 }), [other], ctx())).toEqual([]);
    // Weekend overlap doesn't count as a clash.
    const weekend = { ...other, startsOn: "2027-07-17", endsOn: "2027-07-18" };
    expect(
      checkPlacement(place({ endsOn: "2027-07-18" }), job(), crew(), [weekend], ctx()),
    ).toEqual([]);
    const oneDay = { ...other, startsOn: MON, endsOn: MON };
    expect(checkPlacement(place(), job(), crew(), [oneDay], ctx())[0]?.message).toContain(
      "on Mon, Jul 12",
    );
  });

  it("blocks skill mismatches: spray for cabinets, high access for a 2-story exterior", () => {
    const c = checkPlacement(
      place({ workType: "cabinet_shop" }),
      job({ workTypes: ["cabinets"] }),
      crew(),
      [],
      ctx(),
    );
    expect(codes(c)).toEqual(["spray_for_cabinets"]);
    expect(c[0]?.message).toBe(
      "Crew A doesn't have the Spray finish / cabinets skill. Cabinet work is sprayed needs it.",
    );
    const ext = checkPlacement(
      place({ workType: "exterior_production" }),
      job({ workTypes: ["exterior"], stories: 2 }),
      crew(),
      [],
      ctx(),
    );
    expect(codes(ext)).toEqual(["high_access_two_story"]);
    expect(ext[0]?.message).toContain("Exterior high-access (2-story+)");
    expect(
      checkPlacement(
        place({ workType: "exterior_production" }),
        job({ workTypes: ["exterior"], stories: 2 }),
        crew({ skills: [{ key: "exterior_high_access", expiresOn: null }] }),
        [],
        ctx(),
      ),
    ).toEqual([]);
    const repair = checkPlacement(place({ workType: "rot_repair" }), job(), crew(), [], ctx());
    expect(codes(repair)).toEqual(["work_type_skill"]);
  });

  it("needs a current certified renovator on pre-1978 homes", () => {
    const c = checkPlacement(
      place(),
      job({ leadSafe: true }),
      crew({ skills: [{ key: "rrp_certified", expiresOn: addDays(MON, 1) }] }),
      [],
      ctx(),
    );
    expect(codes(c)).toEqual(["lead_safe_renovator"]);
    expect(c[0]?.message).toMatch(/certification expires before Wed, Jul 14/);
  });

  it("respects crew time off, member time off and company blackouts", () => {
    const c = checkPlacement(
      place(),
      job(),
      crew({
        timeOff: [
          {
            startsOn: addDays(MON, 1),
            endsOn: addDays(MON, 1),
            reason: "Vacation",
            memberName: null,
          },
          { startsOn: MON, endsOn: MON, reason: null, memberName: "Pat" },
        ],
      }),
      [],
      ctx({
        blackouts: [
          { startsOn: addDays(MON, 2), endsOn: addDays(MON, 9), reason: "Company holiday" },
        ],
      }),
    );
    expect(c.map((x) => [x.code, x.severity, x.message])).toEqual([
      ["crew_time_off", "block", "Crew A is off Jul 13 (Vacation)."],
      ["crew_time_off", "warn", "Pat (Crew A) is off Jul 12."],
      ["crew_time_off", "block", "Jul 14 is a company blackout (Company holiday)."],
    ]);
  });

  it("blocks on holds (deposit first) whatever the rule settings say", () => {
    const c = checkPlacement(
      place(),
      job({
        blockingHolds: [
          { type: "deposit", label: "Deposit" },
          { type: "hoa", label: "HOA Hold" },
        ],
      }),
      crew(),
      [],
      ctx(),
    );
    expect(codes(c)).toEqual(["deposit_before_scheduling", "blocking_hold"]);
    expect(c[1]?.message).toContain("HOA Hold that blocks scheduling");
    expect(c.every((x) => !x.overridable)).toBe(true);
  });

  it("keeps exterior and deck work in season, with an owner override", () => {
    const p = place({
      startsOn: "2027-10-04",
      endsOn: "2027-10-06",
      workType: "exterior_production",
    });
    const j = job({ workTypes: ["exterior"] });
    const c = checkPlacement(p, j, crew(), [], ctx());
    expect(codes(c)).toEqual(["exterior_in_season"]);
    expect(c[0]?.message).toBe(
      "Oct 4–6 are outside the exterior season (Jun 1–Sep 30). An owner can override with a reason.",
    );
    expect(c[0]?.overridable).toBe(true);
    const over = checkPlacement(
      { ...p, overrideRules: ["exterior_in_season"] },
      j,
      crew(),
      [],
      ctx(),
    );
    expect(over[0]?.overridden).toBe(true);
    expect(isBlocked(over)).toBe(false);
    // Straddling the end of the season names the days outside it.
    const edge = checkPlacement(
      { ...p, startsOn: "2027-09-29", endsOn: "2027-10-01" },
      j,
      crew(),
      [],
      ctx(),
    );
    expect(edge[0]?.message).toMatch(/^Fri, Oct 1 is outside/);
  });

  it("needs the walkthrough and the HOA approval for exteriors", () => {
    const c = checkPlacement(
      place({ workType: "exterior_production" }),
      job({ walkthroughDone: false, workTypes: ["exterior"], hoaApprovalPending: true }),
      crew(),
      [],
      ctx(),
    );
    expect(codes(c)).toEqual(["walkthrough_before_production", "hoa_before_exterior"]);
  });

  it("checks subcontractor paperwork and suspension", () => {
    const sub = crew({
      crewType: "subcontractor",
      subcontractor: {
        name: "Cedar Brush LLC",
        status: "suspended",
        suspendedReason: "COI lapsed",
        lniExpiresOn: null,
        coiExpiresOn: addDays(MON, 1),
      },
    });
    const c = checkPlacement(place(), job(), sub, [], ctx());
    expect(c.map((x) => x.message)).toEqual([
      "Cedar Brush LLC is suspended (COI lapsed).",
      "Cedar Brush LLC has no L&I registration on file.",
      "Cedar Brush LLC's insurance (COI) expires Tue, Jul 13, before the job ends.",
    ]);
  });

  it("rejects past dates, inactive crews, closed jobs and empty ranges", () => {
    expect(
      codes(checkPlacement(place({ startsOn: "2027-06-30" }), job(), crew(), [], ctx())),
    ).toContain("past_date");
    expect(codes(checkPlacement(place(), job(), crew({ active: false }), [], ctx()))).toEqual([
      "inactive_crew",
    ]);
    expect(codes(checkPlacement(place(), job(), null, [], ctx()))).toEqual(["inactive_crew"]);
    expect(
      codes(checkPlacement(place(), job({ stage: "closed_lost" }), crew(), [], ctx())),
    ).toEqual(["job_closed"]);
    expect(
      checkPlacement(place({ startsOn: MON, endsOn: "2027-07-01" }), job(), crew(), [], ctx())[0]
        ?.message,
    ).toBe("The end date is before the start date.");
    const weekend = checkPlacement(
      place({ startsOn: "2027-07-17", endsOn: "2027-07-18" }),
      job(),
      crew(),
      [],
      ctx(),
    );
    expect(weekend[0]?.message).toBe(
      "Jul 17–18 has no production days (crews work Monday to Friday).",
    );
    const satStart = checkPlacement(
      place({ startsOn: "2027-07-17", endsOn: "2027-07-19" }),
      job(),
      crew(),
      [],
      ctx(),
    );
    expect(satStart.map((x) => [x.code, x.severity])).toEqual([["non_production_day", "warn"]]);
    expect(blockingConflicts(satStart)).toEqual([]);
  });

  it("only checks the rain forecast when weather is connected", () => {
    const p = place({ workType: "exterior_production" });
    const j = job({ workTypes: ["exterior"] });
    const days = [{ date: addDays(MON, 1), precipProbability: 80, minTempF: 40 }];
    expect(checkPlacement(p, j, crew(), [], ctx({ weather: { connected: false, days } }))).toEqual(
      [],
    );
    const c = checkPlacement(
      p,
      j,
      crew(),
      [],
      ctx({ weather: { connected: true, days, minApplicationTempF: 50 } }),
    );
    expect(c.map((x) => x.message)).toEqual([
      "Rain 80%+ is forecast on Tue, Jul 13.",
      "It's forecast below the paint's 50°F minimum on Tue, Jul 13.",
    ]);
  });

  it("skips rules that are switched off and uses a rule's severity", () => {
    const rules: Record<WorkRuleKey, (typeof DEFAULT_WORK_RULES)[WorkRuleKey]> = {
      ...DEFAULT_WORK_RULES,
      walkthrough_before_production: {
        ...DEFAULT_WORK_RULES.walkthrough_before_production,
        enabled: false,
      },
      spray_for_cabinets: { ...DEFAULT_WORK_RULES.spray_for_cabinets, severity: "warn" },
    };
    const c = checkPlacement(
      place({ workType: "cabinet_shop" }),
      job({ walkthroughDone: false, workTypes: ["cabinets"] }),
      crew(),
      [],
      ctx({ rules }),
    );
    expect(c.map((x) => [x.code, x.severity])).toEqual([["spray_for_cabinets", "warn"]]);
  });
});

describe("crew recommendations", () => {
  const crews = [
    { ...crew(), homeTerritoryId: "t-kirkland" },
    {
      ...crew({ id: "crew-b", name: "Crew B", skills: [{ key: "spray_finish", expiresOn: null }] }),
      homeTerritoryId: null,
    },
    { ...crew({ id: "crew-c", name: "Crew C", active: false }), homeTerritoryId: "t-kirkland" },
  ];
  const jobFacts = {
    ...job({ workTypes: ["cabinets"] }),
    territoryId: "t-kirkland",
    city: "Kirkland",
  };

  it("ranks by skills, availability, workload and territory, and explains the score", () => {
    const ranked = rankCrews(
      { job: jobFacts, workType: "cabinet_shop", startsOn: MON, endsOn: addDays(MON, 2) },
      crews,
      [],
      ctx(),
    );
    expect(ranked.map((r) => [r.crewName, r.score, r.eligible])).toEqual([
      ["Crew B", 90, true],
      ["Crew A", 65, false],
    ]);
    expect(ranked[0]?.reasons.map((r) => r.label)).toEqual([
      "Has every skill the job needs",
      "Free on these dates",
      "0 of the next 10 production days booked",
      "No home territory set",
    ]);
    expect(ranked[0]?.reasons.reduce((s, r) => s + r.points, 0)).toBe(ranked[0]?.score);
  });

  it("counts workload and busy days, and same-city clustering", () => {
    const busy: ScheduledBar = {
      id: "x",
      jobId: "job-9",
      jobLabel: "Other",
      crewId: "crew-b",
      startsOn: MON,
      endsOn: addDays(MON, 4),
      allowSplit: false,
    };
    const ranked = rankCrews(
      {
        job: { ...jobFacts, workTypes: ["interior"] },
        workType: "interior_production",
        startsOn: MON,
        endsOn: MON,
      },
      crews,
      [busy],
      ctx(),
      { "crew-b": ["Kirkland"] },
    );
    const b = ranked.find((r) => r.crewId === "crew-b");
    expect(b?.eligible).toBe(false);
    expect(b?.reasons.map((r) => r.label)).toEqual([
      "No special skills needed",
      "Not free on these dates",
      "5 of the next 10 production days booked",
      "Already working in Kirkland",
    ]);
    expect(ranked[0]?.crewId).toBe("crew-a");
  });

  it("finds the first open start for a crew", () => {
    const busy: ScheduledBar = {
      id: "x",
      jobId: "job-9",
      jobLabel: "Other",
      crewId: "crew-a",
      startsOn: MON,
      endsOn: addDays(MON, 2),
      allowSplit: false,
    };
    expect(firstOpenStart(job(), crew(), "interior_production", 2, [busy], ctx(), MON)).toEqual({
      startsOn: "2027-07-15",
      endsOn: "2027-07-16",
    });
    // A skill gap won't go away by waiting: the date stays.
    expect(
      firstOpenStart(job({ workTypes: ["cabinets"] }), crew(), "cabinet_shop", 1, [], ctx(), MON)
        ?.startsOn,
    ).toBe(MON);
    // Out of season for the whole search window → none.
    expect(
      firstOpenStart(
        job({ workTypes: ["exterior"] }),
        crew(),
        "exterior_production",
        1,
        [],
        ctx({ today: "2027-10-01" }),
        "2027-10-01",
        30,
      ),
    ).toBeNull();
  });
});

describe("dispatch readiness", () => {
  const base = {
    crewName: "Crew A",
    territoryMatch: true,
    missingSkillLabels: [],
    availabilityProblems: [],
    paintOrderStatuses: ["picked_up"],
    complianceOpen: [],
    seasonal: false,
    weather: { connected: false, problems: [] },
  };
  it("is 100% when everything lines up and leaves out what isn't connected", () => {
    expect(dispatchReadiness(base).percent).toBe(100);
    const ext = dispatchReadiness({ ...base, seasonal: true });
    expect(ext.percent).toBe(100);
    expect(ext.checks.find((c) => c.key === "weather")?.status).toBe("unavailable");
  });
  it("counts failures", () => {
    const r = dispatchReadiness({
      ...base,
      territoryMatch: false,
      paintOrderStatuses: ["draft"],
      complianceOpen: ["HOA approval"],
      seasonal: true,
      weather: { connected: true, problems: ["Rain 70% Tue"] },
    });
    expect(r.percent).toBe(33);
    expect(r.checks.map((c) => c.status)).toEqual(["fail", "pass", "pass", "fail", "fail", "fail"]);
    const none = dispatchReadiness({ ...base, crewName: null, territoryMatch: null });
    expect(none.checks.slice(0, 3).every((c) => c.status === "fail")).toBe(true);
    expect(dispatchReadiness({ ...base, territoryMatch: null }).checks[0]?.status).toBe(
      "unavailable",
    );
  });
  it("reads paint order status", () => {
    expect(materialsStatus([])).toBe("none");
    expect(materialsStatus(["canceled"])).toBe("none");
    expect(materialsStatus(["picked_up", "delivered"])).toBe("ready");
    expect(materialsStatus(["ordered", "delivered"])).toBe("ordered");
    expect(materialsStatus(["draft", "delivered"])).toBe("not_ordered");
  });
});

describe("on-time guarantee", () => {
  const base = {
    guaranteeDate: MON,
    actualStartDate: null,
    today: "2027-07-10",
    rainDelayDates: [],
    currentStatus: "n/a" as const,
    amountCents: 25_000,
  };
  it("is met when the job starts on or before the promised date", () => {
    expect(evaluateOnTime({ ...base, actualStartDate: MON, today: MON }).status).toBe("met");
    expect(evaluateOnTime({ ...base, actualStartDate: "2027-07-09" }).status).toBe("met");
  });
  it("waits while the date hasn't passed, and needs a promise", () => {
    expect(evaluateOnTime(base)).toMatchObject({ status: "n/a", draftCredit: null });
    expect(evaluateOnTime({ ...base, guaranteeDate: null }).status).toBe("n/a");
  });
  it("drafts the credit (amount from settings) when the start slips for a non-weather reason", () => {
    const late = evaluateOnTime({ ...base, actualStartDate: "2027-07-14", today: "2027-07-14" });
    expect(late.status).toBe("missed_credit_pending");
    expect(late.draftCredit).toEqual({
      amountCents: 25_000,
      reason: "Promised Mon, Jul 12, started Wed, Jul 14 (2 days late).",
    });
    const notStarted = evaluateOnTime({ ...base, today: "2027-07-13" });
    expect(notStarted.draftCredit?.reason).toBe(
      "Promised Mon, Jul 12; not started as of Tue, Jul 13.",
    );
    expect(evaluateOnTime({ ...base, today: "2027-07-13", amountCents: 0 }).draftCredit).toBeNull();
  });
  it("never charges for rain: a rain delay in the slip window means missed_weather, no credit", () => {
    const r = evaluateOnTime({
      ...base,
      actualStartDate: "2027-07-14",
      today: "2027-07-14",
      rainDelayDates: [MON],
    });
    expect(r).toMatchObject({ status: "missed_weather", draftCredit: null });
    // A rain day before the promise doesn't excuse a later slip.
    expect(
      evaluateOnTime({ ...base, actualStartDate: "2027-07-14", rainDelayDates: ["2027-07-01"] })
        .status,
    ).toBe("missed_credit_pending");
  });
  it("keeps an owner's decision", () => {
    expect(
      evaluateOnTime({ ...base, currentStatus: "waived_by_owner", today: "2027-08-01" }).status,
    ).toBe("waived_by_owner");
    expect(evaluateOnTime({ ...base, currentStatus: "credit_applied" }).detail).toMatch(/invoice/);
  });
  it("moves the guarantee date only for weather or a customer request", () => {
    expect(nextGuaranteeDate(null, MON, "company")).toBe(MON);
    expect(nextGuaranteeDate(MON, "2027-07-19", "company")).toBe(MON);
    expect(nextGuaranteeDate(MON, "2027-07-08", "company")).toBe("2027-07-08");
    expect(nextGuaranteeDate(MON, "2027-07-19", "weather")).toBe("2027-07-19");
    expect(nextGuaranteeDate(MON, "2027-07-19", "customer")).toBe("2027-07-19");
    expect(nextGuaranteeDate(MON, null, "company")).toBe(MON);
    expect(rescheduleCostsCredit(MON, "2027-07-19", "company")).toBe(true);
    expect(rescheduleCostsCredit(MON, "2027-07-19", "weather")).toBe(false);
    expect(rescheduleCostsCredit(null, "2027-07-19", "company")).toBe(false);
  });
});

describe("daily updates", () => {
  const ranges = [{ startsOn: MON, endsOn: "2027-07-19" }];
  const days = jobProductionDays(ranges, [1, 2, 3, 4, 5], ["2027-07-14"]);
  it("lists production days without weekends or rain days", () => {
    expect(days).toEqual(["2027-07-12", "2027-07-13", "2027-07-15", "2027-07-16", "2027-07-19"]);
    expect(isProductionDay(MON, ranges, [1, 2, 3, 4, 5])).toBe(true);
    expect(isProductionDay("2027-07-17", ranges, [1, 2, 3, 4, 5])).toBe(false);
  });
  it("raises a missed update only after 7:00 pm Pacific (fixed clock)", () => {
    const opts = { cutoffHour: 19, lookbackDays: 3 };
    const before = pacific("2027-07-13T18:59:00");
    const after = pacific("2027-07-13T19:00:00");
    expect(missedDailyUpdates(days, ["2027-07-12"], before, opts)).toEqual([]);
    expect(missedDailyUpdates(days, ["2027-07-12"], after, opts)).toEqual(["2027-07-13"]);
    expect(missedDailyUpdates(days, ["2027-07-12", "2027-07-13"], after, opts)).toEqual([]);
    // 11:30 pm Pacific is the next day in UTC: still Tuesday's update.
    expect(missedDailyUpdates(days, ["2027-07-12"], pacific("2027-07-13T23:30:00"), opts)).toEqual([
      "2027-07-13",
    ]);
    // Days older than the lookback drop off.
    expect(missedDailyUpdates(days, [], pacific("2027-07-20T08:00:00"), opts)).toEqual([
      "2027-07-19",
    ]);
    expect(
      dueDays(days, pacific("2027-07-16T20:00:00"), { cutoffHour: 19, lookbackDays: 10 }),
    ).toEqual(["2027-07-12", "2027-07-13", "2027-07-15", "2027-07-16"]);
  });
  it("computes compliance", () => {
    expect(dailyUpdateCompliance(0, 0)).toBeNull();
    expect(dailyUpdateCompliance(4, 3)).toBe(0.75);
  });
});

describe("subcontractor compliance", () => {
  const sub = {
    status: "active",
    lniExpiresOn: "2028-01-01",
    coiExpiresOn: "2028-01-01",
    bondExpiresOn: null,
    rrpExpiresOn: null,
    w9OnFile: true,
  };
  it("matches the database status", () => {
    expect(subcontractorStatus(sub, MON)).toBe("active");
    expect(subcontractorStatus({ ...sub, coiExpiresOn: "2027-08-01" }, MON)).toBe("expiring");
    expect(subcontractorStatus({ ...sub, w9OnFile: false }, MON)).toBe("expiring");
    expect(subcontractorStatus({ ...sub, lniExpiresOn: null }, MON)).toBe("expiring");
    expect(subcontractorStatus({ ...sub, status: "suspended" }, MON)).toBe("suspended");
  });
  it("lists what needs renewing", () => {
    expect(complianceIssues(sub, MON)).toEqual([]);
    expect(
      complianceIssues(
        {
          ...sub,
          coiExpiresOn: "2027-07-01",
          rrpExpiresOn: "2027-08-01",
          lniExpiresOn: null,
          w9OnFile: false,
        },
        MON,
      ).map((i) => [i.kind, i.level, i.message]),
    ).toEqual([
      ["lni", "expired", "L&I registration not on file."],
      ["coi", "expired", "Insurance (COI) expired Thu, Jul 1."],
      ["rrp", "expiring", "RRP certification expires Sun, Aug 1."],
      ["w9", "expired", "No W-9 on file."],
    ]);
  });
});

describe("publish plan", () => {
  const draft = (over: Partial<EntryState> = {}): EntryState => ({
    id: "e-1",
    jobId: "job-1",
    status: "draft",
    crewId: null,
    startsOn: null,
    endsOn: null,
    draftAction: "create",
    draftCrewId: "crew-a",
    draftStartsOn: MON,
    draftEndsOn: "2027-07-14",
    draftReason: null,
    ...over,
  });
  const jobs = new Map([
    ["job-1", { stage: "ready_to_schedule", guaranteeDate: null, isPriorityReschedule: false }],
    ["job-2", { stage: "scheduled", guaranteeDate: MON, isPriorityReschedule: true }],
  ]);

  it("publishes a new job: promise date, customer + crew notice, move to Scheduled", () => {
    const plan = planPublish([draft()], jobs);
    expect(plan.changes).toHaveLength(1);
    expect(plan.jobs[0]).toMatchObject({
      jobId: "job-1",
      firstStartAfter: MON,
      lastEndAfter: "2027-07-14",
      guaranteeDate: MON,
      customerChange: "scheduled",
      notifyCustomer: true,
      crewIds: ["crew-a"],
      advanceToScheduled: true,
      clearPriority: false,
    });
  });

  it("moves a published job: the company keeps the original promise, weather moves it and clears the rain flag", () => {
    const moved = draft({
      id: "e-2",
      jobId: "job-2",
      status: "published",
      crewId: "crew-a",
      startsOn: MON,
      endsOn: "2027-07-14",
      draftAction: "update",
      draftCrewId: "crew-b",
      draftStartsOn: "2027-07-19",
      draftEndsOn: "2027-07-21",
    });
    const company = planPublish([moved], jobs).jobs[0];
    expect(company).toMatchObject({
      customerChange: "moved",
      guaranteeDate: MON,
      crewIds: ["crew-a", "crew-b"],
      advanceToScheduled: false,
      clearPriority: true,
    });
    expect(planPublish([{ ...moved, draftReason: "weather" }], jobs).jobs[0]?.guaranteeDate).toBe(
      "2027-07-19",
    );
  });

  it("handles crew-only changes, cancellations and unchanged updates", () => {
    const pub = {
      id: "e-2",
      jobId: "job-2",
      status: "published" as const,
      crewId: "crew-a",
      startsOn: MON,
      endsOn: "2027-07-14",
    };
    const crewOnly = planPublish(
      [draft({ ...pub, draftAction: "update", draftCrewId: "crew-b" })],
      jobs,
    ).jobs[0];
    expect(crewOnly?.customerChange).toBe("crew_changed");
    const cancel = planPublish(
      [
        draft({
          ...pub,
          draftAction: "cancel",
          draftCrewId: null,
          draftStartsOn: null,
          draftEndsOn: null,
        }),
      ],
      jobs,
    );
    expect(cancel.changes[0]?.after).toBeNull();
    expect(cancel.jobs[0]).toMatchObject({
      customerChange: "unscheduled",
      firstStartAfter: null,
      guaranteeDate: MON,
    });
    const same = planPublish(
      [draft({ ...pub, draftAction: "update", draftCrewId: "crew-a" })],
      jobs,
    ).jobs[0];
    expect(same).toMatchObject({ customerChange: "unchanged", notifyCustomer: false, crewIds: [] });
  });

  it("publishes only the selected entries and skips jobs it doesn't know", () => {
    const a = draft();
    const b = draft({ id: "e-3", jobId: "job-unknown" });
    expect(planPublish([a, b], jobs, ["e-3"]).jobs).toEqual([]);
    expect(planPublish([a, b], jobs, ["e-1"]).changes.map((c) => c.entryId)).toEqual(["e-1"]);
    expect(planPublish([draft({ draftAction: null })], jobs).changes).toEqual([]);
  });

  it("knows what the schedule shows", () => {
    expect(effectiveSlot(draft())).toEqual({
      crewId: "crew-a",
      startsOn: MON,
      endsOn: "2027-07-14",
    });
    expect(effectiveSlot(draft({ status: "canceled" }))).toBeNull();
    expect(effectiveSlot(draft({ draftAction: "cancel" }))).toBeNull();
    expect(
      effectiveSlot(
        draft({ status: "published", crewId: "c", startsOn: MON, endsOn: MON, draftAction: null }),
      ),
    ).toEqual({ crewId: "c", startsOn: MON, endsOn: MON });
    expect(effectiveSlot(draft({ draftCrewId: null }))).toBeNull();
  });
});

describe("calendar layout", () => {
  it("builds Day / Week / Multi-week windows and pages through them", () => {
    expect(calendarWindow("day", MON)).toEqual([MON]);
    expect(calendarWindow("week", "2027-07-15")).toHaveLength(7);
    expect(calendarWindow("week", "2027-07-15")[0]).toBe(MON);
    expect(calendarWindow("multi", MON)).toHaveLength(28);
    expect(shiftAnchor("week", MON, 1)).toBe("2027-07-19");
    expect(shiftAnchor("day", MON, -1)).toBe("2027-07-11");
    expect(shiftAnchor("multi", MON, 1)).toBe("2027-08-09");
  });
  it("clips bars to the window and stacks overlapping bars into lanes", () => {
    const days = calendarWindow("week", MON);
    const rows = layoutRows(
      [
        { id: "a", crewId: "c1", startsOn: "2027-07-08", endsOn: "2027-07-13" },
        { id: "b", crewId: "c1", startsOn: "2027-07-13", endsOn: "2027-07-14" },
        { id: "c", crewId: "c1", startsOn: "2027-07-15", endsOn: "2027-07-30" },
        { id: "d", crewId: "c2", startsOn: "2027-08-01", endsOn: "2027-08-02" },
      ],
      days,
    );
    const c1 = rows.get("c1");
    expect(c1?.lanes).toBe(2);
    expect(
      c1?.bars.map((p) => [p.bar.id, p.col, p.span, p.lane, p.clippedStart, p.clippedEnd]),
    ).toEqual([
      ["a", 0, 2, 0, true, false],
      ["b", 1, 2, 1, false, false],
      ["c", 3, 4, 0, false, true],
    ]);
    expect(rows.has("c2")).toBe(false);
    expect(layoutRows([], []).size).toBe(0);
  });
  it("moves and resizes bars", () => {
    expect(moveBar({ startsOn: MON, endsOn: "2027-07-14" }, "2027-07-19")).toEqual({
      startsOn: "2027-07-19",
      endsOn: "2027-07-21",
    });
    expect(resizeBar({ startsOn: MON, endsOn: MON }, "2027-07-10")).toEqual({
      startsOn: MON,
      endsOn: MON,
    });
    expect(resizeBar({ startsOn: MON, endsOn: MON }, "2027-07-15").endsOn).toBe("2027-07-15");
    expect(resizeBar({ startsOn: MON, endsOn: MON }, "2028-07-15").endsOn).toBe(addDays(MON, 120));
  });
});

describe("production messages (draft wording)", () => {
  const c = {
    customerFirstName: "Maya",
    signerName: "Hunter Lee",
    companyName: "Brushy Bear Painters",
    crewLeadName: "Sam Rivera",
    arrivalWindow: "8:00–8:30 am",
  };
  it("tells the customer their dates, the arrival window and the rain-day promise", () => {
    const n = scheduleNotice("scheduled", { startsOn: MON, endsOn: "2027-07-14" }, c);
    expect(n.sms).toBe(
      "Hi Maya, you're on the schedule! We start Mon, Jul 12 (Jul 12–14). We'll arrive between 8:00–8:30 am. Sam leads your crew. If rain gets in the way, you're first on the schedule when it clears, and the delay never costs you anything. – Hunter, Brushy Bear Painters",
    );
    expect(n.emailSubject).toBe("You're on the schedule: Mon, Jul 12");
    expect(n.emailBody).toContain("Reply to this message");
    expect(
      scheduleNotice("moved", { startsOn: MON, endsOn: MON }, { ...c, customerFirstName: null })
        .sms,
    ).toMatch(/^Hi, your painting dates have changed/);
    expect(scheduleNotice("unscheduled", { startsOn: null, endsOn: null }, c).emailSubject).toBe(
      "Your painting dates",
    );
    expect(
      scheduleNotice("crew_changed", { startsOn: MON, endsOn: MON }, { ...c, crewLeadName: null })
        .sms,
    ).toBe("Hi Maya, a quick update: your dates stay Jul 12. – Hunter, Brushy Bear Painters");
  });
  it("uses the SPEC's rain-delay wording", () => {
    expect(rainDelayText("2027-07-15", c)).toBe(
      "Hi Maya, rain's coming in Thursday. We'll move your start to the next dry day, and you're first on the list. No cost to you. – Hunter, Brushy Bear Painters",
    );
  });
  it("writes the daily update signed by the point of contact", () => {
    const u = dailyUpdateText(
      { finishedToday: "Primed the living room", nextUp: "First coat", photoCount: 3 },
      c,
    );
    expect(u.sms).toBe(
      "Hi Maya, today's update: Primed the living room. Next up: First coat. The work area is cleaned up for the evening. 3 photos from today are in your project. – Hunter, Brushy Bear Painters",
    );
    expect(u.emailBody).toContain("Finished today: Primed the living room");
    expect(
      dailyUpdateText({ finishedToday: "Done!", nextUp: null, photoCount: 1 }, c).sms,
    ).toContain("Done! The work area");
  });
  it("lists crew changes", () => {
    const n = crewNotice("Crew A", [
      { jobLabel: "BB-2027-0001 Lee", city: "Kirkland", before: null, after: "Jul 12–14" },
      { jobLabel: "BB-2027-0002 Park", city: null, before: "Jul 19", after: null },
      { jobLabel: "BB-2027-0003 Kim", city: null, before: "Jul 1", after: "Jul 2" },
    ]);
    expect(n.body.split("\n").slice(1, 4)).toEqual([
      "• BB-2027-0001 Lee (Kirkland): Jul 12–14",
      "• BB-2027-0002 Park: taken off your schedule (was Jul 19)",
      "• BB-2027-0003 Kim: moved from Jul 1 to Jul 2",
    ]);
  });
  it("formats the arrival window", () => {
    expect(arrivalWindowLabel("08:00", 30)).toBe("8:00–8:30 am");
    expect(arrivalWindowLabel("11:45", 30)).toBe("11:45 am–12:15 pm");
    expect(arrivalWindowLabel("08:00:00", 0)).toBe("8:00 am");
    expect(arrivalWindowLabel("later", 30)).toBeNull();
  });
});
