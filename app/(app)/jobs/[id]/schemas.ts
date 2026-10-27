import { z } from "zod";

/**
 * Job Detail inputs that lib/validation/jobs.ts doesn't cover yet (Admin
 * section extras). Everything else uses the shared schemas there.
 */

/** Admin → Status overrides → Release all holds (a note is required, like every override). */
export const releaseAllHoldsSchema = z.object({
  job_id: z.uuid(),
  note: z
    .string()
    .trim()
    .min(3, "Say why you're releasing them (at least 3 characters).")
    .max(1000, "Keep it under 1,000 characters."),
});
export type ReleaseAllHoldsInput = z.input<typeof releaseAllHoldsSchema>;

/** Admin → Dates: the promised start date (a calendar date, not a timestamp). */
export const promisedStartSchema = z.object({
  id: z.uuid(),
  value: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."), z.literal("")])
    .nullable()
    .transform((v) => (v ? v : null)),
});
export type PromisedStartInput = z.input<typeof promisedStartSchema>;

/** Contract baseline typed in dollars ("12,500" / "12500.00") on the Admin form. */
export function parseDollarInput(input: string): number | null | "invalid" {
  const clean = input.replace(/[$,\s]/g, "");
  if (clean === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return "invalid";
  const [whole = "0", frac = ""] = clean.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : "invalid";
}
