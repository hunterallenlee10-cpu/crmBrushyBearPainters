"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";
import { decryptField, encryptField, FieldEncryptionError } from "@/lib/crypto/field-encryption";
import { logError } from "@/lib/log";
import {
  accessCodeSchema,
  bulkAssignAccountsSchema,
  createAccountSchema,
  createPropertySchema,
  deleteRecordSchema,
  propertyIdSchema,
  setPrimaryContactSchema,
  updateAccountSchema,
  updatePropertySchema,
  type AccountStatus,
  type AccountType,
} from "@/lib/validation/accounts";
import {
  contactColumns,
  fieldEncryptionKey,
  logAccountActivity,
  MISSING_KEY_MESSAGE,
  propertyColumns,
  shortAddress,
} from "./_lib/rows";

/**
 * Accounts, their properties and gate/lockbox codes (SPEC §5.1, §8.10, §13.1).
 * Every read and write uses the user-scoped client, so RLS decides scope; audit
 * rows and domain events come from database triggers in the same transaction.
 */

function revalidateAccount(id?: string) {
  revalidatePath("/accounts");
  revalidatePath("/contacts");
  if (id) revalidatePath(`/accounts/${id}`);
}

/** The account must be visible to the caller (RLS), or the action stops with "not found". */
async function requireVisibleAccount(ctx: ActionContext, id: string) {
  const row = check(
    await ctx.supabase.from("accounts").select("id, display_name").eq("id", id).maybeSingle(),
  );
  if (!row) {
    throw new ActionFailure({ code: "not_found", message: "That account isn't available." });
  }
  return row;
}

async function requireVisibleProperty(ctx: ActionContext, id: string) {
  const row = check(
    await ctx.supabase
      .from("properties")
      .select("id, account_id, street, city, zip, is_primary")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!row) {
    throw new ActionFailure({ code: "not_found", message: "That property isn't available." });
  }
  return row;
}

/** `.single()` results are typed nullable; a missing row here means the write didn't happen. */
function saved<T>(row: T): NonNullable<T> {
  if (!row)
    throw new ActionFailure({ code: "server", message: "The change wasn't saved. Try again." });
  return row;
}

function noRows(message: string): never {
  throw new ActionFailure({ code: "forbidden", message });
}

// -----------------------------------------------------------------------------
// Preview (list drawer)
// -----------------------------------------------------------------------------

