"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";
import {
  createContactSchema,
  deleteRecordSchema,
  updateContactSchema,
  type ContactRole,
  type PreferredChannel,
} from "@/lib/validation/accounts";
import { contactColumns } from "../accounts/_lib/rows";

/**
 * Contacts (SPEC §5.1, §13.2). Contacts follow their account's scope (RLS).
 * Consent timestamps are set here from the previous row: a new opt-in is
 * stamped now, an unchanged one keeps its time, and opting out clears it.
 */

function revalidateContact(accountId: string | null, id?: string) {
  revalidatePath("/contacts");
  revalidatePath("/accounts");
  if (accountId) revalidatePath(`/accounts/${accountId}`);
  if (id) revalidatePath(`/contacts/${id}`);
}

export type ContactPreview = {
  id: string;
  name: string;
  role: ContactRole;
  accountId: string;
  accountName: string | null;
  isPrimary: boolean;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  preferredChannel: PreferredChannel | null;
  smsOptIn: boolean;
  smsOptInAt: string | null;
  smsOptInSource: string | null;
  emailOptIn: boolean;
  emailOptInAt: string | null;
  emailOptInSource: string | null;
  optedOutAt: string | null;
  doNotContact: boolean;
  createdAt: string;
};

export const getContactPreview = defineAction({
  name: "contacts.preview",
  permissions: ["contacts:read"],
  schema: z.object({ id: z.uuid() }),
  handler: async ({ id }, { supabase }): Promise<ContactPreview> => {
    const c = check(
      await supabase
        .from("contacts")
        .select(
          "id, first_name, last_name, role, account_id, mobile, phone, email, preferred_channel, sms_opt_in, sms_opt_in_at, sms_opt_in_source, email_opt_in, email_opt_in_at, email_opt_in_source, opted_out_at, do_not_contact, created_at, account:accounts!contacts_account_id_fkey(display_name, primary_contact_id)",
        )
        .eq("id", id)
        .maybeSingle(),
    );
    if (!c)
      throw new ActionFailure({ code: "not_found", message: "That contact isn't available." });
    return {
      id: c.id,
      name: [c.first_name, c.last_name].filter(Boolean).join(" "),
      role: c.role as ContactRole,
      accountId: c.account_id,
      accountName: c.account?.display_name ?? null,
      isPrimary: c.account?.primary_contact_id === c.id,
      mobile: c.mobile,
      phone: c.phone,
      email: c.email,
      preferredChannel: c.preferred_channel as PreferredChannel | null,
      smsOptIn: c.sms_opt_in,
      smsOptInAt: c.sms_opt_in_at,
      smsOptInSource: c.sms_opt_in_source,
      emailOptIn: c.email_opt_in,
      emailOptInAt: c.email_opt_in_at,
      emailOptInSource: c.email_opt_in_source,
      optedOutAt: c.opted_out_at,
      doNotContact: c.do_not_contact,
      createdAt: c.created_at,
    };
  },
});

export const createContact = defineAction({
  name: "contacts.create",
  permissions: ["contacts:create"],
  schema: createContactSchema,
  handler: async ({ account_id, contact }, { supabase, viewer }) => {
    const account = check(
      await supabase
        .from("accounts")
        .select("id, primary_contact_id")
        .eq("id", account_id)
        .maybeSingle(),
    );
    if (!account) {
      throw new ActionFailure({ code: "not_found", message: "That account isn't available." });
    }
    const row = check(
      await supabase
        .from("contacts")
        .insert({
          org_id: viewer.orgId,
          account_id,
          ...contactColumns(contact, null),
          first_name: contact.first_name,
        })
        .select("id")
        .single(),
    );
    if (!row)
      throw new ActionFailure({ code: "server", message: "The contact wasn't saved. Try again." });
    // The first contact on an account becomes its primary contact (when allowed).
    if (!account.primary_contact_id && viewer.can("accounts:update")) {
      await supabase.from("accounts").update({ primary_contact_id: row.id }).eq("id", account_id);
    }
    revalidateContact(account_id, row.id);
    return { id: row.id };
  },
});

export const updateContact = defineAction({
  name: "contacts.update",
  permissions: ["contacts:update"],
  schema: updateContactSchema,
  handler: async ({ id, contact }, { supabase }) => {
    const prev = check(
      await supabase
        .from("contacts")
        .select(
          "account_id, sms_opt_in, sms_opt_in_at, email_opt_in, email_opt_in_at, opted_out_at",
        )
        .eq("id", id)
        .maybeSingle(),
    );
    if (!prev)
      throw new ActionFailure({ code: "not_found", message: "That contact isn't available." });
    if (prev.opted_out_at && (contact.sms_opt_in || contact.email_opt_in)) {
      throw new ActionFailure({
        code: "validation",
        message:
          "This person replied STOP. They have to text START (or ask in writing) before you opt them back in.",
        fieldErrors: {
          "contact.sms_opt_in": ["They opted out. They have to opt back in themselves."],
        },
      });
    }
    const rows = check(
      await supabase
        .from("contacts")
        .update(contactColumns(contact, prev))
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length) {
      throw new ActionFailure({ code: "forbidden", message: "You can't edit this contact." });
    }
    revalidateContact(prev.account_id, id);
    return { saved: true };
  },
});

export const deleteContact = defineAction({
  name: "contacts.delete",
  permissions: ["contacts:delete"],
  schema: deleteRecordSchema,
  handler: async ({ id, reason }, { supabase }) => {
    // The delete RPC checks the permission, not record scope, so check visibility first.
    const c = check(
      await supabase
        .from("contacts")
        .select("id, account_id, account:accounts!contacts_account_id_fkey(primary_contact_id)")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!c)
      throw new ActionFailure({ code: "not_found", message: "That contact isn't available." });
    if (c.account?.primary_contact_id === id) {
      throw new ActionFailure({
        code: "conflict",
        message:
          "This is the account's primary contact. Make someone else primary first, or delete the whole account.",
      });
    }
    check(
      await supabase.rpc("soft_delete_record", { p_table: "contacts", p_id: id, p_reason: reason }),
    );
    revalidateContact(c.account_id, id);
    return { deleted: true, accountId: c.account_id };
  },
});
