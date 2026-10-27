import { z } from "zod";
import { optionalText, requiredText } from "./common";

/** Bear Champions and review requests (SPEC §5.8, §8.16). */

const uuid = z.uuid();

export const addChampionSchema = z.object({ contactId: uuid, notes: optionalText(2000) });

export const championStatusSchema = z.object({
  id: uuid,
  status: z.enum(["active", "paused", "retired"]),
});

export const manualReferralSchema = z
  .object({
    championId: uuid,
    leadId: uuid.optional(),
    jobId: uuid.optional(),
    referredName: optionalText(200),
    notes: optionalText(2000),
  })
  .refine((v) => v.leadId || v.jobId, {
    message: "Pick the lead or job they referred.",
    path: ["leadId"],
  });

export const PAYOUT_METHODS = ["check", "cash", "gift_card", "credit", "zelle", "other"] as const;
export const PAYOUT_METHOD_LABELS: Record<(typeof PAYOUT_METHODS)[number], string> = {
  check: "Check",
  cash: "Cash",
  gift_card: "Gift card",
  credit: "Credit on a future job",
  zelle: "Zelle",
  other: "Other",
};

export const payoutSchema = z.object({
  referralId: uuid,
  method: z.enum(PAYOUT_METHODS),
  reference: optionalText(200),
});

export const ineligibleSchema = z.object({
  referralId: uuid,
  reason: requiredText("Reason", 500),
});

export const referralSettingsSchema = z.object({
  payableWhen: z.enum(["paid_in_full", "sold"]),
  codePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,8}$/, "Use 2–8 letters, like BEAR."),
  programNote: optionalText(2000),
  terms: optionalText(5000),
});

export const reviewLeftSchema = z.object({
  id: uuid,
  reviewLeft: z.boolean(),
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  platform: z.enum(["google", "facebook", "yelp", "nextdoor", "other"]).optional(),
  notes: optionalText(2000),
});
