import { z } from "zod";
import { AUDIENCE_MODULES } from "@/lib/domain/campaigns";
import { DRIP_EXIT_CONDITIONS, validateDripSteps } from "@/lib/domain/drips";
import { ruleSchema } from "@/lib/lists/filters";
import { optionalText, requiredText } from "./common";

/** Campaigns and drips (SPEC §8.11). Refinements live here, out of "use server" files. */

const uuid = z.uuid();

export const audienceSchema = z.object({
  module: z.enum(AUDIENCE_MODULES),
  match: z.enum(["all", "any"]).default("all"),
  rules: z.array(ruleSchema).max(20).default([]),
});

export const saveCampaignSchema = z
  .object({
    id: uuid.optional(),
    name: requiredText("Name", 120),
    channel: z.enum(["sms", "email"]),
    audience: audienceSchema,
    templateId: uuid.nullable().optional(),
    subject: z.string().trim().max(200).optional(),
    body: z.string().max(5000),
  })
  .refine((v) => v.channel !== "email" || (v.subject ?? "").trim().length > 0, {
    message: "Emails need a subject.",
    path: ["subject"],
  });
export type SaveCampaignInput = z.input<typeof saveCampaignSchema>;

export const previewAudienceSchema = z.object({
  channel: z.enum(["sms", "email"]),
  audience: audienceSchema,
  subject: z.string().max(200).optional(),
  body: z.string().max(5000),
  templateId: uuid.nullable().optional(),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

/** "now", or a Pacific "YYYY-MM-DDTHH:mm" from a datetime-local input. */
export const scheduleCampaignSchema = z.object({
  id: uuid,
  when: z.union([
    z.literal("now"),
    z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, "Pick a date and time."),
  ]),
});

export const campaignStatusSchema = z.object({
  id: uuid,
  status: z.enum(["draft", "paused", "canceled", "scheduled"]),
  reason: optionalText(500),
});

export const campaignIdSchema = z.object({ id: uuid });

const dripStep = z.object({
  delay_days: z.number().int().min(0).max(365).optional(),
  on_date: z.string().optional(),
  channel: z.enum(["sms", "email", "sms_or_email", "email_or_sms"]),
  template_key: z.string(),
});

export const saveDripSchema = z
  .object({
    id: uuid,
    name: requiredText("Name", 120),
    description: optionalText(1000),
    active: z.boolean(),
    steps: z.array(dripStep).max(20),
    exitConditions: z
      .array(z.enum(Object.keys(DRIP_EXIT_CONDITIONS) as [keyof typeof DRIP_EXIT_CONDITIONS]))
      .max(6),
  })
  .superRefine((v, ctx) => {
    for (const message of validateDripSteps(v.steps).errors) {
      ctx.addIssue({ code: "custom", message, path: ["steps"] });
    }
  });

export const cancelEnrollmentSchema = z.object({ id: uuid });
