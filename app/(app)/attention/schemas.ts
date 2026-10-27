import { z } from "zod";

/** Attention Center inputs (shared by the dialogs and the Server Actions). */

const id = z.uuid({ message: "That item isn't available." });

export const attentionRefSchema = z.object({ id });

export const assignAttentionSchema = z.object({
  id,
  ownerId: z.uuid({ message: "Pick someone from the list." }).nullable(),
});

export const snoozeAttentionSchema = z.object({
  id,
  until: z.iso
    .datetime({ offset: true, message: "Pick a date and time." })
    .refine((v) => new Date(v).getTime() > Date.now(), "Pick a time in the future."),
});

export const RESOLVE_NOTE_MIN = 3;
export const RESOLVE_NOTE_MAX = 1000;

export const resolveAttentionSchema = z.object({
  id,
  note: z
    .string()
    .trim()
    .min(RESOLVE_NOTE_MIN, "Add a short note saying how it was resolved.")
    .max(RESOLVE_NOTE_MAX, "Keep the note under 1,000 characters."),
});

export type AssignAttentionInput = z.infer<typeof assignAttentionSchema>;
export type SnoozeAttentionInput = z.infer<typeof snoozeAttentionSchema>;
export type ResolveAttentionInput = z.infer<typeof resolveAttentionSchema>;
export type AttentionRefInput = z.infer<typeof attentionRefSchema>;
