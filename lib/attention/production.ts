import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { SnapshotJob, SnapshotSubcontractor } from "@/lib/domain/attention/rules";
import { addDays, pacificToday } from "@/lib/domain/scheduling/dates";
import { jobProductionDays } from "@/lib/domain/scheduling/daily-updates";
import { effectiveSlot } from "@/lib/domain/scheduling/publish";
import { complianceIssues } from "@/lib/domain/scheduling/subcontractors";
import { toEntryState, type EntryRow } from "@/lib/production/context";

type Db = SupabaseClient<Database>;

/**
 * What the production attention rules read (SPEC §9): each production job's
 * crew and crew lead, first scheduled day, paint order, production days and
 * daily-log dates, rain days and open punch items; and every subcontractor's
 * paperwork. Service client, one company at a time.
 */

const PRODUCTION = new Set(["ready_to_schedule", "scheduled", "in_progress", "final_walkthrough"]);
const ORDERED = new Set(["ordered", "partially_received", "picked_up", "delivered"]);

export async function loadProductionSnapshot(
  service: Db,
  orgId: string,
  jobs: readonly {
    id: string;
    stage: string;
    crew_id?: string | null;
    promised_start_date: string | null;
  }[],
  now: Date,
): Promise<{ byJob: Map<string, Partial<SnapshotJob>>; subcontractors: SnapshotSubcontractor[] }> {
  const byJob = new Map<string, Partial<SnapshotJob>>();
  const ids = jobs.filter((j) => PRODUCTION.has(j.stage)).map((j) => j.id);
  const today = pacificToday(now);
  const since = addDays(today, -40);
  const [settings, rule, subs] = await Promise.all([
    service.from("schedule_settings").select("production_days").eq("org_id", orgId).maybeSingle(),
    service
      .from("attention_rules")
      .select("thresholds")
      .eq("org_id", orgId)
      .eq("rule_key", "sub_compliance_expiring")
      .maybeSingle(),
    service
      .from("subcontractors")
      .select(
        "id, company_name, status, lni_expires_on, coi_expires_on, bond_expires_on, rrp_expires_on, w9_on_file",
      )
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .neq("status", "suspended"),
  ]);
  const workdays = (settings.data?.production_days ?? [1, 2, 3, 4, 5]).map(Number);

  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [entries, paint, logs, rain, punch, crews] = await Promise.all([
      service
        .from("schedule_entries")
        .select(
          "id, job_id, work_order_id, work_type, status, crew_id, starts_on, ends_on, published_at, draft_action, draft_crew_id, draft_starts_on, draft_ends_on, draft_reason, draft_note, allow_split, override_rules, override_reason",
        )
        .in("job_id", chunk)
        .neq("status", "canceled"),
      service
        .from("paint_orders")
        .select("job_id, status")
        .in("job_id", chunk)
        .is("deleted_at", null)
        .neq("status", "canceled"),
      service
        .from("daily_logs")
        .select("job_id, log_date")
        .in("job_id", chunk)
        .is("deleted_at", null)
        .gte("log_date", since),
      service.from("rain_delays").select("job_id, delay_date").in("job_id", chunk),
      service
        .from("punch_items")
        .select("job_id")
        .in("job_id", chunk)
        .eq("status", "open")
        .is("deleted_at", null),
      service.from("crews").select("id, lead_user_id").eq("org_id", orgId),
    ]);
    const lead = new Map((crews.data ?? []).map((c) => [c.id, c.lead_user_id]));
    for (const j of jobs) {
      if (!chunk.includes(j.id)) continue;
      const rows = ((entries.data ?? []) as EntryRow[]).filter((e) => e.job_id === j.id);
      const slots = rows.map((r) => effectiveSlot(toEntryState(r))).filter((s) => s !== null);
      const published = rows.filter((r) => r.status === "published" && r.starts_on && r.ends_on);
      const firstPublished = published.map((r) => r.starts_on as string).sort()[0] ?? null;
      const firstDraft = slots.map((s) => s.startsOn).sort()[0] ?? null;
      const crewId = j.crew_id ?? slots[0]?.crewId ?? null;
      const myPaint = (paint.data ?? []).filter((p) => p.job_id === j.id);
      const rainDays = (rain.data ?? []).filter((r) => r.job_id === j.id).map((r) => r.delay_date);
      byJob.set(j.id, {
        crewId,
        crewLeadId: crewId ? (lead.get(crewId) ?? null) : null,
        startDate: firstPublished ?? firstDraft ?? j.promised_start_date,
        paintOrdered: myPaint.length ? myPaint.some((p) => ORDERED.has(p.status)) : null,
        productionDays:
          j.stage === "scheduled" || j.stage === "in_progress"
            ? jobProductionDays(
                published.map((r) => ({
                  startsOn: r.starts_on as string,
                  endsOn: r.ends_on as string,
                })),
                workdays,
                rainDays,
              ).filter((d) => d >= since && d <= today)
            : [],
        logDates: (logs.data ?? []).filter((l) => l.job_id === j.id).map((l) => l.log_date),
        rainDelayDates: rainDays,
        punchOpen: (punch.data ?? []).filter((p) => p.job_id === j.id).length,
      });
    }
  }

  const raw = rule.data?.thresholds;
  const days =
    raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.days === "number"
      ? raw.days
      : 30;
  const subcontractors: SnapshotSubcontractor[] = (subs.data ?? []).map((s) => ({
    id: s.id,
    name: s.company_name,
    issues: complianceIssues(
      {
        status: s.status,
        lniExpiresOn: s.lni_expires_on,
        coiExpiresOn: s.coi_expires_on,
        bondExpiresOn: s.bond_expires_on,
        rrpExpiresOn: s.rrp_expires_on,
        w9OnFile: s.w9_on_file,
      },
      today,
      days,
    ),
  }));
  return { byJob, subcontractors };
}
