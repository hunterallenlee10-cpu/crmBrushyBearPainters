import { z } from "zod";
import { isIsoDate } from "@/lib/domain/scheduling/dates";

/**
 * Production validation shared by Server Actions and Route Handlers (Phase 6).
 */

export const isoDate = z.string().refine((v) => isIsoDate(v), "Use a date like 2027-07-12.");
const id = z.uuid();
const text = (max: number) => z.string().trim().max(max);

export const dailyLogHoursSchema = z
  .array(
    z
      .object({
        userId: id.optional(),
        name: z.string().trim().min(1).max(120).optional(),
        hours: z.coerce
          .number()
          .positive("Hours must be more than 0.")
          .max(24, "At most 24 hours."),
      })
      .refine((h) => h.userId || h.name, "Pick a teammate or type a name."),
  )
  .max(30);

export const dailyLogSchema = z.object({
  clientId: id,
  logDate: isoDate,
  workOrderId: id.optional(),
  finishedToday: z.string().trim().min(3, "Say what got done today.").max(4000),
  nextUp: text(4000).optional(),
  issues: text(4000).optional(),
  weatherObserved: text(200).optional(),
  cleanupDone: z.literal(true, { error: "Check “Cleanup done” — a clean house every evening." }),
  hours: dailyLogHoursSchema.default([]),
  source: z.enum(["online", "offline"]).default("online"),
});
export type DailyLogInput = z.infer<typeof dailyLogSchema>;

export const draftEntrySchema = z
  .object({
    entryId: id.optional(),
    jobId: id,
    crewId: id,
    startsOn: isoDate,
    endsOn: isoDate,
    workType: z
      .enum([
        "interior_production",
        "exterior_production",
        "cabinet_shop",
        "deck_fence",
        "pressure_washing",
        "rot_repair",
        "touch_up",
      ])
      .optional(),
    workOrderId: id.optional(),
    allowSplit: z.boolean().optional(),
    reason: z.enum(["company", "weather", "customer"]).optional(),
    note: text(500).optional(),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    message: "The end date is before the start date.",
    path: ["endsOn"],
  });

export const rainDelaySchema = z.object({
  jobId: id,
  date: isoDate,
  note: text(500).optional(),
  notifyCustomer: z.boolean().default(true),
});

export const punchItemSchema = z.object({
  jobId: id,
  area: z.string().trim().min(1, "Name the area.").max(120),
  description: z.string().trim().min(3, "Describe the touch-up.").max(1000),
  photoId: id.optional(),
  assignedTo: id.optional(),
});

export const punchUpdateSchema = z
  .object({
    id,
    status: z.enum(["open", "fixed", "customer_waived"]).optional(),
    waivedNote: z.string().trim().max(500).optional(),
    fixedPhotoId: id.nullable().optional(),
    area: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(3).max(1000).optional(),
  })
  .refine((v) => v.status !== "customer_waived" || (v.waivedNote?.length ?? 0) >= 3, {
    message: "Say why the customer waived it.",
    path: ["waivedNote"],
  });

export const signoffSchema = z.object({
  jobId: id,
  signerName: z.string().trim().min(2, "Type the customer's name.").max(120),
  signaturePng: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Ask the customer to sign in the box.")
    .max(400_000),
  note: text(1000).optional(),
});
