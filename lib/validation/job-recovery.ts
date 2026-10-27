import { z } from "zod";
import { JOB_STAGES } from "@/lib/domain/stages";
import { MILESTONE_FIELDS } from "@/lib/domain/jobs/constants";
import { RECOVERY_REASON_MIN } from "@/lib/domain/jobs/recovery";

/** Admin → Job Recovery inputs (owners). */
const reason = z
  .string()
  .trim()
  .min(RECOVERY_REASON_MIN, `Say why (at least ${RECOVERY_REASON_MIN} characters).`)
  .max(500);

export const recoverStageSchema = z.object({
  job_id: z.uuid(),
  to: z.enum(JOB_STAGES.map((s) => s.id) as [string, ...string[]]),
  reason,
  lost_reason: z.string().max(80).optional(),
});

export const recoverMilestoneSchema = z.object({
  job_id: z.uuid(),
  field: z.enum(MILESTONE_FIELDS.map(([f]) => f) as [string, ...string[]]),
  value: z
    .union([z.iso.datetime({ offset: true }), z.literal("")])
    .nullable()
    .transform((v) => (v ? v : null)),
  reason,
});
