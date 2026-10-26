import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AA_LARGE, AA_TEXT, contrastRatio, tint } from "@/lib/design/contrast";
import { brand, brandCssVar, status, surface } from "@/lib/design/tokens";
import { JOB_STAGES, STAGE_BADGE_TINT } from "@/lib/domain/stages";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8").toLowerCase();

function cssVar(name: string): string | undefined {
  const m = new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\s*;`).exec(css);
  return m?.[1];
}

describe("design tokens", () => {
  it("globals.css mirrors every brand token from tokens.ts", () => {
    for (const key of Object.keys(brand) as (keyof typeof brand)[]) {
      expect(cssVar(brandCssVar[key]), brandCssVar[key]).toBe(brand[key].toLowerCase());
    }
  });

  it("globals.css mirrors every status color", () => {
    for (const [tone, { fg, bg }] of Object.entries(status)) {
      expect(cssVar(`--status-${tone}`), tone).toBe(fg.toLowerCase());
      expect(cssVar(`--status-${tone}-bg`), `${tone} bg`).toBe(bg.toLowerCase());
    }
  });

  it("globals.css uses the documented app surfaces", () => {
    expect(cssVar("--background")).toBe(surface.appBackground.toLowerCase());
    expect(cssVar("--muted-foreground")).toBe(surface.mutedForeground.toLowerCase());
  });
});

describe("WCAG 2.2 AA contrast (SPEC §16)", () => {
  const white = "#FFFFFF";

  it.each([
    ["forest text on white", brand.forest, white],
    ["white text on forest (primary button)", white, brand.forest],
    ["white text on forest-dark", white, brand.forestDark],
    ["ink text on honey (CTA)", brand.ink, brand.honey],
    ["ink text on cream (brand surfaces)", brand.ink, brand.cream],
    ["forest text on cream", brand.forest, brand.cream],
    ["ink text on app background", brand.ink, surface.appBackground],
    ["muted text on white", surface.mutedForeground, white],
    ["muted text on app background", surface.mutedForeground, surface.appBackground],
  ])("%s passes AA for body text", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("honey is never safe as text on white (why CTAs use ink on honey)", () => {
    expect(contrastRatio(brand.honey, white)).toBeLessThan(AA_LARGE);
  });

  it.each(Object.entries(status))("%s status text passes AA on its tint", (_tone, { fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(JOB_STAGES.map((s) => [s.label, s.color] as const))(
    "%s stage badge text passes AA on its tint",
    (_label, color) => {
      expect(contrastRatio(color, tint(color, STAGE_BADGE_TINT))).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );
});

describe("contrast helpers", () => {
  it("black on white is 21:1 and identical colors are 1:1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#1F4D3A", "#1F4D3A")).toBeCloseTo(1, 5);
  });

  it("tint(…, 0) is white and tint(…, 1) is the color", () => {
    expect(tint("#1F4D3A", 0)).toBe("#FFFFFF");
    expect(tint("#1F4D3A", 1)).toBe("#1F4D3A");
  });

  it("rejects malformed hex", () => {
    expect(() => contrastRatio("forest", "#FFFFFF")).toThrow(/Invalid hex/);
  });
});
