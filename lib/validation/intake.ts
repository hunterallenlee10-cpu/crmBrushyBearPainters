import { z } from "zod";

/**
 * Payload contract for POST /api/public/leads (SPEC §14). Field names follow
 * the website's /estimate form. Documented in docs/WEBSITE_INTEGRATION.md.
 * Values are the labels people click ("Interior", "As soon as possible"…);
 * the stored keys are accepted too.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Keep this under ${max} characters.` });

const optionalText = (max: number) =>
  text(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const intakePhotoSchema = z.object({
  path: z
    .string()
    .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/, { message: "Unknown upload." }),
  file_name: text(200).min(1),
  content_type: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
  ]),
  size_bytes: z
    .number()
    .int()
    .min(1)
    .max(15 * 1024 * 1024),
});

export const websiteLeadSchema = z
  .object({
    name: text(160).min(1, { message: "Name is required." }),
    phone: optionalText(40),
    email: optionalText(254),
    location: optionalText(300),
    services: z.array(text(60)).max(10).optional().default([]),
    timeline: optionalText(60),
    home_built: optionalText(60),
    notes: optionalText(5000),
    photos: z.array(intakePhotoSchema).max(10).optional().default([]),
    /** Honeypot (hidden input named "company"). Bots fill it; people never see it. */
    company: optionalText(200),
    page_path: optionalText(500),
    landing_page: optionalText(2000),
    referrer: optionalText(2000),
    utm_source: optionalText(200),
    utm_medium: optionalText(200),
    utm_campaign: optionalText(200),
    utm_term: optionalText(200),
    utm_content: optionalText(200),
    gclid: optionalText(500),
    fbclid: optionalText(500),
    ref: optionalText(40),
    /** The visitor's IP as the website saw it (signed, so it can't be forged). Used for rate limits only. */
    client_ip: optionalText(64),
  })
  .strict();

export type WebsiteLeadInput = z.input<typeof websiteLeadSchema>;
export type WebsiteLead = z.output<typeof websiteLeadSchema>;

export const uploadUrlSchema = z
  .object({
    file_name: text(200).min(1),
    content_type: intakePhotoSchema.shape.content_type,
    size_bytes: intakePhotoSchema.shape.size_bytes,
    client_ip: optionalText(64),
  })
  .strict();
export type UploadUrlRequest = z.output<typeof uploadUrlSchema>;

/** Storage-safe file name: letters, digits, dot, dash, underscore. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return (cleaned || "upload").slice(-120);
}
