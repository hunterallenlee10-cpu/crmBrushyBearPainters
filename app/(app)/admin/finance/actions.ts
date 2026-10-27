"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, mapDbError } from "@/lib/actions/errors";
import { canCloseMonth, monthStart } from "@/lib/domain/ledger/periods";
import { pacificToday } from "@/lib/domain/scheduling/dates";
import { closeMonthSchema, reopenMonthSchema } from "@/lib/validation/money";

/**
 * Admin → Finance (SPEC §8.19, §10): close a month (Finance) and reopen it
 * (owners only, with a reason). The database checks both again and keeps a
 * summary of the month at close.
 */

export const closeMonth = defineAction({
  name: "finance.month.close",
  schema: closeMonthSchema,
  permissions: ["finance:close_month"],
  handler: async (v, ctx) => {
    const problem = canCloseMonth(v.month, pacificToday(new Date()));
    if (problem) throw new ActionFailure(actionError("validation", problem));
    const service = await ctx.service();
    const { data, error } = await service.rpc("close_month", {
      p_month: monthStart(v.month),
      p_note: v.note ?? undefined,
    });
    if (error || !data) throw new ActionFailure(mapDbError(error));
    revalidatePath("/admin/finance");
    return { id: data };
  },
});

export const reopenMonth = defineAction({
  name: "finance.month.reopen",
  schema: reopenMonthSchema,
  permissions: ["finance:override_lock"],
  handler: async (v, ctx) => {
    const service = await ctx.service();
    const { error } = await service.rpc("reopen_month", {
      p_month: monthStart(v.month),
      p_reason: v.reason,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    revalidatePath("/admin/finance");
    return { month: v.month };
  },
});
