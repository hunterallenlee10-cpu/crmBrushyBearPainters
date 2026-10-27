"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { check } from "@/lib/actions/errors";
import { marketingSpendSchema, revenueGoalsSchema } from "@/lib/validation/analytics";

/**
 * Admin → Marketing Spend and Revenue Goals (SPEC §12.1 cost per lead / CAC,
 * §8.2 Revenue Forecast goal). settings:manage; row security checks again;
 * audit rows and marketing_spend.* / revenue_goal.* events come from triggers.
 * An empty amount removes the month's row.
 */
export const saveMarketingSpend = defineAction({
  name: "admin.save_marketing_spend",
  schema: marketingSpendSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase, viewer }) => {
    const upserts = v.rows.filter((r) => r.amount !== null);
    const clears = v.rows.filter((r) => r.amount === null).map((r) => r.lead_source);
    if (upserts.length) {
      check(
        await supabase.from("marketing_spend").upsert(
          upserts.map((r) => ({
            org_id: viewer.orgId,
            month: v.month,
            lead_source: r.lead_source,
            amount_cents: r.amount!,
          })),
          { onConflict: "org_id,month,lead_source" },
        ),
      );
    }
    if (clears.length) {
      check(
        await supabase
          .from("marketing_spend")
          .delete()
          .eq("month", v.month)
          .in("lead_source", clears),
      );
    }
    revalidatePath("/admin/marketing-spend");
    return { saved: upserts.length, cleared: clears.length };
  },
});

export const saveRevenueGoals = defineAction({
  name: "admin.save_revenue_goals",
  schema: revenueGoalsSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase, viewer }) => {
    const upserts = v.months.filter((m) => m.goal !== null);
    const clears = v.months.filter((m) => m.goal === null).map((m) => m.month);
    if (upserts.length) {
      check(
        await supabase.from("revenue_goals").upsert(
          upserts.map((m) => ({ org_id: viewer.orgId, month: m.month, goal_cents: m.goal! })),
          { onConflict: "org_id,month" },
        ),
      );
    }
    if (clears.length) check(await supabase.from("revenue_goals").delete().in("month", clears));
    revalidatePath("/admin/revenue-goals");
    return { saved: upserts.length, cleared: clears.length };
  },
});
