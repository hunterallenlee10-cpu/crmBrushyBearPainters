import { z } from "zod";
import { DISPOSITION_GROUPS } from "@/lib/domain/follow-ups";
import { optionalText, requiredText } from "./common";

/**
 * Follow-up lists and the power dialer (SPEC §11.4, §8.19). Shared by the
 * Server Actions; refinements live here, out of "use server" files.
 */

const key = z.string().regex(/^[a-z0-9][a-z0-9_]{0,59}$/, "Use lowercase letters, numbers and _.");
const uuid = z.uuid();
/** "YYYY-MM-DDTHH:mm" in Pacific time, from a datetime-local input. */
const pacificDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, "Pick a date and time.");

const subject = {
  subjectType: z.enum(["lead", "job", "account"]),
  subjectId: uuid,
  /** Where the call is logged (an account's latest job). */
  messageSubject: z
    .object({ type: z.enum(["lead", "job"]), id: uuid })
    .nullable()
    .optional(),
};

export const dispositionSchema = z.object({
  listKey: key,
  ...subject,
  dispositionKey: key,
  channel: z.enum(["call", "sms", "email", "none"]).default("call"),
  notes: optionalText(2000),
  callbackAt: z.union([pacificDateTime, z.literal("")]).optional(),
});
export type DispositionInput = z.input<typeof dispositionSchema>;

export const placeCallSchema = z.object({ ...subject, listKey: key });

export const updateListSchema = z.object({
  key,
  name: requiredText("Name", 120),
  description: optionalText(500),
  script: optionalText(5000),
  cooldownHours: z.coerce.number().int().min(0).max(8760),
  active: z.boolean(),
});

export const saveDispositionSchema = z
  .object({
    id: uuid.optional(),
    key: key.optional(),
    label: requiredText("Label", 80),
    group: z.enum(DISPOSITION_GROUPS),
    leadDisposition: z.union([key, z.literal("")]).optional(),
    requiresCallback: z.boolean(),
    setsDoNotContact: z.boolean(),
    active: z.boolean(),
  })
  .refine((v) => v.id || v.key, { message: "Give the new disposition a key.", path: ["key"] });
