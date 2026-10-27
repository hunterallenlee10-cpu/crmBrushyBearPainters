import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { buildProposalSnapshot, priceVersion } from "@/lib/estimating/engine";
import { exteriorJob, interiorJob } from "@/lib/domain/estimating/fixtures";
import {
  buildProposalView,
  companyHeader,
  formatAddress,
  selectedOnly,
  type ProposalViewInput,
} from "@/lib/estimating/proposal-view";
import { ColorSheetDocument, InvoiceDocument } from "./other-documents";
import { ProposalDocument } from "./proposal-document";
import { renderPdf, pdfHeaders } from "./render";

const company = {
  company_name: "Brushy Bear Painters",
  tagline: "Eastside house painting that holds up to the rain.",
  phone: "[PHONE]",
  email: "[EMAIL]",
  hours_text: "[HOURS]",
  lni_number: "[LNI_NUMBER]",
  ubi_number: "[UBI_NUMBER]",
  website_url: "https://brushybear.vercel.app",
  on_time_guarantee_cents: 25000,
  estimate_sla_hours: 24,
};

function viewInput(): ProposalViewInput {
  const v = interiorJob();
  const snapshot = buildProposalSnapshot(v, priceVersion(v));
  return {
    company,
    customer: { firstName: "Sam", lastName: "Smith", accountName: "Smith Residence" },
    property: {
      street: "12 Lake St",
      unit: null,
      city: "Kirkland",
      state: "WA",
      zip: "98033",
      leadSafeRequired: true,
      hasHoa: true,
    },
    job: { number: "BB-2026-0001", name: "Smith – Kirkland – Interior" },
    document: { kind: "estimate", number: "EST-2026-0001", version: 1 },
    sentAt: "2026-10-27T17:00:00Z",
    expiresAt: "2026-11-26T17:00:00Z",
    pointOfContact: "Hunter Lee",
    snapshot,
    settings: {
      whatsIncluded: {
        interior: { status: "draft", items: ["furniture moved and covered"] },
        exterior: { status: "approved", items: ["washing siding and trim"] },
      },
      guarantees: [
        {
          key: "on_time_start",
          title: "On-time start",
          body: "Or take {{company.on_time_guarantee}} off.",
        },
        { key: "off", title: "Hidden", body: "", enabled: false },
      ],
      leadSafeDisclosure: null,
    },
    workTypeLabels: new Map([
      ["interior", "Interior"],
      ["exterior", "Exterior"],
    ]),
    templates: {
      proposal: {
        body: "# Proposal {{estimate.number}}\n\n[TERMS — owner]",
        status: "draft",
        clauses: [],
      },
      contract: {
        body: "# Contract\n\nTotal {{estimate.total}} for {{customer.name}}.",
        status: "published",
        clauses: [
          { title: "HOA approval", body: "[HOA_CLAUSE]", when: "hoa" },
          "bad",
          { title: "x" },
        ],
      },
    },
    customerNotes: null,
    selection: null,
    signature: null,
  };
}

