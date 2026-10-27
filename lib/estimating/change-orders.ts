import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import type { Database } from "@/lib/db/types";
import {
  buildChangeOrderSnapshot,
  expiresAt as computeExpiry,
  priceChangeOrder,
  type PricedChangeOrder,
} from "@/lib/estimating/engine";
import { serverEnv } from "@/lib/env";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { logError } from "@/lib/log";
import { loadPricingContext } from "./load";
import { lineResultJson, settingsJson, toVersionLine } from "./map";
import { checkChannels, deliverLink, loadRecipient, type SendMessages } from "./send";
import { generateProposalToken, proposalUrl } from "./tokens";

type Db = SupabaseClient<Database>;

/**
 * Change orders (SPEC §7.7): the same line engine on a draft attached to the
 * job; the customer signs it on the proposal page; a signed change order
 * updates the contract and can draft a change-order invoice.
 */

export async function repriceChangeOrder(
  service: Db,
  coId: string,
): Promise<{ jobId: string; priced: PricedChangeOrder } | null> {
  const { data: co } = await service.from("change_orders").select("*").eq("id", coId).maybeSingle();
  if (!co) return null;
  const { data: lines } = await service
    .from("estimate_line_items")
    .select("*")
    .eq("change_order_id", coId)
    .order("sort_order");
  const ctx = await loadPricingContext(service, co.org_id);
  const vlines = (lines ?? []).map((l) => toVersionLine(l, ctx.lookups));
  const priced = priceChangeOrder({
    id: co.id,
    title: co.title,
    reason: co.reason,
    lines: vlines,
    settings: ctx.settings,
  });
  if (co.status === "draft") {
    const { error } = await service.rpc("store_change_order_pricing", {
      p_change_order: coId,
      p_settings: settingsJson(ctx.settings),
      p_priced: JSON.parse(
        JSON.stringify({
          issues: priced.issues,
          sendable: priced.sendable,
          costCents: priced.costCents,
          laborHours: priced.laborHours,
        }),
      ),
      p_subtotal: priced.subtotalCents,
      p_tax: priced.taxCents,
      p_total: priced.totalCents,
      p_lines: priced.lines.map((l) => lineResultJson(l.line.id, l.line, l.priced)),
    });
    if (error) throw error;
  }
  return { jobId: co.job_id, priced };
}

export async function sendChangeOrder(
  input: { id: string } & SendMessages,
  ctx: ActionContext,
): Promise<{ url: string; expiresAt: string }> {
  const co = check(
    await ctx.supabase
      .from("change_orders")
      .select("id, org_id, job_id, status, title, reason")
      .eq("id", input.id)
      .maybeSingle(),
  );
  if (!co) throw new ActionFailure(actionError("not_found", "That change order isn't available."));
  if (co.status !== "draft") {
    throw new ActionFailure(actionError("validation", "This change order was already sent."));
  }
  const job = check(
    await ctx.supabase
      .from("jobs")
      .select("id, org_id, primary_contact_id, lead_id")
      .eq("id", co.job_id)
      .maybeSingle(),
  );
  if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
  const service = await ctx.service();
  const recipient = await loadRecipient(ctx.supabase, service, job);
  checkChannels(recipient, input.channels);

  const repriced = await repriceChangeOrder(service, co.id);
  if (!repriced)
    throw new ActionFailure(actionError("not_found", "That change order isn't available."));
  const problems = [
    ...new Set(repriced.priced.issues.filter((i) => i.severity === "error").map((i) => i.message)),
  ];
  if (problems.length)
    throw new ActionFailure(actionError("validation", `Fix these first: ${problems.join(" ")}`));

  const { data: fin } = await service
    .from("job_financials")
    .select("contract_cents")
    .eq("job_id", job.id)
    .maybeSingle();
  const pc = await loadPricingContext(service, co.org_id);
  const { data: lines } = await service
    .from("estimate_line_items")
    .select("*")
    .eq("change_order_id", co.id);
  const vlines = (lines ?? []).map((l) => toVersionLine(l, pc.lookups));
  const snapshot = buildChangeOrderSnapshot(
    { id: co.id, title: co.title, reason: co.reason, lines: vlines, settings: pc.settings },
    repriced.priced,
    { beforeCents: fin?.contract_cents ?? null },
  );
  const { token, hash } = generateProposalToken();
  const expires = computeExpiry(new Date(), pc.settings.expiryDays);
  const { error } = await service.rpc("mark_change_order_sent", {
    p_change_order: co.id,
    p_token_hash: hash,
    p_expires_at: expires.toISOString(),
    p_proposal: JSON.parse(JSON.stringify(snapshot)),
    p_channels: [...input.channels],
  });
  if (error) throw new ActionFailure(mapDbError(error));
  const url = proposalUrl(serverEnv().APP_URL, token);
  await deliverLink(ctx, recipient, url, input);
  await recomputeJobHealth(service, [job.id]).catch((e: unknown) => logError("co.send.health", e));
  return { url, expiresAt: expires.toISOString() };
}
