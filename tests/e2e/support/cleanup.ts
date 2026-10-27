import { adminClient } from "./users";

/**
 * Hard-deletes test data with the service role (trusted deletes are allowed
 * for messages and stage history; see migrations 0900 and 1100). Order matters:
 * children first, then the records they point at.
 */

async function deleteSubjectRows(type: "lead" | "job" | "account" | "contact", ids: string[]) {
  if (!ids.length) return;
  const db = adminClient();
  const { data: msgs } = await db
    .from("messages")
    .select("outbox_id")
    .eq("subject_type", type)
    .in("subject_id", ids);
  const outboxIds = (msgs ?? [])
    .map((m: { outbox_id: string | null }) => m.outbox_id)
    .filter(Boolean);
  await db.from("messages").delete().eq("subject_type", type).in("subject_id", ids);
  if (outboxIds.length) await db.from("integration_outbox").delete().in("id", outboxIds);
  for (const table of ["notes", "comments", "tasks"]) {
    await db.from(table).delete().eq("subject_type", type).in("subject_id", ids);
  }
  await db.from("attention_items").delete().eq("subject_type", type).in("subject_id", ids);
  await db.from("activity").delete().eq("subject_type", type).in("subject_id", ids);
}

/** Jobs and everything hanging off them (appointments, holds, team, history, approvals). */
export async function deleteJobs(jobIds: string[]) {
  if (!jobIds.length) return;
  const db = adminClient();
  await deleteSubjectRows("job", jobIds);
  await db
    .from("notifications")
    .delete()
    .in(
      "link",
      jobIds.map((id) => `/jobs/${id}`),
    );
  await db.from("leads").update({ converted_job_id: null }).in("converted_job_id", jobIds);
  // Stored files go with their rows (rows cascade with the job).
  const { data: docs } = await db.from("documents").select("storage_path").in("job_id", jobIds);
  const docPaths = (docs ?? []).map((d: { storage_path: string }) => d.storage_path);
  if (docPaths.length) await db.storage.from("documents").remove(docPaths);
  const { data: photos } = await db
    .from("job_photos")
    .select("storage_path, thumb_path")
    .in("job_id", jobIds);
  const photoPaths = (photos ?? []).flatMap((p: { storage_path: string; thumb_path: string }) => [
    p.storage_path,
    p.thumb_path,
  ]);
  if (photoPaths.length) await db.storage.from("photos").remove(photoPaths);
  // Money: payments first (their applications point at invoices), then receipt files.
  await db.from("payments").delete().in("job_id", jobIds);
  const { data: receipts } = await db
    .from("job_expenses")
    .select("receipt_path")
    .in("job_id", jobIds)
    .not("receipt_path", "is", null);
  const receiptPaths = (receipts ?? []).map((r: { receipt_path: string }) => r.receipt_path);
  if (receiptPaths.length) await db.storage.from("receipts").remove(receiptPaths);
  // appointments, holds, team, stage history, approvals and financials cascade.
  const { error } = await db.from("jobs").delete().in("id", jobIds);
  if (error) throw error;
}

/** Jobs created from these leads, then the leads themselves. */
export async function deleteLeadsAndJobs(leadIds: string[]) {
  if (!leadIds.length) return { accountIds: [] as string[] };
  const db = adminClient();
  const { data: jobs } = await db.from("jobs").select("id, account_id").in("lead_id", leadIds);
  const jobIds = (jobs ?? []).map((j: { id: string }) => j.id);
  const accountIds = [...new Set((jobs ?? []).map((j: { account_id: string }) => j.account_id))];
  await deleteJobs(jobIds);
  await db.from("appointments").delete().in("lead_id", leadIds);
  await deleteSubjectRows("lead", leadIds);
  await db
    .from("notifications")
    .delete()
    .in(
      "link",
      leadIds.map((id) => `/leads/${id}`),
    );
  await db.from("lead_attachments").delete().in("lead_id", leadIds);
  await db.from("intake_requests").delete().in("lead_id", leadIds);
  const { error } = await db.from("leads").delete().in("id", leadIds);
  if (error) throw error;
  return { accountIds };
}

/** Accounts with their contacts and properties (after their jobs are gone). */
export async function deleteAccounts(accountIds: string[]) {
  if (!accountIds.length) return;
  const db = adminClient();
  const { data: contacts } = await db.from("contacts").select("id").in("account_id", accountIds);
  const contactIds = (contacts ?? []).map((c: { id: string }) => c.id);
  const { data: props } = await db.from("properties").select("id").in("account_id", accountIds);
  const propIds = (props ?? []).map((p: { id: string }) => p.id);
  await deleteSubjectRows("account", accountIds);
  await deleteSubjectRows("contact", contactIds);
  const { data: docs } = await db
    .from("documents")
    .select("storage_path")
    .in("account_id", accountIds);
  const docPaths = (docs ?? []).map((d: { storage_path: string }) => d.storage_path);
  if (docPaths.length) await db.storage.from("documents").remove(docPaths);
  await db
    .from("leads")
    .update({ account_id: null, contact_id: null, property_id: null })
    .in("account_id", accountIds);
  await db.from("accounts").update({ primary_contact_id: null }).in("id", accountIds);
  if (propIds.length) {
    await db.from("property_secrets").delete().in("property_id", propIds);
    await db.from("properties").delete().in("id", propIds);
  }
  if (contactIds.length) await db.from("contacts").delete().in("id", contactIds);
  const { error } = await db.from("accounts").delete().in("id", accountIds);
  if (error) throw error;
}
