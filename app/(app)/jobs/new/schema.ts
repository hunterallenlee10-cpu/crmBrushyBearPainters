import { z } from "zod";

/** New Job customer lookups (the job itself uses jobCreateSchema from lib/validation/jobs). */

export const accountSearchSchema = z.object({
  q: z.string().trim().min(2, "Type at least 2 letters.").max(100),
});

export const accountRefSchema = z.object({ id: z.uuid() });

export type AccountHit = { id: string; name: string; city: string | null };

export type AccountChoice = {
  id: string;
  name: string;
  primaryContactId: string | null;
  properties: { id: string; label: string; city: string | null; isPrimary: boolean }[];
  contacts: { id: string; name: string; firstName: string; lastName: string | null }[];
};

/** Characters that mean something to PostgREST filters or LIKE patterns. */
export function searchTerm(q: string): string {
  return q
    .replace(/[%_,()*\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
