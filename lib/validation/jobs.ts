import { z } from "zod";
import { JOB_STAGES } from "@/lib/domain/stages";
import { OVERRIDE_REASON_MIN } from "@/lib/domain/jobs/gates";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  JOB_PRIORITIES,
  MILESTONE_FIELDS,
  ON_TIME_STATUSES,
  TEAM_ROLES,
  WALKTHROUGH_RESULTS,
} from "@/lib/domain/jobs/constants";

/** Zod schemas shared by job Server Actions and forms (SPEC §8.5). */

const stageIds = JOB_STAGES.map((s) => s.id) as [string, ...string[]];
const key = z.string().regex(/^[a-z0-9_]{1,60}$/, "Pick one of the choices.");
const optionalUuid = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const optionalText = (max: number) =>
  z
    .string()
    .max(max, `Keep it under ${max} characters.`)
    .optional()
    .nullable()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : null;
    });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const optionalDate = z
  .union([isoDate, z.literal("")])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const pacificTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time.");

export const jobStageSchema = z.enum(stageIds);

/** New Job (from an account) — starts at Walkthrough Scheduled. */
export const jobCreateSchema = z.object({
  account_id: z.uuid({ message: "Pick a customer." }),
  property_id: optionalUuid,
  primary_contact_id: optionalUuid,
  name: z.string().trim().min(1, "Give the job a name.").max(200),
  work_types: z.array(key).min(1, "Pick at least one work type.").max(6),
  owner_id: optionalUuid,
  point_of_contact_id: optionalUuid,
  lead_source: key.optional().nullable(),
  priority: z.enum(JOB_PRIORITIES).default("normal"),
  target_season: z.coerce.number().int().min(2000).max(2100).optional().nullable(),
  notes: optionalText(2000),
});
export type JobCreateInput = z.input<typeof jobCreateSchema>;

/** Job Details card edit (not stage, money or milestones). */
export const jobUpdateSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1, "Give the job a name.").max(200),
    work_types: z.array(key).min(1, "Pick at least one work type.").max(6),
    property_id: optionalUuid,
    primary_contact_id: optionalUuid,
    owner_id: optionalUuid,
    point_of_contact_id: optionalUuid,
    project_manager_id: optionalUuid,
    priority: z.enum(JOB_PRIORITIES),
    priority_reason: optionalText(500),
    target_season: z.coerce.number().int().min(2000).max(2100).optional().nullable(),
    promised_start_date: optionalDate,
    estimated_duration_days: z.coerce.number().int().min(1).max(365).optional().nullable(),
    estimated_completion_date: optionalDate,
    tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  })
  .refine((v) => v.priority === "normal" || !!v.priority_reason, {
    message: "Say why it's high priority.",
    path: ["priority_reason"],
  });
export type JobUpdateInput = z.input<typeof jobUpdateSchema>;

/** Advance stage (owner override needs a reason; Closed Lost needs a lost reason). */
export const advanceStageSchema = z
  .object({
    id: z.uuid(),
    to_stage: jobStageSchema,
    override: z.boolean().default(false),
    reason: optionalText(1000),
    lost_reason: key.optional().nullable(),
  })
  .refine((v) => !v.override || (v.reason?.length ?? 0) >= OVERRIDE_REASON_MIN, {
    message: `Say why you're overriding (at least ${OVERRIDE_REASON_MIN} characters).`,
    path: ["reason"],
  })
  .refine((v) => v.to_stage !== "closed_lost" || !!v.lost_reason, {
    message: "Pick a lost reason.",
    path: ["lost_reason"],
  });
export type AdvanceStageInput = z.input<typeof advanceStageSchema>;

/** Non-owners ask an owner to override a gate (lands in Approvals). */
export const requestOverrideSchema = z.object({
  id: z.uuid(),
  to_stage: jobStageSchema,
  reason: z
    .string()
    .trim()
    .min(OVERRIDE_REASON_MIN, `Say why (at least ${OVERRIDE_REASON_MIN} characters).`)
    .max(1000),
});
export type RequestOverrideInput = z.input<typeof requestOverrideSchema>;

export const decideApprovalSchema = z
  .object({
    id: z.uuid(),
    decision: z.enum(["approved", "rejected"]),
    note: optionalText(1000),
  })
  .refine((v) => v.decision === "approved" || !!v.note, {
    message: "Say why you're rejecting it.",
    path: ["note"],
  });
export type DecideApprovalInput = z.input<typeof decideApprovalSchema>;

export const cancelApprovalSchema = z.object({ id: z.uuid() });

export const placeHoldSchema = z.object({
  job_id: z.uuid(),
  hold_type: key,
  reason: z.string().trim().min(3, "Say what the hold is waiting on.").max(1000),
  blocks_scheduling: z.boolean().default(true),
});
export type PlaceHoldInput = z.input<typeof placeHoldSchema>;

export const releaseHoldSchema = z.object({
  id: z.uuid(),
  note: optionalText(1000),
});
export type ReleaseHoldInput = z.input<typeof releaseHoldSchema>;

export const teamMemberSchema = z.object({
  job_id: z.uuid(),
  user_id: z.uuid({ message: "Pick a teammate." }),
  role: z.enum(TEAM_ROLES),
});
export type TeamMemberInput = z.input<typeof teamMemberSchema>;

/** Admin: milestone dates (ISO timestamps or empty to clear). */
export const milestonesSchema = z.object({
  id: z.uuid(),
  field: z.enum(MILESTONE_FIELDS.map(([f]) => f) as [string, ...string[]]),
  value: z
    .union([z.iso.datetime({ offset: true }), z.literal("")])
    .nullable()
    .transform((v) => (v ? v : null)),
});
export type MilestoneInput = z.input<typeof milestonesSchema>;

/** Admin: contract baseline until estimates exist (Phase 4). Dollars in, cents stored. */
export const contractBaselineSchema = z.object({
  id: z.uuid(),
  amount_cents: z.coerce.number().int().min(0, "Enter $0 or more.").max(100_000_000_000).nullable(),
});
export type ContractBaselineInput = z.input<typeof contractBaselineSchema>;

export const onTimeStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(ON_TIME_STATUSES),
});

/** Book an appointment on a job (Pacific date/time → UTC). */
export const bookAppointmentSchema = z.object({
  job_id: z.uuid(),
  type: z.enum(APPOINTMENT_TYPES),
  date: isoDate,
  time: pacificTime,
  duration_minutes: z.coerce.number().int().min(15).max(720),
  assigned_user_ids: z.array(z.uuid()).max(20).default([]),
  notes: optionalText(2000),
});
export type BookAppointmentInput = z.input<typeof bookAppointmentSchema>;

export const appointmentStatusSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(APPOINTMENT_STATUSES),
    result: z.enum(WALKTHROUGH_RESULTS).optional().nullable(),
    note: optionalText(500),
  })
  .refine((v) => v.status !== "completed" || v.result !== undefined, {
    message: "Pick the walkthrough result.",
    path: ["result"],
  });
export type AppointmentStatusInput = z.input<typeof appointmentStatusSchema>;

export const deleteJobSchema = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(3, "Say why (at least 3 characters).").max(500),
});
