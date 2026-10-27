"use server";

import { revalidatePath } from "next/cache";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, checkOne, mapDbError } from "@/lib/actions/errors";
import type { Database } from "@/lib/db/types";
import { repriceVersion, loadPricingContext } from "@/lib/estimating/load";
import { quantityFromMeasurement } from "@/lib/estimating/measurement";
import { sendEstimateVersion } from "@/lib/estimating/send";
import { logError } from "@/lib/log";
import {
  areaAddSchema,
  areaCopySchema,
  areaUpdateSchema,
  colorAddSchema,
  colorUpdateSchema,
  createEstimateSchema,
  idSchema,
  lineAddSchema,
  lineUpdateSchema,
  optionAddSchema,
  optionUpdateSchema,
  requestDiscountSchema,
  sendSchema,
  versionIdSchema,
  versionUpdateSchema,
} from "@/lib/validation/estimates";
import { repriceChangeOrder } from "@/lib/estimating/change-orders";

/**
 * Estimate & Scope Builder mutations (SPEC §7, §8.5 #4). Each is zod-validated
 * and permission-checked by defineAction; content is written with the person's
 * own client so row security and the draft-only guards decide; the engine then
 * re-prices the draft with the service client (its columns are trusted-only).
 * Audit rows and domain events come from the database triggers.
 */

type LineInsert = Database["public"]["Tables"]["estimate_line_items"]["Insert"];
type LinePatch = Database["public"]["Tables"]["estimate_line_items"]["Update"];

const NOT_FOUND = new ActionFailure(actionError("not_found", "That estimate isn't available."));

function refresh(jobId: string, versionId?: string | null) {
  revalidatePath(`/jobs/${jobId}`);
  if (versionId) revalidatePath(`/jobs/${jobId}/estimate/${versionId}`);
  revalidatePath("/estimates");
}

/** The version and its job, as the person sees them (row security). */
async function versionRow(ctx: ActionContext, versionId: string) {
  const v = check(
    await ctx.supabase
      .from("estimate_versions")
      .select("id, org_id, status, estimate_id, estimates!inner(id, job_id)")
      .eq("id", versionId)
      .maybeSingle(),
  );
  if (!v) throw NOT_FOUND;
  return {
    id: v.id,
    orgId: v.org_id,
    status: v.status,
    estimateId: v.estimate_id,
    jobId: v.estimates.job_id,
  };
}

async function reprice(ctx: ActionContext, versionId: string) {
  try {
    await repriceVersion(await ctx.service(), versionId);
  } catch (e) {
    logError("estimates.reprice", e);
    throw new ActionFailure(
      actionError("server", "Saved, but the prices couldn't be updated. Try again."),
    );
  }
}

/** Where a line lives: an estimate version or a change order. */
async function lineParent(ctx: ActionContext, lineId: string) {
  const l = check(
    await ctx.supabase
      .from("estimate_line_items")
      .select(
        "id, version_id, change_order_id, option_id, area_id, catalog_item_id, kind, unit, surface",
      )
      .eq("id", lineId)
      .maybeSingle(),
  );
  if (!l) throw NOT_FOUND;
  return l;
}

async function afterLineChange(
  ctx: ActionContext,
  parent: { version_id: string | null; change_order_id: string | null },
) {
  if (parent.version_id) {
    const v = await versionRow(ctx, parent.version_id);
    await reprice(ctx, v.id);
    refresh(v.jobId, v.id);
  } else if (parent.change_order_id) {
    const service = await ctx.service();
    const co = await repriceChangeOrder(service, parent.change_order_id);
    if (co) refresh(co.jobId);
  }
}

// --- Estimates and versions -------------------------------------------------------------

export const createEstimate = defineAction({
  name: "estimates.create",
  permissions: ["estimates:create"],
  schema: createEstimateSchema,
  handler: async ({ job_id, title }, ctx) => {
    const { data, error } = await ctx.supabase.rpc("create_estimate", {
      p_job: job_id,
      p_title: title ?? "",
    });
    if (error || !data) throw new ActionFailure(mapDbError(error));
    const est = checkOne(
      await ctx.supabase.from("estimates").select("current_version_id").eq("id", data).single(),
    );
    if (est.current_version_id) await reprice(ctx, est.current_version_id);
    refresh(job_id, est.current_version_id);
    return { estimateId: data, versionId: est.current_version_id };
  },
});

