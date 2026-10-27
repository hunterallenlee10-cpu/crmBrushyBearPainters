import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { UnsubscribeTarget } from "@/lib/messaging/links";

type Db = SupabaseClient<Database>;

/**
 * The two public messaging links (no login): `/r/<token>` tracks a review
 * request click and forwards to the company's review page; `/u/<token>`
 * unsubscribes from marketing email. Service client: the token is the
 * credential (the review token is stored only as a hash).
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export function isReviewToken(t: string): boolean {
  return TOKEN_RE.test(t);
}

function safeHttpsUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Records the click (first time sets clicked_at) and returns where to send them. */
export async function recordReviewClick(
  service: Db,
  token: string,
  now = new Date(),
): Promise<{ found: boolean; link: string | null; companyName: string | null }> {
  if (!isReviewToken(token)) return { found: false, link: null, companyName: null };
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: r } = await service
    .from("review_requests")
    .select("id, org_id, status, clicked_at, click_count, platform")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!r) return { found: false, link: null, companyName: null };
  await service
    .from("review_requests")
    .update({
      click_count: r.click_count + 1,
      clicked_at: r.clicked_at ?? now.toISOString(),
      status: r.status === "sent" ? "clicked" : r.status,
    })
    .eq("id", r.id);
  const { data: s } = await service
    .from("company_settings")
    .select("review_link, company_name")
    .eq("org_id", r.org_id)
    .maybeSingle();
  return { found: true, link: safeHttpsUrl(s?.review_link), companyName: s?.company_name ?? null };
}

export async function companyNameFor(service: Db, orgId: string): Promise<string | null> {
  const { data } = await service
    .from("company_settings")
    .select("company_name")
    .eq("org_id", orgId)
    .maybeSingle();
  return data?.company_name ?? null;
}

const exitNow = () => ({
  status: "exited" as const,
  exit_reason: "Unsubscribed from marketing email.",
  ended_at: new Date().toISOString(),
  next_run_at: null,
});

/** Marketing email opt-out for the contact or lead (transactional email still goes). */
export async function applyUnsubscribe(
  service: Db,
  t: UnsubscribeTarget,
  now = new Date(),
): Promise<boolean> {
  const at = now.toISOString();
  if (t.kind === "contact") {
    const { data } = await service
      .from("contacts")
      .update({ email_opted_out_at: at, email_opt_in: false })
      .eq("id", t.id)
      .eq("org_id", t.orgId)
      .is("email_opted_out_at", null)
      .select("id");
    if (data?.length) {
      await service
        .from("drip_enrollments")
        .update(exitNow())
        .eq("subject_type", "contact")
        .eq("subject_id", t.id)
        .eq("status", "active");
    }
    return true;
  }
  const { data } = await service
    .from("leads")
    .update({ email_opted_out_at: at })
    .eq("id", t.id)
    .eq("org_id", t.orgId)
    .is("email_opted_out_at", null)
    .select("id");
  if (data?.length) {
    await service
      .from("drip_enrollments")
      .update(exitNow())
      .eq("subject_type", "lead")
      .eq("subject_id", t.id)
      .eq("status", "active");
  }
  return true;
}
