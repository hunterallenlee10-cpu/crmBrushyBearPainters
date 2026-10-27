"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, checkOne } from "@/lib/actions/errors";
import { checkPublishable, type AgreementDocType } from "@/lib/estimating/engine";
import { agreementTemplateSchema, publishTemplateSchema } from "@/lib/validation/estimates";

/**
 * Admin → Agreement Templates (SPEC §8.19 BearSign). Anyone with
 * templates:manage edits drafts; publishing needs an owner, every slot
 * filled and the required merge fields (checked here and by the database).
 * Editing a published template's wording sends it back to draft.
 */

const refresh = (id?: string) => {
  revalidatePath("/admin/agreements");
  if (id) revalidatePath(`/admin/agreements/${id}`);
};

export const saveAgreementTemplate = defineAction({
  name: "agreements.save",
  permissions: ["templates:manage"],
  schema: agreementTemplateSchema,
  handler: async ({ id, doc_type, name, body, clauses }, ctx) => {
    const stored = clauses?.map((c) => ({
      title: c.title,
      body: c.body,
      when: c.when === "always" ? null : c.when,
    }));
    if (id) {
      const rows = check(
        await ctx.supabase
          .from("agreement_templates")
          .update({ name, body, ...(stored ? { clauses: stored } : {}) })
          .eq("id", id)
          .select("id"),
      );
      if (!rows?.length) throw new ActionFailure(actionError("not_found"));
      refresh(id);
      return { id };
    }
    const row = checkOne(
      await ctx.supabase
        .from("agreement_templates")
        .insert({
          org_id: ctx.viewer.orgId,
          doc_type,
          name,
          body,
          clauses: stored ?? [],
          signer_roles: ["customer"],
        })
        .select("id")
        .single(),
    );
    refresh(row.id);
    return { id: row.id };
  },
});

export const publishAgreementTemplate = defineAction({
  name: "agreements.publish",
  permissions: ["templates:manage", "settings:manage"],
  schema: publishTemplateSchema,
  handler: async ({ id, owner_confirmed, approval_note }, ctx) => {
    const t = check(
      await ctx.supabase
        .from("agreement_templates")
        .select("id, doc_type, body, clauses, status")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!t) throw new ActionFailure(actionError("not_found"));
    const clauses = Array.isArray(t.clauses)
      ? t.clauses.flatMap((c) =>
          c && typeof c === "object" && !Array.isArray(c) && typeof c.body === "string"
            ? [{ body: c.body }]
            : [],
        )
      : [];
    const verdict = checkPublishable({
      docType: t.doc_type as AgreementDocType,
      body: t.body,
      clauses,
      ownerConfirmed: owner_confirmed,
    });
    if (!verdict.ok) {
      throw new ActionFailure(actionError("validation", verdict.problems.join(" ")));
    }
    check(
      await ctx.supabase
        .from("agreement_templates")
        .update({ status: "published", approval_note: approval_note ?? null })
        .eq("id", id)
        .select("id"),
    );
    refresh(id);
    return { id };
  },
});
