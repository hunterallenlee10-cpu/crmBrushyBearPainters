import { z } from "zod";
import type { HomeBuilt } from "@/lib/domain/leads/constants";
import { subSourceIssue, type SubSourceOption } from "@/lib/domain/leads/sub-source";
import {
  leadContactSchema,
  leadCreateSchema,
  leadPropertySchema,
  type LeadCreateInput,
} from "@/lib/validation/leads";

/**
 * Pure helpers for the New Lead wizard (SPEC §8.4), shared by the client
 * component and the server actions. No I/O.
 */

export type WizardStep = 1 | 2 | 3;

export { subSourceIssue, subSourcesFor, type SubSourceOption } from "@/lib/domain/leads/sub-source";

/** The wizard's step-1 rule (mirrors leadCreateSchema): one way to reach them. */
export const CONTACT_METHOD_MESSAGE = "Add a mobile, phone or email so we can reach them.";

// A value that failed its own check (bad phone) still counts as "given", so only its error shows.
const filled = (v: unknown) => (typeof v === "string" ? v.trim() !== "" : v != null);

/**
 * Step 1 schema. `when: () => true` runs the contact rule even while names are
 * missing, so every problem on the step shows at once.
 */
export const wizardStep1Schema = leadContactSchema.refine(
  (v) => filled(v.mobile) || filled(v.phone) || filled(v.email),
  { message: CONTACT_METHOD_MESSAGE, path: ["mobile"], when: () => true },
);

export const wizardStep2Schema = leadPropertySchema;

/** Step 3 validates the whole lead, plus the sub-source rule for the picked source. */
export function wizardStep3Schema(subSources: readonly SubSourceOption[]) {
  return leadCreateSchema.superRefine(
    (v, ctx) => {
      const issue = subSourceIssue(v.lead_source, v.lead_sub_source, subSources);
      if (issue) ctx.addIssue({ code: "custom", message: issue, path: ["lead_sub_source"] });
    },
    // Show the sub-source problem alongside any others on the step.
    { when: () => true },
  );
}

/** A typed year decides "home built" when nobody picked it (SPEC §5.1 pre-1978). */
export function homeBuiltFromYear(year: string | number | null | undefined): HomeBuilt | null {
  if (year === null || year === undefined || year === "") return null;
  const n = Number(year);
  if (!Number.isInteger(n) || n < 1700 || n > 2100) return null;
  return n < 1978 ? "before_1978" : "1978_or_later";
}

export function resolveHomeBuilt(
  year: string | number | null | undefined,
  homeBuilt: HomeBuilt | null | undefined,
): HomeBuilt | null {
  return homeBuilt ?? homeBuiltFromYear(year);
}

/** Before 1978 or "not sure" means lead-safe prep applies (SPEC §13.3). */
export function needsLeadSafe(homeBuilt: HomeBuilt | null | undefined): boolean {
  return homeBuilt === "before_1978" || homeBuilt === "not_sure";
}

const STEP_FIELDS: Record<WizardStep, readonly string[]> = {
  1: Object.keys(leadContactSchema.shape),
  2: Object.keys(leadPropertySchema.shape),
  3: [],
};

/** Which step shows a field (server errors jump back to it). Unknown fields → step 3. */
export function stepForField(field: string): WizardStep {
  const root = field.split(".")[0] ?? field;
  if (STEP_FIELDS[1].includes(root)) return 1;
  if (STEP_FIELDS[2].includes(root)) return 2;
  return 3;
}

/** Maps a guard message from the database to the field it is about. */
export function fieldForDbMessage(message: string): keyof LeadCreateInput | null {
  if (/^Sub-source\b/.test(message)) return "lead_sub_source";
  if (/^Lead source\b/.test(message)) return "lead_source";
  if (/^Property type\b/.test(message)) return "property_type";
  if (/^Siding type\b/.test(message)) return "siding_type";
  if (/^Lead set by\b/.test(message)) return "lead_set_by";
  if (/^Owner\b|assign leads/.test(message)) return "owner_id";
  return null;
}

// Photos ---------------------------------------------------------------------

export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export const PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

export const PHOTO_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/*,application/pdf";

const EXT_TYPES: Record<string, PhotoType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

/** The upload's content type; phones sometimes leave HEIC types blank, so fall back to the extension. */
export function photoContentType(file: { name: string; type: string }): PhotoType | null {
  const t = file.type.toLowerCase();
  if ((PHOTO_TYPES as readonly string[]).includes(t)) return t as PhotoType;
  if (t === "image/jpg") return "image/jpeg";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPES[ext] ?? null;
}

/**
 * Adds picked files to the list, keeping at most 10 and refusing wrong types
 * or files over 15 MB. Returns the new list and a message for anything refused.
 */
export function addPhotos<F extends { name: string; type: string; size: number }>(
  current: readonly F[],
  picked: readonly F[],
): { files: F[]; problems: string[] } {
  const files = [...current];
  const problems: string[] = [];
  for (const f of picked) {
    if (!photoContentType(f)) {
      problems.push(`${f.name}: only photos (JPG, PNG, WebP, HEIC) or PDFs.`);
    } else if (f.size > MAX_PHOTO_BYTES) {
      problems.push(`${f.name}: bigger than 15 MB.`);
    } else if (f.size <= 0) {
      problems.push(`${f.name}: the file is empty.`);
    } else if (files.length >= MAX_PHOTOS) {
      problems.push(`${f.name}: up to ${MAX_PHOTOS} files per lead.`);
    } else {
      files.push(f);
    }
  }
  return { files, problems };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Upload request shapes (validated again on the server). */
export const photoMetaSchema = z.object({
  file_name: z.string().trim().min(1).max(200),
  content_type: z.enum(PHOTO_TYPES),
  size_bytes: z.number().int().min(1).max(MAX_PHOTO_BYTES),
});
export type PhotoMeta = z.infer<typeof photoMetaSchema>;