describe("proposal view", () => {
  it("fills the header, inclusions, guarantees and templates", () => {
    const view = buildProposalView(viewInput());
    expect(view.company.placeholders).toEqual([
      "phone",
      "email",
      "hours",
      "L&I number",
      "UBI number",
    ]);
    expect(view.customer).toEqual({
      name: "Sam Smith",
      firstName: "Sam",
      address: "12 Lake St, Kirkland, WA 98033",
    });
    expect(view.inclusions.map((i) => [i.label, i.draft])).toEqual([
      ["Interior", true],
      ["Exterior", false],
    ]);
    expect(view.inclusions[0]?.items).toEqual(["Furniture moved and covered"]);
    expect(view.guarantees).toEqual([
      { key: "on_time_start", title: "On-time start", body: "Or take $250 off." },
    ]);
    expect(view.guaranteesDraft).toBe(false);
    const draftView = buildProposalView({
      ...viewInput(),
      settings: { ...viewInput().settings, guaranteesApproved: false },
    });
    expect(draftView.guaranteesDraft).toBe(true);
    expect(view.terms?.draft).toBe(true);
    expect(view.contract?.draft).toBe(false);
    expect(view.contract?.blocks).toContainEqual({
      kind: "paragraph",
      text: "Total $2,981.46 for Sam Smith.",
    });
    expect(view.contract?.blocks).toContainEqual({
      kind: "heading",
      level: 2,
      text: "HOA approval",
    });
    // No lead-safe lines in the interior fixture.
    expect(view.leadSafe).toBeNull();
  });

  it("shows the lead-safe disclosure for lead-safe work on a pre-1978 home", () => {
    const base = viewInput();
    const v = exteriorJob();
    const view = buildProposalView({
      ...base,
      snapshot: buildProposalSnapshot(v, priceVersion(v)),
      customer: { firstName: null, lastName: null, accountName: null },
      property: null,
      pointOfContact: null,
      templates: { proposal: null, contract: null },
    });
    expect(view.leadSafe).toBeNull(); // no property → not known to be pre-1978
    const withHome = buildProposalView({
      ...base,
      snapshot: buildProposalSnapshot(v, priceVersion(v)),
    });
    expect(withHome.leadSafe).toMatch(/1978/);
    expect(view.customer.name).toBe("Customer");
    expect(formatAddress(null)).toBeNull();
    expect(
      formatAddress({
        street: null,
        unit: null,
        city: null,
        state: null,
        zip: null,
        leadSafeRequired: false,
        hasHoa: false,
      }),
    ).toBeNull();
    expect(companyHeader({ ...company, phone: "425-555-0100" }).placeholders).not.toContain(
      "phone",
    );
  });

  it("keeps only the selected option and add-ons for the signed copy", () => {
    const base = buildProposalView(viewInput());
    expect(selectedOnly(base)).toBe(base);
    const selection = {
      optionId: base.snapshot.options[1]!.id,
      addOnIds: [],
      totals: base.snapshot.options[1]!.totals,
    };
    const signed = selectedOnly({ ...base, selection });
    expect(signed.snapshot.options.map((o) => o.id)).toEqual([selection.optionId]);
    expect(signed.snapshot.addOns).toEqual([]);
  });
});

describe("PDF rendering", () => {
  it("renders the proposal, the signed proposal + contract, a color sheet and an invoice", async () => {
    const view = buildProposalView(viewInput());
    const proposal = await renderPdf(createElement(ProposalDocument, { view }));
    expect(proposal.subarray(0, 5).toString()).toBe("%PDF-");

    const signedView = selectedOnly({
      ...view,
      selection: {
        optionId: view.snapshot.options[1]!.id,
        addOnIds: [view.snapshot.addOns[0]!.id],
        totals: view.snapshot.options[1]!.totals,
      },
      signature: {
        name: "Sam Smith",
        signedAt: "2026-10-28T18:00:00Z",
        ip: "203.0.113.9",
        userAgent: "test",
        png: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
    });
    const signed = await renderPdf(createElement(ProposalDocument, { view: signedView }));
    expect(signed.length).toBeGreaterThan(proposal.length / 2);

    const sheet = await renderPdf(
      createElement(ColorSheetDocument, {
        company: view.company,
        customerName: "Sam Smith",
        address: null,
        jobNumber: "BB-2026-0001",
        generatedAt: "2026-10-28T18:00:00Z",
        rows: [
          {
            area: "Living Room",
            surface: "Walls",
            brand: "Behr",
            colorName: "Soft Fern",
            colorCode: "X-1",
            sheen: "Eggshell",
            product: "Interior acrylic wall paint",
            notes: "Two coats",
            confirmed: true,
          },
        ],
      }),
    );
    expect(sheet.subarray(0, 5).toString()).toBe("%PDF-");
    const empty = await renderPdf(
      createElement(ColorSheetDocument, {
        company: view.company,
        customerName: "Sam Smith",
        address: "12 Lake St",
        jobNumber: "BB-2026-0001",
        generatedAt: "2026-10-28T18:00:00Z",
        rows: [],
      }),
    );
    expect(empty.length).toBeGreaterThan(500);

    const invoice = await renderPdf(
      createElement(InvoiceDocument, {
        company: view.company,
        customerName: "Sam Smith",
        address: "12 Lake St",
        invoiceNumber: "INV-2026-0001",
        invoiceType: "deposit",
        status: "draft",
        issueDate: "2026-10-28",
        dueDate: null,
        terms: null,
        jobNumber: "BB-2026-0001",
        lines: [{ description: "Deposit (30%)", quantity: 1, amountCents: 99944 }],
        subtotalCents: 99944,
        taxCents: 0,
        totalCents: 99944,
      }),
    );
    expect(invoice.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);

  it("names downloads safely", () => {
    expect(pdfHeaders("Signed proposal EST/1.pdf", "attachment")["Content-Disposition"]).toBe(
      'attachment; filename="Signed-proposal-EST-1.pdf"',
    );
  });
});
