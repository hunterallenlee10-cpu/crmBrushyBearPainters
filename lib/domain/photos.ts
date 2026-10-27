/**
 * Job photos (SPEC §8.5 #6): categories, the required-shot checklist per work
 * type, and gallery counts. Pure.
 */

export const PHOTO_CATEGORIES = [
  "before",
  "prep",
  "progress",
  "after",
  "damage",
  "color",
  "cleanup",
  "other",
] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  before: "Before",
  prep: "Prep",
  progress: "Progress",
  after: "After",
  damage: "Damage/Rot",
  color: "Color",
  cleanup: "Cleanup",
  other: "Other",
};

export function isPhotoCategory(v: string): v is PhotoCategory {
  return (PHOTO_CATEGORIES as readonly string[]).includes(v);
}

/** Largest edge of the stored copy and of the thumbnail (pixels). */
export const PHOTO_MAX_EDGE = 2560;
export const THUMB_MAX_EDGE = 480;
/** Upload limit after the browser shrinks the photo (bytes). */
export const PHOTO_UPLOAD_LIMIT = 8 * 1024 * 1024;
export const PHOTO_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// --- Required shots -----------------------------------------------------------------

export type RequiredShot = {
  key: string;
  label: string;
  category: PhotoCategory;
  /** The shot is needed once for each area (room, elevation…) of that work type. */
  perArea: boolean;
  /** Plain hint shown under the item. */
  hint: string;
};

type ShotTemplate = Omit<RequiredShot, "key"> & { id: string };

/** Required shots by work type (SPEC §8.5 #6). Areas come from the accepted estimate. */
export const REQUIRED_SHOTS: Record<string, readonly ShotTemplate[]> = {
  interior: [
    { id: "before", label: "Before", category: "before", perArea: true, hint: "Each room, wide." },
    {
      id: "prep",
      label: "Prep and protection",
      category: "prep",
      perArea: false,
      hint: "Floors and furniture covered, patches done.",
    },
    {
      id: "after",
      label: "After",
      category: "after",
      perArea: true,
      hint: "Same angle as before.",
    },
    {
      id: "cleanup",
      label: "Cleanup",
      category: "cleanup",
      perArea: false,
      hint: "The house at the end of the day.",
    },
  ],
  exterior: [
    {
      id: "before",
      label: "Before",
      category: "before",
      perArea: true,
      hint: "Each elevation, whole wall in frame.",
    },
    {
      id: "prep",
      label: "Prep",
      category: "prep",
      perArea: false,
      hint: "Washed, scraped, repaired, caulked, primed.",
    },
    {
      id: "progress",
      label: "Progress",
      category: "progress",
      perArea: false,
      hint: "Primer or first coat going on.",
    },
    {
      id: "after",
      label: "After",
      category: "after",
      perArea: true,
      hint: "Same angle as before.",
    },
    {
      id: "cleanup",
      label: "Cleanup",
      category: "cleanup",
      perArea: false,
      hint: "Paint chips and drop cloths picked up.",
    },
  ],
  cabinets: [
    { id: "before", label: "Before", category: "before", perArea: true, hint: "Each cabinet run." },
    {
      id: "prep",
      label: "Doors labeled and removed",
      category: "prep",
      perArea: false,
      hint: "Doors, drawers and hardware off and labeled.",
    },
    {
      id: "progress",
      label: "Spray and primer",
      category: "progress",
      perArea: false,
      hint: "Bonding primer or finish coats.",
    },
    {
      id: "after",
      label: "After",
      category: "after",
      perArea: true,
      hint: "Reinstalled and adjusted.",
    },
  ],
  deck_fence: [
    {
      id: "before",
      label: "Before",
      category: "before",
      perArea: true,
      hint: "Each deck or fence run.",
    },
    {
      id: "prep",
      label: "Cleaned and brightened",
      category: "prep",
      perArea: false,
      hint: "Boards clean and dry before stain.",
    },
    {
      id: "after",
      label: "After",
      category: "after",
      perArea: true,
      hint: "Stained, plants uncovered.",
    },
  ],
};

