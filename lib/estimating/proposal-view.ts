import {
  INCLUSION_WORK_TYPES,
  applicableClauses,
  parseGuarantees,
  parseInclusions,
  renderMergeFields,
  sentenceCase,
  templateBlocks,
  type InclusionWorkType,
  type MergeValues,
  type ProposalSnapshot,
  type QuoteTotals,
  type TemplateBlock,
} from "@/lib/estimating/engine";
import { isPlaceholder } from "@/lib/domain/company-settings";
import { formatDate } from "@/lib/format/dates";
import { formatCents } from "@/lib/format/money";

/**
 * Everything the customer sees on the proposal page and in the PDFs (SPEC
 * §7.5): company header from Company Settings (placeholders shown as they are
 * until the owners fill them in), scope by area, options and add-ons, what's
 * included, guarantees, terms, the lead-safe disclosure when it applies, and
 * the signature once signed. Pure: the loaders pass the rows in.
 */

export type CompanyHeader = {
  name: string;
  tagline: string | null;
  phone: string;
  email: string;
  hours: string;
  lniNumber: string;
  ubiNumber: string;
  website: string | null;
  onTimeGuaranteeCents: number;
  estimateSlaHours: number;
  /** Fields still showing a placeholder like [PHONE]. */
  placeholders: string[];
};

export type ProposalSignature = {
  name: string;
  signedAt: string;
  ip: string | null;
  userAgent: string | null;
  png: string;
};

export type ProposalView = {
  company: CompanyHeader;
  customer: { name: string; firstName: string | null; address: string | null };
  job: { number: string; name: string };
  document: { kind: "estimate" | "change_order"; number: string; version: number | null };
  sentAt: string | null;
  expiresAt: string | null;
  pointOfContact: string | null;
  snapshot: ProposalSnapshot;
  inclusions: { workType: InclusionWorkType; label: string; items: string[]; draft: boolean }[];
  guarantees: { key: string; title: string; body: string }[];
  terms: { blocks: TemplateBlock[]; draft: boolean } | null;
  contract: { blocks: TemplateBlock[]; draft: boolean } | null;
  leadSafe: string | null;
  customerNotes: string | null;
  selection: { optionId: string; addOnIds: string[]; totals: QuoteTotals } | null;
  signature: ProposalSignature | null;
};

export type CompanyRow = {
  company_name: string;
  tagline: string | null;
  phone: string;
  email: string;
  hours_text: string;
  lni_number: string;
  ubi_number: string;
  website_url: string | null;
  on_time_guarantee_cents: number;
  estimate_sla_hours: number;
};

export function companyHeader(c: CompanyRow): CompanyHeader {
  const placeholders = (
    [
      ["phone", c.phone],
      ["email", c.email],
      ["hours", c.hours_text],
      ["L&I number", c.lni_number],
      ["UBI number", c.ubi_number],
    ] as const
  )
    .filter(([, v]) => isPlaceholder(v))
    .map(([k]) => k);
  return {
    name: c.company_name,
    tagline: c.tagline,
    phone: c.phone,
    email: c.email,
    hours: c.hours_text,
    lniNumber: c.lni_number,
    ubiNumber: c.ubi_number,
    website: c.website_url,
    onTimeGuaranteeCents: Number(c.on_time_guarantee_cents),
    estimateSlaHours: c.estimate_sla_hours,
    placeholders,
  };
}

export type TemplateRow = {
  body: string;
  status: string;
  clauses: unknown;
};

function clauseList(raw: unknown): { title: string; body: string; when: string | null }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const o = c as Record<string, unknown>;
    if (typeof o.body !== "string") return [];
    return [
      {
        title: typeof o.title === "string" ? o.title : "",
        body: o.body,
        when: typeof o.when === "string" ? o.when : null,
      },
    ];
  });
}

/** Renders a template body (plus the clauses that apply) into display blocks. */
export function renderTemplate(
  t: TemplateRow | null,
  values: MergeValues,
  conditions: { leadSafe: boolean; hoa: boolean },
): { blocks: TemplateBlock[]; draft: boolean } | null {
  if (!t) return null;
  const clauses = applicableClauses(clauseList(t.clauses), conditions)
    .map((c) => (c.title ? `## ${c.title}\n${c.body}` : c.body))
    .join("\n\n");
  const body = clauses ? `${t.body}\n\n${clauses}` : t.body;
  return {
    blocks: templateBlocks(renderMergeFields(body, values)),
    draft: t.status !== "published",
  };
}