export const updateVersion = defineAction({
  name: "estimates.update_version",
  permissions: ["estimates:create"],
  schema: versionUpdateSchema,
  handler: async ({ version_id, ...patch }, ctx) => {
    const v = await versionRow(ctx, version_id);
    const rows = check(
      await ctx.supabase.from("estimate_versions").update(patch).eq("id", version_id).select("id"),
    );
    if (!rows?.length) throw NOT_FOUND;
    await reprice(ctx, version_id);
    refresh(v.jobId, version_id);
    return { id: version_id };
  },
});

export const newVersion = defineAction({
  name: "estimates.new_version",
  permissions: ["estimates:create"],
  schema: versionIdSchema,
  handler: async ({ version_id }, ctx) => {
    const v = await versionRow(ctx, version_id);
    const { data, error } = await ctx.supabase.rpc("copy_estimate_version", {
      p_version: version_id,
    });
    if (error || !data) throw new ActionFailure(mapDbError(error));
    await reprice(ctx, data);
    refresh(v.jobId, data);
    return { versionId: data };
  },
});

export const discardVersion = defineAction({
  name: "estimates.discard_version",
  permissions: ["estimates:create"],
  schema: versionIdSchema,
  handler: async ({ version_id }, ctx) => {
    const v = await versionRow(ctx, version_id);
    const { error } = await ctx.supabase.from("estimate_versions").delete().eq("id", version_id);
    if (error) throw new ActionFailure(mapDbError(error));
    const est = checkOne(
      await ctx.supabase
        .from("estimates")
        .select("current_version_id")
        .eq("id", v.estimateId)
        .single(),
    );
    refresh(v.jobId);
    return { versionId: est.current_version_id };
  },
});

export const sendEstimate = defineAction({
  name: "estimates.send",
  permissions: ["estimates:send", "messages:send"],
  schema: sendSchema,
  handler: async ({ id, channels, sms_body, email_subject, email_body }, ctx) => {
    const v = await versionRow(ctx, id);
    const result = await sendEstimateVersion(
      {
        versionId: id,
        channels,
        smsBody: sms_body,
        emailSubject: email_subject,
        emailBody: email_body,
      },
      ctx,
    );
    refresh(v.jobId, id);
    return { url: result.url, expiresAt: result.expiresAt, stage: result.stage };
  },
});

export const requestDiscountApproval = defineAction({
  name: "estimates.request_discount_approval",
  permissions: ["estimates:create"],
  schema: requestDiscountSchema,
  handler: async ({ version_id, reason }, ctx) => {
    const v = await versionRow(ctx, version_id);
    if (v.status !== "draft")
      throw new ActionFailure(actionError("validation", "Only a draft needs approval."));
    const repriced = await repriceVersion(await ctx.service(), version_id);
    if (!repriced) throw NOT_FOUND;
    const est = checkOne(
      await ctx.supabase
        .from("estimates")
        .select("estimate_number")
        .eq("id", v.estimateId)
        .single(),
    );
    const { error } = await ctx.supabase.from("approval_requests").insert({
      org_id: v.orgId,
      requested_by: ctx.viewer.id, // the database stamps the real requester
      type: "estimate_discount",
      job_id: v.jobId,
      reason,
      payload: {
        version_id,
        estimate_id: v.estimateId,
        estimate_number: est.estimate_number,
        discount_percent: repriced.priced.maxEffectiveDiscountPercent,
      },
    });
    if (error) {
      if (error.code === "23505") {
        throw new ActionFailure(
          actionError(
            "conflict",
            "A discount request for this job is already waiting in Approvals.",
          ),
        );
      }
      throw new ActionFailure(mapDbError(error));
    }
    refresh(v.jobId, version_id);
    revalidatePath("/jobs/approvals");
    return { requested: true };
  },
});

// --- Options and areas ---------------------------------------------------------------

async function nextSort(
  ctx: ActionContext,
  where:
    | { table: "estimate_options"; versionId: string }
    | { table: "estimate_areas"; optionId: string }
    | { table: "estimate_line_items"; versionId?: string; changeOrderId?: string },
) {
  let q;
  if (where.table === "estimate_options") {
    q = ctx.supabase
      .from("estimate_options")
      .select("sort_order")
      .eq("version_id", where.versionId);
  } else if (where.table === "estimate_areas") {
    q = ctx.supabase.from("estimate_areas").select("sort_order").eq("option_id", where.optionId);
  } else {
    q = where.versionId
      ? ctx.supabase
          .from("estimate_line_items")
          .select("sort_order")
          .eq("version_id", where.versionId)
      : ctx.supabase
          .from("estimate_line_items")
          .select("sort_order")
          .eq("change_order_id", where.changeOrderId ?? "");
  }
  const { data } = await q.order("sort_order", { ascending: false }).limit(1);
  return (data?.[0]?.sort_order ?? 0) + 10;
}

