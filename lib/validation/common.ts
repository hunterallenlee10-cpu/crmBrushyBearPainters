import { z } from "zod";

/** Trimmed text; empty string becomes null (for optional DB columns). */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `Keep it under ${max} characters.`);

/** "$1,234.50" / "1234.5" → integer cents. Empty → null when optional. */
export function dollarsToCents(input: string): number | null {
  const clean = input.replace(/[$,\s]/g, "");
  if (clean === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return Number.NaN;
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

export const moneyCents = (label: string) =>
  z.string().transform((v, ctx) => {
    const cents = dollarsToCents(v);
    if (cents === null || Number.isNaN(cents)) {
      ctx.addIssue({
        code: "custom",
        message: `${label} must be a dollar amount like 250 or 250.00.`,
      });
      return z.NEVER;
    }
    return cents;
  });

export const optionalMoneyCents = (label: string) =>
  z.string().transform((v, ctx) => {
    const cents = dollarsToCents(v);
    if (Number.isNaN(cents)) {
      ctx.addIssue({
        code: "custom",
        message: `${label} must be a dollar amount like 50 or 50.00.`,
      });
      return z.NEVER;
    }
    return cents;
  });

export const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^https:\/\/[^\s]+$/.test(v), "Use a full https:// link.");
