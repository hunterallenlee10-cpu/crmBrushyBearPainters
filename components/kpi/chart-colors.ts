/**
 * Chart colors (SPEC §16 brand). Kept out of the "use client" chart module so
 * Server Components can read them: a client module's exports are references,
 * not values, on the server.
 *
 * One series = brand forest for every bar. A part-of-whole pair (converted /
 * not converted yet) uses forest and a light tint of the same hue, so the
 * split reads as "more of the same" rather than two unrelated categories.
 */
export const CHART_COLORS = {
  primary: "var(--bb-forest)",
  secondary: "#a9c2b5",
  grid: "#e3e6ea",
  axis: "#5b6470",
  label: "#2b2b2b",
} as const;
