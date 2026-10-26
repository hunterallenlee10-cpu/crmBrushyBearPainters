import { z } from "zod";
import { optionalText, requiredText } from "@/lib/validation/common";

/**
 * Lead Detail inputs: messages, notes, comments, tasks and delete. (Lead edits,
 * status and booking use lib/validation/leads.ts.) Kept next to the page until
 * Jobs and Accounts need the same records; then move to lib/validation.
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

export const sendSmsSchema = z.object({
  lead_id: id,
  body: z
    .string()
    .trim()
    .min(1, "Write a message first.")
    .max(1600, "Keep texts under 1,600 characters."),
});
export type SendSmsInput = z.input<typeof sendSmsSchema>;

export const sendEmailSchema = z.object({
  lead_id: id,
  subject: requiredText("Subject", 300),
  body: z.string().trim().min(1, "Write a message first.").max(20000),
});
export type SendEmailInput = z.input<typeof sendEmailSchema>;

export const logCallSchema = z.object({
  lead_id: id,
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
export type LogCallInput = z.input<typeof logCallSchema>;

export const NOTE_PRIORITIES = ["normal", "high", "urgent"] as const;
export type NotePriority = (typeof NOTE_PRIORITIES)[number];

export const noteSchema = z.object({
  lead_id: id,
  body: requiredText("Note", 10000),
  priority: z.enum(NOTE_PRIORITIES).default("normal"),
  pinned: z.boolean().default(false),
});
export type NoteInput = z.input<typeof noteSchema>;

export const noteUpdateSchema = noteSchema.extend({ id });
export type NoteUpdateInput = z.input<typeof noteUpdateSchema>;

export const recordRefSchema = z.object({ id, lead_id: id });

export const COMMENT_CATEGORIES = ["general", "sales", "production", "office", "finance"] as const;
export type CommentCategory = (typeof COMMENT_CATEGORIES)[number];

export const commentSchema = z.object({
  lead_id: id,
  body: requiredText("Comment", 5000),
  category: z.enum(COMMENT_CATEGORIES).default("general"),
  mentions: z.array(id).max(20, "Mention up to 20 people.").default([]),
});
export type CommentInput = z.input<typeof commentSchema>;

export const commentUpdateSchema = commentSchema.extend({ id });
export type CommentUpdateInput = z.input<typeof commentUpdateSchema>;

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const taskSchema = z
  .object({
    lead_id: id,
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
export type TaskInput = z.input<typeof taskSchema>;

export const taskStatusSchema = z.object({ id, lead_id: id, done: z.boolean() });

export const deleteLeadSchema = z.object({
  id,
  reason: z
    .string()
    .trim()
    .min(3, "Say why in a few words (at least 3 characters).")
    .max(500, "Keep it under 500 characters."),
});
export type DeleteLeadInput = z.input<typeof deleteLeadSchema>;
