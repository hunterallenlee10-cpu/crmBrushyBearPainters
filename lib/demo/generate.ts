import { JOB_STAGES, type JobStageId } from "@/lib/domain/stages";

/**
 * Demo data plan for `pnpm seed:demo` (SPEC §15.2): ~300 leads and ~120 jobs
 * spread over every stage and work type, five cities, estimates with options
 * and add-ons, invoices and payments (some overdue), daily logs, three crews
 * (two employee, one subcontractor), every hold type, weather delays.
 *
 * Pure and deterministic (seeded PRNG + an explicit "now"), so the same seed
 * gives the same plan and the shape is unit-tested. scripts/seed-demo.ts turns
 * the plan into records through the app's own database functions. Every name,
 * address, phone and email is fictional: 555-01xx numbers and example.com /
 * example.net addresses, which can't reach anyone.
 */

export type DemoCity = { city: string; zips: readonly string[] };

/** The five service-area cities seeded in Admin → Territories. */
export const DEMO_CITIES: readonly DemoCity[] = [
  { city: "Kirkland", zips: ["98033", "98034"] },
  { city: "Bellevue", zips: ["98004", "98005", "98006", "98007", "98008"] },
  { city: "Redmond", zips: ["98052", "98053"] },
  { city: "Sammamish", zips: ["98074", "98075"] },
  { city: "Issaquah", zips: ["98027", "98029"] },
];

/** Outside the service area (for out-of-area leads). */
const OUT_OF_AREA: readonly DemoCity[] = [
  { city: "Tacoma", zips: ["98402"] },
  { city: "Everett", zips: ["98201"] },
];

export const DEMO_WORK_TYPES = [
  "interior",
  "exterior",
  "cabinets",
  "deck_fence",
  "add_on_only",
  "warranty_touch_up",
] as const;
export type DemoWorkType = (typeof DEMO_WORK_TYPES)[number];

export const DEMO_HOLD_TYPES = [
  "deposit",
  "hoa",
  "lead_safe",
  "weather",
  "customer",
  "color",
  "repair_approval",
  "materials",
  "other",
] as const;
export type DemoHoldType = (typeof DEMO_HOLD_TYPES)[number];

const HOLD_REASONS: Record<DemoHoldType, string> = {
  deposit: "Waiting for the deposit.",
  hoa: "Waiting for HOA color approval.",
  lead_safe: "Pre-1978 home: lead-safe paperwork and test results first.",
  weather: "Exterior work paused for rain in the forecast.",
  customer: "Customer asked to wait until they're back from travel.",
  color: "Customer is still choosing colors.",
  repair_approval: "Rot repair found; waiting for the customer to approve the change order.",
  materials: "Specialty primer on back order at the paint store.",
  other: "Waiting on a key from the property manager.",
};

export type DemoLeadStatus = "new" | "contacted" | "nurture" | "unqualified" | "lost" | "converted";

export type DemoLead = {
  key: string;
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string | null;
  street: string;
  city: string;
  zip: string;
  outOfArea: boolean;
  source: string;
  services: string[];
  timeline: "asap" | "1_3_months" | "3_plus_months" | "just_planning";
  homeBuilt: "before_1978" | "1978_or_later" | "not_sure";
  yearBuilt: number | null;
  propertyType: "single_family" | "townhome" | "condo";
  stories: number;
  sidingType: string | null;
  hasHoa: boolean;
  status: DemoLeadStatus;
  lostReason: string | null;
  disposition: string | null;
  /** Index into the people the script loads (owners and estimators). */
  ownerIndex: number;
  createdAt: string;
  /** Set when this lead becomes a job (index into plan.jobs). */
  jobIndex: number | null;
};

export type DemoEstimateArea = {
  name: string;
  workType: Exclude<DemoWorkType, "add_on_only" | "warranty_touch_up">;
  /** Catalog codes with quantities (catalog units). */
  lines: { code: string; quantity: number }[];
};

export type DemoEstimate = {
  /** Option A ("Standard") and Option B ("Premium": two coats + extra scope). */
  areas: DemoEstimateArea[];
  premiumExtra: DemoEstimateArea;
  /** Optional add-on line (catalog code). */
  addOn: { code: string; quantity: number };
  /** Accepted: which option the customer picked and whether they took the add-on. */
  pickPremium: boolean;
  takeAddOn: boolean;
  declined: boolean;
};

