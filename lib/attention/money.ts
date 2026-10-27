import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { SnapshotInvoice, SnapshotJob } from "@/lib/domain/attention/rules";
import { stageOrder } from "@/lib/domain/jobs/gates";
import { isJobStageId } from "@/lib/domain/stages";

type Db = SupabaseClient<Database>;

/**
 * Money facts for the attention rules (SPEC §9 "Sold, no deposit" and
 * "Overdue invoice"), read from the ledger views with the service client.
 */
export async function loadMoneySnapshot(
  service: Db,
  orgId: string,
  jobs: readonly {
    id: string;
    stage: string;
    estimate_accepted_at: string | null;
    deposit_paid_at: string | null;
  }[],
): Promise<{
  invoices: SnapshotInvoice[];
  byJob: Map<string, Pick<SnapshotJob, "deposit" | "depositRequired">>;
}> {
  const { data: overdue, error } = await service
    .from("invoice_ledger")
    .select("id, invoice_number, job_id, job_name, job_number, balance_cents, days_past_due")
    .eq("org_id", orgId)
    .eq("issued", true)
    .gt("balance_cents", 0)
    .gt("days_past_due", 0)
    .order("days_past_due", { ascending: false })
    .limit(2000);
  if (error) throw error;
  const jobIds = [...new Set((overdue ?? []).map((i) => i.job_id).filter((x): x is string => !!x))];
  const owners = new Map<string, string | null>();
  for (let i = 0; i < jobIds.length; i += 200) {
    const { data } = await service
      .from("jobs")
      .select("id, owner_id, point_of_contact_id")
      .in("id", jobIds.slice(i, i + 200));
    for (const j of data ?? []) owners.set(j.id, j.point_of_contact_id ?? j.owner_id);
  }
  const invoices: SnapshotInvoice[] = (overdue ?? []).flatMap((i) =>
    i.id && i.job_id
      ? [
          {
            id: i.id,
            number: i.invoice_number ?? "",
            jobId: i.job_id,
            jobName: i.job_name ?? "A job",
            jobNumber: i.job_number ?? "",
            balanceCents: i.balance_cents ?? 0,
            daysPastDue: i.days_past_due ?? 0,
            ownerId: owners.get(i.job_id) ?? null,
          },
        ]
      : [],
  );

  // Deposits for sold jobs whose deposit isn't stamped paid.
  const waiting = jobs.filter(
    (j) => isJobStageId(j.stage) && stageOrder(j.stage) >= stageOrder("sold") && !j.deposit_paid_at,
  );
  const byJob = new Map<string, Pick<SnapshotJob, "deposit" | "depositRequired">>();
  for (let i = 0; i < waiting.length; i += 200) {
    const ids = waiting.slice(i, i + 200).map((j) => j.id);
    const { data, error: depErr } = await service
      .from("invoice_ledger")
      .select("job_id, invoice_number, total_cents, collected_cents")
      .in("job_id", ids)
      .eq("invoice_type", "deposit")
      .neq("status", "void");
    if (depErr) throw depErr;
    const found = new Map((data ?? []).map((d) => [d.job_id, d]));
    for (const j of waiting.slice(i, i + 200)) {
      const d = found.get(j.id);
      byJob.set(
        j.id,
        d
          ? {
              deposit: {
                number: d.invoice_number ?? "",
                totalCents: d.total_cents ?? 0,
                collectedCents: d.collected_cents ?? 0,
              },
              depositRequired: (d.total_cents ?? 0) > 0,
            }
          : // No deposit invoice after an accepted estimate means a 0% deposit (Phase 4).
            { deposit: null, depositRequired: !j.estimate_accepted_at },
      );
    }
  }
  return { invoices, byJob };
}
