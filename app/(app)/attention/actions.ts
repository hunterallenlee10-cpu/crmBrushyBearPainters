"use server";

import { revalidatePath } from "next/cache";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";
import type { Database } from "@/lib/db/types";
import {
  assignAttentionSchema,
  attentionRefSchema,
  resolveAttentionSchema,
  snoozeAttentionSchema,
} from "./schemas";

/**
 * Attention Center mutations (SPEC §8.9, §9). People may only assign, start,
 * snooze, wake and resolve items: the database grants UPDATE on just
 * `status`, `snoozed_until`, `owner_id` and `resolution_note`, and its guard
 * checks the snooze time, the resolution note, and stamps `resolution =
 * 'manual'`. Each action is zod-validated, permission-checked (and refused
 * while viewing as another user) by defineAction, runs as the person so row
 * security decides, and is audit-logged and emitted as a domain event by
 * triggers on attention_items.
 */

type Patch = Pick<
  Database["public"]["Tables"]["attention_items"]["Update"],
  "status" | "snoozed_until" | "owner_id" | "resolution_note"
>;
type Status = "pending" | "in_progress" | "snoozed" | "resolved";

const NOT_FOUND = new ActionFailure({
  code: "not_found",
  message: "That item isn't available anymore. Refresh the list.",
});
const ALREADY_RESOLVED = new ActionFailure({
  code: "conflict",
  message: "This item is already resolved. Refresh the list.",
});

async function currentStatus(ctx: ActionContext, id: string): Promise<Status> {
  const row = check(
    await ctx.supabase.from("attention_items").select("id, status").eq("id", id).maybeSingle(),
  );
  if (!row) throw NOT_FOUND;
  return row.status as Status;
}

async function update(ctx: ActionContext, id: string, patch: Patch) {
  const row = check(
    await ctx.supabase
      .from("attention_items")
      .update(patch)
      .eq("id", id)
      .select("id, status")
      .maybeSingle(),
  );
  if (!row) throw NOT_FOUND;
  revalidatePath("/attention");
  return { id: row.id, status: row.status };
}

async function open(ctx: ActionContext, id: string): Promise<Status> {
  const status = await currentStatus(ctx, id);
  if (status === "resolved") throw ALREADY_RESOLVED;
  return status;
}

export const assignAttentionItem = defineAction({
  name: "attention.assign",
  schema: assignAttentionSchema,
  permissions: ["attention:read"],
  handler: async ({ id, ownerId }, ctx) => {
    await open(ctx, id);
    if (ownerId) {
      const person = check(
        await ctx.supabase.from("profiles").select("id, is_active").eq("id", ownerId).maybeSingle(),
      );
      if (!person?.is_active) {
        throw new ActionFailure({
          code: "validation",
          message: "Pick an active team member.",
          fieldErrors: { ownerId: ["Pick an active team member."] },
        });
      }
    }
    return update(ctx, id, { owner_id: ownerId });
  },
});

export const startAttentionItem = defineAction({
  name: "attention.start",
  schema: attentionRefSchema,
  permissions: ["attention:read"],
  handler: async ({ id }, ctx) => {
    const status = await open(ctx, id);
    if (status === "in_progress") return { id, status };
    return update(ctx, id, { status: "in_progress" });
  },
});

/** Ends a snooze early, or stops work on an item, so it's Pending again. */
export const reopenAttentionItem = defineAction({
  name: "attention.reopen",
  schema: attentionRefSchema,
  permissions: ["attention:read"],
  handler: async ({ id }, ctx) => {
    const status = await open(ctx, id);
    if (status === "pending") return { id, status };
    return update(ctx, id, { status: "pending", snoozed_until: null });
  },
});

export const snoozeAttentionItem = defineAction({
  name: "attention.snooze",
  schema: snoozeAttentionSchema,
  permissions: ["attention:read"],
  handler: async ({ id, until }, ctx) => {
    await open(ctx, id);
    return update(ctx, id, { status: "snoozed", snoozed_until: new Date(until).toISOString() });
  },
});

export const resolveAttentionItem = defineAction({
  name: "attention.resolve",
  schema: resolveAttentionSchema,
  permissions: ["attention:read"],
  handler: async ({ id, note }, ctx) => {
    await open(ctx, id);
    return update(ctx, id, { status: "resolved", resolution_note: note });
  },
});