export const addOption = defineAction({
  name: "estimates.add_option",
  permissions: ["estimates:create"],
  schema: optionAddSchema,
  handler: async ({ version_id, name }, ctx) => {
    const v = await versionRow(ctx, version_id);
    const data = checkOne(
      await ctx.supabase
        .from("estimate_options")
        .insert({
          org_id: v.orgId,
          version_id,
          name,
          sort_order: await nextSort(ctx, { table: "estimate_options", versionId: version_id }),
        })
        .select("id")
        .single(),
    );
    await reprice(ctx, version_id);
    refresh(v.jobId, version_id);
    return { id: data.id };
  },
});

export const updateOption = defineAction({
  name: "estimates.update_option",
  permissions: ["estimates:create"],
  schema: optionUpdateSchema,
  handler: async ({ id, ...patch }, ctx) => {
    const opt = check(
      await ctx.supabase
        .from("estimate_options")
        .select("id, version_id")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!opt) throw NOT_FOUND;
    const v = await versionRow(ctx, opt.version_id);
    if (patch.is_recommended) {
      // One recommended option per version.
      check(
        await ctx.supabase
          .from("estimate_options")
          .update({ is_recommended: false })
          .eq("version_id", opt.version_id)
          .neq("id", id),
      );
    }
    check(await ctx.supabase.from("estimate_options").update(patch).eq("id", id));
    await reprice(ctx, opt.version_id);
    refresh(v.jobId, opt.version_id);
    return { id };
  },
});

export const deleteOption = defineAction({
  name: "estimates.delete_option",
  permissions: ["estimates:create"],
  schema: idSchema,
  handler: async ({ id }, ctx) => {
    const opt = check(
      await ctx.supabase
        .from("estimate_options")
        .select("id, version_id")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!opt) throw NOT_FOUND;
    const v = await versionRow(ctx, opt.version_id);
    const { count } = await ctx.supabase
      .from("estimate_options")
      .select("id", { count: "exact", head: true })
      .eq("version_id", opt.version_id);
    if ((count ?? 0) <= 1) {
      throw new ActionFailure(actionError("validation", "An estimate needs at least one option."));
    }
    check(await ctx.supabase.from("estimate_options").delete().eq("id", id));
    await reprice(ctx, opt.version_id);
    refresh(v.jobId, opt.version_id);
    return { id };
  },
});

/** Copies an option with its areas and lines ("Good / Better / Best"). */
export const duplicateOption = defineAction({
  name: "estimates.duplicate_option",
  permissions: ["estimates:create"],
  schema: idSchema,
  handler: async ({ id }, ctx) => {
    const opt = check(
      await ctx.supabase.from("estimate_options").select("*").eq("id", id).maybeSingle(),
    );
    if (!opt) throw NOT_FOUND;
    const v = await versionRow(ctx, opt.version_id);
    const created = checkOne(
      await ctx.supabase
        .from("estimate_options")
        .insert({
          org_id: opt.org_id,
          version_id: opt.version_id,
          name: `${opt.name} (copy)`.slice(0, 120),
          description: opt.description,
          sort_order: await nextSort(ctx, { table: "estimate_options", versionId: opt.version_id }),
        })
        .select("id")
        .single(),
    );
    const areas =
      check(await ctx.supabase.from("estimate_areas").select("*").eq("option_id", id)) ?? [];
    const lines =
      check(await ctx.supabase.from("estimate_line_items").select("*").eq("option_id", id)) ?? [];
    const areaMap = new Map<string, string>();
    for (const a of areas) {
      const na = checkOne(
        await ctx.supabase
          .from("estimate_areas")
          .insert({
            org_id: a.org_id,
            version_id: a.version_id,
            option_id: created.id,
            name: a.name,
            work_type: a.work_type,
            measurements: a.measurements,
            notes: a.notes,
            sort_order: a.sort_order,
          })
          .select("id")
          .single(),
      );
      areaMap.set(a.id, na.id);
    }
    for (const l of lines) {
      check(
        await ctx.supabase
          .from("estimate_line_items")
          .insert(copyLine(l, created.id, l.area_id ? (areaMap.get(l.area_id) ?? null) : null)),
      );
    }
    await reprice(ctx, opt.version_id);
    refresh(v.jobId, opt.version_id);
    return { id: created.id };
  },
});