export type DemoFinalInvoice = "none" | "sent" | "overdue" | "partial" | "paid";

export type DemoJob = {
  index: number;
  leadKey: string;
  stage: JobStageId;
  workTypes: DemoWorkType[];
  /** 0, 1 = employee crews, 2 = subcontractor crew. */
  crewIndex: number | null;
  /** When the job entered each stage on its path (ISO), in order. */
  timeline: { stage: JobStageId; at: string }[];
  estimate: DemoEstimate | null;
  depositPaid: boolean;
  finalInvoice: DemoFinalInvoice;
  paymentMethod: "check" | "card" | "ach" | "zelle";
  holds: DemoHoldType[];
  rainDelay: boolean;
  dailyLogs: number;
  /** Production window (Pacific dates) for scheduled and later jobs. */
  production: { startsOn: string; endsOn: string } | null;
  lostReason: string | null;
  priority: boolean;
};

export type DemoCrew = {
  name: string;
  crewType: "employee" | "subcontractor";
  color: string;
  cityIndex: number;
  members: { displayName: string; role: "lead" | "painter" | "helper" }[];
};

export type DemoPlan = {
  seed: number;
  now: string;
  subcontractor: { companyName: string; contactName: string; email: string };
  crews: DemoCrew[];
  leads: DemoLead[];
  jobs: DemoJob[];
};

export type DemoOptions = {
  seed?: number;
  now?: Date;
  leadCount?: number;
  /** How many owners/estimators the script found to assign leads to. */
  ownerCount?: number;
};

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  weighted: <T extends string>(items: readonly (readonly [T, number])[]) => T;
  chance: (p: number) => boolean;
};

function rng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)] as T,
    weighted: <T extends string>(items: readonly (readonly [T, number])[]) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) {
        r -= w;
        if (r < 0) return v;
      }
      return items[items.length - 1]![0];
    },
    chance: (p: number) => next() < p,
  };
}

// ---------------------------------------------------------------------------
// Vocabularies (generic; nothing here describes a real person or business)
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Avery",
  "Blake",
  "Cameron",
  "Dana",
  "Elliot",
  "Frances",
  "Gabriel",
  "Harper",
  "Isaac",
  "Jordan",
  "Kendall",
  "Logan",
  "Morgan",
  "Nina",
  "Owen",
  "Parker",
  "Quinn",
  "Riley",
  "Sam",
  "Taylor",
  "Uma",
  "Victor",
  "Wendy",
  "Xavier",
  "Yara",
  "Zane",
  "Alex",
  "Brooke",
  "Casey",
  "Drew",
  "Emery",
  "Finley",
  "Grace",
  "Hayden",
  "Ivy",
  "Jesse",
  "Kai",
  "Lena",
  "Miles",
  "Noah",
  "Olivia",
  "Priya",
  "Reese",
  "Sofia",
  "Theo",
  "Vera",
  "Wyatt",
  "Zoe",
  "Mei",
  "Arjun",
] as const;

const LAST_NAMES = [
  "Anderson",
  "Brooks",
  "Carter",
  "Diaz",
  "Ellis",
  "Foster",
  "Garcia",
  "Hughes",
  "Ito",
  "Jensen",
  "Kim",
  "Lopez",
  "Martin",
  "Nguyen",
  "Olsen",
  "Patel",
  "Quintero",
  "Reyes",
  "Schmidt",
  "Turner",
  "Underwood",
  "Vasquez",
  "Walker",
  "Young",
  "Zimmerman",
  "Bennett",
  "Chen",
  "Dawson",
  "Evans",
  "Fischer",
  "Gupta",
  "Hansen",
  "Iverson",
  "Johansson",
  "Kowalski",
  "Larsen",
  "Murphy",
  "Nakamura",
  "Ortiz",
  "Park",
] as const;

const STREETS = [
  "NE 85th St",
  "132nd Ave NE",
  "NE 24th St",
  "Lake Hills Blvd",
  "SE 8th St",
  "148th Ave SE",
  "NE Redmond Way",
  "Avondale Rd NE",
  "228th Ave SE",
  "Issaquah-Pine Lake Rd SE",
  "Front St N",
  "Market St",
  "7th Ave S",
  "Forbes Creek Dr",
  "NE 116th St",
  "Juanita Dr NE",
  "SE 43rd Way",
  "Newport Way SW",
  "Klahanie Blvd",
  "E Lake Sammamish Pkwy NE",
  "NE 40th St",
  "164th Ave NE",
] as const;

