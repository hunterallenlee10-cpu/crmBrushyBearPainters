import { z } from "zod";

/** Help Center article editor (help:manage). */
export const articleSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1, "Give the article a title.").max(160),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "Use lowercase letters, numbers and dashes."),
  category_id: z
    .union([z.uuid(), z.literal("")])
    .nullish()
    .transform((v) => v || null),
  summary: z.string().trim().max(300).default(""),
  body: z.string().max(40000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  audience: z
    .array(z.enum(["owner", "office", "sales", "crew"]))
    .max(4)
    .default([]),
  status: z.enum(["draft", "published"]),
});
export type ArticleInput = z.input<typeof articleSchema>;

export const articleIdSchema = z.object({ id: z.uuid() });

export const helpSearchSchema = z.object({ q: z.string().trim().max(100) });
