/**
 * Loads demo data (SPEC §15.2) so the owners can try every screen before real
 * records arrive: ~300 leads, ~120 jobs across every stage and work type, five
 * cities, estimates with options and add-ons, invoices and payments (some
 * overdue), daily logs, three crews, every hold type, weather delays and the
 * attention items they cause. Every record is tagged `is_demo = true`; Admin →
 * Demo Data (owners) or `--purge` removes all of it.
 *
 * Guarded (lib/demo/guard.ts): runs only with DEMO_DATA=true AND a local
 * Supabase URL, or with --i-know-this-is-not-production. NEVER run it against
 * production. No message is sent and no outside service is called: records go
 * through the app's own database functions, and the attention sweep uses the
 * disconnected adapters.
 *
 *   DEMO_DATA=true pnpm seed:demo              load (refuses if demo data exists)
 *   DEMO_DATA=true pnpm seed:demo --replace    purge existing demo data, then load
 *   DEMO_DATA=true pnpm seed:demo --purge      only purge
 *   DEMO_DATA=true pnpm seed:demo --seed=42    a different (repeatable) data set
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { runAttentionSweep } from "@/lib/attention/engine";
import type { Database, Json } from "@/lib/db/types";
import { demoGuard } from "@/lib/demo/guard";
import {
  generateDemoPlan,
  holdReason,
  pacificDate,
  STAGE_MILESTONES,
  stageAtLeast,
  type DemoEstimateArea,
  type DemoJob,
  type DemoLead,
  type DemoPlan,
} from "@/lib/demo/generate";
import { purgeDemo } from "@/lib/demo/purge";
import type { JobStageId } from "@/lib/domain/stages";
import { buildAcceptOutputs } from "@/lib/estimating/accept-outputs";
import {
  buildProposalSnapshot,
  ESIGN_CONSENT,
  expiresAt,
  LEAD_SAFE_WORK_TYPES,
  LINE_SHEEN_PREFERENCE,
  quoteSelection,
} from "@/lib/estimating/engine";
import { repriceVersion } from "@/lib/estimating/load";
import { generateProposalToken, signatureHash } from "@/lib/estimating/tokens";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { reverifyJob } from "@/lib/onboarding/checks";
import { PHOTOS_BUCKET } from "@/lib/photos/storage";

type Db = SupabaseClient<Database>;
type CatalogItem = Database["public"]["Tables"]["catalog_items"]["Row"];
type LineInsert = Database["public"]["Tables"]["estimate_line_items"]["Insert"];
type JobUpdate = Database["public"]["Tables"]["jobs"]["Update"];

const DAY = 86_400_000;
/** A 1×1 transparent PNG: the demo signature. */
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const SCHEDULE_WORK_TYPE: Record<
  string,
  Database["public"]["Tables"]["schedule_entries"]["Insert"]["work_type"]
> = {
  interior: "interior_production",
  exterior: "exterior_production",
  cabinets: "cabinet_shop",
  deck_fence: "deck_fence",
  add_on_only: "pressure_washing",
  warranty_touch_up: "touch_up",
};

function out(message: string): void {
  process.stdout.write(`${message}\n`);
}

function fail(message: string): never {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
}

function must<T>(
  res: { data: T; error: { message: string } | null },
  what: string,
): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null || res.data === undefined) throw new Error(`${what}: nothing returned`);
  return res.data as NonNullable<T>;
}

function maybe<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

function ok(res: { error: { message: string } | null }, what: string): void {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

async function pool<T>(
  items: readonly T[],
  size: number,
  fn: (item: T, i: number) => Promise<void>,
) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
}

function at(job: DemoJob, stage: JobStageId): number | undefined {
  const t = job.timeline.find((x) => x.stage === stage);
  return t ? Date.parse(t.at) : undefined;
}

