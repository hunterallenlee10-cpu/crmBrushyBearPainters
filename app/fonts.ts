import localFont from "next/font/local";

/**
 * Brand fonts, self-hosted from the @fontsource packages through next/font so
 * Next.js preloads them and gives the fallback font matching metrics: text
 * no longer reflows (layout shift) when the web font arrives on a slow phone.
 * Latin subset; other scripts fall back to the system font.
 */
export const manrope = localFont({
  src: "../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  variable: "--font-manrope",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const lilita = localFont({
  src: "../node_modules/@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-lilita",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
