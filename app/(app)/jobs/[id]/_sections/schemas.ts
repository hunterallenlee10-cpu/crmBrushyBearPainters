import { z } from "zod";
import { optionalText, requiredText } from "@/lib/validation/common";
import {
  COMMENT_CATEGORIES,
  NOTE_PRIORITIES,
  TASK_PRIORITIES,
} from "@/app/(app)/leads/[id]/schemas";

/**
 * Inputs for the Job Detail sections (Customer, Messages, Tasks, Notes,
 * Activity). The same rules as the Lead Detail inputs, keyed by job_id.
 * Team changes use teamMemberSchema from lib/validation/jobs.
 */

const id = z.uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
  .or(z.literal(""))
  .optional()
  .transform((v) => (v ? v : null));
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time.")
  .or(z.literal(""))
  .optional()
  .transform((v) => (v ? v : null));

// --- Messages --------------------------------------------------------------------

export const jobSmsSchema = z.object({
  job_id: id,
  body: z
    .string()
    .trim()
    .min(1, "Write a message first.")
    .max(1600, "Keep texts under 1,600 characters."),
});
export type JobSmsInput = z.input<typeof jobSmsSchema>;

export const jobEmailSchema = z.object({
  job_id: id,
  subject: requiredText("Subject", 300),
  body: z.string().trim().min(1, "Write a message first.").max(20000),
});
export type JobEmailInput = z.input<typeof jobEmailSchema>;

export const jobCallSchema = z.object({
  job_id: id,
  outcome: requiredText("Outcome", 60),
  duration_minutes: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 600) {
        ctx.addIssue({ code: "custom", message: "Enter minutes between 0 and 600." });
        return z.NEVER;
      }
      return Math.round(n * 60);
    }),
  notes: optionalText(5000),
});
export type JobCallInput = z.input<typeof jobCallSchema>;

// --- Notes and comments --------------------------------------------------------------

export const jobNoteSchema = z.object({
  job_id: id,
  body: requiredText("Note", 10000),
  priority: z.enum(NOTE_PRIORITIES).default("normal"),
  pinned: z.boolean().default(false),
});
export type JobNoteInput = z.input<typeof jobNoteSchema>;

export const jobNoteUpdateSchema = jobNoteSchema.extend({ id });
export type JobNoteUpdateInput = z.input<typeof jobNoteUpdateSchema>;

export const jobNotePinSchema = z.object({ id, job_id: id, pinned: z.boolean() });

export const jobRecordRefSchema = z.object({ id, job_id: id });

export const jobCommentSchema = z.object({
  job_id: id,
  body: requiredText("Comment", 5000),
  category: z.enum(COMMENT_CATEGORIES).default("general"),
  mentions: z.array(id).max(20, "Mention up to 20 people.").default([]),
});
export type JobCommentInput = z.input<typeof jobCommentSchema>;

export const jobCommentUpdateSchema = jobCommentSchema.extend({ id });
export type JobCommentUpdateInput = z.input<typeof jobCommentUpdateSchema>;

// --- Tasks -----------------------------------------------------------------------------

export const jobTaskSchema = z
  .object({
    job_id: id,
    title: requiredText("Title", 200),
    due_date: isoDate,
    due_time: clockTime,
    assignee_id: z.uuid({ message: "Pick who it's for." }),
    priority: z.enum(TASK_PRIORITIES).default("normal"),
  })
  .refine((v) => !v.due_time || v.due_date, {
    message: "Pick a date for this time.",
    path: ["due_date"],
  });
export type JobTaskInput = z.input<typeof jobTaskSchema>;

export const jobTaskStatusSchema = z.object({ id, job_id: id, done: z.boolean() });
