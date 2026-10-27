import { z } from "zod";

/** Commissions (Admin → Commissions; commissions:manage). Percentages 0–100. */
const percent = z.coerce.number().min(0, "0% or more.").max(100, "100% at most.");
const dollarsToCents = z.union([z.string(), z.number(), z.null()]).transform((v, ctx) => {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: "custom", message: "Enter a dollar amount." });
    return z.NEVER;
  }
  return Math.round(n * 100);
});

export const commissionSettingsSchema = z.object({
  enabled: z.boolean(),
  basis: z.enum(["contract", "collected"]),
  overhead_deduction_percent: percent,
  review_threshold: dollarsToCents,
  self_generated_sources: z.array(z.string().max(80)).max(50).default([]),
  require_cleared_funds: z.boolean(),
  notes: z.string().trim().max(1000).optional(),
});

export const commissionPlanSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "Name the plan.").max(80),
    role_template_id: z
      .union([z.uuid(), z.literal("")])
      .nullish()
      .transform((v) => v || null),
    user_id: z
      .union([z.uuid(), z.literal("")])
      .nullish()
      .transform((v) => v || null),
    company_rate_percent: percent,
    self_rate_percent: percent,
    overhead_deduction_percent: z
      .union([z.literal(""), z.null(), percent])
      .transform((v) => (v === "" || v === null ? null : v)),
    active: z.boolean().default(true),
  })
  .refine((v) => v.role_template_id || v.user_id, {
    path: ["role_template_id"],
    message: "Pick a role or a person.",
  });

export const commissionEntryActionSchema = z.object({
  id: z.uuid(),
  action: z.enum(["approve", "void", "pay", "reopen"]),
  paid_on: z.iso.date().optional(),
  payroll_ref: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
});

export const commissionAdjustmentSchema = z.object({
  user_id: z.uuid(),
  job_id: z
    .union([z.uuid(), z.literal("")])
    .nullish()
    .transform((v) => v || null),
  kind: z.enum(["bonus", "clawback", "correction", "other"]),
  amount: z.union([z.string(), z.number()]).transform((v, ctx) => {
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n === 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount (negative takes money off)." });
      return z.NEVER;
    }
    return Math.round(n * 100);
  }),
  reason: z.string().trim().min(10, "Say why (at least 10 characters).").max(500),
});

export const commissionAdjustmentActionSchema = z.object({
  id: z.uuid(),
  action: z.enum(["approve", "void", "pay"]),
  paid_on: z.iso.date().optional(),
});
