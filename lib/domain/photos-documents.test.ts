import { describe, expect, it } from "vitest";
import {
  PHOTO_CATEGORIES,
  areaTags,
  categoryCounts,
  fitWithin,
  formatBytes,
  isPhotoCategory,
  requiredShots,
  shotCoverage,
  suggestPair,
} from "./photos";
import {
  DOCUMENT_TABS,
  guessCategory,
  isDocumentCategory,
  isDocumentTab,
  previewKind,
  safeFileName,
  tabCategories,
  tabCounts,
  titleFromFileName,
  uploadProblem,
} from "./documents";

describe("required shots", () => {
  it("per-area shots repeat for each area of that work type", () => {
    const shots = requiredShots(["exterior"], { exterior: ["Front", "Back", "front "] });
    expect(shots.map((s) => s.label)).toEqual([
      "Before – Front",
      "Before – Back",
      "Prep",
      "Progress",
      "After – Front",
      "After – Back",
      "Cleanup",
    ]);
    expect(shots[0]?.key).toBe("exterior_before_front");
    expect(new Set(shots.map((s) => s.key)).size).toBe(shots.length);
  });

  it("prefixes work types when a job has several, and skips unknown ones", () => {
    const shots = requiredShots(["interior", "cabinets", "add_on_only"]);
    expect(shots[0]?.label).toBe("Interior: Before");
    expect(shots.some((s) => s.label.startsWith("Cabinets: "))).toBe(true);
    expect(shots.every((s) => s.workType !== "add_on_only")).toBe(true);
    expect(requiredShots(["deck_fence"]).map((s) => s.category)).toEqual([
      "before",
      "prep",
      "after",
    ]);
  });

  it("a photo covers a shot by tag, or by category and area", () => {
    const shots = requiredShots(["exterior"], { exterior: ["Front"] });
    const cov = shotCoverage(shots, [
      { id: "p1", category: "before", area: "front", checklistKey: null },
      { id: "p2", category: "prep", area: null, checklistKey: null },
      { id: "p3", category: "other", area: null, checklistKey: "exterior_cleanup" },
      { id: "p4", category: "after", area: "Back", checklistKey: null },
    ]);
    expect(cov.filter((c) => c.done).map((c) => c.key)).toEqual([
      "exterior_before_front",
      "exterior_prep",
      "exterior_cleanup",
    ]);
    expect(cov.find((c) => c.key === "exterior_before_front")?.photoIds).toEqual(["p1"]);
  });
});

describe("gallery helpers", () => {
  it("counts photos per category chip", () => {
    const c = categoryCounts([
      { category: "before" },
      { category: "before" },
      { category: "junk" },
    ]);
    expect(c.all).toBe(3);
    expect(c.before).toBe(2);
    expect(c.after).toBe(0);
    expect(PHOTO_CATEGORIES.every((k) => typeof c[k] === "number")).toBe(true);
    expect(isPhotoCategory("damage")).toBe(true);
    expect(isPhotoCategory("nope")).toBe(false);
  });

  it("lists area tags once, sorted, including suggestions", () => {
    expect(
      areaTags([{ area: "Kitchen" }, { area: " kitchen" }, { area: null }], ["Back", ""]),
    ).toEqual(["Back", "Kitchen"]);
  });

  it("pairs a before and after from the same area when it can", () => {
    const photos = [
      { id: "b1", category: "before", area: "Front" },
      { id: "b2", category: "before", area: "Back" },
      { id: "a1", category: "after", area: "back" },
    ];
    expect(suggestPair(photos)).toEqual({ before: photos[1], after: photos[2] });
    expect(suggestPair([photos[0]!, { id: "a2", category: "after", area: null }])?.before.id).toBe(
      "b1",
    );
    expect(suggestPair([photos[0]!])).toBeNull();
  });

  it("formats sizes and fits images inside a box", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatBytes(-1)).toBe("—");
    expect(fitWithin(4000, 3000, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(800, 600, 2560)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 10, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe("documents", () => {
  it("maps tabs to categories and counts them", () => {
    expect(tabCategories("invoices")).toEqual(["invoice", "receipt"]);
    expect(tabCategories("all")).toEqual([]);
    const counts = tabCounts({ invoice: 2, receipt: 1, hoa: 1 });
    expect(counts.all).toBe(4);
    expect(counts.invoices).toBe(3);
    expect(counts.contracts).toBe(0);
    expect(DOCUMENT_TABS[0]?.id).toBe("all");
    expect(isDocumentTab("hoa")).toBe(true);
    expect(isDocumentTab("x")).toBe(false);
    expect(isDocumentCategory("lead_safe")).toBe(true);
    expect(isDocumentCategory("photo")).toBe(false);
  });

  it("checks uploads", () => {
    expect(uploadProblem({ name: "a.pdf", type: "application/pdf", size: 10 })).toBeNull();
    expect(uploadProblem({ name: " ", type: "application/pdf", size: 10 })).toMatch(/name/);
    expect(uploadProblem({ name: "a.exe", type: "application/x-msdownload", size: 10 })).toMatch(
      /isn't supported/,
    );
    expect(uploadProblem({ name: "a.pdf", type: "application/pdf", size: 0 })).toMatch(/empty/);
    expect(
      uploadProblem({ name: "a.pdf", type: "application/pdf", size: 26 * 1024 * 1024 }),
    ).toMatch(/25 MB/);
  });

  it("previews PDFs and common images only", () => {
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("image/png")).toBe("image");
    expect(previewKind("image/heic")).toBe("none");
    expect(previewKind("text/plain")).toBe("none");
  });

  it("names files and guesses categories", () => {
    expect(safeFileName("  HOA Approval (signed).PDF ")).toBe("hoa-approval-signed-.pdf");
    expect(safeFileName("///")).toBe("file");
    expect(titleFromFileName("hoa_approval-2026.pdf")).toBe("hoa approval 2026");
    expect(titleFromFileName(".pdf")).toBe("Document");
    expect(guessCategory("Lakeview HOA approval.pdf")).toBe("hoa");
    expect(guessCategory("Renovate Right acknowledgment.pdf")).toBe("lead_safe");
    expect(guessCategory("warranty.pdf")).toBe("warranty");
    expect(guessCategory("Receipt 12.jpg")).toBe("receipt");
    expect(guessCategory("invoice.pdf")).toBe("invoice");
    expect(guessCategory("change-order 2.pdf")).toBe("change_order");
    expect(guessCategory("signed contract.pdf")).toBe("contract");
    expect(guessCategory("colors.pdf")).toBe("color_sheet");
    expect(guessCategory("estimate.pdf")).toBe("proposal");
    expect(guessCategory("misc.txt")).toBe("other");
  });
});
