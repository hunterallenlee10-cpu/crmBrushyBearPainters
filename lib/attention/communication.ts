import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { SnapshotCase, SnapshotThread } from "@/lib/domain/attention/rules";

type Db = SupabaseClient<Database>;

/**
 * Communication facts for the attention rules (SPEC §9 "Unread customer
 * message" and "Warranty request"): unread lead/job conversations and open
 * cases, read with the service client.
 */
export async function loadCommunicationSnapshot(
  service: Db,
  orgId: string,
): Promise<{ threads: SnapshotThread[]; cases: SnapshotCase[] }> {
  const [threads, cases] = await Promise.all([
    service
      .from("message_threads")
      .select("id, subject_type, subject_id, last_inbound_at, last_preview, last_direction")
      .eq("org_id", orgId)
      .eq("unread", true)
      .in("subject_type", ["lead", "job"])
      .order("last_inbound_at", { ascending: true })
      .limit(2000),
    service
      .from("cases")
      .select(
        "id, case_number, title, type, priority, sla_due_at, owner_id, account:accounts(display_name)",
      )
      .eq("org_id", orgId)
      .not("status", "in", "(resolved,closed)")
      .order("sla_due_at")
      .limit(2000),
  ]);
  if (threads.error) throw threads.error;
  if (cases.error) throw cases.error;

  const jobIds = (threads.data ?? [])
    .filter((t) => t.subject_type === "job")
    .map((t) => t.subject_id);
  const leadIds = (threads.data ?? [])
    .filter((t) => t.subject_type === "lead")
    .map((t) => t.subject_id);
  const [jobs, leads] = await Promise.all([
    jobIds.length
      ? service
          .from("jobs")
          .select("id, name, owner_id, point_of_contact_id, deleted_at")
          .in("id", jobIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            name: string;
            owner_id: string | null;
            point_of_contact_id: string | null;
            deleted_at: string | null;
          }[],
        }),
    leadIds.length
      ? service
          .from("leads")
          .select("id, first_name, last_name, owner_id, point_of_contact_id, deleted_at")
          .in("id", leadIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            first_name: string;
            last_name: string | null;
            owner_id: string | null;
            point_of_contact_id: string | null;
            deleted_at: string | null;
          }[],
        }),
  ]);
  const jobMap = new Map((jobs.data ?? []).map((j) => [j.id, j]));
  const leadMap = new Map((leads.data ?? []).map((l) => [l.id, l]));

  const out: SnapshotThread[] = [];
  for (const t of threads.data ?? []) {
    if (!t.last_inbound_at) continue;
    if (t.subject_type === "job") {
      const j = jobMap.get(t.subject_id);
      if (!j || j.deleted_at) continue;
      out.push({
        id: t.id,
        subjectType: "job",
        subjectId: j.id,
        subjectName: j.name,
        lastInboundAt: t.last_inbound_at,
        ownerId: j.point_of_contact_id ?? j.owner_id,
        preview: t.last_direction === "inbound" ? t.last_preview : null,
      });
    } else {
      const l = leadMap.get(t.subject_id);
      if (!l || l.deleted_at) continue;
      out.push({
        id: t.id,
        subjectType: "lead",
        subjectId: l.id,
        subjectName: [l.first_name, l.last_name].filter(Boolean).join(" "),
        lastInboundAt: t.last_inbound_at,
        ownerId: l.point_of_contact_id ?? l.owner_id,
        preview: t.last_direction === "inbound" ? t.last_preview : null,
      });
    }
  }
  return {
    threads: out,
    cases: (cases.data ?? []).map((c) => ({
      id: c.id,
      number: c.case_number,
      title: c.title,
      type: c.type,
      priority: c.priority === "urgent" ? "urgent" : c.priority === "high" ? "high" : "normal",
      slaDueAt: c.sla_due_at,
      ownerId: c.owner_id,
      customerName: c.account?.display_name ?? null,
    })),
  };
}
