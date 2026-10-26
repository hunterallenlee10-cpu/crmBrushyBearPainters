import { z } from "zod";

/**
 * Tables the soft_delete_record / restore_record RPCs support (platform
 * migration). Add a table here when the RPC allowlist grows.
 */
export const DELETED_RECORD_TABLES = [
  "leads",
  "accounts",
  "contacts",
  "properties",
  "territories",
  "role_templates",
  "permission_packs",
] as const;
export type DeletedRecordTable = (typeof DELETED_RECORD_TABLES)[number];

export const DELETED_RECORD_TYPES: Record<
  DeletedRecordTable,
  { singular: string; plural: string; href: string }
> = {
  leads: { singular: "Lead", plural: "Leads", href: "/leads/list" },
  accounts: { singular: "Account", plural: "Accounts", href: "/accounts" },
  contacts: { singular: "Contact", plural: "Contacts", href: "/contacts" },
  properties: { singular: "Property", plural: "Properties", href: "/accounts" },
  territories: { singular: "Territory", plural: "Territories", href: "/admin/territories" },
  role_templates: { singular: "Role template", plural: "Role templates", href: "/admin/roles" },
  permission_packs: {
    singular: "Permission pack",
    plural: "Permission packs",
    href: "/admin/roles",
  },
};

export function isDeletedRecordTable(v: string): v is DeletedRecordTable {
  return (DELETED_RECORD_TABLES as readonly string[]).includes(v);
}

export const restoreRecordSchema = z.object({
  table: z.enum(DELETED_RECORD_TABLES, { message: "That kind of record can't be restored here." }),
  id: z.uuid({ message: "Missing record." }),
});
export type RestoreRecordInput = z.input<typeof restoreRecordSchema>;
