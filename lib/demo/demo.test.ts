import { describe, expect, it } from "vitest";
import { JOB_STAGES } from "@/lib/domain/stages";
import { demoGuard, isLocalSupabaseUrl, NOT_PRODUCTION_FLAG } from "./guard";
import {
  DEMO_CITIES,
  DEMO_HOLD_TYPES,
  DEMO_STAGE_COUNTS,
  DEMO_WORK_TYPES,
  generateDemoPlan,
  mulberry32,
  pacificDate,
  stageAtLeast,
} from "./generate";

const ENV = {
  DEMO_DATA: "true",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-key",
};

describe("demoGuard", () => {
  it("runs against a local stack with DEMO_DATA=true", () => {
    expect(demoGuard(ENV, [])).toEqual({ ok: true, local: true });
    expect(demoGuard({ ...ENV, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }, [])).toEqual({
      ok: true,
      local: true,
    });
  });

  it("refuses without DEMO_DATA=true", () => {
    for (const v of [undefined, "", "false", "1", "TRUE"]) {
      const r = demoGuard({ ...ENV, DEMO_DATA: v }, [NOT_PRODUCTION_FLAG]);
      expect(r.ok).toBe(false);
    }
  });

  it("refuses a hosted project unless the not-production flag is passed", () => {
    const hosted = { ...ENV, NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" };
    const refused = demoGuard(hosted, ["--replace"]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain("abcd.supabase.co");
    expect(demoGuard(hosted, [NOT_PRODUCTION_FLAG])).toEqual({ ok: true, local: false });
  });

  it("refuses when the URL or service key is missing", () => {
    expect(demoGuard({ ...ENV, NEXT_PUBLIC_SUPABASE_URL: undefined }, []).ok).toBe(false);
    expect(demoGuard({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" }, []).ok).toBe(false);
  });

  it("treats junk and look-alike hosts as not local", () => {
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
    expect(isLocalSupabaseUrl("https://127.0.0.1.example.com")).toBe(false);
    expect(isLocalSupabaseUrl("https://localhost.supabase.co")).toBe(false);
    expect(demoGuard({ ...ENV, NEXT_PUBLIC_SUPABASE_URL: "nope" }, []).ok).toBe(false);
  });
});

describe("generateDemoPlan", () => {
  const now = new Date("2026-10-27T18:00:00Z");
  const plan = generateDemoPlan({ seed: 7, now, ownerCount: 3 });

  it("is deterministic for a seed and changes with the seed", () => {
    expect(generateDemoPlan({ seed: 7, now, ownerCount: 3 })).toEqual(plan);
    expect(generateDemoPlan({ seed: 8, now, ownerCount: 3 }).leads[0]).not.toEqual(plan.leads[0]);
  });

  it("makes ~300 leads and 120 jobs across every stage", () => {
    expect(plan.leads).toHaveLength(300);
    expect(plan.jobs).toHaveLength(120);
    for (const s of JOB_STAGES) {
      expect(plan.jobs.filter((j) => j.stage === s.id)).toHaveLength(DEMO_STAGE_COUNTS[s.id]);
    }
  });

  it("covers every work type, five cities and some out-of-area leads", () => {
    for (const w of DEMO_WORK_TYPES) {
      expect(
        plan.jobs.some((j) => j.workTypes.includes(w)),
        w,
      ).toBe(true);
    }
    const cities = new Set(plan.leads.filter((l) => !l.outOfArea).map((l) => l.city));
    expect([...cities].sort()).toEqual(DEMO_CITIES.map((c) => c.city).sort());
    expect(plan.leads.filter((l) => l.outOfArea).length).toBeGreaterThan(0);
    for (const l of plan.leads.filter((x) => !x.outOfArea)) {
      expect(DEMO_CITIES.find((c) => c.city === l.city)?.zips).toContain(l.zip);
    }
  });

  it("links every job to exactly one converted lead", () => {
    const converted = plan.leads.filter((l) => l.status === "converted");
    expect(converted).toHaveLength(120);
    for (const j of plan.jobs) {
      const lead = plan.leads.find((l) => l.key === j.leadKey);
      expect(lead?.jobIndex).toBe(j.index);
    }
    const keys = new Set(plan.leads.map((l) => l.key));
    expect(keys.size).toBe(plan.leads.length);
  });

  it("uses only fictional contact details, each phone once", () => {
    const phones = plan.leads.flatMap((l) => (l.mobile ? [l.mobile] : []));
    expect(new Set(phones).size).toBe(phones.length);
    for (const p of phones) expect(p).toMatch(/^\+14255550[01]\d\d$/);
    for (const l of plan.leads) {
      expect(l.email ?? l.mobile).toBeTruthy();
      if (l.email) expect(l.email).toMatch(/@example\.(com|net)$/);
    }
  });

  it("gives lost leads a reason and only open/closed lead statuses", () => {
    for (const l of plan.leads) {
      expect(["new", "contacted", "nurture", "unqualified", "lost", "converted"]).toContain(
        l.status,
      );
      expect(l.lostReason !== null).toBe(l.status === "lost");
    }
    for (const j of plan.jobs) expect(j.lostReason !== null).toBe(j.stage === "closed_lost");
  });

  it("puts every date in the past, in stage order, with the lead before the job", () => {
    for (const j of plan.jobs) {
      const times = j.timeline.map((t) => Date.parse(t.at));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(times[times.length - 1]!).toBeLessThan(now.getTime());
      expect(j.timeline[j.timeline.length - 1]!.stage).toBe(j.stage);
      const lead = plan.leads.find((l) => l.key === j.leadKey)!;
      expect(Date.parse(lead.createdAt)).toBeLessThan(times[0]!);
    }
    for (const l of plan.leads) expect(Date.parse(l.createdAt)).toBeLessThan(now.getTime());
  });

  it("assigns crews and production windows from Scheduled on (two employee crews, one sub)", () => {
    expect(plan.crews.map((c) => c.crewType)).toEqual(["employee", "employee", "subcontractor"]);
    const today = pacificDate(now.getTime());
    for (const j of plan.jobs) {
      const producing = stageAtLeast(j.stage, "scheduled");
      expect(j.crewIndex !== null).toBe(producing);
      expect(j.production !== null).toBe(producing);
      if (j.stage === "scheduled") expect(j.production!.startsOn > today).toBe(true);
      if (j.stage === "in_progress") {
        expect(j.production!.startsOn <= today && j.production!.endsOn >= today).toBe(true);
      }
      if (j.production) expect(j.production.startsOn <= j.production.endsOn).toBe(true);
    }
    expect(new Set(plan.jobs.map((j) => j.crewIndex).filter((c) => c !== null))).toEqual(
      new Set([0, 1, 2]),
    );
  });

  it("books upcoming work back to back: a crew never has two upcoming jobs on one day", () => {
    const upcoming = plan.jobs.filter((j) => j.stage === "scheduled");
    for (const a of upcoming) {
      for (const b of upcoming) {
        if (a === b || a.crewIndex !== b.crewIndex) continue;
        const apart =
          a.production!.endsOn < b.production!.startsOn ||
          b.production!.endsOn < a.production!.startsOn;
        expect(apart, `${a.index} and ${b.index}`).toBe(true);
      }
    }
  });

  it("uses every hold type and adds weather delays", () => {
    const holds = new Set(plan.jobs.flatMap((j) => j.holds));
    for (const h of DEMO_HOLD_TYPES) expect(holds.has(h), h).toBe(true);
    for (const j of plan.jobs.filter((x) => x.holds.includes("deposit"))) {
      expect(j.stage).toBe("sold");
      expect(j.depositPaid).toBe(false);
    }
    const rain = plan.jobs.filter((j) => j.rainDelay);
    expect(rain.length).toBeGreaterThan(0);
    for (const j of rain) expect(["in_progress", "final_walkthrough"]).toContain(j.stage);
  });

  it("plans estimates with two options and an add-on, and money by stage", () => {
    for (const j of plan.jobs) {
      const hasEstimate = stageAtLeast(j.stage, "estimate_sent") || j.stage === "closed_lost";
      expect(j.estimate !== null).toBe(hasEstimate);
      if (j.estimate) {
        expect(j.estimate.areas.length).toBeGreaterThan(0);
        expect(j.estimate.premiumExtra.lines.length).toBeGreaterThan(0);
        expect(j.estimate.addOn.quantity).toBeGreaterThan(0);
        expect(j.estimate.declined).toBe(j.stage === "closed_lost");
      }
      expect(j.depositPaid).toBe(stageAtLeast(j.stage, "onboarding"));
    }
    const invoiced = plan.jobs.filter((j) => j.stage === "invoiced").map((j) => j.finalInvoice);
    expect(invoiced).toContain("overdue");
    expect(invoiced.every((f) => ["sent", "overdue", "partial"].includes(f))).toBe(true);
    expect(
      plan.jobs
        .filter((j) => ["paid_in_full", "closed_won"].includes(j.stage))
        .every((j) => j.finalInvoice === "paid"),
    ).toBe(true);
    expect(plan.jobs.some((j) => j.dailyLogs > 0)).toBe(true);
  });

  it("spreads leads over the owners it was given", () => {
    expect(new Set(plan.leads.map((l) => l.ownerIndex))).toEqual(new Set([0, 1, 2]));
  });
});

describe("mulberry32", () => {
  it("returns numbers in [0, 1) and repeats for a seed", () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(b()).toBe(x);
    }
  });
});
