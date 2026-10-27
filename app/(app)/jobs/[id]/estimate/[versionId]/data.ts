import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { Viewer } from "@/lib/auth/viewer";
import {
  describeLine,
  discountLimitFor,
  parseDiscountLimits,
  priceVersion,
  type OptionSummary,
  type Unit,
} from "@/lib/estimating/engine";
import { buildVersionInput, loadPricingContext, loadVersionRows } from "@/lib/estimating/load";
import { productLabel } from "@/lib/estimating/map";
import { defaultEstimateMessages } from "@/lib/estimating/messages";

type Db = SupabaseClient<Database>;

/**
 * Everything the Estimate Builder shows, loaded with the person's own client
 * (row security decides what they see). Drafts are priced live with today's
 * catalog; sent versions show what was frozen when they went out.
 */

export type BuilderIssue = { severity: "error" | "warning"; message: string };

export type BuilderLine = {
  id: string;
  optionId: string | null;
  areaId: string | null;
  isOptional: boolean;
  kind: "production_rate" | "flat";
  name: string;
  unit: Unit;
  surface: string | null;
  catalogCode: string | null;
  quantity: number;
  sides: number;
  condition: string;
  prepLevel: string;
  coats: number;
  primer: string;
  colorChange: string;
  method: string;
  access: string;
  height: string;
  sheen: string | null;
  productId: string | null;
  primerProductId: string | null;
  leadSafe: boolean;
  taxable: boolean;
  isRepairAllowance: boolean;
  unitPriceCents: number | null;
  unitCostCents: number | null;
  overridePriceCents: number | null;
  overrideReason: string | null;
  customerNote: string | null;
  laborHours: number | null;
  gallons: number | null;
  primerGallons: number | null;
  costCents: number | null;
  computedPriceCents: number | null;
  priceCents: number | null;
  description: string;
  issues: BuilderIssue[];
};

export type OptionTotals = {
  optionId: string;
  summary: OptionSummary;
  withAllAddOns: OptionSummary;
};

export type BuilderData = {
  job: { id: string; number: string; name: string; leadSafeRequired: boolean; stage: string };
  estimate: { id: string; number: string; title: string | null; status: string };
  version: {
    id: string;
    versionNo: number;
    status: string;
    discountType: "amount" | "percent" | null;
    discountValue: number | null;
    discountReason: string | null;
    depositPercent: number | null;
    customerNotes: string | null;
    internalNotes: string | null;
    sentAt: string | null;
    viewedAt: string | null;
    expiresAt: string | null;
    acceptedAt: string | null;
    acceptedOptionId: string | null;
    discountApprovedPercent: number | null;
  };
  versions: { id: string; versionNo: number; status: string; sentAt: string | null }[];
  options: { id: string; name: string; description: string | null; isRecommended: boolean }[];
  areas: { id: string; optionId: string; name: string; workType: string | null }[];
  lines: BuilderLine[];
  totals: OptionTotals[];
  issues: BuilderIssue[];
  sendable: boolean;
  maxDiscountPercent: number;
  catalog: {
    id: string;
    code: string;
    name: string;
    family: string;
    unit: string;
    itemType: string;
    pricingMethod: string;
    isSample: boolean;
  }[];
  products: {
    id: string;
    label: string;
    use: string;
    sheens: string[];
    isPrimer: boolean;
    isSample: boolean;
  }[];
  sheens: { value: string; label: string }[];
  workTypes: { value: string; label: string }[];
  settings: {
    isSample: boolean;
    depositPercent: number;
    marginFloorPercent: number;
    doorDeductionSqft: number;
    windowDeductionSqft: number;
    gableFactor: number;
    taxRatePercent: number;
    taxConfirmed: boolean;
  };
  limitPercent: number | null;
  pendingApproval: { id: string; percent: number | null } | null;
  contact: { name: string; mobile: string | null; email: string | null } | null;
  messages: { sms: string; emailSubject: string; emailBody: string };
  can: { edit: boolean; send: boolean; approve: boolean };
};

function issuesOf(raw: unknown): BuilderIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((i) => {
    if (!i || typeof i !== "object") return [];
    const o = i as Record<string, unknown>;
    if (typeof o.message !== "string") return [];
    return [{ severity: o.severity === "error" ? "error" : "warning", message: o.message }];
  });
}

function storedTotals(raw: unknown): OptionTotals[] {
  if (!raw || typeof raw !== "object") return [];
  const opts = (raw as { options?: unknown }).options;
  if (!Array.isArray(opts)) return [];
  return opts.flatMap((o) => {
    if (!o || typeof o !== "object") return [];
    const r = o as { id?: unknown; summary?: unknown; withAllAddOns?: unknown };
    if (typeof r.id !== "string" || !r.summary || !r.withAllAddOns) return [];
    return [
      {
        optionId: r.id,
        summary: r.summary as OptionSummary,
        withAllAddOns: r.withAllAddOns as OptionSummary,
      },
    ];
  });
}

