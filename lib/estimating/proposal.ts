import "server-only";
import { createElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import {
  WORK_ORDER_PHASE_LABELS,
  buildPaintOrder,
  buildProposalSnapshot,
  priceVersion,
  buildWorkOrders,
  colorSelectionSeeds,
  describeLine,
  isContainer,
  onboardingRequirements,
  quoteSelection,
  type Container,
  type ProposalSnapshot,
  type QuoteTotals,
  type Unit,
  type WorkOrderPhase,
} from "@/lib/estimating/engine";
import { getStage, isJobStageId, type JobStageId } from "@/lib/domain/stages";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { advanceIfGatePasses } from "@/lib/jobs/stage";
import { logError } from "@/lib/log";
import { reverifyJob } from "@/lib/onboarding/checks";
import { ProposalDocument } from "@/lib/pdf/proposal-document";
import { renderPdf } from "@/lib/pdf/render";
import { storeGeneratedDocument } from "./documents";
import { buildVersionInput, loadPricingContext, loadVersionRows } from "./load";
import {
  buildProposalView,
  selectedOnly,
  type CompanyRow,
  type ProposalSignature,
  type ProposalView,
  type TemplateRow,
} from "./proposal-view";
import { hashProposalToken, isProposalToken, signatureHash } from "./tokens";

type Db = SupabaseClient<Database>;

/**
 * The customer side of BearSign (SPEC §7.5): load a proposal by its link,
 * record views, accept & sign (one database transaction, then the signed PDF
 * and the stage moves), or decline. Everything runs with the service client
 * because the customer has no login; the token is the credential.
 */

const COMPANY_COLUMNS =
  "company_name, tagline, phone, email, hours_text, lni_number, ubi_number, website_url, on_time_guarantee_cents, estimate_sla_hours";

/**
 * The database functions accept NULL for these arguments; the generated types
 * mark every argument without a default as required, so pass null through.
 */
function orNull(v: string | null | undefined): string {
  return (v ?? null) as string;
}

export class ProposalError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid" | "conflict" | "validation" = "validation",
  ) {
    super(message);
  }
}

function isSnapshot(v: unknown): v is ProposalSnapshot {
  return (
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as { options?: unknown }).options) &&
    Array.isArray((v as { addOns?: unknown }).addOns)
  );
}

function totalsOf(v: unknown): QuoteTotals | null {
  return v &&
    typeof v === "object" &&
    typeof (v as { totalCents?: unknown }).totalCents === "number"
    ? (v as QuoteTotals)
    : null;
}

export type JobContext = {
  job: {
    id: string;
    org_id: string;
    job_number: string;
    name: string;
    work_types: string[];
    stage: string;
    primary_contact_id: string | null;
    property_id: string | null;
    account_id: string;
    point_of_contact_id: string | null;
  };
  company: CompanyRow;
  settings: {
    whatsIncluded: unknown;
    guarantees: unknown;
    leadSafeDisclosure: string | null;
    guaranteesApproved: boolean;
  };
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
  pointOfContact: string | null;
  workTypeLabels: Map<string, string>;
  templates: {
    proposal: TemplateRow | null;
    contract: TemplateRow | null;
    changeOrder: TemplateRow | null;
  };
};

