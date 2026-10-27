/**
 * Documents (SPEC §8.5 #7, §8.13): categories, tabs, the file types people
 * may upload and how each one previews. Pure.
 */

export const DOCUMENT_CATEGORIES = [
  "proposal",
  "contract",
  "change_order",
  "invoice",
  "receipt",
  "color_sheet",
  "hoa",
  "lead_safe",
  "warranty",
  "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  proposal: "Proposal / Estimate",
  contract: "Contract",
  change_order: "Change Order",
  invoice: "Invoice",
  receipt: "Receipt",
  color_sheet: "Color Sheet",
  hoa: "HOA",
  lead_safe: "Lead-Safe",
  warranty: "Warranty",
  other: "Other",
};

export function isDocumentCategory(v: string): v is DocumentCategory {
  return (DOCUMENT_CATEGORIES as readonly string[]).includes(v);
}

/** Tabs on the job's Documents section (SPEC §8.5 #7). */
export const DOCUMENT_TABS = [
  { id: "all", label: "All", categories: [] },
  { id: "proposals", label: "Proposals/Estimates", categories: ["proposal"] },
  { id: "contracts", label: "Contracts", categories: ["contract"] },
  { id: "change_orders", label: "Change Orders", categories: ["change_order"] },
  { id: "invoices", label: "Invoices & Receipts", categories: ["invoice", "receipt"] },
  { id: "color_sheets", label: "Color Sheets", categories: ["color_sheet"] },
  { id: "hoa", label: "HOA", categories: ["hoa"] },
  { id: "lead_safe", label: "Lead-Safe", categories: ["lead_safe"] },
  { id: "warranty", label: "Warranty", categories: ["warranty"] },
  { id: "other", label: "Other", categories: ["other"] },
] as const satisfies readonly {
  id: string;
  label: string;
  categories: readonly DocumentCategory[];
}[];
export type DocumentTabId = (typeof DOCUMENT_TABS)[number]["id"];

export function isDocumentTab(v: string | null | undefined): v is DocumentTabId {
  return DOCUMENT_TABS.some((t) => t.id === v);
}

export function tabCategories(tab: DocumentTabId): readonly DocumentCategory[] {
  return DOCUMENT_TABS.find((t) => t.id === tab)?.categories ?? [];
}

/** Counts per tab from counts per category. */
export function tabCounts(
  byCategory: Readonly<Record<string, number>>,
): Record<DocumentTabId, number> {
  const total = Object.values(byCategory).reduce((s, n) => s + n, 0);
  const out = {} as Record<DocumentTabId, number>;
  for (const t of DOCUMENT_TABS) {
    out[t.id] = t.id === "all" ? total : t.categories.reduce((s, c) => s + (byCategory[c] ?? 0), 0);
  }
  return out;
}

/** Categories that show money (crew roles never see them; mirrors app.is_money_document). */
export const MONEY_CATEGORIES: readonly DocumentCategory[] = [
  "proposal",
  "contract",
  "change_order",
  "invoice",
  "receipt",
];

/** File types people may upload (the bucket allows the same list). */
export const DOCUMENT_UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/webp": "WebP image",
  "image/heic": "HEIC image",
  "image/heif": "HEIF image",
  "text/plain": "Text",
  "text/csv": "CSV",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
};

/** 25 MB, the bucket's limit. */
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export function isUploadType(mime: string): boolean {
  return Object.hasOwn(DOCUMENT_UPLOAD_TYPES, mime);
}

/** Why a file can't be uploaded, or null. */
export function uploadProblem(file: { name: string; type: string; size: number }): string | null {
  if (!file.name.trim()) return "The file needs a name.";
  if (!isUploadType(file.type)) {
    return "That file type isn't supported. Upload a PDF, photo, Word, Excel, text or CSV file.";
  }
  if (file.size <= 0) return "That file is empty.";
  if (file.size > DOCUMENT_MAX_BYTES) return "Files can be up to 25 MB.";
  return null;
}

export type PreviewKind = "pdf" | "image" | "none";

/** How the browser can show it (HEIC isn't shown by most browsers). */
export function previewKind(mime: string): PreviewKind {
  if (mime === "application/pdf") return "pdf";
  if (["image/jpeg", "image/png", "image/webp"].includes(mime)) return "image";
  return "none";
}

/** Storage file name: lowercase, safe characters, keeps the extension. */
export function safeFileName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "");
  return (cleaned || "file").slice(-120);
}

/** Default title from a file name ("HOA approval.pdf" → "HOA approval"). */
export function titleFromFileName(name: string): string {
  const base = name
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return (base || "Document").slice(0, 200);
}

/** Suggested category from the file name, for the upload form. */
export function guessCategory(name: string): DocumentCategory {
  const n = name.toLowerCase();
  if (/\bhoa\b|association/.test(n)) return "hoa";
  if (/lead|rrp|renovate[ -]?right/.test(n)) return "lead_safe";
  if (/warrant/.test(n)) return "warranty";
  if (/receipt/.test(n)) return "receipt";
  if (/invoice/.test(n)) return "invoice";
  if (/change[ _-]?order/.test(n)) return "change_order";
  if (/contract|agreement/.test(n)) return "contract";
  if (/color/.test(n)) return "color_sheet";
  if (/estimate|proposal|quote/.test(n)) return "proposal";
  return "other";
}