function dateOnly(ms: number): string {
  return pacificDate(ms);
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

// ---------------------------------------------------------------------------

type Context = {
  db: Db;
  orgId: string;
  actorId: string;
  people: string[];
  territories: Map<string, string>;
  catalog: Map<string, CatalogItem>;
  sheens: Map<string, string[]>;
  crewIds: string[];
  photo: { display: Buffer; thumb: Buffer; width: number; height: number };
  now: number;
};

async function loadContext(
  db: Db,
  orgId: string,
  actorId: string,
  now: number,
): Promise<Omit<Context, "crewIds" | "photo" | "people">> {
  const [territories, catalog, products] = await Promise.all([
    db.from("territories").select("id, name").eq("org_id", orgId).is("deleted_at", null),
    db.from("catalog_items").select("*").eq("org_id", orgId).eq("active", true),
    db.from("paint_products").select("id, sheens").eq("org_id", orgId),
  ]);
  return {
    db,
    orgId,
    actorId,
    territories: new Map(must(territories, "territories").map((t) => [t.name, t.id])),
    catalog: new Map(must(catalog, "catalog").map((c) => [c.code, c])),
    sheens: new Map(must(products, "paint products").map((p) => [p.id, p.sheens])),
    now,
  };
}

async function makePhoto(): Promise<Context["photo"]> {
  const width = 960;
  const height = 720;
  const display = await sharp({
    create: { width, height, channels: 3, background: { r: 214, g: 222, b: 214 } },
  })
    .jpeg({ quality: 70 })
    .toBuffer();
  const thumb = await sharp(display).resize(240, 180).jpeg({ quality: 70 }).toBuffer();
  return { display, thumb, width, height };
}

async function seedCrews(
  ctx: Omit<Context, "crewIds" | "photo">,
  plan: DemoPlan,
): Promise<string[]> {
  const { db, orgId } = ctx;
  const sub = must(
    await db
      .from("subcontractors")
      .insert({
        org_id: orgId,
        company_name: plan.subcontractor.companyName,
        contact_name: plan.subcontractor.contactName,
        email: plan.subcontractor.email,
        w9_on_file: true,
        status: "active",
        notes: "Demo data – not a real company.",
        is_demo: true,
      })
      .select("id")
      .single(),
    "subcontractor",
  );
  const cityTerritory = [...ctx.territories.values()];
  const ids: string[] = [];
  for (const [i, c] of plan.crews.entries()) {
    const crew = must(
      await db
        .from("crews")
        .insert({
          org_id: orgId,
          name: c.name,
          crew_type: c.crewType,
          subcontractor_id: c.crewType === "subcontractor" ? sub.id : null,
          color: c.color,
          home_territory_id: cityTerritory[c.cityIndex] ?? null,
          sort_order: 100 + i,
          notes: "Demo data.",
          is_demo: true,
        })
        .select("id")
        .single(),
      "crew",
    );
    ids.push(crew.id);
    ok(
      await db.from("crew_members").insert(
        c.members.map((m) => ({
          org_id: orgId,
          crew_id: crew.id,
          display_name: m.displayName,
          role: m.role,
          is_demo: true,
        })),
      ),
      "crew members",
    );
  }
  return ids;
}

function intakeChannel(source: string): "manual" | "website" | "referral" {
  if (source === "website" || source === "google_ads" || source === "google_business_profile")
    return "website";
  if (source === "customer_referral" || source === "past_customer") return "referral";
  return "manual";
}

async function insertLead(ctx: Context, lead: DemoLead): Promise<string> {
  const created = Date.parse(lead.createdAt);
  const contacted = lead.status === "new" ? null : new Date(created + 47 * 60_000).toISOString();
  const row = must(
    await ctx.db
      .from("leads")
      .insert({
        org_id: ctx.orgId,
        first_name: lead.firstName,
        last_name: lead.lastName,
        email: lead.email,
        mobile: lead.mobile,
        street: lead.street,
        city: lead.city,
        state: "WA",
        zip: lead.zip,
        services: lead.services,
        timeline: lead.timeline,
        home_built: lead.homeBuilt,
        year_built: lead.yearBuilt,
        property_type: lead.propertyType,
        stories: lead.stories,
        siding_type: lead.sidingType,
        has_hoa: lead.hasHoa,
        lead_source: lead.source,
        intake_channel: intakeChannel(lead.source),
        status: lead.status === "converted" ? "contacted" : lead.status,
        lost_reason: lead.lostReason,
        disposition: lead.disposition,
        owner_id: ctx.people[lead.ownerIndex % ctx.people.length] ?? ctx.actorId,
        first_contacted_at: contacted,
        last_activity_at: contacted ?? lead.createdAt,
        created_at: lead.createdAt,
        is_demo: true,
      })
      .select("id")
      .single(),
    `lead ${lead.key}`,
  );
  return row.id;
}

/** Converts the lead (account, contact, property, job) and tags everything demo. */
async function convert(
  ctx: Context,
  leadId: string,
  lead: DemoLead,
  job: DemoJob,
): Promise<string> {
  const { db } = ctx;
  const jobId = must(
    await db.rpc("convert_lead_to_job", { p_lead: leadId, p_work_types: job.workTypes }),
    `convert ${lead.key}`,
  );
  const l = must(
    await db.from("leads").select("account_id, contact_id, property_id").eq("id", leadId).single(),
    "converted lead",
  );
  const first = Date.parse(job.timeline[0]!.at);
  ok(
    await db
      .from("leads")
      .update({ converted_at: new Date(first).toISOString() })
      .eq("id", leadId),
    "lead converted_at",
  );
  if (l.account_id)
    ok(await db.from("accounts").update({ is_demo: true }).eq("id", l.account_id), "account");
  if (l.contact_id)
    ok(await db.from("contacts").update({ is_demo: true }).eq("id", l.contact_id), "contact");
  if (l.property_id) {
    ok(
      await db
        .from("properties")
        .update({
          is_demo: true,
          year_built: lead.yearBuilt,
          home_built: lead.homeBuilt,
          has_hoa: lead.hasHoa,
          hoa_name: lead.hasHoa ? "Sample HOA (demo)" : null,
          stories: lead.stories,
        })
        .eq("id", l.property_id),
      "property",
    );
  }
  ok(
    await db
      .from("jobs")
      .update({ is_demo: true, created_at: new Date(first).toISOString() })
      .eq("id", jobId),
    "job demo flag",
  );
  return jobId;
}

function lineRow(
  ctx: Context,
  placement: {
    version_id: string;
    option_id: string | null;
    area_id: string | null;
    is_optional: boolean;
  },
  code: string,
  quantity: number,
  sort: number,
  leadSafeHome: boolean,
  premium: boolean,
): LineInsert {
  const item = ctx.catalog.get(code);
  if (!item) throw new Error(`Catalog item ${code} is missing (check Price Book → Catalog).`);
  const sheens = item.default_product_id ? (ctx.sheens.get(item.default_product_id) ?? []) : [];
  const production = item.pricing_method === "production_rate";
  return {
    org_id: ctx.orgId,
    ...placement,
    catalog_item_id: item.id,
    kind: production ? "production_rate" : "flat",
    name: item.name,
    catalog_code: item.code,
    surface: item.surface,
    unit: item.unit,
    work_type: item.work_type,
    work_order_phase: item.work_order_phase,
    quantity: item.unit === "lump" ? 1 : quantity,
    coats:
      premium && production
        ? Math.min(3, Math.max(2, item.default_coats ?? 2))
        : item.default_coats,
    method: item.default_method,
    paint_product_id: item.default_product_id,
    paint_sqft_per_unit: item.paint_sqft_per_unit,
    sheen: LINE_SHEEN_PREFERENCE.find((s) => sheens.includes(s)) ?? sheens[0] ?? null,
    unit_price_cents: production ? null : item.unit_price_cents,
    unit_cost_cents: production ? null : item.unit_cost_cents,
    labor_hours_per_unit: item.labor_hours_per_unit,
    taxable: item.taxable,
    is_repair_allowance: item.is_repair_allowance,
    customer_note: item.customer_description,
    lead_safe:
      leadSafeHome &&
      production &&
      LEAD_SAFE_WORK_TYPES.has(item.work_type ?? "") &&
      Number(item.paint_sqft_per_unit) > 0,
    sort_order: sort,
  };
}

async function addAreas(
  ctx: Context,
  versionId: string,
  optionId: string,
  areas: readonly DemoEstimateArea[],
  leadSafeHome: boolean,
  premium: boolean,
): Promise<void> {
  for (const [i, a] of areas.entries()) {
    const area = must(
      await ctx.db
        .from("estimate_areas")
        .insert({
          org_id: ctx.orgId,
          version_id: versionId,
          option_id: optionId,
          name: a.name,
          work_type: a.workType,
          sort_order: (i + 1) * 10,
        })
        .select("id")
        .single(),
      "estimate area",
    );
    ok(
      await ctx.db
        .from("estimate_line_items")
        .insert(
          a.lines.map((l, k) =>
            lineRow(
              ctx,
              { version_id: versionId, option_id: optionId, area_id: area.id, is_optional: false },
              l.code,
              l.quantity,
              (k + 1) * 10,
              leadSafeHome,
              premium,
            ),
          ),
        ),
      "estimate lines",
    );
  }
}

/** Estimate with Standard and Premium options plus an add-on; sent, then signed or declined. */
async function seedEstimate(
  ctx: Context,
  jobId: string,
  job: DemoJob,
  lead: DemoLead,
): Promise<void> {
  const plan = job.estimate;
  if (!plan) return;
  const { db } = ctx;
  const estimateId = must(
    await db.rpc("create_estimate", { p_job: jobId, p_title: "Painting estimate" }),
    "create estimate",
  );
  const version = must(
    await db.from("estimate_versions").select("id").eq("estimate_id", estimateId).single(),
    "estimate version",
  );
  const optionA = must(
    await db.from("estimate_options").select("id").eq("version_id", version.id).single(),
    "option A",
  );
  ok(
    await db
      .from("estimate_options")
      .update({ name: "Standard", description: "One finish coat where the surface allows." })
      .eq("id", optionA.id),
    "rename option A",
  );
  const optionB = must(
    await db
      .from("estimate_options")
      .insert({
        org_id: ctx.orgId,
        version_id: version.id,
        name: "Premium",
        description: "Two finish coats and extra scope.",
        is_recommended: false,
        sort_order: 2,
      })
      .select("id")
      .single(),
    "option B",
  );
  const leadSafe = lead.homeBuilt === "before_1978";
  await addAreas(ctx, version.id, optionA.id, plan.areas, leadSafe, false);
  await addAreas(ctx, version.id, optionB.id, [...plan.areas, plan.premiumExtra], leadSafe, true);
  ok(
    await db
      .from("estimate_line_items")
      .insert(
        lineRow(
          ctx,
          { version_id: version.id, option_id: null, area_id: null, is_optional: true },
          plan.addOn.code,
          plan.addOn.quantity,
          900,
          leadSafe,
          false,
        ),
      ),
    "add-on",
  );

  const repriced = await repriceVersion(db, version.id);
  if (!repriced) throw new Error("estimate pricing: version not found");
  const snapshot = buildProposalSnapshot(repriced.input, repriced.priced);
  const recommended =
    repriced.priced.options.find((o) => o.option.isRecommended) ?? repriced.priced.options[0];
  const { hash } = generateProposalToken();
  ok(
    await db.rpc("mark_estimate_sent", {
      p_version: version.id,
      p_token_hash: hash,
      p_expires_at: expiresAt(new Date(), repriced.context.settings.expiryDays).toISOString(),
      p_proposal: JSON.parse(JSON.stringify(snapshot)) as Json,
      p_total_cents: recommended?.summary.totalCents ?? 0,
      p_channels: ["email"],
    }),
    "send estimate",
  );
  const sentAt = at(job, "estimate_sent") ?? ctx.now - DAY;
  const expires = new Date(
    sentAt + Math.max(1, repriced.context.settings.expiryDays) * DAY,
  ).toISOString();

  if (plan.declined) {
    ok(
      await db.rpc("decline_proposal", {
        p_token_hash: hash,
        p_reason: "Went another direction (demo).",
      }),
      "decline",
    );
    ok(
      await db
        .from("estimate_versions")
        .update({ sent_at: new Date(sentAt).toISOString(), expires_at: expires })
        .eq("id", version.id),
      "backdate declined version",
    );
    ok(
      await db
        .from("estimates")
        .update({ sent_at: new Date(sentAt).toISOString() })
        .eq("id", estimateId),
      "backdate declined estimate",
    );
    return;
  }

  if (!stageAtLeast(job.stage, "sold")) {
    // Still waiting on the customer: some have looked at it.
    ok(
      await db
        .from("estimate_versions")
        .update({ sent_at: new Date(sentAt).toISOString() })
        .eq("id", version.id),
      "backdate sent version",
    );
    ok(
      await db
        .from("estimates")
        .update({ sent_at: new Date(sentAt).toISOString() })
        .eq("id", estimateId),
      "backdate sent estimate",
    );
    return;
  }

  // Signed the way the customer page signs (minus the PDF, which needs the app).
  const optionId = plan.pickPremium ? optionB.id : optionA.id;
  const addOnIds = plan.takeAddOn ? snapshot.addOns.map((a) => a.id) : [];
  const quote = quoteSelection(snapshot, { optionId, addOnIds });
  if (!quote) throw new Error("estimate selection");
  const [lines, areas, property] = await Promise.all([
    db.from("estimate_line_items").select("*").eq("version_id", version.id),
    db.from("estimate_areas").select("id, name, work_type").eq("version_id", version.id),
    db.from("jobs").select("name, work_types, properties(has_hoa)").eq("id", jobId).single(),
  ]);
  const jobRow = must(property, "job for outputs");
  const wanted = new Set(addOnIds);
  const included = must(lines, "lines").filter(
    (l) => l.option_id === optionId || (l.is_optional && wanted.has(l.id)),
  );
  const outputs = await buildAcceptOutputs(db, {
    lines: included,
    areaNames: new Map(
      must(areas, "areas").map((a) => [a.id, { name: a.name, workType: a.work_type }]),
    ),
    jobWorkTypes: jobRow.work_types,
    jobName: jobRow.name,
    hasHoa: jobRow.properties?.has_hoa ?? false,
    depositCents: quote.totals.depositCents,
    orgId: ctx.orgId,
  });
  ok(
    await db.rpc("accept_estimate", {
      p_token_hash: hash,
      p_option: optionId,
      p_addons: addOnIds,
      p_signer_name: `${lead.firstName} ${lead.lastName}`,
      p_signer_email: lead.email ?? "",
      p_signature_png: SIGNATURE_PNG,
      p_signature_sha256: signatureHash(SIGNATURE_PNG),
      p_consent: ESIGN_CONSENT,
      p_ip: null,
      p_user_agent: "Demo data script",
      p_totals: JSON.parse(
        JSON.stringify({ ...quote.totals, depositPercent: snapshot.terms.depositPercent }),
      ) as Json,
      p_outputs: outputs,
    }),
    "accept estimate",
  );
  const acceptedAt = new Date(at(job, "sold") ?? ctx.now).toISOString();
  ok(
    await db
      .from("estimate_versions")
      .update({ sent_at: new Date(sentAt).toISOString(), accepted_at: acceptedAt })
      .eq("id", version.id),
    "backdate accepted version",
  );
  ok(
    await db
      .from("estimates")
      .update({ sent_at: new Date(sentAt).toISOString(), accepted_at: acceptedAt })
      .eq("id", estimateId),
    "backdate accepted estimate",
  );
}

/** Deposit paid from Onboarding on; final invoice from Invoiced on (some overdue or partly paid). */
async function seedMoney(ctx: Context, jobId: string, job: DemoJob): Promise<void> {
  if (!job.estimate || job.estimate.declined || !stageAtLeast(job.stage, "sold")) return;
  const { db } = ctx;
  const soldAt = at(job, "sold") ?? ctx.now;
  const deposit = maybe(
    await db
      .from("invoices")
      .select("id, total_cents")
      .eq("job_id", jobId)
      .eq("invoice_type", "deposit")
      .maybeSingle(),
    "deposit invoice",
  );
  if (deposit) {
    ok(
      await db.rpc("mark_invoice_sent", {
        p_invoice: deposit.id,
        p_issue_date: dateOnly(soldAt),
        p_due_date: dateOnly(soldAt + 7 * DAY),
      }),
      "send deposit invoice",
    );
    if (job.depositPaid) {
      const paidAt = at(job, "onboarding") ?? soldAt + DAY;
      ok(
        await db.rpc("record_payment", {
          p_job: jobId,
          p_method: job.paymentMethod,
          p_amount_cents: Number(deposit.total_cents),
          p_received_on: dateOnly(Math.min(paidAt, ctx.now)),
          p_applications: [{ invoice_id: deposit.id, amount_cents: Number(deposit.total_cents) }],
          p_reference: job.paymentMethod === "check" ? `DEMO-${1000 + job.index}` : undefined,
        }),
        "deposit payment",
      );
      // The onboarding check sees the payment and releases the Deposit Hold.
      await reverifyJob(db, jobId, { advance: false });
    }
  }
  if (stageAtLeast(job.stage, "ready_to_schedule")) {
    // Past onboarding: every item was cleared along the way.
    ok(
      await db
        .from("onboarding_requirements")
        .update({ status: "verified", note: "Cleared (demo data)." })
        .eq("job_id", jobId)
        .neq("status", "verified"),
      "onboarding cleared",
    );
    ok(
      await db
        .from("job_holds")
        .update({ released_at: new Date().toISOString(), release_note: "Cleared (demo data)." })
        .eq("job_id", jobId)
        .is("released_at", null),
      "holds released",
    );
  }
  if (job.finalInvoice === "none") return;

  const fin = maybe(
    await db.from("job_financials").select("contract_cents").eq("job_id", jobId).maybeSingle(),
    "job financials",
  );
  const contract = Number(fin?.contract_cents ?? 0);
  const balance = contract - Number(deposit?.total_cents ?? 0);
  if (balance <= 0) return;
  const invoicedAt = at(job, "invoiced") ?? ctx.now - DAY;
  const issued =
    job.finalInvoice === "overdue" ? Math.min(invoicedAt, ctx.now - 30 * DAY) : invoicedAt;
  const invoiceId = must(
    await db.rpc("create_invoice", {
      p_job: jobId,
      p_type: "final",
      p_lines: [
        { description: "Balance of the contract (demo)", quantity: 1, unit_price_cents: balance },
      ],
      p_due_date: dateOnly(issued + 15 * DAY),
      p_terms: "Due in 15 days (demo)",
    }),
    "final invoice",
  );
  ok(
    await db.rpc("mark_invoice_sent", {
      p_invoice: invoiceId,
      p_issue_date: dateOnly(issued),
      p_due_date: dateOnly(issued + 15 * DAY),
    }),
    "send final invoice",
  );
  if (job.finalInvoice === "paid" || job.finalInvoice === "partial") {
    const total = must(
      await db.from("invoices").select("total_cents").eq("id", invoiceId).single(),
      "final total",
    );
    const amount =
      job.finalInvoice === "paid"
        ? Number(total.total_cents)
        : Math.round(Number(total.total_cents) / 2);
    const paidAt = at(job, "paid_in_full") ?? Math.min(ctx.now, issued + 10 * DAY);
    ok(
      await db.rpc("record_payment", {
        p_job: jobId,
        p_method: job.paymentMethod,
        p_amount_cents: amount,
        p_received_on: dateOnly(Math.min(paidAt, ctx.now)),
        p_applications: [{ invoice_id: invoiceId, amount_cents: amount }],
      }),
      "final payment",
    );
  }
}

async function seedAppointments(
  ctx: Context,
  jobId: string,
  leadId: string,
  job: DemoJob,
  ownerId: string,
) {
  const scheduledAt = at(job, "walkthrough_scheduled") ?? ctx.now;
  const visit =
    job.stage === "walkthrough_scheduled"
      ? ctx.now + (1 + (job.index % 5)) * DAY
      : (at(job, "walkthrough_complete") ?? scheduledAt + 2 * DAY) - 3 * 3_600_000;
  const done = job.stage !== "walkthrough_scheduled";
  const rows: Database["public"]["Tables"]["appointments"]["Insert"][] = [
    {
      org_id: ctx.orgId,
      job_id: jobId,
      lead_id: leadId,
      type: "walkthrough",
      title: "Walkthrough & measure",
      starts_at: new Date(visit).toISOString(),
      ends_at: new Date(visit + 3_600_000).toISOString(),
      status: done ? "completed" : job.index % 2 === 0 ? "confirmed" : "scheduled",
      result: done ? "measured" : null,
      completed_at: done ? new Date(visit + 3_600_000).toISOString() : null,
      confirmed_at: done || job.index % 2 === 0 ? new Date(scheduledAt).toISOString() : null,
      assigned_user_ids: [ownerId],
      is_demo: true,
    },
  ];
  if (job.stage === "final_walkthrough") {
    const fw = ctx.now + (job.index % 3) * DAY + 2 * 3_600_000;
    rows.push({
      org_id: ctx.orgId,
      job_id: jobId,
      type: "final_walkthrough",
      title: "Final walkthrough",
      starts_at: new Date(fw).toISOString(),
      ends_at: new Date(fw + 3_600_000).toISOString(),
      status: "scheduled",
      assigned_user_ids: [ownerId],
      is_demo: true,
    });
  }
  ok(await ctx.db.from("appointments").insert(rows), "appointments");
}

async function moveStage(ctx: Context, jobId: string, job: DemoJob): Promise<void> {
  const cur = must(await ctx.db.from("jobs").select("stage").eq("id", jobId).single(), "job stage");
  if (cur.stage === job.stage) return;
  ok(
    await ctx.db.rpc("apply_job_stage_change", {
      p_job: jobId,
      p_from: cur.stage,
      p_to: job.stage,
      p_override: true,
      p_reason: "Demo data: placed at this stage by the demo script.",
      p_lost_reason: job.lostReason ?? undefined,
    }),
    `stage ${job.stage}`,
  );
}

async function stampMilestones(
  ctx: Context,
  jobId: string,
  job: DemoJob,
  lead: DemoLead,
): Promise<void> {
  const patch: JobUpdate = {
    lead_created_at: lead.createdAt,
    first_contact_at: new Date(Date.parse(lead.createdAt) + 47 * 60_000).toISOString(),
  };
  const fields = patch as Record<string, string | number | boolean | null>;
  for (const t of job.timeline) {
    for (const m of STAGE_MILESTONES[t.stage]) fields[m] = t.at;
  }
  if (job.production) {
    patch.promised_start_date = job.production.startsOn;
    if (stageAtLeast(job.stage, "in_progress")) patch.actual_start_date = job.production.startsOn;
    patch.estimated_duration_days =
      Math.round((Date.parse(job.production.endsOn) - Date.parse(job.production.startsOn)) / DAY) +
      1;
    patch.crew_id = job.crewIndex === null ? null : (ctx.crewIds[job.crewIndex] ?? null);
  }
  if (job.priority) {
    patch.is_priority_reschedule = true;
    patch.priority_reschedule_at = new Date(ctx.now - DAY).toISOString();
  }
  if (job.stage === "closed_won" || job.stage === "paid_in_full")
    patch.on_time_guarantee_status = "met";
  ok(await ctx.db.from("jobs").update(patch).eq("id", jobId), "milestones");
  const entered = Date.parse(job.timeline[job.timeline.length - 1]!.at);
  ok(
    await ctx.db.rpc("demo_backdate_stage", {
      p_job: jobId,
      p_entered_at: new Date(Math.min(entered, ctx.now - 60_000)).toISOString(),
    }),
    "stage date",
  );
}

async function seedProduction(ctx: Context, jobId: string, job: DemoJob): Promise<void> {
  const { db } = ctx;
  if (!job.production || job.crewIndex === null) return;
  const crewId = ctx.crewIds[job.crewIndex]!;
  const entry = must(
    await db
      .from("schedule_entries")
      .insert({
        org_id: ctx.orgId,
        job_id: jobId,
        crew_id: crewId,
        work_type: SCHEDULE_WORK_TYPE[job.workTypes[0] ?? "interior"] ?? "interior_production",
        status: "published",
        starts_on: job.production.startsOn,
        ends_on: job.production.endsOn,
        published_at: new Date(at(job, "scheduled") ?? ctx.now).toISOString(),
        published_by: ctx.actorId,
        is_demo: true,
      })
      .select("id")
      .single(),
    "schedule entry",
  );
  const woStatus = stageAtLeast(job.stage, "final_walkthrough")
    ? "completed"
    : job.stage === "in_progress"
      ? "in_progress"
      : "scheduled";
  ok(
    await db
      .from("work_orders")
      .update({
        crew_id: crewId,
        status: woStatus,
        scheduled_start: job.production.startsOn,
        scheduled_end: job.production.endsOn,
        completed_at:
          woStatus === "completed"
            ? new Date(at(job, "final_walkthrough") ?? ctx.now).toISOString()
            : null,
        is_demo: true,
      })
      .eq("job_id", jobId),
    "work orders",
  );

  if (job.rainDelay) {
    const delay = Math.max(Date.parse(`${job.production.startsOn}T20:00:00Z`), ctx.now - 2 * DAY);
    ok(
      await db.from("rain_delays").insert({
        org_id: ctx.orgId,
        job_id: jobId,
        delay_date: dateOnly(Math.min(delay, ctx.now)),
        schedule_entry_id: entry.id,
        note: "Rain all day; crew sent home (demo).",
        marked_by: ctx.actorId,
        notify_customer: false,
        is_demo: true,
      }),
      "rain delay",
    );
  }

  // Daily logs with a cleanup photo, on production days so far.
  const start = Date.parse(`${job.production.startsOn}T20:00:00Z`);
  for (let d = 0; d < job.dailyLogs; d++) {
    const day = start + d * DAY;
    if (day > ctx.now) break;
    const base = `${ctx.orgId}/jobs/${jobId}/demo-${d + 1}`;
    const display = `${base}.jpg`;
    const thumb = `${base}-thumb.jpg`;
    for (const [path, bytes] of [
      [display, ctx.photo.display],
      [thumb, ctx.photo.thumb],
    ] as const) {
      const up = await db.storage
        .from(PHOTOS_BUCKET)
        .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
      if (up.error) throw new Error(`photo upload: ${up.error.message}`);
    }
    const photo = must(
      await db
        .from("job_photos")
        .insert({
          org_id: ctx.orgId,
          job_id: jobId,
          category: "cleanup",
          caption: "End-of-day cleanup (demo placeholder)",
          storage_path: display,
          thumb_path: thumb,
          mime_type: "image/jpeg",
          size_bytes: ctx.photo.display.length,
          thumb_size_bytes: ctx.photo.thumb.length,
          width: ctx.photo.width,
          height: ctx.photo.height,
          taken_at: new Date(day).toISOString(),
          source: "camera",
          exif_stripped: true,
          uploaded_by: ctx.actorId,
        })
        .select("id")
        .single(),
      "job photo",
    );
    ok(
      await db.from("daily_logs").insert({
        org_id: ctx.orgId,
        job_id: jobId,
        schedule_entry_id: entry.id,
        log_date: dateOnly(day),
        author_id: ctx.actorId,
        finished_today:
          d === 0
            ? "Prep, masking and first coat on walls (demo)."
            : "Second coat and trim (demo).",
        next_up: d === 0 ? "Second coat and trim." : "Touch-ups and walkthrough.",
        weather_observed: job.workTypes.includes("exterior") ? "Dry, 58°F" : null,
        cleanup_done: true,
        cleanup_photo_id: photo.id,
        customer_update_status: "skipped",
        source: "online",
        is_demo: true,
      }),
      "daily log",
    );
  }
}

async function seedHolds(ctx: Context, jobId: string, job: DemoJob): Promise<void> {
  // The deposit hold comes from signing; the rest are placed here.
  const rows = job.holds
    .filter((h) => h !== "deposit")
    .map((h) => ({
      org_id: ctx.orgId,
      job_id: jobId,
      hold_type: h,
      reason: holdReason(h),
      blocks_scheduling: h !== "other",
      placed_by: ctx.actorId,
      placed_at: new Date(
        Math.min(
          ctx.now - 3_600_000,
          Date.parse(job.timeline[job.timeline.length - 1]!.at) + 3_600_000,
        ),
      ).toISOString(),
      is_demo: true,
    }));
  if (rows.length > 0) ok(await ctx.db.from("job_holds").insert(rows), "holds");
}

async function seedJob(
  ctx: Context,
  plan: DemoPlan,
  job: DemoJob,
  leadIds: Map<string, string>,
): Promise<string> {
  const lead = plan.leads.find((l) => l.key === job.leadKey)!;
  const leadId = leadIds.get(lead.key)!;
  const ownerId = ctx.people[lead.ownerIndex % ctx.people.length] ?? ctx.actorId;
  const jobId = await convert(ctx, leadId, lead, job);
  await seedAppointments(ctx, jobId, leadId, job, ownerId);
  await seedEstimate(ctx, jobId, job, lead);
  await seedMoney(ctx, jobId, job);
  await moveStage(ctx, jobId, job);
  await stampMilestones(ctx, jobId, job, lead);
  await seedProduction(ctx, jobId, job);
  await seedHolds(ctx, jobId, job);
  return jobId;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const guard = demoGuard(process.env, process.argv.slice(2));
  if (!guard.ok) fail(guard.reason);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const base: Db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const org = must(
    await base.from("organizations").select("id").eq("slug", "brushy-bear").single(),
    "organization",
  );
  const owners = must(
    await base
      .from("profiles")
      .select("id, full_name, role_templates!inner(key)")
      .eq("org_id", org.id)
      .eq("is_active", true)
      .eq("role_templates.key", "owner")
      .order("created_at"),
    "owners",
  );
  const actorId = owners[0]?.id;
  if (!actorId) fail("No active owner account yet. Run `pnpm seed:owners` first.");
  // Everything is recorded as done by the first owner (audit log, actor columns).
  const db: Db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-bb-actor-id": actorId } },
  });

  const counts = must(await db.rpc("demo_data_counts", { p_org: org.id }), "demo counts") as Record<
    string,
    number
  >;
  const existing = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
  const replace = process.argv.includes("--replace");
  if (process.argv.includes("--purge") || (existing > 0 && replace)) {
    out("Removing existing demo data…");
    const removed = await purgeDemo(db, org.id);
    out(
      `  removed ${
        Object.entries(removed)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${n} ${k}`)
          .join(", ") || "nothing"
      }`,
    );
    if (process.argv.includes("--purge")) return;
  } else if (existing > 0) {
    fail(
      "Demo data is already loaded. Pass --replace to remove it and load a fresh set, or --purge to only remove it.",
    );
  }

  const people = must(
    await db
      .from("profiles")
      .select("id, role_templates(key)")
      .eq("org_id", org.id)
      .eq("is_active", true)
      .order("created_at"),
    "people",
  )
    .filter((p) =>
      ["owner", "estimator", "sales", "office_manager"].some((k) =>
        p.role_templates?.key.includes(k),
      ),
    )
    .map((p) => p.id);

  const now = Date.now();
  const seed = Number(arg("seed") ?? 20261031);
  const plan = generateDemoPlan({
    seed,
    now: new Date(now),
    ownerCount: Math.max(1, people.length),
  });
  const started = Date.now();
  const partial = await loadContext(db, org.id, actorId, now);
  const crewIds = await seedCrews({ ...partial, people }, plan);
  const ctx: Context = {
    ...partial,
    people: people.length ? people : [actorId],
    crewIds,
    photo: await makePhoto(),
  };
  out(`Loading demo data (seed ${seed}) into ${new URL(url).host}…`);

  const leadIds = new Map<string, string>();
  await pool(plan.leads, 8, async (lead) => {
    leadIds.set(lead.key, await insertLead(ctx, lead));
  });
  out(`  ${leadIds.size} leads`);

  const jobIds: string[] = [];
  let done = 0;
  await pool(plan.jobs, 4, async (job) => {
    try {
      jobIds.push(await seedJob(ctx, plan, job, leadIds));
    } catch (e) {
      throw new Error(
        `job ${job.index} (${job.stage}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    done++;
    if (done % 20 === 0) out(`  ${done} / ${plan.jobs.length} jobs`);
  });

  out("  attention sweep and job health…");
  await runAttentionSweep(db, new Date());
  await recomputeJobHealth(db, jobIds, new Date());
  // Tag what the app's own functions created along the way (deposit holds and
  // invoices, payments, work orders, paint orders…) so counts show them too.
  const jobTables = [
    "estimates",
    "invoices",
    "payments",
    "work_orders",
    "paint_orders",
    "punch_items",
    "credits",
    "schedule_entries",
  ] as const;
  for (const table of jobTables) {
    for (let i = 0; i < jobIds.length; i += 200) {
      ok(
        await db
          .from(table)
          .update({ is_demo: true })
          .eq("org_id", org.id)
          .in("job_id", jobIds.slice(i, i + 200)),
        `${table} demo flag`,
      );
    }
  }
  for (let i = 0; i < jobIds.length; i += 200) {
    // Released holds are frozen; open ones (the deposit holds) get the tag.
    ok(
      await db
        .from("job_holds")
        .update({ is_demo: true })
        .in("job_id", jobIds.slice(i, i + 200))
        .is("released_at", null),
      "job_holds demo flag",
    );
  }
  const demoSubjects = [...leadIds.values(), ...jobIds];
  for (let i = 0; i < demoSubjects.length; i += 200) {
    ok(
      await db
        .from("attention_items")
        .update({ is_demo: true })
        .eq("org_id", org.id)
        .in("subject_id", demoSubjects.slice(i, i + 200)),
      "attention demo flag",
    );
  }

  const final = must(await db.rpc("demo_data_counts", { p_org: org.id }), "demo counts") as Record<
    string,
    number
  >;
  out(`\n✓ Demo data loaded in ${Math.round((Date.now() - started) / 1000)}s:`);
  for (const [k, n] of Object.entries(final)) if (Number(n) > 0) out(`  ${k}: ${n}`);
  out(
    "\nRemove it any time from Admin → Demo Data, or with `DEMO_DATA=true pnpm seed:demo --purge`.",
  );
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