export async function loadBuilderData(
  supabase: Db,
  viewer: Viewer,
  jobId: string,
  versionId: string,
): Promise<BuilderData | null> {
  const rows = await loadVersionRows(supabase, versionId);
  if (!rows || rows.estimate.job_id !== jobId) return null;
  const orgId = rows.version.org_id;
  const [job, versions, catalog, ctx, settingsRow, approval, workTypes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, job_number, name, stage, team_user_ids, property:properties(lead_safe_required), contact:contacts!jobs_primary_contact_id_fkey(first_name, last_name, mobile, email)",
      )
      .eq("id", jobId)
      .maybeSingle(),
    supabase
      .from("estimate_versions")
      .select("id, version_no, status, sent_at")
      .eq("estimate_id", rows.estimate.id)
      .order("version_no", { ascending: false }),
    supabase
      .from("catalog_items")
      .select(
        "id, code, name, family, unit, item_type, pricing_method, is_sample, sort_order, price_books!inner(is_default, active)",
      )
      .eq("active", true)
      .eq("price_books.is_default", true)
      .order("family")
      .order("sort_order"),
    loadPricingContext(supabase, orgId),
    supabase.from("estimate_settings").select("discount_limits").eq("org_id", orgId).maybeSingle(),
    supabase
      .from("approval_requests")
      .select("id, payload")
      .eq("job_id", jobId)
      .eq("type", "estimate_discount")
      .eq("status", "pending")
      .maybeSingle(),
    supabase
      .from("picklist_values")
      .select("value, label, sort_order, picklists!inner(key)")
      .eq("picklists.key", "work_type")
      .eq("active", true)
      .order("sort_order"),
  ]);
  if (!job.data) return null;

  const draft = rows.version.status === "draft";
  const input = buildVersionInput(rows, ctx);
  const priced = priceVersion(input);
  const fresh = new Map(priced.lines.map((l) => [l.line.id, l]));
  const sheenLabels = ctx.lookups.sheenLabels;

  const lines: BuilderLine[] = rows.lines.map((r) => {
    const f = fresh.get(r.id);
    const unit = (f?.line.unit ?? r.unit) as Unit;
    const live = draft && f;
    return {
      id: r.id,
      optionId: r.option_id,
      areaId: r.area_id,
      isOptional: r.is_optional,
      kind: r.kind === "flat" ? "flat" : "production_rate",
      name: r.name,
      unit,
      surface: r.surface,
      catalogCode: r.catalog_code,
      quantity: Number(r.quantity),
      sides: r.sides,
      condition: r.condition,
      prepLevel: r.prep_level,
      coats: r.coats,
      primer: r.primer,
      colorChange: r.color_change,
      method: r.method,
      access: r.access,
      height: r.height,
      sheen: r.sheen,
      productId: r.paint_product_id,
      primerProductId: r.primer_product_id,
      leadSafe: r.lead_safe,
      taxable: r.taxable,
      isRepairAllowance: r.is_repair_allowance,
      unitPriceCents: r.unit_price_cents,
      unitCostCents: r.unit_cost_cents,
      overridePriceCents: r.override_price_cents,
      overrideReason: r.override_reason,
      customerNote: r.customer_note,
      laborHours: live
        ? f.priced.laborHours
        : r.labor_hours === null
          ? null
          : Number(r.labor_hours),
      gallons: live ? f.priced.gallons : r.gallons === null ? null : Number(r.gallons),
      primerGallons: live
        ? f.priced.primerGallons
        : r.primer_gallons === null
          ? null
          : Number(r.primer_gallons),
      costCents: live ? f.priced.costCents : r.cost_cents,
      computedPriceCents: live ? f.priced.computedPriceCents : r.computed_price_cents,
      priceCents: live ? f.priced.priceCents : r.price_cents,
      description: describeLine({
        name: r.name,
        quantity: Number(r.quantity),
        unit,
        kind: r.kind === "flat" ? "flat" : "production_rate",
        coats: r.coats,
        primer: r.primer === "spot" || r.primer === "full" ? r.primer : "none",
        sides: r.sides,
        sheenLabel: r.sheen ? (sheenLabels.get(r.sheen) ?? r.sheen) : null,
      }),
      issues: live
        ? f.priced.issues.map((i) => ({ severity: i.severity, message: i.message }))
        : issuesOf(r.issues),
    };
  });

  const totals: OptionTotals[] = draft
    ? priced.options.map((o) => ({
        optionId: o.option.id,
        summary: o.summary,
        withAllAddOns: o.withAllAddOns,
      }))
    : storedTotals(rows.version.priced);
  const versionIssues = draft
    ? priced.issues
        .filter((i) => i.lineId === null)
        .map((i) => ({ severity: i.severity, message: i.message }))
    : [];

  const limit = discountLimitFor(parseDiscountLimits(settingsRow.data?.discount_limits), {
    userId: viewer.id,
    roleKey: viewer.role.key,
    canApprove: viewer.can("estimates:approve_discount"),
  });
  const approvalPayload = approval.data?.payload as
    { version_id?: unknown; discount_percent?: unknown } | undefined;
  const contact = job.data.contact;
  const canEditJob =
    viewer.can("jobs:update", "all") ||
    job.data.team_user_ids.includes(viewer.id) ||
    rows.estimate.owner_id === viewer.id ||
    rows.estimate.created_by === viewer.id;
  const writable = (b: boolean) => b && !viewer.impersonating;

  const messages = defaultEstimateMessages({
    customerFirstName: contact?.first_name ?? null,
    senderName: viewer.name,
    companyName: "Brushy Bear Painters",
    companyPhone: null,
    documentNumber: rows.estimate.estimate_number,
    expiresAt: new Date(Date.now() + ctx.settings.expiryDays * 86_400_000),
  });

  return {
    job: {
      id: job.data.id,
      number: job.data.job_number,
      name: job.data.name,
      leadSafeRequired: job.data.property?.lead_safe_required ?? false,
      stage: job.data.stage,
    },
    estimate: {
      id: rows.estimate.id,
      number: rows.estimate.estimate_number,
      title: rows.estimate.title,
      status: rows.estimate.status,
    },
    version: {
      id: rows.version.id,
      versionNo: rows.version.version_no,
      status: rows.version.status,
      discountType:
        rows.version.discount_type === "amount" || rows.version.discount_type === "percent"
          ? rows.version.discount_type
          : null,
      discountValue:
        rows.version.discount_value === null ? null : Number(rows.version.discount_value),
      discountReason: rows.version.discount_reason,
      depositPercent:
        rows.version.deposit_percent === null ? null : Number(rows.version.deposit_percent),
      customerNotes: rows.version.customer_notes,
      internalNotes: rows.version.internal_notes,
      sentAt: rows.version.sent_at,
      viewedAt: rows.version.viewed_at,
      expiresAt: rows.version.expires_at,
      acceptedAt: rows.version.accepted_at,
      acceptedOptionId: rows.version.accepted_option_id,
      discountApprovedPercent:
        rows.version.discount_approved_percent === null
          ? null
          : Number(rows.version.discount_approved_percent),
    },
    versions: (versions.data ?? []).map((v) => ({
      id: v.id,
      versionNo: v.version_no,
      status: v.status,
      sentAt: v.sent_at,
    })),
    options: rows.options.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      isRecommended: o.is_recommended,
    })),
    areas: rows.areas.map((a) => ({
      id: a.id,
      optionId: a.option_id,
      name: a.name,
      workType: a.work_type,
    })),
    lines,
    totals,
    issues: versionIssues,
    sendable: draft ? priced.sendable : false,
    maxDiscountPercent: draft
      ? priced.maxEffectiveDiscountPercent
      : Number(rows.version.max_effective_discount_percent),
    catalog: (catalog.data ?? []).map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      family: c.family,
      unit: c.unit,
      itemType: c.item_type,
      pricingMethod: c.pricing_method,
      isSample: c.is_sample,
    })),
    products: [...ctx.lookups.products.values()]
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        label: productLabel(p, ctx.lookups.brandLabels) ?? p.product,
        use: p.use,
        sheens: p.sheens,
        isPrimer: p.is_primer,
        isSample: p.is_sample,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    sheens: [...sheenLabels.entries()].map(([value, label]) => ({ value, label })),
    workTypes: (workTypes.data ?? []).map((w) => ({ value: w.value, label: w.label })),
    settings: {
      isSample: ctx.isSample,
      depositPercent: ctx.settings.depositPercent,
      marginFloorPercent: ctx.settings.marginFloorPercent,
      doorDeductionSqft: ctx.settings.doorDeductionSqft,
      windowDeductionSqft: ctx.settings.windowDeductionSqft,
      gableFactor: ctx.settings.gableFactor,
      taxRatePercent: ctx.settings.tax.ratePercent,
      taxConfirmed: ctx.settings.tax.confirmedWithAccountant,
    },
    limitPercent: Number.isFinite(limit) ? limit : null,
    pendingApproval:
      approval.data && approvalPayload?.version_id === versionId
        ? {
            id: approval.data.id,
            percent:
              typeof approvalPayload.discount_percent === "number"
                ? approvalPayload.discount_percent
                : null,
          }
        : null,
    contact: contact
      ? {
          name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
          mobile: contact.mobile,
          email: contact.email,
        }
      : null,
    messages,
    can: {
      edit: writable(draft && viewer.can("estimates:create") && canEditJob),
      send: writable(
        draft && viewer.can("estimates:send") && viewer.can("messages:send") && canEditJob,
      ),
      approve: writable(viewer.can("estimates:approve_discount")),
    },
  };
}