const SOURCES = [
  ["website", 24],
  ["google_ads", 12],
  ["google_business_profile", 12],
  ["customer_referral", 10],
  ["past_customer", 6],
  ["nextdoor", 6],
  ["facebook_instagram", 6],
  ["yard_sign", 4],
  ["neighbor_jobsite_sign", 4],
  ["angi", 3],
  ["yelp", 3],
  ["thumbtack", 2],
  ["home_show_event", 2],
  ["realtor_property_manager", 2],
  ["local_services_ads", 1],
  ["vehicle_truck", 1],
  ["door_hanger_flyer", 1],
  ["partner_vendor_referral", 1],
] as const;

const LOST_REASONS = [
  "price",
  "timing",
  "chose_competitor",
  "diy",
  "no_response",
  "scope_not_a_fit",
] as const;

/** Stage counts for the job pipeline (sums to 120). */
export const DEMO_STAGE_COUNTS: Readonly<Record<JobStageId, number>> = {
  walkthrough_scheduled: 10,
  walkthrough_complete: 6,
  estimate_sent: 14,
  sold: 6,
  onboarding: 8,
  ready_to_schedule: 8,
  scheduled: 10,
  in_progress: 5,
  final_walkthrough: 5,
  completed: 5,
  invoiced: 8,
  paid_in_full: 6,
  closed_won: 21,
  closed_lost: 8,
};

/** Typical days between entering a stage and entering the next one. */
const STAGE_GAP: Readonly<Record<JobStageId, readonly [number, number]>> = {
  walkthrough_scheduled: [2, 7],
  walkthrough_complete: [1, 4],
  estimate_sent: [3, 14],
  sold: [1, 5],
  onboarding: [5, 14],
  ready_to_schedule: [3, 10],
  scheduled: [7, 25],
  in_progress: [3, 9],
  final_walkthrough: [1, 3],
  completed: [0, 2],
  invoiced: [3, 25],
  paid_in_full: [1, 7],
  closed_won: [0, 0],
  closed_lost: [0, 0],
};

const PATH: readonly JobStageId[] = JOB_STAGES.filter((s) => s.id !== "closed_lost").map(
  (s) => s.id,
);

const DAY = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Pacific calendar date (YYYY-MM-DD) for an instant. */
export function pacificDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(ms));
}

function stageIndex(stage: JobStageId): number {
  return PATH.indexOf(stage);
}

