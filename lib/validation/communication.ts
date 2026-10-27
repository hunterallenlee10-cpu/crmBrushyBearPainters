import { z } from "zod";
import { TEMPLATE_CATEGORIES } from "@/lib/domain/templates/defaults";
import { validateTemplate } from "@/lib/domain/templates/merge";
import { optionalText, requiredText } from "./common";

/**
 * Phase 8 schemas shared by Server Actions (Workflows, Templates, Messaging
 * settings, Inbox). Kept out of "use server" files (refinements are
 * functions; DECISIONS 2026-10-27).
 */

const key = z.string().regex(/^[a-z0-9][a-z0-9_]{0,59}$/, "Use lowercase letters, numbers and _.");
const uuid = z.uuid();

export const toggleWorkflowSchema = z
  .object({
    key,
    enabled: z.boolean(),
    reason: optionalText(500),
  })
  .refine((v) => v.enabled || (v.reason?.length ?? 0) >= 5, {
    message: "Say why you're turning it off (at least 5 characters).",
    path: ["reason"],
  });

export const testWorkflowSchema = z.object({
  key,
  subjectId: uuid,
  /** Pretend it's this time (ISO, from a Pacific date-time input). */
  at: z.iso.datetime({ offset: true }).optional(),
});

export const retryRunSchema = z.object({ runId: uuid });

const templateText = (label: string, max: number) =>
  z
    .string()
    .max(max, `Keep the ${label} under ${max} characters.`)
    .refine((v) => validateTemplate(v).length === 0, {
      message: `The ${label} has a merge field or filter that doesn't exist. Check the list under “Insert field”.`,
    });

export const saveTemplateSchema = z
  .object({
    id: uuid.optional(),
    key: key.optional(),
    channel: z.enum(["sms", "email"]),
    name: requiredText("Name", 120),
    description: optionalText(500),
    category: z.enum(TEMPLATE_CATEGORIES),
    messageType: z.enum(["transactional", "marketing"]),
    subject: z.string().trim().max(200).optional(),
    body: templateText("message", 5000).refine((v) => v.trim().length > 0, "Write the message."),
    active: z.boolean(),
  })
  .refine((v) => v.channel !== "email" || (v.subject ?? "").trim().length > 0, {
    message: "Emails need a subject.",
    path: ["subject"],
  })
  .refine((v) => !v.subject || validateTemplate(v.subject).length === 0, {
    message: "The subject has a merge field or filter that doesn't exist.",
    path: ["subject"],
  })
  .refine((v) => v.id || v.key, { message: "Give the new template a key.", path: ["key"] });

export const templateIdSchema = z.object({ id: uuid });

export const previewTemplateSchema = z.object({
  body: z.string().max(5000),
  subject: z.string().max(200).optional(),
  channel: z.enum(["sms", "email"]),
  messageType: z.enum(["transactional", "marketing"]),
  /** A real job or lead to fill the fields from; else the sample values. */
  jobId: uuid.optional(),
  leadId: uuid.optional(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).");

export const messagingSettingsSchema = z
  .object({
    quietHoursEnabled: z.boolean(),
    quietHoursStart: hhmm,
    quietHoursEnd: hhmm,
    customerThreadHours: z.coerce.number().int().min(0).max(168),
    smsOptOutText: z
      .string()
      .trim()
      .min(5)
      .max(120)
      .refine((v) => /stop/i.test(v), "Keep the word STOP in it."),
    emailFooter: z.string().trim().min(5).max(500),
    reviewDelayDays: z.coerce.number().int().min(0).max(60),
    referralInviteDelayDays: z.coerce.number().int().min(0).max(120),
    caseSlaBusinessDays: z.coerce.number().int().min(1).max(30),
  })
  .refine((v) => v.quietHoursStart !== v.quietHoursEnd, {
    message: "Start and end can't be the same.",
    path: ["quietHoursEnd"],
  });

// --- Inbox -------------------------------------------------------------------------

export const markThreadSchema = z.object({ threadId: uuid, read: z.boolean() });

export const replyThreadSchema = z.object({
  threadId: uuid,
  channel: z.enum(["sms", "email"]),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1, "Write a message.").max(5000),
  templateKey: key.optional(),
});

export const renderForSchema = z.object({
  subjectType: z.enum(["job", "lead"]),
  subjectId: uuid,
  key,
  channel: z.enum(["sms", "email"]),
});
