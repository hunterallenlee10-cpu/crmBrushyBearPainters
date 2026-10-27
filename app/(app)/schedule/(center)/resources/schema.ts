import { z } from "zod";
import { isoDate } from "@/lib/validation/production";

/** Resources form schemas (kept out of the "use server" file). */

const id = z.uuid();

export const crewSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1, "Name the crew.").max(80),
    crewType: z.enum(["employee", "subcontractor"]),
    subcontractorId: id.nullable(),
    leadUserId: id.nullable(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable(),
    homeTerritoryId: id.nullable(),
    maxJobsPerDay: z.coerce.number().int().min(1).max(5),
    dailyCapacityHours: z.coerce.number().min(1).max(24),
    active: z.boolean(),
  })
  .refine((v) => v.crewType === "employee" || v.subcontractorId, {
    message: "Pick the subcontractor this crew belongs to.",
    path: ["subcontractorId"],
  });

export const crewMemberSchema = z
  .object({
    crewId: id,
    userId: id.optional(),
    displayName: z.string().trim().max(120).optional(),
    role: z.enum(["lead", "painter", "helper"]),
  })
  .refine((v) => v.userId || v.displayName, {
    message: "Pick a teammate or type a name.",
    path: ["userId"],
  });

export const timeOffSchema = z
  .object({
    kind: z.enum(["time_off", "blackout"]),
    crewId: id.optional(),
    userId: id.optional(),
    startsOn: isoDate,
    endsOn: isoDate,
    reason: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    message: "The last day is before the first.",
    path: ["endsOn"],
  })
  .refine((v) => v.kind === "blackout" || v.crewId || v.userId, {
    message: "Pick a crew or a person.",
    path: ["crewId"],
  });