function copyLine(
  l: Database["public"]["Tables"]["estimate_line_items"]["Row"],
  optionId: string,
  areaId: string | null,
): LineInsert {
  return {
    org_id: l.org_id,
    version_id: l.version_id,
    option_id: optionId,
    area_id: areaId,
    catalog_item_id: l.catalog_item_id,
    kind: l.kind,
    is_optional: false,
    name: l.name,
    customer_note: l.customer_note,
    catalog_code: l.catalog_code,
    surface: l.surface,
    unit: l.unit,
    work_type: l.work_type,
    work_order_phase: l.work_order_phase,
    quantity: l.quantity,
    sides: l.sides,
    condition: l.condition,
    prep_level: l.prep_level,
    coats: l.coats,
    primer: l.primer,
    color_change: l.color_change,
    method: l.method,
    access: l.access,
    height: l.height,
    sheen: l.sheen,
    paint_product_id: l.paint_product_id,
    primer_product_id: l.primer_product_id,
    lead_safe: l.lead_safe,
    taxable: l.taxable,
    is_repair_allowance: l.is_repair_allowance,
    unit_price_cents: l.unit_price_cents,
    unit_cost_cents: l.unit_cost_cents,
    labor_hours_per_unit: l.labor_hours_per_unit,
    paint_sqft_per_unit: l.paint_sqft_per_unit,
    override_price_cents: l.override_price_cents,
    override_reason: l.override_reason,
    measurement: l.measurement,
    sort_order: l.sort_order,
  };
}

export const addArea = defineAction({
  name: "estimates.add_area",
  permissions: ["estimates:create"],
  schema: areaAddSchema,
  handler: async ({ version_id, option_id, name, work_type }, ctx) => {
    const v = await versionRow(ctx, version_id);
    const data = checkOne(
      await ctx.supabase
        .from("estimate_areas")
        .insert({
          org_id: v.orgId,
          version_id,
          option_id,
          name,
          work_type,
          sort_order: await nextSort(ctx, { table: "estimate_areas", optionId: option_id }),
        })
        .select("id")
        .single(),
    );
    refresh(v.jobId, version_id);
    return { id: data.id };
  },
});

export const updateArea = defineAction({
  name: "estimates.update_area",
  permissions: ["estimates:create"],
  schema: areaUpdateSchema,
  handler: async ({ id, ...patch }, ctx) => {
    const area = check(
      await ctx.supabase.from("estimate_areas").select("id, version_id").eq("id", id).maybeSingle(),
    );
    if (!area) throw NOT_FOUND;
    const v = await versionRow(ctx, area.version_id);
    check(await ctx.supabase.from("estimate_areas").update(patch).eq("id", id));
    await reprice(ctx, area.version_id);
    refresh(v.jobId, area.version_id);
    return { id };
  },
});

export const deleteArea = defineAction({
  name: "estimates.delete_area",
  permissions: ["estimates:create"],
  schema: idSchema,
  handler: async ({ id }, ctx) => {
    const area = check(
      await ctx.supabase.from("estimate_areas").select("id, version_id").eq("id", id).maybeSingle(),
    );
    if (!area) throw NOT_FOUND;
    const v = await versionRow(ctx, area.version_id);
    check(await ctx.supabase.from("estimate_areas").delete().eq("id", id));
    await reprice(ctx, area.version_id);
    refresh(v.jobId, area.version_id);
    return { id };
  },
});