export function stageAtLeast(stage: JobStageId, min: JobStageId): boolean {
  if (stage === "closed_lost") return false;
  return stageIndex(stage) >= stageIndex(min);
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

function areaFor(r: Rng, workType: DemoEstimateArea["workType"], n: number): DemoEstimateArea {
  switch (workType) {
    case "interior": {
      const room = r.pick([
        "Living room",
        "Primary bedroom",
        "Kitchen",
        "Hallway",
        "Dining room",
        "Family room",
        "Guest bedroom",
      ]);
      const walls = r.int(28, 60) * 10;
      return {
        name: n > 0 ? `${room} ${n + 1}` : room,
        workType,
        lines: [
          { code: "int_walls", quantity: walls },
          { code: "int_ceilings", quantity: Math.round(walls * 0.35) },
          { code: "int_baseboard", quantity: r.int(40, 90) },
          { code: "int_door", quantity: r.int(1, 3) },
        ],
      };
    }
    case "exterior":
      return {
        name: n > 0 ? `House body ${n + 1}` : "House body",
        workType,
        lines: [
          {
            code: r.pick(["ext_siding_fiber_cement", "ext_siding_cedar", "ext_siding_vinyl"]),
            quantity: r.int(180, 360) * 10,
          },
          { code: "ext_trim", quantity: r.int(250, 520) },
          { code: "ext_soffit", quantity: r.int(30, 70) * 10 },
          { code: "ext_fascia", quantity: r.int(160, 320) },
          { code: "ext_garage_door", quantity: r.int(1, 2) },
        ],
      };
    case "cabinets":
      return {
        name: "Kitchen cabinets",
        workType,
        lines: [
          { code: "cab_doors", quantity: r.int(18, 36) },
          { code: "cab_drawer_fronts", quantity: r.int(6, 14) },
          { code: "cab_end_panels", quantity: r.int(2, 5) },
          { code: "cab_hardware", quantity: r.int(24, 50) },
        ],
      };
    case "deck_fence":
      return {
        name: r.chance(0.5) ? "Back deck" : "Fence",
        workType,
        lines: r.chance(0.5)
          ? [
              { code: "deck_clean_brighten", quantity: r.int(25, 60) * 10 },
              { code: "deck_boards", quantity: r.int(25, 60) * 10 },
              { code: "deck_railings", quantity: r.int(30, 80) },
            ]
          : [{ code: "fence", quantity: r.int(60, 160) * 10 }],
      };
  }
}

function estimateFor(r: Rng, workTypes: readonly DemoWorkType[], stage: JobStageId): DemoEstimate {
  const priced = workTypes.filter(
    (w): w is DemoEstimateArea["workType"] => w !== "add_on_only" && w !== "warranty_touch_up",
  );
  const kinds: DemoEstimateArea["workType"][] = priced.length > 0 ? priced : ["interior"];
  const areas: DemoEstimateArea[] = [];
  for (const k of kinds) {
    const count = k === "interior" ? r.int(1, 3) : 1;
    for (let i = 0; i < count; i++) areas.push(areaFor(r, k, i));
  }
  const exterior = kinds.includes("exterior");
  return {
    areas,
    premiumExtra: areaFor(r, kinds[0]!, areas.length),
    addOn: exterior
      ? { code: "pressure_washing", quantity: r.int(150, 300) * 10 }
      : { code: "color_consultation", quantity: 1 },
    pickPremium: r.chance(0.35),
    takeAddOn: r.chance(0.5),
    declined: stage === "closed_lost",
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

function workTypesFor(r: Rng, i: number): DemoWorkType[] {
  // Every work type shows up; the mix leans on interior and exterior.
  if (i % 40 === 7) return ["add_on_only"];
  if (i % 40 === 23) return ["warranty_touch_up"];
  const main = r.weighted([
    ["interior", 40],
    ["exterior", 35],
    ["cabinets", 13],
    ["deck_fence", 12],
  ] as const);
  if (main === "exterior" && r.chance(0.2)) return ["exterior", "deck_fence"];
  if (main === "interior" && r.chance(0.15)) return ["interior", "cabinets"];
  return [main];
}

function servicesFor(workTypes: readonly DemoWorkType[]): string[] {
  const s = workTypes.filter(
    (w) => w === "interior" || w === "exterior" || w === "cabinets" || w === "deck_fence",
  );
  return s.length > 0 ? [...s] : ["other"];
}

/** How long a job has sat in its current stage (some deliberately stale). */
function daysInStage(r: Rng, stage: JobStageId, i: number): number {
  const stale = i % 5 === 0;
  switch (stage) {
    case "walkthrough_scheduled":
      return r.int(0, 4);
    case "estimate_sent":
      return stale ? r.int(12, 20) : r.int(1, 8);
    case "sold":
      return stale ? r.int(8, 12) : r.int(0, 4);
    case "onboarding":
      return stale ? r.int(18, 28) : r.int(1, 10);
    case "ready_to_schedule":
      return stale ? r.int(16, 24) : r.int(1, 8);
    case "scheduled":
      return r.int(2, 12);
    case "in_progress":
      return r.int(1, 4);
    case "invoiced":
      return stale ? r.int(35, 50) : r.int(2, 20);
    case "closed_won":
      return r.int(5, 200);
    case "closed_lost":
      return r.int(3, 120);
    default:
      return r.int(0, 3);
  }
}

function buildTimeline(
  r: Rng,
  stage: JobStageId,
  entered: number,
): { stage: JobStageId; at: number }[] {
  const target = stage === "closed_lost" ? "estimate_sent" : stage;
  const path = PATH.slice(0, stageIndex(target) + 1);
  const out: { stage: JobStageId; at: number }[] = [];
  let at = entered;
  if (stage === "closed_lost") {
    out.unshift({ stage: "closed_lost", at });
    at -= r.int(...STAGE_GAP.estimate_sent) * DAY;
  }
  for (let k = path.length - 1; k >= 0; k--) {
    const s = path[k]!;
    out.unshift({ stage: s, at });
    if (k > 0) at -= Math.max(1, r.int(...STAGE_GAP[path[k - 1]!])) * DAY - r.int(0, 8) * 3_600_000;
  }
  return out;
}

const CREW_COUNT = 3;

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T12:00:00Z`) / DAY);
}

/** Days two Pacific date ranges share. */
function overlapDays(
  a: { startsOn: string; endsOn: string },
  b: { startsOn: string; endsOn: string },
) {
  const from = Math.max(dayNumber(a.startsOn), dayNumber(b.startsOn));
  const to = Math.min(dayNumber(a.endsOn), dayNumber(b.endsOn));
  return Math.max(0, to - from + 1);
}

/**
 * Crews and production windows for Scheduled-and-later jobs, like a real
 * board: jobs in progress started on their In Progress day, upcoming jobs are
 * booked back to back per crew from a few days out, finished jobs keep the
 * window from their history and go to the least busy crew.
 */
function placeProduction(r: Rng, jobs: DemoJob[], nowMs: number): void {
  const booked: { startsOn: string; endsOn: string }[][] = Array.from(
    { length: CREW_COUNT },
    () => [],
  );
  const cursor: number[] = Array.from({ length: CREW_COUNT }, () => nowMs + 3 * DAY);
  const duration = (j: DemoJob) => (j.workTypes.includes("exterior") ? r.int(4, 7) : r.int(2, 4));
  const at = (j: DemoJob, st: JobStageId) => {
    const t = j.timeline.find((x) => x.stage === st);
    return t ? Date.parse(t.at) : undefined;
  };
  const leastBusy = (w: { startsOn: string; endsOn: string }) => {
    let best = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let c = 0; c < CREW_COUNT; c++) {
      const score = booked[c]!.reduce((s, b) => s + overlapDays(b, w), 0) * 100 + booked[c]!.length;
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  };

  jobs
    .filter((j) => j.stage === "in_progress")
    .forEach((j, k) => {
      const started = at(j, "in_progress") ?? nowMs - DAY;
      const end = Math.max(started + (duration(j) - 1) * DAY, nowMs + 2 * DAY);
      const w = { startsOn: pacificDate(started), endsOn: pacificDate(end) };
      const c = k % CREW_COUNT;
      j.crewIndex = c;
      j.production = w;
      booked[c]!.push(w);
      cursor[c] = Math.max(cursor[c]!, end + DAY);
    });

  jobs
    .filter((j) => j.stage === "scheduled")
    .forEach((j, k) => {
      const c = k % CREW_COUNT;
      const start = cursor[c]!;
      const end = start + (duration(j) - 1) * DAY;
      const w = { startsOn: pacificDate(start), endsOn: pacificDate(end) };
      j.crewIndex = c;
      j.production = w;
      booked[c]!.push(w);
      cursor[c] = end + (1 + r.int(0, 2)) * DAY;
    });

  for (const j of jobs) {
    if (!stageAtLeast(j.stage, "final_walkthrough")) continue;
    const started = at(j, "in_progress");
    const done = at(j, "final_walkthrough");
    if (started === undefined || done === undefined) continue;
    const w = {
      startsOn: pacificDate(started),
      endsOn: pacificDate(Math.max(started, done - 2 * 3_600_000)),
    };
    const c = leastBusy(w);
    j.crewIndex = c;
    j.production = w;
    booked[c]!.push(w);
  }
}

export function generateDemoPlan(options: DemoOptions = {}): DemoPlan {
  const seed = options.seed ?? 20261031;
  const nowMs = (options.now ?? new Date()).getTime();
  const leadCount = Math.max(options.leadCount ?? 300, 130);
  const ownerCount = Math.max(1, options.ownerCount ?? 1);
  const r = rng(seed);
  let phoneSeq = 0;

  const person = (n: number) => {
    const firstName = FIRST_NAMES[(n * 7 + r.int(0, 3)) % FIRST_NAMES.length]!;
    const lastName = LAST_NAMES[(n * 11 + r.int(0, 5)) % LAST_NAMES.length]!;
    // Fictional contacts: example domains, and 555-0100..0199 numbers (one each).
    const useEmail = r.chance(0.85) || phoneSeq >= 100;
    const email = useEmail
      ? `${firstName}.${lastName}.${n + 1}@${n % 2 === 0 ? "example.com" : "example.net"}`.toLowerCase()
      : null;
    const mobile =
      phoneSeq < 100 && (!useEmail || r.chance(0.3))
        ? `+1425555${String(100 + phoneSeq++).padStart(4, "0")}`
        : null;
    return { firstName, lastName, email, mobile };
  };

  const address = (outOfArea: boolean) => {
    const c = outOfArea ? r.pick(OUT_OF_AREA) : r.pick(DEMO_CITIES);
    return { street: `${r.int(100, 24999)} ${r.pick(STREETS)}`, city: c.city, zip: r.pick(c.zips) };
  };

  const homeDetails = () => {
    const homeBuilt = r.weighted([
      ["1978_or_later", 65],
      ["before_1978", 25],
      ["not_sure", 10],
    ] as const);
    return {
      homeBuilt,
      yearBuilt:
        homeBuilt === "before_1978"
          ? r.int(1948, 1977)
          : homeBuilt === "1978_or_later"
            ? r.int(1979, 2021)
            : null,
      propertyType: r.weighted([
        ["single_family", 82],
        ["townhome", 12],
        ["condo", 6],
      ] as const),
      stories: r.int(1, 3),
      sidingType: r.chance(0.8) ? r.pick(["fiber_cement", "cedar_wood", "vinyl", "mixed"]) : null,
      hasHoa: r.chance(0.18),
    };
  };

  // Jobs first: their timelines decide when their leads came in.
  const jobs: DemoJob[] = [];
  const leads: DemoLead[] = [];
  let i = 0;
  for (const s of JOB_STAGES) {
    for (let n = 0; n < DEMO_STAGE_COUNTS[s.id]; n++, i++) {
      const stage = s.id;
      const workTypes = workTypesFor(r, i);
      const entered = nowMs - daysInStage(r, stage, i) * DAY - r.int(1, 10) * 3_600_000;
      const timeline = buildTimeline(r, stage, entered);
      const first = timeline[0]!.at;
      const leadCreated = first - r.int(1, 6) * DAY - r.int(0, 20) * 3_600_000;
      const leadKey = `L${String(leads.length + 1).padStart(3, "0")}`;
      const who = person(leads.length);
      const home = homeDetails();
      leads.push({
        key: leadKey,
        ...who,
        ...address(false),
        outOfArea: false,
        source: r.weighted(SOURCES),
        services: servicesFor(workTypes),
        timeline: r.pick(["asap", "1_3_months", "1_3_months", "3_plus_months"] as const),
        ...home,
        status: "converted",
        lostReason: null,
        disposition: null,
        ownerIndex: i % ownerCount,
        createdAt: iso(leadCreated),
        jobIndex: i,
      });

      // Crews and production windows are placed after every job exists.
      const crewIndex: number | null = null;
      const production: DemoJob["production"] = null;
      const finalInvoice: DemoFinalInvoice =
        stage === "invoiced"
          ? n % 2 === 0
            ? "overdue"
            : n % 4 === 1
              ? "partial"
              : "sent"
          : stage === "paid_in_full" || stage === "closed_won"
            ? "paid"
            : "none";
      jobs.push({
        index: i,
        leadKey,
        stage,
        workTypes,
        crewIndex,
        timeline: timeline.map((t) => ({ stage: t.stage, at: iso(t.at) })),
        estimate:
          stageAtLeast(stage, "estimate_sent") || stage === "closed_lost"
            ? estimateFor(r, workTypes, stage)
            : null,
        depositPaid: stageAtLeast(stage, "onboarding"),
        finalInvoice,
        paymentMethod: r.pick(["check", "card", "ach", "zelle"] as const),
        holds: [],
        rainDelay: false,
        dailyLogs:
          stage === "in_progress"
            ? r.int(1, 2)
            : stageAtLeast(stage, "final_walkthrough") && !stageAtLeast(stage, "paid_in_full")
              ? r.int(2, 3)
              : 0,
        production,
        lostReason: stage === "closed_lost" ? r.pick(LOST_REASONS) : null,
        priority: false,
      });
    }
  }

  placeProduction(r, jobs, nowMs);

  // Holds: every type at least once, on jobs where it makes sense. Sold jobs
  // wait for their deposit (the deposit hold comes from signing).
  const byStage = (st: JobStageId) => jobs.filter((j) => j.stage === st);
  const assign = (stages: JobStageId[], hold: DemoHoldType, count: number) => {
    const pool = stages.flatMap(byStage).filter((j) => !j.holds.includes(hold));
    for (let k = 0; k < count && k < pool.length; k++)
      pool[(k * 3) % pool.length]!.holds.push(hold);
  };
  for (const j of byStage("sold")) j.holds.push("deposit");
  assign(["onboarding"], "hoa", 2);
  assign(["onboarding", "ready_to_schedule"], "lead_safe", 2);
  assign(["onboarding"], "color", 2);
  assign(["ready_to_schedule"], "repair_approval", 1);
  assign(["ready_to_schedule", "scheduled"], "materials", 1);
  assign(["ready_to_schedule"], "customer", 1);
  assign(["onboarding"], "other", 1);
  assign(["scheduled"], "weather", 1);

  // Weather delays: rain days on jobs already in production (they're
  // rescheduled with priority).
  const rainPool = [...byStage("in_progress"), ...byStage("final_walkthrough")];
  for (const j of rainPool.slice(0, 4)) {
    j.rainDelay = true;
    j.priority = true;
  }

  // The other leads: open, nurture, unqualified, lost and a few out of area.
  const statusMix = [
    ["new", 14],
    ["contacted", 18],
    ["nurture", 20],
    ["unqualified", 8],
    ["lost", 40],
  ] as const;
  const remaining = leadCount - leads.length;
  for (let k = 0; k < remaining; k++) {
    const outOfArea = k % 30 === 9;
    const status: DemoLeadStatus = outOfArea ? "unqualified" : r.weighted(statusMix);
    const ageDays =
      status === "new" ? r.int(0, 3) : status === "contacted" ? r.int(1, 20) : r.int(5, 360);
    const workTypes = workTypesFor(r, k + 3);
    const who = person(leads.length);
    leads.push({
      key: `L${String(leads.length + 1).padStart(3, "0")}`,
      ...who,
      ...address(outOfArea),
      outOfArea,
      source: r.weighted(SOURCES),
      services: servicesFor(workTypes),
      timeline: r.pick(["asap", "1_3_months", "3_plus_months", "just_planning"] as const),
      ...homeDetails(),
      status,
      lostReason: status === "lost" ? r.pick(LOST_REASONS) : null,
      disposition:
        status === "contacted"
          ? r.pick(["call_back", "left_voicemail", "texted_no_reply"])
          : status === "nurture"
            ? "just_planning"
            : outOfArea
              ? "out_of_area"
              : null,
      ownerIndex: k % ownerCount,
      createdAt: iso(nowMs - ageDays * DAY - r.int(0, 23) * 3_600_000),
      jobIndex: null,
    });
  }

  return {
    seed,
    now: iso(nowMs),
    subcontractor: {
      companyName: "Demo Finishing Co. (sample)",
      contactName: "Sample Contact",
      email: "subcontractor@example.org",
    },
    crews: [
      {
        name: "Demo Crew North",
        crewType: "employee",
        color: "#2F6B4F",
        cityIndex: 0,
        members: [
          { displayName: "Demo Lead A", role: "lead" },
          { displayName: "Demo Painter A1", role: "painter" },
          { displayName: "Demo Painter A2", role: "painter" },
        ],
      },
      {
        name: "Demo Crew East",
        crewType: "employee",
        color: "#1D4ED8",
        cityIndex: 3,
        members: [
          { displayName: "Demo Lead B", role: "lead" },
          { displayName: "Demo Painter B1", role: "painter" },
          { displayName: "Demo Helper B2", role: "helper" },
        ],
      },
      {
        name: "Demo Sub Crew",
        crewType: "subcontractor",
        color: "#9A3412",
        cityIndex: 1,
        members: [
          { displayName: "Demo Sub Lead", role: "lead" },
          { displayName: "Demo Sub Painter", role: "painter" },
        ],
      },
    ],
    leads,
    jobs,
  };
}

export function holdReason(hold: DemoHoldType): string {
  return HOLD_REASONS[hold];
}

/** Milestone columns stamped when a job enters a stage (jobs table). */
export const STAGE_MILESTONES: Readonly<Record<JobStageId, readonly string[]>> = {
  walkthrough_scheduled: ["walkthrough_scheduled_at"],
  walkthrough_complete: ["walkthrough_completed_at"],
  estimate_sent: ["estimate_sent_at"],
  sold: ["estimate_accepted_at", "contract_signed_at"],
  onboarding: ["deposit_paid_at", "onboarding_started_at"],
  ready_to_schedule: ["onboarding_completed_at", "ready_to_schedule_at"],
  scheduled: ["scheduled_at"],
  in_progress: [],
  final_walkthrough: ["work_completed_at"],
  completed: ["final_walkthrough_at", "completed_at"],
  invoiced: ["final_invoiced_at"],
  paid_in_full: ["paid_in_full_at"],
  closed_won: ["closed_at"],
  closed_lost: ["lost_at"],
};
