/**
 * Design tokens (SPEC §16). These hex values are mirrored as CSS variables in
 * app/globals.css; a unit test keeps the two in sync and checks WCAG contrast.
 */

export const brand = {
  forest: "#1F4D3A",
  forestDark: "#163829",
  honey: "#E9A93B",
  cream: "#F4EDE1",
  creamLight: "#FAF6EF",
  ink: "#2B2B2B",
  border: "#E6DAC6",
} as const;

/** Neutral app surfaces (dense data stays readable on gray + white cards). */
export const surface = {
  appBackground: "#F6F7F9",
  card: "#FFFFFF",
  border: "#E3E6EA",
  muted: "#F1F3F5",
  mutedForeground: "#5B6470",
} as const;

export type StatusTone = "info" | "success" | "warning" | "danger" | "neutral";

/** Semantic status colors: `fg` is used for text/icons on the `bg` tint. */
export const status: Record<StatusTone, { fg: string; bg: string }> = {
  info: { fg: "#1D4ED8", bg: "#EFF6FF" },
  success: { fg: "#15803D", bg: "#F0FDF4" },
  warning: { fg: "#A16207", bg: "#FEFCE8" },
  danger: { fg: "#B91C1C", bg: "#FEF2F2" },
  neutral: { fg: "#475569", bg: "#F1F5F9" },
};

/** CSS variable name for each brand token (kebab-case of the key). */
export const brandCssVar: Record<keyof typeof brand, string> = {
  forest: "--bb-forest",
  forestDark: "--bb-forest-dark",
  honey: "--bb-honey",
  cream: "--bb-cream",
  creamLight: "--bb-cream-light",
  ink: "--bb-ink",
  border: "--bb-border",
};
