import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, plainText, slugify } from "@/lib/domain/help/markdown";
import { parseReleaseNotes } from "@/lib/domain/help/release-notes";

const SEED = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261031000200_hardening_seed.sql"),
  "utf8",
);

describe("help markdown", () => {
  it("parses headings, paragraphs, lists and inline marks", () => {
    const blocks = parseMarkdown(
      "Intro line\ncontinues.\n\n## Steps\n\n1. Go to **Leads**.\n2. Pick `ZIP`.\n- a [link](/help)\n- bad [x](javascript:alert(1))\n### More",
    );
    expect(blocks).toEqual([
      { type: "paragraph", inline: [{ type: "text", text: "Intro line continues." }] },
      { type: "heading", level: 2, text: "Steps", id: "steps" },
      {
        type: "ol",
        items: [
          [
            { type: "text", text: "Go to " },
            { type: "bold", text: "Leads" },
            { type: "text", text: "." },
          ],
          [
            { type: "text", text: "Pick " },
            { type: "code", text: "ZIP" },
            { type: "text", text: "." },
          ],
        ],
      },
      {
        type: "ul",
        items: [
          [
            { type: "text", text: "a " },
            { type: "link", text: "link", href: "/help" },
          ],
          [
            { type: "text", text: "bad " },
            { type: "text", text: "x" },
            { type: "text", text: ")" },
          ],
        ],
      },
      { type: "heading", level: 3, text: "More", id: "more" },
    ]);
    expect(parseInline("plain")).toEqual([{ type: "text", text: "plain" }]);
    expect(plainText("## Hi\n- **Bold** `x` [y](/z)")).toBe("Hi Bold x y");
    expect(slugify("Good to know!")).toBe("good-to-know");
  });

  it("every seeded article parses into headings and steps, with no raw HTML", () => {
    const bodies = [...SEED.matchAll(/\$md\$([\s\S]*?)\$md\$/g)].map((m) => m[1]!);
    expect(bodies).toHaveLength(10);
    for (const body of bodies) {
      expect(body).not.toMatch(/<[a-z]/i);
      const blocks = parseMarkdown(body);
      expect(blocks.some((b) => b.type === "heading")).toBe(true);
      expect(blocks.some((b) => b.type === "ol" || b.type === "ul")).toBe(true);
    }
  });

  it("seeded articles state no prices, phone numbers or emails", () => {
    const bodies = [...SEED.matchAll(/\$md\$([\s\S]*?)\$md\$/g)].map((m) => m[1]!).join("\n");
    expect(bodies).not.toMatch(/\$[1-9]/);
    expect(bodies).not.toMatch(/\(\d{3}\)\s?\d{3}-\d{4}|\d{3}-\d{3}-\d{4}/);
    expect(bodies).not.toMatch(/@[a-z]+\.[a-z]/i);
  });
});

describe("release notes", () => {
  it("reads phases with Added / Changed and skips tests", () => {
    const notes = parseReleaseNotes(
      "# Changelog\n\n## Phase 2 — Leads\n\n### Added\n\n- **Lead list** with `filters`.\n  More text.\n\n### Tests\n\n- 12 tests\n\n## Phase 1 — Platform\n\n### Changed\n\n- Faster [lists](/x).\n",
    );
    expect(notes).toEqual([
      {
        phase: 2,
        title: "Phase 2 — Leads",
        added: ["Lead list with filters. More text."],
        changed: [],
      },
      { phase: 1, title: "Phase 1 — Platform", added: [], changed: ["Faster lists."] },
    ]);
  });

  it("the real CHANGELOG has every phase", () => {
    const notes = parseReleaseNotes(readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"));
    const phases = notes.map((n) => n.phase).filter((p): p is number => p !== null);
    for (const p of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(phases).toContain(p);
  });
});
