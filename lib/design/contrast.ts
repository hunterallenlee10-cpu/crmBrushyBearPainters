/** WCAG 2.x relative luminance and contrast helpers (pure; used in tests and /dev/ui). */

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) throw new Error(`Invalid hex color: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix `color` into white at `amount` (0–1). Mirrors CSS `color-mix(in srgb, color N%, white)`. */
export function tint(color: string, amount: number): string {
  const [r, g, b] = hexToRgb(color);
  return rgbToHex([255 + (r - 255) * amount, 255 + (g - 255) * amount, 255 + (b - 255) * amount]);
}

/** WCAG AA for normal text. */
export const AA_TEXT = 4.5;
/** WCAG AA for large text and UI components (borders, icons). */
export const AA_LARGE = 3;
