import { z } from "zod";
import { IMPORT_MODULES, MAX_IMPORT_ROWS } from "@/lib/domain/imports";
import { BULK_MODULES, MAX_BULK_ROWS } from "@/lib/domain/bulk";
import { MERGE_MODULES } from "@/lib/domain/merge";

/** Inputs for Admin → Data Import, Bulk Update, Merge Customers and list exports. */

export const startImportSchema = z.object({
  module: z.enum(IMPORT_MODULES),
  file_name: z.string().trim().min(1).max(200),
  header: z.array(z.string().max(200)).min(1, "The file has no header row.").max(100),
  rows: z
    .array(z.array(z.string().max(5000)).max(100))
    .min(1, "The file has a header but no rows.")
    .max(
      MAX_IMPORT_ROWS,
      `Import up to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows at a time.`,
    ),
});
export type StartImportInput = z.input<typeof startImportSchema>;

export const mapImportSchema = z.object({
  id: z.uuid(),
  mapping: z.record(z.string().max(200), z.string().regex(/^(cf:)?[a-z][a-z0-9_]{0,39}$/)),
  duplicates: z.enum(["skip", "create"]).default("skip"),
});
export type MapImportInput = z.input<typeof mapImportSchema>;

export const importRowDecisionSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["create", "skip"]),
});

export const importIdSchema = z.object({ id: z.uuid() });

const bulkValue = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.array(z.string().max(100)).max(50),
  z.null(),
]);

export const bulkPreviewSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("selection"),
    module: z.enum(BULK_MODULES),
    title: z.string().trim().max(200).optional(),
    ids: z.array(z.uuid()).min(1, "Pick at least one record.").max(MAX_BULK_ROWS),
    changes: z.record(z.string().regex(/^(cf:)?[a-z][a-z0-9_]{0,39}$/), bulkValue),
  }),
  z.object({
    source: z.literal("csv"),
    module: z.enum(BULK_MODULES),
    title: z.string().trim().max(200).optional(),
    file_name: z.string().trim().max(200),
    header: z.array(z.string().max(200)).min(1).max(100),
    rows: z
      .array(z.array(z.string().max(500)).max(100))
      .min(1)
      .max(MAX_BULK_ROWS),
  }),
]);
export type BulkPreviewInput = z.input<typeof bulkPreviewSchema>;

export const bulkIdSchema = z.object({ id: z.uuid() });
export const bulkRevertSchema = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(10, "Say why you're reverting (at least 10 characters).").max(500),
});

export const mergeSchema = z.object({
  module: z.enum(MERGE_MODULES),
  survivor_id: z.uuid(),
  merged_id: z.uuid(),
  choices: z.record(z.string().max(60), z.enum(["survivor", "merged", "union"])),
  reason: z.string().trim().max(500).optional(),
});
export type MergeInput = z.input<typeof mergeSchema>;

export const undoMergeSchema = z.object({
  id: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(10, "Say why you're undoing the merge (at least 10 characters).")
    .max(500),
});

export const listExportSchema = z.object({
  list: z.enum(["leads", "jobs", "audit_log"]),
  /** The page's query string (filters, tab, sort) so the export matches the list. */
  query: z.string().max(4000).default(""),
});