export type AccountPreview = {
  id: string;
  name: string;
  type: AccountType;
  status: AccountStatus;
  ownerName: string | null;
  territoryName: string | null;
  isReferralChampion: boolean;
  tags: string[];
  primaryContact: {
    name: string;
    mobile: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  properties: { id: string; address: string; leadSafe: boolean; isPrimary: boolean }[];
  contactCount: number;
  leadCount: number;
  createdAt: string;
  notes: string | null;
};

export const getAccountPreview = defineAction({
  name: "accounts.preview",
  permissions: ["accounts:read"],
  schema: z.object({ id: z.uuid() }),
  handler: async ({ id }, { supabase }): Promise<AccountPreview> => {
    const [acc, contacts, leads] = await Promise.all([
      supabase
        .from("accounts")
        .select(
          "id, display_name, account_type, status, is_referral_champion, tags, notes, created_at, owner:profiles!accounts_owner_id_fkey(full_name), territory:territories!accounts_territory_id_fkey(name), primary_contact:contacts!accounts_primary_contact_fk(first_name, last_name, mobile, phone, email), properties(id, street, unit, city, state, zip, is_primary, lead_safe_required)",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("account_id", id),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("account_id", id),
    ]);
    const a = check(acc);
    if (!a)
      throw new ActionFailure({ code: "not_found", message: "That account isn't available." });
    const pc = a.primary_contact;
    return {
      id: a.id,
      name: a.display_name,
      type: a.account_type as AccountType,
      status: a.status as AccountStatus,
      ownerName: a.owner?.full_name ?? null,
      territoryName: a.territory?.name ?? null,
      isReferralChampion: a.is_referral_champion,
      tags: a.tags,
      primaryContact: pc
        ? {
            name: [pc.first_name, pc.last_name].filter(Boolean).join(" "),
            mobile: pc.mobile,
            phone: pc.phone,
            email: pc.email,
          }
        : null,
      properties: [...a.properties]
        .sort((x, y) => Number(y.is_primary) - Number(x.is_primary))
        .map((p) => ({
          id: p.id,
          address:
            [
              [p.street, p.unit].filter(Boolean).join(" "),
              p.city,
              [p.state, p.zip].filter(Boolean).join(" "),
            ]
              .filter(Boolean)
              .join(", ") || "No address yet",
          leadSafe: Boolean(p.lead_safe_required),
          isPrimary: p.is_primary,
        })),
      contactCount: contacts.count ?? 0,
      leadCount: leads.count ?? 0,
      createdAt: a.created_at,
      notes: a.notes,
    };
  },
});

// -----------------------------------------------------------------------------
// Create (account + primary contact + primary property)
// -----------------------------------------------------------------------------

export const createAccount = defineAction({
  name: "accounts.create",
  permissions: ["accounts:create", "contacts:create"],
  schema: createAccountSchema,
  handler: async ({ account, contact, property }, ctx) => {
    const { supabase, viewer } = ctx;
    const now = new Date();

    const created = saved(
      check(
        await supabase
          .from("accounts")
          .insert({
            org_id: viewer.orgId,
            display_name: account.display_name,
            account_type: account.account_type,
            status: account.status,
            owner_id: account.owner_id,
            is_referral_champion: account.is_referral_champion,
            tags: account.tags,
            notes: account.notes,
          })
          .select("id")
          .single(),
      ),
    );
    const accountId = created.id;
    let contactId: string | null = null;

    try {
      const c = saved(
        check(
          await supabase
            .from("contacts")
            .insert({
              org_id: viewer.orgId,
              account_id: accountId,
              ...contactColumns(contact, null, now),
              first_name: contact.first_name,
            })
            .select("id")
            .single(),
        ),
      );
      contactId = c.id;

      const linked = check(
        await supabase
          .from("accounts")
          .update({ primary_contact_id: contactId })
          .eq("id", accountId)
          .select("id"),
      );
      if (!linked?.length) noRows("The primary contact couldn't be linked to the account.");

      check(
        await supabase
          .from("properties")
          .insert({
            org_id: viewer.orgId,
            account_id: accountId,
            is_primary: true,
            ...propertyColumns(property),
          })
          .select("id")
          .single(),
      );
    } catch (error) {
      // Undo the partial create so no half-made account is left behind. Users
      // can't hard-delete, so the service client removes exactly what we made.
      try {
        const svc = await ctx.service();
        await svc.from("accounts").update({ primary_contact_id: null }).eq("id", accountId);
        await svc.from("properties").delete().eq("account_id", accountId);
        if (contactId) await svc.from("contacts").delete().eq("id", contactId);
        await svc.from("accounts").delete().eq("id", accountId);
      } catch (cleanupError) {
        logError("accounts.create.cleanup", cleanupError);
      }
      if (error instanceof ActionFailure) {
        throw new ActionFailure({
          ...error.error,
          message: `The account wasn't created: ${error.error.message} Nothing was saved.`,
        });
      }
      throw error;
    }

    await logAccountActivity(
      ctx,
      accountId,
      "account_created",
      `Account created with ${[contact.first_name, contact.last_name].filter(Boolean).join(" ")} as the primary contact`,
    );
    revalidateAccount();
    return { id: accountId };
  },
});

// -----------------------------------------------------------------------------
// Edit, assign, delete
// -----------------------------------------------------------------------------

export const updateAccount = defineAction({
  name: "accounts.update",
  permissions: ["accounts:update"],
  schema: updateAccountSchema,
  handler: async ({ id, account }, { supabase }) => {
    const rows = check(
      await supabase
        .from("accounts")
        .update({
          display_name: account.display_name,
          account_type: account.account_type,
          status: account.status,
          owner_id: account.owner_id,
          is_referral_champion: account.is_referral_champion,
          tags: account.tags,
          notes: account.notes,
        })
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length) noRows("You can't edit this account.");
    revalidateAccount(id);
    return { saved: true };
  },
});

export const bulkAssignAccounts = defineAction({
  name: "accounts.bulk_assign",
  permissions: ["accounts:update"],
  schema: bulkAssignAccountsSchema,
  handler: async ({ ids, owner_id }, { supabase }) => {
    const rows = check(
      await supabase.from("accounts").update({ owner_id }).in("id", ids).select("id"),
    );
    revalidateAccount();
    return { updated: rows?.length ?? 0, skipped: ids.length - (rows?.length ?? 0) };
  },
});

export const deleteAccount = defineAction({
  name: "accounts.delete",
  permissions: ["accounts:delete"],
  schema: deleteRecordSchema,
  handler: async ({ id, reason }, ctx) => {
    // The delete RPC checks the permission, not record scope, so check visibility first.
    await requireVisibleAccount(ctx, id);
    check(
      await ctx.supabase.rpc("soft_delete_record", {
        p_table: "accounts",
        p_id: id,
        p_reason: reason,
      }),
    );
    revalidateAccount(id);
    return { deleted: true };
  },
});

export const setPrimaryContact = defineAction({
  name: "accounts.set_primary_contact",
  permissions: ["accounts:update"],
  schema: setPrimaryContactSchema,
  handler: async ({ account_id, contact_id }, { supabase }) => {
    const rows = check(
      await supabase
        .from("accounts")
        .update({ primary_contact_id: contact_id })
        .eq("id", account_id)
        .select("id"),
    );
    if (!rows?.length) noRows("You can't edit this account.");
    revalidateAccount(account_id);
    revalidatePath(`/contacts/${contact_id}`);
    return { saved: true };
  },
});

// -----------------------------------------------------------------------------
// Properties
// -----------------------------------------------------------------------------

export const createProperty = defineAction({
  name: "properties.create",
  permissions: ["accounts:update"],
  schema: createPropertySchema,
  handler: async ({ account_id, property }, ctx) => {
    const { supabase, viewer } = ctx;
    await requireVisibleAccount(ctx, account_id);
    const { count } = await supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account_id);
    const makePrimary = property.is_primary || (count ?? 0) === 0;
    if (makePrimary) {
      check(
        await supabase
          .from("properties")
          .update({ is_primary: false })
          .eq("account_id", account_id)
          .eq("is_primary", true)
          .select("id"),
      );
    }
    const row = saved(
      check(
        await supabase
          .from("properties")
          .insert({
            org_id: viewer.orgId,
            account_id,
            is_primary: makePrimary,
            ...propertyColumns(property),
          })
          .select("id")
          .single(),
      ),
    );
    revalidateAccount(account_id);
    return { id: row.id };
  },
});

export const updateProperty = defineAction({
  name: "properties.update",
  permissions: ["accounts:update"],
  schema: updatePropertySchema,
  handler: async ({ id, property }, ctx) => {
    const { supabase } = ctx;
    const current = await requireVisibleProperty(ctx, id);
    if (property.is_primary && !current.is_primary) {
      check(
        await supabase
          .from("properties")
          .update({ is_primary: false })
          .eq("account_id", current.account_id)
          .eq("is_primary", true)
          .select("id"),
      );
    }
    const rows = check(
      await supabase
        .from("properties")
        .update({ is_primary: property.is_primary, ...propertyColumns(property) })
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length) noRows("You can't edit this property.");
    revalidateAccount(current.account_id);
    return { saved: true };
  },
});

export const deleteProperty = defineAction({
  name: "properties.delete",
  permissions: ["accounts:delete"],
  schema: deleteRecordSchema,
  handler: async ({ id, reason }, ctx) => {
    const current = await requireVisibleProperty(ctx, id);
    check(
      await ctx.supabase.rpc("soft_delete_record", {
        p_table: "properties",
        p_id: id,
        p_reason: reason,
      }),
    );
    revalidateAccount(current.account_id);
    return { deleted: true };
  },
});

// -----------------------------------------------------------------------------
// Gate / lockbox codes (encrypted in the app; never sent to the browser unasked)
// -----------------------------------------------------------------------------

export const setAccessCode = defineAction({
  name: "properties.set_access_code",
  permissions: ["properties:view_access_codes", "accounts:update"],
  schema: accessCodeSchema,
  handler: async ({ property_id, code }, ctx) => {
    const key = fieldEncryptionKey();
    if (!key) throw new ActionFailure({ code: "validation", message: MISSING_KEY_MESSAGE });
    const property = await requireVisibleProperty(ctx, property_id);
    const existing = check(
      await ctx.supabase
        .from("property_secrets")
        .select("property_id")
        .eq("property_id", property_id)
        .maybeSingle(),
    );
    let ciphertext: string;
    try {
      ciphertext = encryptField(code, key);
    } catch (error) {
      if (error instanceof FieldEncryptionError) {
        throw new ActionFailure({ code: "validation", message: MISSING_KEY_MESSAGE });
      }
      throw error;
    }
    if (existing) {
      const rows = check(
        await ctx.supabase
          .from("property_secrets")
          .update({ access_code_ciphertext: ciphertext })
          .eq("property_id", property_id)
          .select("property_id"),
      );
      if (!rows?.length) noRows("You can't change this code.");
    } else {
      check(
        await ctx.supabase
          .from("property_secrets")
          .insert({
            property_id,
            org_id: ctx.viewer.orgId,
            access_code_ciphertext: ciphertext,
          })
          .select("property_id")
          .single(),
      );
    }
    await logAccountActivity(
      ctx,
      property.account_id,
      existing ? "access_code_replaced" : "access_code_set",
      `${existing ? "Replaced" : "Added"} the gate/lockbox code for ${shortAddress(property)}`,
      { property_id },
    );
    revalidateAccount(property.account_id);
    return { saved: true };
  },
});

export const removeAccessCode = defineAction({
  name: "properties.remove_access_code",
  permissions: ["properties:view_access_codes", "accounts:update"],
  schema: propertyIdSchema,
  handler: async ({ property_id }, ctx) => {
    const property = await requireVisibleProperty(ctx, property_id);
    const rows = check(
      await ctx.supabase
        .from("property_secrets")
        .delete()
        .eq("property_id", property_id)
        .select("property_id"),
    );
    if (!rows?.length) {
      throw new ActionFailure({ code: "not_found", message: "There's no code to remove." });
    }
    await logAccountActivity(
      ctx,
      property.account_id,
      "access_code_removed",
      `Removed the gate/lockbox code for ${shortAddress(property)}`,
      { property_id },
    );
    revalidateAccount(property.account_id);
    return { removed: true };
  },
});

export const revealAccessCode = defineAction({
  name: "properties.reveal_access_code",
  permissions: ["properties:view_access_codes"],
  schema: propertyIdSchema,
  handler: async ({ property_id }, ctx) => {
    const key = fieldEncryptionKey();
    if (!key) throw new ActionFailure({ code: "validation", message: MISSING_KEY_MESSAGE });
    // RLS decides whether this person may read the row at all.
    const secret = check(
      await ctx.supabase
        .from("property_secrets")
        .select("access_code_ciphertext, property:properties!inner(account_id, street, city, zip)")
        .eq("property_id", property_id)
        .maybeSingle(),
    );
    if (!secret) {
      throw new ActionFailure({
        code: "not_found",
        message: "No code is saved for this property.",
      });
    }
    let code: string;
    try {
      code = decryptField(secret.access_code_ciphertext, key);
    } catch (error) {
      logError("properties.reveal_access_code", error);
      throw new ActionFailure({
        code: "server",
        message: "The code couldn't be read. It may have been saved with a different key.",
      });
    }
    await logAccountActivity(
      ctx,
      secret.property.account_id,
      "access_code_viewed",
      `Viewed the gate/lockbox code for ${shortAddress(secret.property)}`,
      { property_id },
    );
    return { code };
  },
});