/** Copies an area (and its lines) into another option of the same version. */
export const copyAreaToOption = defineAction({
  name: "estimates.copy_area",
  permissions: ["estimates:create"],
  schema: areaCopySchema,
  handler: async ({ id, to_option_id }, ctx) => {
    const area = check(
      await ctx.supabase.from("estimate_areas").select("*").eq("id", id).maybeSingle(),
    );
    if (!area) throw NOT_FOUND;
    const v = await versionRow(ctx, area.version_id);
    const na = checkOne(
      await ctx.supabase
        .from("estimate_areas")
        .insert({
          org_id: area.org_id,
          version_id: area.version_id,
          option_id: to_option_id,
          name: area.name,
          work_type: area.work_type,
          measurements: area.measurements,
          notes: area.notes,
          sort_order: await nextSort(ctx, { table: "estimate_areas", optionId: to_option_id }),
        })
        .select("id")
        .single(),
    );
    const lines =
      check(await ctx.supabase.from("estimate_line_items").select("*").eq("area_id", id)) ?? [];
    for (const l of lines) {
      check(
        await ctx.supabase.from("estimate_line_items").insert(copyLine(l, to_option_id, na.id)),
      );
    }
    await reprice(ctx, area.version_id);
    refresh(v.jobId, area.version_id);
    return { id: na.id };
  },
});

// --- Lines -------------------------------------------------------------------------

const SHEEN_PREFERENCE = ["eggshell", "satin", "semi_gloss", "flat", "matte", "gloss"];
const LEAD_SAFE_WORK = new Set(["interior", "exterior", "cabinets"]);

export const addLine = defineAction({
  name: "estimates.add_line",
  permissions: ["estimates:create"],
  schema: lineAddSchema,
  handler: async (input, ctx) => {
    let orgId: string;
    let jobId: string;
    if (input.version_id) {
      const v = await versionRow(ctx, input.version_id);
      orgId = v.orgId;
      jobId = v.jobId;
    } else {
      const co = check(
        await ctx.supabase
          .from("change_orders")
          .select("id, org_id, job_id")
          .eq("id", input.change_order_id as string)
          .maybeSingle(),
      );
      if (!co) throw NOT_FOUND;
      orgId = co.org_id;
      jobId = co.job_id;
    }
    const job = check(
      await ctx.supabase
        .from("jobs")
        .select("id, property:properties(lead_safe_required)")
        .eq("id", jobId)
        .maybeSingle(),
    );
    const preLeadSafe = job?.property?.lead_safe_required ?? false;
    const sort = await nextSort(
      ctx,
      input.version_id
        ? { table: "estimate_line_items", versionId: input.version_id }
        : { table: "estimate_line_items", changeOrderId: input.change_order_id ?? "" },
    );
    const placement = input.version_id
      ? {
          version_id: input.version_id,
          option_id: input.option_id,
          area_id: input.option_id ? input.area_id : null,
          is_optional: input.option_id === null,
        }
      : { change_order_id: input.change_order_id, is_credit: input.is_credit ?? false };

    let row: LineInsert;
    if (input.catalog_item_id) {
      const item = check(
        await ctx.supabase
          .from("catalog_items")
          .select("*")
          .eq("id", input.catalog_item_id)
          .maybeSingle(),
      );
      if (!item || !item.active) {
        throw new ActionFailure(actionError("not_found", "That catalog item isn't available."));
      }
      let sheen: string | null = null;
      if (item.default_product_id) {
        const p = check(
          await ctx.supabase
            .from("paint_products")
            .select("sheens")
            .eq("id", item.default_product_id)
            .maybeSingle(),
        );
        sheen = SHEEN_PREFERENCE.find((s) => p?.sheens.includes(s)) ?? p?.sheens[0] ?? null;
      }
      row = {
        org_id: orgId,
        ...placement,
        catalog_item_id: item.id,
        kind: item.pricing_method === "production_rate" ? "production_rate" : "flat",
        name: item.name,
        catalog_code: item.code,
        surface: item.surface,
        unit: item.unit,
        work_type: item.work_type,
        work_order_phase: item.work_order_phase,
        quantity: item.unit === "lump" ? 1 : 0,
        coats: item.default_coats,
        method: item.default_method,
        paint_product_id: item.default_product_id,
        paint_sqft_per_unit: item.paint_sqft_per_unit,
        sheen,
        unit_price_cents: item.pricing_method === "flat" ? item.unit_price_cents : null,
        unit_cost_cents: item.pricing_method === "flat" ? item.unit_cost_cents : null,
        labor_hours_per_unit: item.labor_hours_per_unit,
        taxable: item.taxable,
        is_repair_allowance: item.is_repair_allowance,
        customer_note: item.customer_description,
        // Pre-1978 (or not sure) homes: painted surfaces we disturb get lead-safe prep (SPEC §7.3).
        lead_safe:
          preLeadSafe &&
          item.pricing_method === "production_rate" &&
          LEAD_SAFE_WORK.has(item.work_type ?? "") &&
          Number(item.paint_sqft_per_unit) > 0,
        sort_order: sort,
      };
    } else {
      row = {
        org_id: orgId,
        ...placement,
        kind: "flat",
        name: input.custom_name as string,
        unit: input.custom_unit ?? "each",
        quantity: 1,
        unit_price_cents: input.custom_price,
        unit_cost_cents: input.custom_cost ?? 0,
        sort_order: sort,
      };
    }
    const data = checkOne(
      await ctx.supabase.from("estimate_line_items").insert(row).select("id").single(),
    );
    await afterLineChange(ctx, {
      version_id: input.version_id,
      change_order_id: input.change_order_id,
    });
    return { id: data.id };
  },
});