export type ProposalViewInput = {
  company: CompanyRow;
  customer: { firstName: string | null; lastName: string | null; accountName: string | null };
  property: {
    street: string | null;
    unit: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    leadSafeRequired: boolean;
    hasHoa: boolean;
  } | null;
  job: { number: string; name: string };
  document: ProposalView["document"];
  sentAt: string | null;
  expiresAt: string | null;
  pointOfContact: string | null;
  snapshot: ProposalSnapshot;
  settings: { whatsIncluded: unknown; guarantees: unknown; leadSafeDisclosure: string | null };
  workTypeLabels: ReadonlyMap<string, string>;
  templates: { proposal: TemplateRow | null; contract: TemplateRow | null };
  customerNotes: string | null;
  selection: ProposalView["selection"];
  signature: ProposalSignature | null;
  /** Extra merge values (change order fields, contract totals). */
  extraValues?: MergeValues;
};

export function formatAddress(p: ProposalViewInput["property"]): string | null {
  if (!p) return null;
  const line1 = [p.street, p.unit].filter(Boolean).join(" ");
  const line2 = [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const s = [line1, line2].filter(Boolean).join(", ");
  return s || null;
}

export function buildProposalView(i: ProposalViewInput): ProposalView {
  const company = companyHeader(i.company);
  const name =
    [i.customer.firstName, i.customer.lastName].filter(Boolean).join(" ") ||
    i.customer.accountName ||
    "Customer";
  const address = formatAddress(i.property);
  const inc = parseInclusions(i.settings.whatsIncluded);
  const inclusions = INCLUSION_WORK_TYPES.filter((wt) => i.snapshot.workTypes.includes(wt))
    .map((wt) => ({
      workType: wt,
      label: i.workTypeLabels.get(wt) ?? wt,
      items: inc[wt].items.map(sentenceCase),
      draft: inc[wt].status !== "approved",
    }))
    .filter((x) => x.items.length > 0);

  const totals =
    i.selection?.totals ??
    (i.snapshot.options.find((o) => o.isRecommended) ?? i.snapshot.options[0])?.totals ??
    null;
  const values: MergeValues = {
    "company.name": company.name,
    "company.phone": company.phone,
    "company.email": company.email,
    "company.lni_number": company.lniNumber,
    "company.ubi_number": company.ubiNumber,
    "company.on_time_guarantee": formatCents(company.onTimeGuaranteeCents).replace(/\.00$/, ""),
    "company.estimate_sla_hours": String(company.estimateSlaHours),
    "customer.name": name,
    "property.address": address,
    "job.number": i.job.number,
    "job.point_of_contact": i.pointOfContact ?? "Your project lead",
    "estimate.number": i.document.kind === "estimate" ? i.document.number : null,
    "estimate.total": totals ? formatCents(totals.totalCents) : null,
    "estimate.deposit": totals ? formatCents(totals.depositCents) : null,
    "estimate.expires": i.expiresAt ? formatDate(i.expiresAt) : null,
    ...i.extraValues,
  };
  const guarantees = parseGuarantees(i.settings.guarantees)
    .filter((g) => g.enabled)
    .map((g) => ({ key: g.key, title: g.title, body: renderMergeFields(g.body, values) }));
  const conditions = {
    leadSafe: i.snapshot.leadSafe || (i.property?.leadSafeRequired ?? false),
    hoa: i.property?.hasHoa ?? false,
  };
  return {
    company,
    customer: { name, firstName: i.customer.firstName, address },
    job: i.job,
    document: i.document,
    sentAt: i.sentAt,
    expiresAt: i.expiresAt,
    pointOfContact: i.pointOfContact,
    snapshot: i.snapshot,
    inclusions,
    guarantees,
    terms: renderTemplate(i.templates.proposal, values, conditions),
    contract: renderTemplate(i.templates.contract, values, conditions),
    leadSafe:
      i.snapshot.leadSafe && i.property?.leadSafeRequired
        ? (i.settings.leadSafeDisclosure ?? "Homes built before 1978 get lead-safe prep.")
        : null,
    customerNotes: i.customerNotes,
    selection: i.selection,
    signature: i.signature,
  };
}

/** The proposal with only what the customer picked (signed PDF). */
export function selectedOnly(view: ProposalView): ProposalView {
  if (!view.selection) return view;
  const sel = view.selection;
  return {
    ...view,
    snapshot: {
      ...view.snapshot,
      options: view.snapshot.options.filter((o) => o.id === sel.optionId),
      addOns: view.snapshot.addOns.filter((a) => sel.addOnIds.includes(a.id)),
    },
  };
}
