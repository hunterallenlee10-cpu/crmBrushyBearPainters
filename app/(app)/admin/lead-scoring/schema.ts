import { z } from "zod";
import { SCORING_FACTORS } from "@/lib/domain/leads/scoring";

/** Admin → Lead Scoring input (shared by the form and the Server Action). */

export const POINTS_MIN = -100;
export const POINTS_MAX = 100;

export const scoringPointsSchema = z
  .number({ error: "Enter a whole number." })
  .int("Use a whole number.")
  .min(POINTS_MIN, `Use ${POINTS_MIN} to ${POINTS_MAX}.`)
  .max(POINTS_MAX, `Use ${POINTS_MIN} to ${POINTS_MAX}.`);

export const scoringRuleInputSchema = z.object({
  id: z.uuid(),
  factor: z.enum(SCORING_FACTORS),
  points: scoringPointsSchema,
  active: z.boolean(),
});

export const saveScoringRulesSchema = z.object({
  rules: z
    .array(scoringRuleInputSchema)
    .min(1)
    .max(SCORING_FACTORS.length)
    .refine((rules) => new Set(rules.map((r) => r.id)).size === rules.length, {
      message: "Each rule can only appear once.",
    }),
});
export type SaveScoringRulesInput = z.infer<typeof saveScoringRulesSchema>;

export const recalculateSchema = z.object({});

/** Most open leads one "Recalculate" run rescores. */
export const RECALCULATE_LIMIT = 2000;