export async function loadJobContext(service: Db, jobId: string): Promise<JobContext | null> {
  const { data: job } = await service
    .from("jobs")
    .select(
      "id, org_id, job_number, name, work_types, stage, primary_contact_id, property_id, account_id, point_of_contact_id",
    )
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!job) return null;
  const [company, est, contact, account, property, poc, labels, templates] = await Promise.all([
    service.from("company_settings").select(COMPANY_COLUMNS).eq("org_id", job.org_id).maybeSingle(),
    service
      .from("estimate_settings")
      .select("whats_included, guarantees, guarantees_status, lead_safe_disclosure")
      .eq("org_id", job.org_id)
      .maybeSingle(),
    job.primary_contact_id
      ? service
          .from("contacts")
          .select("first_name, last_name")
          .eq("id", job.primary_contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    service.from("accounts").select("display_name").eq("id", job.account_id).maybeSingle(),
    job.property_id
      ? service
          .from("properties")
          .select("street, unit, city, state, zip, lead_safe_required, has_hoa")
          .eq("id", job.property_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    job.point_of_contact_id
      ? service.from("profiles").select("full_name").eq("id", job.point_of_contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    service
      .from("picklist_values")
      .select("value, label, picklists!inner(key, org_id)")
      .eq("picklists.key", "work_type")
      .eq("picklists.org_id", job.org_id),
    service
      .from("agreement_templates")
      .select("doc_type, body, status, clauses")
      .eq("org_id", job.org_id)
      .eq("is_default", true)
      .is("deleted_at", null),
  ]);
  if (!company.data) return null;
  const tpl = (type: string): TemplateRow | null => {
    const t = (templates.data ?? []).find((x) => x.doc_type === type);
    return t ? { body: t.body, status: t.status, clauses: t.clauses } : null;
  };
  const p = property.data;
  return {
    job,
    company: company.data,
    settings: {
      whatsIncluded: est.data?.whats_included ?? {},
      guarantees: est.data?.guarantees ?? [],
      guaranteesApproved: est.data?.guarantees_status === "approved",
      leadSafeDisclosure: est.data?.lead_safe_disclosure ?? null,
    },
    customer: {
      firstName: contact.data?.first_name ?? null,
      lastName: contact.data?.last_name ?? null,
      accountName: account.data?.display_name ?? null,
    },
    property: p
      ? {
          street: p.street,
          unit: p.unit,
          city: p.city,
          state: p.state,
          zip: p.zip,
          leadSafeRequired: p.lead_safe_required ?? false,
          hasHoa: p.has_hoa,
        }
      : null,
    pointOfContact: poc.data?.full_name ?? null,
    workTypeLabels: new Map((labels.data ?? []).map((v) => [v.value, v.label])),
    templates: {
      proposal: tpl("proposal"),
      contract: tpl("contract"),
      changeOrder: tpl("change_order"),
    },
  };
}

function toSignature(
  row: {
    signer_name: string;
    signed_at: string;
    ip: unknown;
    user_agent: string | null;
    signature_png: string;
  } | null,
): ProposalSignature | null {
  if (!row) return null;
  return {
    name: row.signer_name,
    signedAt: row.signed_at,
    ip: typeof row.ip === "string" ? row.ip : row.ip ? String(row.ip) : null,
    userAgent: row.user_agent,
    png: row.signature_png,
  };
}

export type EstimateViewData = {
  view: ProposalView;
  version: Database["public"]["Tables"]["estimate_versions"]["Row"];
  estimate: Database["public"]["Tables"]["estimates"]["Row"];
  job: JobContext["job"];
  signatureId: string | null;
  signatureDocumentId: string | null;
};

/**
 * The customer view of a sent (or accepted) estimate version. With
 * `previewDraft`, a draft is shown as it would be sent today (internal preview).
 */
export async function loadEstimateView(
  service: Db,
  versionId: string,
  opts: { previewDraft?: boolean } = {},
): Promise<EstimateViewData | null> {
  const { data: row } = await service
    .from("estimate_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle();
  if (!row) return null;
  let version = row;
  if (!isSnapshot(row.proposal)) {
    if (!opts.previewDraft || row.status !== "draft") return null;
    const rows = await loadVersionRows(service, versionId);
    if (!rows) return null;
    const input = buildVersionInput(rows, await loadPricingContext(service, row.org_id));
    const snapshot = buildProposalSnapshot(input, priceVersion(input));
    version = { ...row, proposal: JSON.parse(JSON.stringify(snapshot)) as Json };
  }
  if (!isSnapshot(version.proposal)) return null;
  const { data: estimate } = await service
    .from("estimates")
    .select("*")
    .eq("id", version.estimate_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!estimate) return null;
  const ctx = await loadJobContext(service, estimate.job_id);
  if (!ctx) return null;
  const { data: sig } = await service
    .from("signatures")
    .select("id, signer_name, signed_at, ip, user_agent, signature_png, document_id")
    .eq("estimate_version_id", versionId)
    .maybeSingle();
  const totals = totalsOf(version.accepted_totals);
  const view = buildProposalView({
    company: ctx.company,
    customer: ctx.customer,
    property: ctx.property,
    job: { number: ctx.job.job_number, name: ctx.job.name },
    document: { kind: "estimate", number: estimate.estimate_number, version: version.version_no },
    sentAt: version.sent_at,
    expiresAt: version.expires_at,
    pointOfContact: ctx.pointOfContact,
    snapshot: version.proposal,
    settings: ctx.settings,
    workTypeLabels: ctx.workTypeLabels,
    templates: { proposal: ctx.templates.proposal, contract: ctx.templates.contract },
    customerNotes: version.customer_notes,
    selection:
      version.accepted_option_id && totals
        ? { optionId: version.accepted_option_id, addOnIds: version.accepted_addon_ids, totals }
        : null,
    signature: toSignature(sig),
  });
  return {
    view,
    version,
    estimate,
    job: ctx.job,
    signatureId: sig?.id ?? null,
    signatureDocumentId: sig?.document_id ?? null,
  };
}

export type ChangeOrderViewData = {
  view: ProposalView;
  changeOrder: Database["public"]["Tables"]["change_orders"]["Row"];
  job: JobContext["job"];
  signatureId: string | null;
  signatureDocumentId: string | null;
};

export async function loadChangeOrderView(
  service: Db,
  coId: string,
): Promise<ChangeOrderViewData | null> {
  const { data: co } = await service
    .from("change_orders")
    .select("*")
    .eq("id", coId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!co || !isSnapshot(co.proposal)) return null;
  const ctx = await loadJobContext(service, co.job_id);
  if (!ctx) return null;
  const [{ data: sig }, { data: estimate }] = await Promise.all([
    service
      .from("signatures")
      .select("id, signer_name, signed_at, ip, user_agent, signature_png, document_id")
      .eq("change_order_id", coId)
      .maybeSingle(),
    co.estimate_id
      ? service.from("estimates").select("estimate_number").eq("id", co.estimate_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const snap = co.proposal as ProposalSnapshot & {
    changeOrder?: { beforeCents: number | null; afterCents: number | null };
  };
  const option = snap.options[0];
  const money = (c: number | null | undefined) =>
    typeof c === "number"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100)
      : null;
  const view = buildProposalView({
    company: ctx.company,
    customer: ctx.customer,
    property: ctx.property,
    job: { number: ctx.job.job_number, name: ctx.job.name },
    document: { kind: "change_order", number: co.change_order_number, version: null },
    sentAt: co.sent_at,
    expiresAt: co.expires_at,
    pointOfContact: ctx.pointOfContact,
    snapshot: snap,
    settings: { ...ctx.settings, guarantees: [] },
    workTypeLabels: ctx.workTypeLabels,
    templates: { proposal: ctx.templates.changeOrder, contract: null },
    customerNotes: co.reason,
    selection: option ? { optionId: option.id, addOnIds: [], totals: option.totals } : null,
    signature: toSignature(sig),
    extraValues: {
      "estimate.number": estimate?.estimate_number ?? null,
      "change_order.number": co.change_order_number,
      "change_order.reason": co.reason,
      "change_order.total": money(option?.totals.totalCents),
      "contract.total": money(snap.changeOrder?.afterCents),
    },
  });
  return {
    view: { ...view, inclusions: [] },
    changeOrder: co,
    job: ctx.job,
    signatureId: sig?.id ?? null,
    signatureDocumentId: sig?.document_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// The public page
// ---------------------------------------------------------------------------

export type PublicProposal =
  | { state: "invalid" }
  | { state: "replaced" }
  | {
      state: "open" | "expired" | "accepted" | "declined";
      kind: "estimate" | "change_order";
      view: ProposalView;
      hasSignedCopy: boolean;
    };

type Resolved = {
  token_id: string;
  org_id: string;
  job_id: string;
  estimate_version_id: string | null;
  change_order_id: string | null;
  expires_at: string;
  revoked: boolean;
  used_at: string | null;
  expired: boolean;
};

export async function resolveToken(service: Db, token: string): Promise<Resolved | null> {
  if (!isProposalToken(token)) return null;
  const { data, error } = await service.rpc("resolve_proposal_token", {
    p_token_hash: hashProposalToken(token),
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as unknown as Resolved;
}

/** Loads the proposal for a link (no side effects). */
export async function loadPublicProposal(service: Db, token: string): Promise<PublicProposal> {
  const t = await resolveToken(service, token);
  if (!t) return { state: "invalid" };
  if (t.revoked) return { state: "replaced" };
  if (t.estimate_version_id) {
    const data = await loadEstimateView(service, t.estimate_version_id);
    if (!data) return { state: "invalid" };
    const s = data.version.status;
    const state =
      s === "accepted"
        ? "accepted"
        : s === "declined"
          ? "declined"
          : s === "expired" || t.expired
            ? "expired"
            : s === "sent" || s === "viewed"
              ? "open"
              : "invalid";
    if (state === "invalid") return { state };
    return { state, kind: "estimate", view: data.view, hasSignedCopy: !!data.signatureDocumentId };
  }
  if (t.change_order_id) {
    const data = await loadChangeOrderView(service, t.change_order_id);
    if (!data) return { state: "invalid" };
    const s = data.changeOrder.status;
    const state =
      s === "signed"
        ? "accepted"
        : s === "declined"
          ? "declined"
          : t.expired
            ? "expired"
            : s === "sent"
              ? "open"
              : "invalid";
    if (state === "invalid") return { state };
    return {
      state,
      kind: "change_order",
      view: data.view,
      hasSignedCopy: !!data.signatureDocumentId,
    };
  }
  return { state: "invalid" };
}

/** Records a customer view (first view marks the estimate viewed). */
export async function recordView(service: Db, token: string): Promise<void> {
  if (!isProposalToken(token)) return;
  const { error } = await service.rpc("record_proposal_view", {
    p_token_hash: hashProposalToken(token),
  });
  if (error && error.code !== "P0002") logError("proposal.view", error);
}

// ---------------------------------------------------------------------------
// Accept & sign
// ---------------------------------------------------------------------------

export type AcceptInput = {
  token: string;
  optionId: string;
  addOnIds: readonly string[];
  signerName: string;
  signerEmail: string | null;
  signaturePng: string;
  consent: string;
  ip: string | null;
  userAgent: string | null;
};

type LineRow = Database["public"]["Tables"]["estimate_line_items"]["Row"];

function containersOf(ids: readonly string[] | undefined): Container[] {
  return (ids ?? []).filter(isContainer) as Container[];
}

/** The accepted lines → onboarding rows, paint order, work orders and color rows. */
export async function buildAcceptOutputs(
  service: Db,
  input: {
    lines: LineRow[];
    areaNames: Map<string, { name: string; workType: string | null }>;
    jobWorkTypes: readonly string[];
    jobName: string;
    hasHoa: boolean;
    depositCents: number;
    orgId: string;
  },
): Promise<Record<string, Json>> {
  const productIds = [
    ...new Set(
      input.lines
        .flatMap((l) => [l.paint_product_id, l.primer_product_id])
        .filter((x): x is string => !!x),
    ),
  ];
  const [{ data: products }, { data: brands }] = await Promise.all([
    productIds.length
      ? service
          .from("paint_products")
          .select("id, brand, product, containers, cost_per_gal_cents")
          .in("id", productIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            brand: string;
            product: string;
            containers: string[];
            cost_per_gal_cents: number;
          }[],
        }),
    service
      .from("picklist_values")
      .select("value, label, picklists!inner(key, org_id)")
      .eq("picklists.key", "paint_brand")
      .eq("picklists.org_id", input.orgId),
  ]);
  const brandLabel = new Map((brands ?? []).map((b) => [b.value, b.label]));
  const prod = new Map((products ?? []).map((p) => [p.id, p]));
  const label = (id: string | null) => {
    const p = id ? prod.get(id) : undefined;
    return p ? `${brandLabel.get(p.brand) ?? p.brand} ${p.product}` : null;
  };

  const workTypes = new Set<string>(input.jobWorkTypes);
  for (const l of input.lines) if (l.work_type) workTypes.add(l.work_type);
  for (const a of input.areaNames.values()) if (a.workType) workTypes.add(a.workType);

  const describe = (l: LineRow) =>
    describeLine({
      name: l.name,
      quantity: Number(l.quantity),
      unit: l.unit as Unit,
      kind: l.kind === "flat" ? "flat" : "production_rate",
    });

  const paintOrder = buildPaintOrder(
    input.lines.map((l) => {
      const p = l.paint_product_id ? prod.get(l.paint_product_id) : undefined;
      const pr = l.primer_product_id ? prod.get(l.primer_product_id) : undefined;
      return {
        productId: l.paint_product_id,
        productLabel: label(l.paint_product_id),
        containers: containersOf(p?.containers),
        costPerGalCents: Number(p?.cost_per_gal_cents ?? 0),
        sheen: l.sheen,
        gallonsNeeded: Number(l.gallons_needed ?? 0),
        primerProductId: l.primer_product_id,
        primerProductLabel: label(l.primer_product_id),
        primerContainers: containersOf(pr?.containers),
        primerCostPerGalCents: Number(pr?.cost_per_gal_cents ?? 0),
        primerGallonsNeeded: Number(l.primer_gallons_needed ?? 0),
        sundriesCents: Number(l.sundries_cents ?? 0),
      };
    }),
  );
  const workOrders = buildWorkOrders(
    input.lines.map((l) => ({
      description: `${l.area_id ? `${input.areaNames.get(l.area_id)?.name ?? ""}: ` : ""}${describe(l)}`,
      workType:
        l.work_type ?? (l.area_id ? (input.areaNames.get(l.area_id)?.workType ?? null) : null),
      phase: (l.work_order_phase as WorkOrderPhase | null) ?? null,
      laborHours: Number(l.labor_hours ?? 0),
      prepHours: Number(l.prep_hours ?? 0),
    })),
  ).map((w) => ({
    ...w,
    title: `${WORK_ORDER_PHASE_LABELS[w.phase]} – ${input.jobName}`.slice(0, 160),
  }));
  const colors = colorSelectionSeeds(
    input.lines.map((l) => ({
      lineId: l.id,
      areaName: l.area_id ? (input.areaNames.get(l.area_id)?.name ?? null) : null,
      surface: l.name,
      productId: l.paint_product_id,
      brand: l.paint_product_id ? (prod.get(l.paint_product_id)?.brand ?? null) : null,
      sheen: l.sheen,
      paints: l.kind === "production_rate" && Number(l.paint_sqft_per_unit ?? 0) > 0,
    })),
  );
  const onboarding = onboardingRequirements({
    workTypes: [...workTypes],
    hasHoa: input.hasHoa,
    leadSafeWork: input.lines.some((l) => l.lead_safe),
    hasRepairAllowance: input.lines.some((l) => l.is_repair_allowance),
    hasColorConsult: input.lines.some((l) => l.catalog_code === "color_consultation"),
    depositCents: input.depositCents,
  });
  return JSON.parse(JSON.stringify({ onboarding, paintOrder, workOrders, colors })) as Record<
    string,
    Json
  >;
}

export async function acceptProposal(
  service: Db,
  input: AcceptInput,
): Promise<{ kind: "estimate" | "change_order"; jobId: string; id: string }> {
  const t = await resolveToken(service, input.token);
  if (!t || t.revoked) throw new ProposalError("This link isn't valid anymore.", "invalid");
  const hash = hashProposalToken(input.token);
  const sigHash = signatureHash(input.signaturePng);

  if (t.change_order_id) {
    return acceptChangeOrderLink(service, t, hash, sigHash, input);
  }
  if (!t.estimate_version_id) throw new ProposalError("This link isn't valid.", "invalid");
  const { data: version } = await service
    .from("estimate_versions")
    .select("id, estimate_id, proposal, status")
    .eq("id", t.estimate_version_id)
    .maybeSingle();
  if (!version || !isSnapshot(version.proposal))
    throw new ProposalError("This proposal isn't available.", "invalid");
  const quote = quoteSelection(version.proposal, {
    optionId: input.optionId,
    addOnIds: input.addOnIds,
  });
  if (!quote) throw new ProposalError("Pick one of the options on the proposal.");

  const [{ data: lines }, { data: areas }, { data: job }] = await Promise.all([
    service.from("estimate_line_items").select("*").eq("version_id", version.id),
    service.from("estimate_areas").select("id, name, work_type").eq("version_id", version.id),
    service
      .from("jobs")
      .select("id, org_id, name, work_types, property_id")
      .eq("id", t.job_id)
      .maybeSingle(),
  ]);
  if (!job) throw new ProposalError("This proposal isn't available.", "invalid");
  const wanted = new Set(input.addOnIds);
  const included = (lines ?? []).filter(
    (l) => l.option_id === input.optionId || (l.is_optional && wanted.has(l.id)),
  );
  const { data: property } = job.property_id
    ? await service.from("properties").select("has_hoa").eq("id", job.property_id).maybeSingle()
    : { data: null };
  const outputs = await buildAcceptOutputs(service, {
    lines: included,
    areaNames: new Map((areas ?? []).map((a) => [a.id, { name: a.name, workType: a.work_type }])),
    jobWorkTypes: job.work_types,
    jobName: job.name,
    hasHoa: property?.has_hoa ?? false,
    depositCents: quote.totals.depositCents,
    orgId: job.org_id,
  });
  const totals = {
    ...quote.totals,
    depositPercent: version.proposal.terms.depositPercent,
  };
  const { data, error } = await service.rpc("accept_estimate", {
    p_token_hash: hash,
    p_option: input.optionId,
    p_addons: [...input.addOnIds],
    p_signer_name: input.signerName,
    p_signer_email: orNull(input.signerEmail),
    p_signature_png: input.signaturePng,
    p_signature_sha256: sigHash,
    p_consent: input.consent,
    p_ip: orNull(input.ip),
    p_user_agent: orNull(input.userAgent),
    p_totals: JSON.parse(JSON.stringify(totals)),
    p_outputs: outputs,
  });
  if (error)
    throw new ProposalError(
      error.message.length <= 200 ? error.message : "That didn't work.",
      error.code === "23505" ? "conflict" : "validation",
    );
  const result = data as { estimate_id?: string } | null;
  const estimateId = result?.estimate_id ?? version.estimate_id;
  await completeAcceptance(service, estimateId).catch((e: unknown) =>
    logError("proposal.accept.complete", e),
  );
  return { kind: "estimate", jobId: job.id, id: estimateId };
}

async function acceptChangeOrderLink(
  service: Db,
  t: Resolved,
  hash: string,
  sigHash: string,
  input: AcceptInput,
): Promise<{ kind: "change_order"; jobId: string; id: string }> {
  const coId = t.change_order_id as string;
  const [{ data: lines }, { data: job }] = await Promise.all([
    service.from("estimate_line_items").select("*").eq("change_order_id", coId),
    service.from("jobs").select("id, org_id, name, work_types").eq("id", t.job_id).maybeSingle(),
  ]);
  if (!job) throw new ProposalError("This change order isn't available.", "invalid");
  const outputs = await buildAcceptOutputs(service, {
    lines: (lines ?? []).filter((l) => !l.is_credit),
    areaNames: new Map(),
    jobWorkTypes: [],
    jobName: job.name,
    hasHoa: false,
    depositCents: 0,
    orgId: job.org_id,
  });
  const { error } = await service.rpc("accept_change_order", {
    p_token_hash: hash,
    p_signer_name: input.signerName,
    p_signer_email: orNull(input.signerEmail),
    p_signature_png: input.signaturePng,
    p_signature_sha256: sigHash,
    p_consent: input.consent,
    p_ip: orNull(input.ip),
    p_user_agent: orNull(input.userAgent),
    p_outputs: { colors: outputs.colors ?? [], workOrders: outputs.workOrders ?? [] },
  });
  if (error)
    throw new ProposalError(
      error.message.length <= 200 ? error.message : "That didn't work.",
      error.code === "23505" ? "conflict" : "validation",
    );
  await completeChangeOrder(service, coId).catch((e: unknown) =>
    logError("proposal.co.complete", e),
  );
  return { kind: "change_order", jobId: job.id, id: coId };
}

export async function declineProposal(
  service: Db,
  token: string,
  reason: string | null,
): Promise<void> {
  if (!isProposalToken(token)) throw new ProposalError("This link isn't valid.", "invalid");
  const { error } = await service.rpc("decline_proposal", {
    p_token_hash: hashProposalToken(token),
    p_reason: orNull(reason),
  });
  if (error)
    throw new ProposalError(error.message.length <= 200 ? error.message : "That didn't work.");
}

// ---------------------------------------------------------------------------
// After acceptance (idempotent: the worker retries it on estimate.accepted)
// ---------------------------------------------------------------------------

const AUTO_STEPS: [JobStageId, JobStageId][] = [
  ["walkthrough_complete", "estimate_sent"],
  ["estimate_sent", "sold"],
  ["sold", "onboarding"],
];

/** Moves the job through the gates the acceptance just satisfied (never overrides). */
export async function advanceAfterAcceptance(
  service: Db,
  jobId: string,
): Promise<JobStageId | null> {
  const { data: job } = await service.from("jobs").select("stage").eq("id", jobId).maybeSingle();
  if (!job || !isJobStageId(job.stage)) return null;
  let stage: JobStageId = job.stage;
  for (const [from, to] of AUTO_STEPS) {
    if (stage !== from) continue;
    if (!(await advanceIfGatePasses(service, jobId, from, to))) break;
    stage = to;
  }
  return stage;
}

/** Signed proposal + contract PDF stored in Documents, then the stage moves. */
export async function completeAcceptance(
  service: Db,
  estimateId: string,
): Promise<{
  documentId: string | null;
  stage: JobStageId | null;
}> {
  const { data: estimate } = await service
    .from("estimates")
    .select("id, job_id, org_id, status, accepted_version_id, estimate_number")
    .eq("id", estimateId)
    .maybeSingle();
  if (!estimate || estimate.status !== "accepted" || !estimate.accepted_version_id) {
    return { documentId: null, stage: null };
  }
  const data = await loadEstimateView(service, estimate.accepted_version_id);
  let documentId = data?.signatureDocumentId ?? null;
  if (data && data.signatureId && !documentId) {
    const bytes = await renderPdf(
      createElement(ProposalDocument, { view: selectedOnly(data.view) }),
    );
    const stored = await storeGeneratedDocument(service, {
      orgId: estimate.org_id,
      jobId: estimate.job_id,
      category: "contract",
      title: `Signed proposal & contract ${estimate.estimate_number}`,
      fileName: `${estimate.estimate_number}-signed.pdf`,
      bytes,
      status: "signed",
      relatedType: "estimate_version",
      relatedId: estimate.accepted_version_id,
      signatureId: data.signatureId,
      customerVisible: true,
    });
    const { error } = await service.rpc("attach_signed_document", {
      p_signature: data.signatureId,
      p_document: stored.id,
    });
    if (error) throw error;
    documentId = stored.id;
  }
  let stage = await advanceAfterAcceptance(service, estimate.job_id);
  // First onboarding check right away (it may clear items and, rarely, the gate).
  try {
    const r = await reverifyJob(service, estimate.job_id);
    if (r.advanced) stage = "ready_to_schedule";
  } catch (e) {
    logError("proposal.accept.onboarding", e);
  }
  await recomputeJobHealth(service, [estimate.job_id]).catch((e: unknown) =>
    logError("proposal.accept.health", e),
  );
  return { documentId, stage };
}

export async function completeChangeOrder(
  service: Db,
  coId: string,
): Promise<{ documentId: string | null }> {
  const data = await loadChangeOrderView(service, coId);
  if (!data || data.changeOrder.status !== "signed" || !data.signatureId)
    return { documentId: null };
  if (data.signatureDocumentId) return { documentId: data.signatureDocumentId };
  const bytes = await renderPdf(createElement(ProposalDocument, { view: data.view }));
  const stored = await storeGeneratedDocument(service, {
    orgId: data.job.org_id,
    jobId: data.job.id,
    category: "change_order",
    title: `Signed change order ${data.changeOrder.change_order_number}`,
    fileName: `${data.changeOrder.change_order_number}-signed.pdf`,
    bytes,
    status: "signed",
    relatedType: "change_order",
    relatedId: coId,
    signatureId: data.signatureId,
    customerVisible: true,
  });
  const { error } = await service.rpc("attach_signed_document", {
    p_signature: data.signatureId,
    p_document: stored.id,
  });
  if (error) throw error;
  await reverifyJob(service, data.job.id).catch((e: unknown) =>
    logError("proposal.co.onboarding", e),
  );
  await recomputeJobHealth(service, [data.job.id]).catch((e: unknown) =>
    logError("proposal.co.health", e),
  );
  return { documentId: stored.id };
}

/** For staff screens: "Sold → Onboarding" style label. */
export function stageLabel(stage: string | null): string | null {
  return stage && isJobStageId(stage) ? getStage(stage).label : null;
}
