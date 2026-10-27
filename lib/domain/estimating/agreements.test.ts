import { describe, expect, it } from "vitest";
import {
  applicableClauses,
  checkPublishable,
  isMergeField,
  mergeFieldsIn,
  parseGuarantees,
  parseInclusions,
  placeholderSlots,
  renderMergeFields,
  sentenceCase,
  templateBlocks,
} from "@/lib/estimating/engine";

const DRAFT = `# Contract {{estimate.number}}

This agreement is between {{company.name}} (L&I {{company.lni_number}}, UBI {{company.ubi_number}}) and {{customer.name}}.
Price: {{estimate.total}}.

## Payment
[PAYMENT_TERMS — owner/attorney to provide]

## Notes
Thanks {{customer.nickname}}.`;

describe("merge fields and slots", () => {
  it("finds merge fields and placeholder slots", () => {
    expect(mergeFieldsIn(DRAFT)).toEqual([
      "estimate.number",
      "company.name",
      "company.lni_number",
      "company.ubi_number",
      "customer.name",
      "estimate.total",
      "customer.nickname",
    ]);
    expect(placeholderSlots(DRAFT)).toEqual(["[PAYMENT_TERMS — owner/attorney to provide]"]);
    expect(placeholderSlots("[LNI_NUMBER] and [T&M_RATE] and [lowercase]")).toEqual([
      "[LNI_NUMBER]",
      "[T&M_RATE]",
    ]);
    expect(mergeFieldsIn("{{company.name}} and {{ company.name }}")).toEqual(["company.name"]);
    expect(isMergeField("company.name")).toBe(true);
    expect(isMergeField("company.secret")).toBe(false);
  });

  it("renders known fields, shows a dash for missing ones and leaves unknown ones", () => {
    const out = renderMergeFields(DRAFT, {
      "estimate.number": "EST-2026-0001",
      "company.name": "Brushy Bear Painters",
      "company.lni_number": "[LNI_NUMBER]",
      "customer.name": "  ",
    });
    expect(out).toContain("# Contract EST-2026-0001");
    expect(out).toContain("(L&I [LNI_NUMBER], UBI —) and —.");
    expect(out).toContain("{{customer.nickname}}");
  });

  it("splits a body into headings, paragraphs and placeholder blocks", () => {
    const blocks = templateBlocks(renderMergeFields(DRAFT, {}));
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "placeholder",
      "heading",
      "paragraph",
    ]);
    expect(blocks[0]).toEqual({ kind: "heading", level: 1, text: "Contract —" });
    expect(blocks[2]).toEqual({ kind: "heading", level: 2, text: "Payment" });
    expect(templateBlocks("\n\n\n")).toEqual([]);
    expect(templateBlocks("Intro\n[SLOT]\nOutro")).toEqual([
      { kind: "paragraph", text: "Intro" },
      { kind: "placeholder", text: "[SLOT]" },
      { kind: "paragraph", text: "Outro" },
    ]);
  });
});

describe("publish validation", () => {
  it("lists every problem: slots, unknown and missing fields, owner confirmation", () => {
    const check = checkPublishable({
      docType: "contract",
      body: DRAFT.replace("{{estimate.total}}", "the total"),
      clauses: [{ body: "[LEAD_SAFE_CLAUSE]" }],
      ownerConfirmed: false,
    });
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual([
      "Fill in these 2 slots first: [PAYMENT_TERMS], [LEAD_SAFE_CLAUSE].",
      "Unknown merge fields: {{customer.nickname}}.",
      "Add the required fields: {{estimate.total}}.",
      "Confirm that an owner (and, for legal wording, your attorney) approved this text.",
    ]);
    expect(
      checkPublishable({ docType: "proposal", body: "[ONE]", ownerConfirmed: true }).problems[0],
    ).toBe("Fill in this slot first: [ONE].");
  });

  it("passes a finished template; types without required fields only need the basics", () => {
    const body =
      "# Contract {{estimate.number}}\n{{company.name}} {{company.lni_number}} {{company.ubi_number}} {{estimate.total}}";
    expect(checkPublishable({ docType: "contract", body, ownerConfirmed: true })).toEqual({
      ok: true,
      problems: [],
    });
    expect(checkPublishable({ docType: "receipt", body: "Thanks!", ownerConfirmed: true }).ok).toBe(
      true,
    );
  });

  it("keeps clauses that apply to the job", () => {
    const clauses = [
      { key: "always", when: null },
      { key: "lead", when: "lead_safe" },
      { key: "hoa", when: "hoa" },
      { key: "other", when: "spaceship" },
    ];
    expect(applicableClauses(clauses, { leadSafe: true, hoa: false }).map((c) => c.key)).toEqual([
      "always",
      "lead",
    ]);
    expect(applicableClauses(clauses, { leadSafe: false, hoa: true }).map((c) => c.key)).toEqual([
      "always",
      "hoa",
    ]);
  });
});

describe("inclusions and guarantees", () => {
  it("reads What's included per work type defensively", () => {
    const inc = parseInclusions({
      exterior: { status: "approved", source: "website", items: ["washing siding", "", 3] },
      interior: "nope",
    });
    expect(inc.exterior).toEqual({
      items: ["washing siding"],
      status: "approved",
      source: "website",
    });
    expect(inc.interior).toEqual({ items: [], status: "draft", source: "draft" });
    expect(parseInclusions(null).cabinets.items).toEqual([]);
    expect(parseInclusions({ deck_fence: { items: "x" } }).deck_fence.items).toEqual([]);
  });

  it("reads guarantees and skips broken rows", () => {
    expect(
      parseGuarantees([
        {
          key: "rain_day",
          title: "Rain-day promise",
          body: "First when it clears.",
          enabled: true,
        },
        { key: "clean", title: "Clean house", enabled: false },
        { title: "No key" },
        "nope",
      ]),
    ).toEqual([
      { key: "rain_day", title: "Rain-day promise", body: "First when it clears.", enabled: true },
      { key: "clean", title: "Clean house", body: "", enabled: false },
    ]);
    expect(parseGuarantees({})).toEqual([]);
  });

  it("capitalizes a list item", () => {
    expect(sentenceCase(" plants covered")).toBe("Plants covered");
    expect(sentenceCase("")).toBe("");
  });
});
