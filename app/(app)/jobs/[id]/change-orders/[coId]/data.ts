import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { Viewer } from "@/lib/auth/viewer";
import { priceChangeOrder } from "@/lib/estimating/engine";
import { loadPricingContext } from "@/lib/estimating/load";
import { productLabel, toVersionLine } from "@/lib/estimating/map";
import { defaultChangeOrderMessages } from "@/lib/estimating/messages";
import type { CatalogChoice } from "../../estimate/catalog-picker";
import { issuesOf, toBuilderLine } from "../../estimate/line-view";
import type {
  BuilderIssue,
  BuilderLine,
  MeasureSettings,
  ProductChoice,
} from "../../estimate/types";

type Db = SupabaseClient<Database>;

export type ChangeOrderData = {
  job: { id: string; number: string; name: string };
  co: {
    id: string;
    number: string;
    title: string;
    reason: string | null;
    fieldNotes: string | null;
    fromField: boolean;
    status: string;
    billSeparately: boolean;
    sentAt: string | null;
    viewedAt: string | null;
    signedAt: string | null;
    expiresAt: string | null;
    declineReason: string | null;
  };
  lines: BuilderLine[];
  totals: { subtotalCents: number; taxCents: number; totalCents: number; costCents: number };
  contractCents: number | null;
  issues: BuilderIssue[];
  sendable: boolean;
  catalog: CatalogChoice[];
  products: ProductChoice[];
  sheens: { value: string; label: string }[];
  settings: MeasureSettings & { isSample: boolean };
  contact: { name: string; mobile: string | null; email: string | null } | null;
  messages: { sms: string; emailSubject: string; emailBody: string };
  can: { edit: boolean; send: boolean };
};

/** A change order as its editor shows it (row security applies). */
export async function loadChangeOrderData(
  supabase: Db,
  viewer: Viewer,
  jobId: string,
  coId: string,
): Promise<ChangeOrderData | null> {
  const { data: co } = await supabase
    .from("change_orders")
    .select("*")
    .eq("id", coId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!co || co.job_id !== jobId) return null;
  const [job, lineRows, catalog, ctx, fin, company] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, job_number, name, team_user_ids, contact:contacts!jobs_primary_contact_id_fkey(first_name, last_name, mobile, email)",
      )
      .eq("id", jobId)
      .maybeSingle(),
    supabase
      .from("estimate_line_items")
      .select("*")
      .eq("change_order_id", coId)
      .order("sort_order"),
    supabase
      .from("catalog_items")
      .select(
        "id, code, name, family, unit, item_type, pricing_method, is_sample, sort_order, price_books!inner(is_default, active)",
      )
      .eq("active", true)
      .eq("price_books.is_default", true)
      .order("family")
      .order("sort_order"),
    loadPricingContext(supabase, co.org_id),
    supabase.from("job_financials").select("contract_cents").eq("job_id", jobId).maybeSingle(),
    supabase
      .from("company_settings")
      .select("company_name, phone")
      .eq("org_id", co.org_id)
      .maybeSingle(),
  ]);
  if (!job.data) return null;
  const draft = co.status === "draft";
  const rows = lineRows.data ?? [];
  const priced = priceChangeOrder({
    id: co.id,
    title: co.title,
    reason: co.reason,
    lines: rows.map((r) => toVersionLine(r, ctx.lookups)),
    settings: ctx.settings,
  });
  const fresh = new Map(priced.lines.map((l) => [l.line.id, l]));
  const sheenLabels = ctx.lookups.sheenLabels;
  const contact = job.data.contact;
  const canEditJob = viewer.can("jobs:update", "all") || job.data.team_user_ids.includes(viewer.id);
  const writable = (b: boolean) => b && !viewer.impersonating;
  const storedIssues = issuesOf((co.priced as { issues?: unknown } | null)?.issues);

  return {
    job: { id: job.data.id, number: job.data.job_number, name: job.data.name },
    co: {
      id: co.id,
      number: co.change_order_number,
      title: co.title,
      reason: co.reason,
      fieldNotes: co.field_notes,
      fromField: co.created_from_field,
      status: co.status,
      billSeparately: co.bill_separately,
      sentAt: co.sent_at,
      viewedAt: co.viewed_at,
      signedAt: co.signed_at,
      expiresAt: co.expires_at,
      declineReason: co.decline_reason,
    },
    lines: rows.map((r) => toBuilderLine(r, draft ? fresh.get(r.id) : undefined, sheenLabels)),
    totals: draft
      ? {
          subtotalCents: priced.subtotalCents,
          taxCents: priced.taxCents,
          totalCents: priced.totalCents,
          costCents: priced.costCents,
        }
      : {
          subtotalCents: co.subtotal_cents ?? 0,
          taxCents: co.tax_cents ?? 0,
          totalCents: co.total_cents ?? 0,
          costCents: Number((co.priced as { costCents?: unknown } | null)?.costCents ?? 0),
        },
    contractCents: fin.data?.contract_cents ?? null,
    issues: draft
      ? priced.issues
          .filter((i) => i.lineId === null)
          .map((i) => ({ severity: i.severity, message: i.message }))
      : storedIssues,
    sendable: draft && priced.sendable && rows.length > 0,
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
    settings: {
      isSample: ctx.isSample,
      doorDeductionSqft: ctx.settings.doorDeductionSqft,
      windowDeductionSqft: ctx.settings.windowDeductionSqft,
      gableFactor: ctx.settings.gableFactor,
    },
    contact: contact
      ? {
          name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
          mobile: contact.mobile,
          email: contact.email,
        }
      : null,
    messages: defaultChangeOrderMessages({
      customerFirstName: contact?.first_name ?? null,
      senderName: viewer.name,
      companyName: company.data?.company_name ?? "",
      companyPhone: company.data?.phone || null,
      documentNumber: co.change_order_number,
      expiresAt: new Date(Date.now() + ctx.settings.expiryDays * 86_400_000),
      title: co.title,
    }),
    can: {
      edit: writable(draft && viewer.can("estimates:create") && canEditJob),
      send: writable(
        draft && viewer.can("estimates:send") && viewer.can("messages:send") && canEditJob,
      ),
    },
  };
}