export const updateLine = defineAction({
  name: "estimates.update_line",
  permissions: ["estimates:create"],
  schema: lineUpdateSchema,
  handler: async (
    { id, unit_price, unit_cost, override_price, override_reason, measurement, ...rest },
    ctx,
  ) => {
    const line = await lineParent(ctx, id);
    const patch: LinePatch = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    }
    if (unit_price !== null && unit_price !== undefined) patch.unit_price_cents = unit_price;
    if (unit_cost !== null && unit_cost !== undefined) patch.unit_cost_cents = unit_cost;
    if (override_price !== undefined) {
      if (override_price === null) {
        patch.override_price_cents = null;
        patch.override_reason = null;
      } else {
        if (!override_reason || override_reason.length < 3) {
          throw new ActionFailure(
            actionError("validation", "Say why the price is overridden.", {
              override_reason: ["Say why the price is overridden."],
            }),
          );
        }
        patch.override_price_cents = override_price;
        patch.override_reason = override_reason;
      }
    }
    if (measurement && measurement.kind) {
      const orgId = checkOne(
        await ctx.supabase.from("estimate_line_items").select("org_id").eq("id", id).single(),
      ).org_id;
      const pc = await loadPricingContext(await ctx.service(), orgId);
      const qty = quantityFromMeasurement(measurement, pc.settings);
      if (qty !== null) {
        patch.quantity = qty;
        patch.measurement = measurement;
      }
    }
    const rows = check(
      await ctx.supabase.from("estimate_line_items").update(patch).eq("id", id).select("id"),
    );
    if (!rows?.length) throw NOT_FOUND;
    await afterLineChange(ctx, line);
    return { id, quantity: patch.quantity ?? null };
  },
});

export const deleteLine = defineAction({
  name: "estimates.delete_line",
  permissions: ["estimates:create"],
  schema: idSchema,
  handler: async ({ id }, ctx) => {
    const line = await lineParent(ctx, id);
    check(await ctx.supabase.from("estimate_line_items").delete().eq("id", id));
    await afterLineChange(ctx, line);
    return { id };
  },
});

// --- Colors -----------------------------------------------------------------------

export const updateColor = defineAction({
  name: "estimates.update_color",
  permissions: ["estimates:create"],
  schema: colorUpdateSchema,
  handler: async ({ id, confirmed, ...patch }, ctx) => {
    const row = check(
      await ctx.supabase.from("color_selections").select("id, job_id").eq("id", id).maybeSingle(),
    );
    if (!row) throw new ActionFailure(actionError("not_found", "That color row isn't available."));
    const status = confirmed === undefined ? undefined : confirmed ? "confirmed" : "selected";
    const rows = check(
      await ctx.supabase
        .from("color_selections")
        .update({ ...patch, ...(status ? { status } : {}) })
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length) {
      throw new ActionFailure(
        actionError("forbidden", "You can only change colors on jobs you're on."),
      );
    }
    refresh(row.job_id);
    return { id };
  },
});

export const addColor = defineAction({
  name: "estimates.add_color",
  permissions: ["estimates:create"],
  schema: colorAddSchema,
  handler: async ({ job_id, area, surface }, ctx) => {
    const job = check(
      await ctx.supabase.from("jobs").select("id, org_id").eq("id", job_id).maybeSingle(),
    );
    if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
    const data = checkOne(
      await ctx.supabase
        .from("color_selections")
        .insert({ org_id: job.org_id, job_id, area, surface, sort_order: 5000 })
        .select("id")
        .single(),
    );
    refresh(job_id);
    return { id: data.id };
  },
});
