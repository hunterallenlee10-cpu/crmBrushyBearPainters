import { z } from "zod";

/** Admin → Schedule Admin forms (SPEC §8.19, §15.1). */

export const policiesSchema = z
  .object({
    productionDays: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Pick at least one production day."),
    dayStart: z.string().regex(/^\d{2}:\d{2}$/, "Use a time like 08:00."),
    arrivalWindowMinutes: z.coerce.number().int().min(0).max(240),
    crewDayHours: z.coerce.number().min(1).max(16),
    requireApproval: z.boolean(),
    autoExecute: z.boolean(),
    undoWindowMinutes: z.coerce.number().int().min(1).max(240),
  })
  .refine((v) => !(v.autoExecute && v.requireApproval), {
    message: "Turn off “Require approval” before letting recommendations run on their own.",
    path: ["autoExecute"],
  });

export const workTypeSchema = z.object({
  key: z.string().min(1),
  label: z.string().trim().min(1, "Name it.").max(80),
  defaultMinutes: z.coerce.number().int().min(15, "At least 15 minutes.").max(1440),
  assignedRole: z.enum(["estimator", "crew", "pm"]),
  requiredSkillKey: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .nullable(),
  active: z.boolean(),
});

export const workRuleSchema = z.object({
  key: z.string().min(1),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean(),
  severity: z.enum(["block", "warn"]),
  ownerOverride: z.boolean(),
  params: z.record(z.string(), z.union([z.number(), z.string().max(60)])),
});

export const skillSchema = z.object({
  id: z.uuid().optional(),
  label: z.string().trim().min(1, "Name the skill.").max(80),
  description: z.string().trim().max(300).optional(),
  isCertification: z.boolean(),
  active: z.boolean(),
});

/** "Spray finish / cabinets" → "spray_finish_cabinets". */
export function skillKey(label: string): string {
  const k = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return /^[a-z0-9]/.test(k) ? k : `skill_${k}`.slice(0, 60);
}
