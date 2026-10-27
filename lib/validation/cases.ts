import { z } from "zod";
import { CASE_PRIORITIES, CASE_SOURCES, CASE_STATUSES, CASE_TYPES } from "@/lib/domain/cases";
import { optionalText, requiredText } from "./common";

/**
 * Warranty & service cases (SPEC §5.7, §8.16). Shared by the Server Actions;
 * refinements live here, out of "use server" files (DECISIONS 2026-10-27).
 */

const uuid = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const pacificTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time.");

export const createCaseSchema = z
  .object({
    jobId: uuid.optional(),
    accountId: uuid.optional(),
    contactId: uuid.optional(),
    type: z.enum(CASE_TYPES),
    priority: z.enum(CASE_PRIORITIES).default("normal"),
    source: z.enum(CASE_SOURCES).default("phone"),
    title: requiredText("What's the issue", 200).refine((v) => v.length >= 3, {
      message: "Say what the issue is in a few words.",
    }),
    description: optionalText(5000),
    ownerId: uuid.optional(),
    /** Send the "We got your request" message right away. */
    acknowledge: z.enum(["none", "sms", "email"]).default("none"),
  })
  .refine((v) => v.jobId || v.accountId, {
    message: "Pick the job or customer this case is about.",
    path: ["jobId"],
  });
export type CreateCaseInput = z.input<typeof createCaseSchema>;

export const updateCaseSchema = z
  .object({
    id: uuid,
    status: z.enum(CASE_STATUSES).optional(),
    priority: z.enum(CASE_PRIORITIES).optional(),
    type: z.enum(CASE_TYPES).optional(),
    ownerId: uuid.nullable().optional(),
    jobId: uuid.optional(),
    resolution: optionalText(5000),
  })
  .refine(
    // Closing an already-resolved case keeps its resolution (the database checks).
    (v) => v.status !== "resolved" || (v.resolution?.length ?? 0) >= 3,
    { message: "Write what was done before resolving the case.", path: ["resolution"] },
  );
export type UpdateCaseInput = z.input<typeof updateCaseSchema>;

export const caseVisitSchema = z.object({
  caseId: uuid,
  date: isoDate,
  time: pacificTime,
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
  assignedUserIds: z.array(uuid).max(20).default([]),
  notes: optionalText(2000),
  /** Send the "Warranty visit booked" confirmation. */
  confirm: z.enum(["none", "sms", "email"]).default("none"),
});
export type CaseVisitInput = z.input<typeof caseVisitSchema>;

export const caseMessageSchema = z.object({
  caseId: uuid,
  key: z.enum(["case_received", "case_visit_booked"]),
  channel: z.enum(["sms", "email"]),
});