const WORK_TYPE_LABELS: Record<string, string> = {
  interior: "Interior",
  exterior: "Exterior",
  cabinets: "Cabinets",
  deck_fence: "Deck & fence",
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
}

/** Trimmed, case-insensitively unique, in their original order. */
function uniqueAreas(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of list) {
    const t = a.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

export type ChecklistShot = RequiredShot & { workType: string; area: string | null };

/**
 * The job's required shots: each work type's list, with per-area shots once
 * per area of that work type (from the accepted estimate). A work type with no
 * known areas gets one shot per item.
 */
export function requiredShots(
  workTypes: readonly string[],
  areasByWorkType: Readonly<Record<string, readonly string[]>> = {},
): ChecklistShot[] {
  const out: ChecklistShot[] = [];
  const multi = workTypes.filter((w) => REQUIRED_SHOTS[w]).length > 1;
  for (const wt of workTypes) {
    const tpl = REQUIRED_SHOTS[wt];
    if (!tpl) continue;
    const prefix = multi ? `${WORK_TYPE_LABELS[wt] ?? wt}: ` : "";
    const areas = uniqueAreas(areasByWorkType[wt] ?? []);
    for (const t of tpl) {
      if (t.perArea && areas.length) {
        for (const area of areas) {
          out.push({
            key: `${wt}_${t.id}_${slug(area)}`.slice(0, 60),
            label: `${prefix}${t.label} – ${area}`,
            category: t.category,
            perArea: true,
            hint: t.hint,
            workType: wt,
            area,
          });
        }
      } else {
        out.push({
          key: `${wt}_${t.id}`,
          label: `${prefix}${t.label}`,
          category: t.category,
          perArea: t.perArea,
          hint: t.hint,
          workType: wt,
          area: null,
        });
      }
    }
  }
  return out;
}

export type PhotoForChecklist = {
  id: string;
  category: string;
  area: string | null;
  checklistKey: string | null;
};

export type ShotCoverage = ChecklistShot & { photoIds: string[]; done: boolean };

function sameArea(a: string | null, b: string | null): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/**
 * Which required shots have a photo. A photo counts for a shot when it was
 * tagged with that shot, or has the shot's category and (for per-area shots)
 * the same area tag.
 */
export function shotCoverage(
  shots: readonly ChecklistShot[],
  photos: readonly PhotoForChecklist[],
): ShotCoverage[] {
  return shots.map((s) => {
    const ids = photos
      .filter(
        (p) =>
          p.checklistKey === s.key ||
          (!p.checklistKey &&
            p.category === s.category &&
            (s.area === null || sameArea(p.area, s.area))),
      )
      .map((p) => p.id);
    return { ...s, photoIds: ids, done: ids.length > 0 };
  });
}

/** Chip counts: All plus each category. */
export function categoryCounts(
  photos: readonly { category: string }[],
): Record<PhotoCategory | "all", number> {
  const out = { all: photos.length } as Record<PhotoCategory | "all", number>;
  for (const c of PHOTO_CATEGORIES) out[c] = 0;
  for (const p of photos) if (isPhotoCategory(p.category)) out[p.category] += 1;
  return out;
}

/** Distinct area tags in use, sorted (for the area filter and suggestions). */
export function areaTags(
  photos: readonly { area: string | null }[],
  extra: readonly string[] = [],
) {
  const seen = new Map<string, string>();
  for (const a of [...photos.map((p) => p.area), ...extra]) {
    const t = (a ?? "").trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** A before/after pair for the compare slider: same area when possible. */
export function suggestPair<T extends { id: string; category: string; area: string | null }>(
  photos: readonly T[],
): { before: T; after: T } | null {
  const befores = photos.filter((p) => p.category === "before");
  const afters = photos.filter((p) => p.category === "after");
  for (const a of afters) {
    const b = befores.find((x) => x.area && sameArea(x.area, a.area));
    if (b) return { before: b, after: a };
  }
  return befores[0] && afters[0] ? { before: befores[0], after: afters[0] } : null;
}

/** Size of a file for people ("2.4 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Target size for the browser-side shrink, keeping the aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
