import { z } from "zod";

/** Inbound message from a (future) SMS/email provider webhook (SPEC §13.2 keyword handler stub). */
export const inboundMessageSchema = z.object({
  channel: z.enum(["sms", "email"]),
  from: z.string().trim().min(3).max(320),
  to: z.string().trim().max(320).optional(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().max(5000).default(""),
  provider_message_id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:-]{4,200}$/)
    .optional(),
  received_at: z.iso.datetime().optional(),
});
export type InboundMessageInput = z.infer<typeof inboundMessageSchema>;
