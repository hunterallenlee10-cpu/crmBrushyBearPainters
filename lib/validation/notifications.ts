import { z } from "zod";
import { NOTIFICATION_TYPES } from "@/lib/domain/notifications/catalog";

/** Settings → Notifications and Admin → Notification Settings (SPEC §8.18, §8.19). */

const type = z
  .string()
  .refine((t) => NOTIFICATION_TYPES.some((n) => n.type === t), "Unknown notification type.");

const choice = z.object({ type, inApp: z.boolean(), email: z.boolean(), sms: z.boolean() });

export const myNotificationsSchema = z.object({
  items: z.array(choice).min(1).max(NOTIFICATION_TYPES.length),
});

export const companyNotificationsSchema = z.object({
  items: z
    .array(choice.extend({ locked: z.boolean() }))
    .min(1)
    .max(NOTIFICATION_TYPES.length),
});
