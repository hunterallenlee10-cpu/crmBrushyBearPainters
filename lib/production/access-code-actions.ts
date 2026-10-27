"use server";

import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import { decryptField } from "@/lib/crypto/field-encryption";
import { serverEnv } from "@/lib/env";
import { logError } from "@/lib/log";

/**
 * Gate / lockbox code for the crew (SPEC §5.1 "visible only to assigned users
 * on scheduled days"). Row security decides: a crew member or crew lead reads
 * the code only on a published schedule day at that property (Pacific); the
 * office keeps its permission. Every reveal is logged on the account timeline.
 */
export const revealJobAccessCode = defineAction({
  name: "field.reveal_access_code",
  schema: z.object({ job_id: z.uuid() }),
  permissions: null,
  handler: async ({ job_id }, ctx) => {
    const job = check(
      await ctx.supabase.from("jobs").select("id, property_id").eq("id", job_id).maybeSingle(),
    );
    if (!job?.property_id)
      throw new ActionFailure(actionError("not_found", "That job isn't available."));
    const secret = check(
      await ctx.supabase
        .from("property_secrets")
        .select("access_code_ciphertext")
        .eq("property_id", job.property_id)
        .maybeSingle(),
    );
    if (!secret) {
      throw new ActionFailure(
        actionError(
          "forbidden",
          "The code shows only on your scheduled day at this job (or there isn't one).",
        ),
      );
    }
    let key: string | undefined;
    try {
      key = serverEnv().FIELD_ENCRYPTION_KEY ?? undefined;
    } catch {
      key = undefined;
    }
    if (!key)
      throw new ActionFailure(
        actionError("validation", "Gate codes can't be read until FIELD_ENCRYPTION_KEY is set."),
      );
    let code: string;
    try {
      code = decryptField(secret.access_code_ciphertext, key);
    } catch (e) {
      logError("field.reveal_access_code", e);
      throw new ActionFailure(actionError("server", "The code couldn't be read. Ask the office."));
    }
    try {
      const svc = await ctx.service();
      const { data: prop } = await svc
        .from("properties")
        .select("account_id")
        .eq("id", job.property_id)
        .maybeSingle();
      if (prop) {
        await svc.from("activity").insert({
          org_id: ctx.viewer.orgId,
          subject_type: "account",
          subject_id: prop.account_id,
          type: "access_code_viewed",
          summary: "Viewed the gate/lockbox code on a scheduled day",
          payload: { property_id: job.property_id, job_id },
          actor_id: ctx.viewer.real.id,
        });
      }
    } catch (e) {
      logError("field.reveal_access_code.activity", e);
    }
    return { code };
  },
});
