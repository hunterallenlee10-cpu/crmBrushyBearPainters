import {
  REFERRAL_SOURCES,
  type Grade,
  type Service,
  type Temperature,
  type Timeline,
} from "@/lib/domain/leads/constants";

/**
 * Deterministic, explainable lead score (SPEC §6.6; never an LLM).
 * Starts at 50, adds the points of every factor that applies, clamps to 0–100.
 * Weights come from `lead_scoring_rules` (Admin → Lead Scoring).
 */

export const BASE_SCORE = 50;

export const SCORING_FACTORS = [
  "in_service_area",
  "out_of_area",
  "has_mobile",
  "has_email",
  "full_address",
  "timeline_asap",
  "timeline_1_3_months",
  "timeline_just_planning",
  "exterior_or_multiple",
  "cabinets",
  "uploaded_photos",
  "referral_or_past_customer",
  "responded_to_text",
  "no_response_3_attempts",
] as const;
export type ScoringFactor = (typeof SCORING_FACTORS)[number];

export type ScoringRule = { factor: string; label: string; points: number; active: boolean };

export type LeadScoreInput = {
  /** null when there is no ZIP yet (neither bonus nor penalty). */
  inServiceArea: boolean | null;
  hasMobile: boolean;
  hasEmail: boolean;
  hasFullAddress: boolean;
  timeline: Timeline | null;
  services: readonly Service[];
  photoCount: number;
  leadSource: string | null;
  respondedToText: boolean;
  /** Outbound attempts (calls, texts, emails) without any reply. */
  unansweredAttempts: number;
};

export type ScoreFactorResult = { factor: string; label: string; points: number };

export type LeadScore = {
  score: number;
  grade: Grade;
  temperature: Temperature;
  factors: ScoreFactorResult[];
};

/** Which factors apply to a lead (independent of their weights). */
export function applicableFactors(input: LeadScoreInput): Set<ScoringFactor> {
  const f = new Set<ScoringFactor>();
  if (input.inServiceArea === true) f.add("in_service_area");
  if (input.inServiceArea === false) f.add("out_of_area");
  if (input.hasMobile) f.add("has_mobile");
  if (input.hasEmail) f.add("has_email");
  if (input.hasFullAddress) f.add("full_address");
  if (input.timeline === "asap") f.add("timeline_asap");
  if (input.timeline === "1_3_months") f.add("timeline_1_3_months");
  if (input.timeline === "just_planning") f.add("timeline_just_planning");
  const real = input.services.filter((s) => s !== "other");
  if (input.services.includes("exterior") || real.length > 1) f.add("exterior_or_multiple");
  if (input.services.includes("cabinets")) f.add("cabinets");
  if (input.photoCount > 0) f.add("uploaded_photos");
  if (input.leadSource && REFERRAL_SOURCES.includes(input.leadSource)) {
    f.add("referral_or_past_customer");
  }
  if (input.respondedToText) f.add("responded_to_text");
  if (!input.respondedToText && input.unansweredAttempts >= 3) f.add("no_response_3_attempts");
  return f;
}

export function gradeFor(score: number): Grade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function temperatureFor(grade: Grade): Temperature {
  if (grade === "A") return "hot";
  if (grade === "B" || grade === "C") return "warm";
  return "cold";
}

export function scoreLead(input: LeadScoreInput, rules: readonly ScoringRule[]): LeadScore {
  const applies = applicableFactors(input);
  const factors: ScoreFactorResult[] = rules
    .filter((r) => r.active && applies.has(r.factor as ScoringFactor) && r.points !== 0)
    .map((r) => ({ factor: r.factor, label: r.label, points: r.points }));
  const raw = BASE_SCORE + factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const grade = gradeFor(score);
  return { score, grade, temperature: temperatureFor(grade), factors };
}

/** "70/100 · Warm Lead" (SPEC §6.6 display). */
export function scoreSummary(score: number, temperature: Temperature): string {
  const t = temperature === "hot" ? "Hot" : temperature === "warm" ? "Warm" : "Cold";
  return `${score}/100 · ${t} Lead`;
}
