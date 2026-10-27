import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import type { Database } from "@/lib/db/types";
import type { Viewer } from "@/lib/auth/viewer";
import { BUSINESS_TZ } from "@/lib/domain/leads/speed-to-lead";
import {
  BOARD_STAGES,
  DEFAULT_LANE_THRESHOLDS,
  dataAuditIssues,
  type BoardCard,
  type LaneThresholds,
} from "@/lib/domain/onboarding/board";
import { checklistSummary } from "@/lib/domain/onboarding/checklist";
import { isJobStageId } from "@/lib/domain/stages";

type Db = SupabaseClient<Database>;

/**
 * Loads every job on the Onboarding Board (SPEC §8.7) with the person's own
 * client: row security decides which jobs, and money only loads for people
 * with financials:read. The whole board set is loaded (not a page), so the
 * lane totals and KPIs (lib/metrics/registry `onboarding_board`) count every
 * job; lanes render at most LANE_CAP cards each.
 */

export const BOARD_MAX_JOBS = 2000;

export type BoardJob = BoardCard & { auditIssues: string[] };

function monthStartUtc(now: Date): string {
  const z = toZonedTime(now, BUSINESS_TZ);
  const local = `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-01T00:00:00`;
  return fromZonedTime(local, BUSINESS_TZ).toISOString();
}

export async function loadBoard(
  db: Db,
  viewer: Viewer,
  now = new Date(),
): Promise<{
  jobs: BoardJob[];
  canSeeMoney: boolean;
  thresholds: LaneThresholds;
  truncated: boolean;
}> {
  const canSeeMoney = viewer.can("financials:read");
  const { data: rows, error } = await db
    .from("jobs")
    .select(
      "id, job_number, name, work_types, stage, stage_entered_at, priority, estimate_accepted_at, paid_in_full_at, promised_start_date, point_of_contact_id, primary_contact_id, property_id, account:accounts(display_name), property:properties(city, lead_safe_required, has_hoa), contact:contacts!jobs_primary_contact_id_fkey(mobile, email)",
    )
    .in("stage", [...BOARD_STAGES])
    .or(`stage.neq.closed_won,paid_in_full_at.gte.${monthStartUtc(now)}`)
    .order("stage_entered_at", { ascending: true })
    .limit(BOARD_MAX_JOBS + 1);
  if (error) throw error;
  const truncated = (rows ?? []).length > BOARD_MAX_JOBS;
  const jobs = (rows ?? []).slice(0, BOARD_MAX_JOBS);
  const ids = jobs.map((j) => j.id);

  const holds: {
    job_id: string;
    hold_type: string;
    blocks_scheduling: boolean;
    placed_at: string;
  }[] = [];
  const reqs: {
    job_id: string;
    key: string;
    label: string;
    group_key: string;
    required: boolean;
    status: string;
    verified_auto: boolean;
  }[] = [];
  const money = new Map<string, number>();
  const collected = new Map<string, number>();
  const deposits = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [h, r, f, d] = await Promise.all([
      db
        .from("job_holds")
        .select("job_id, hold_type, blocks_scheduling, placed_at")
        .in("job_id", chunk)
        .is("released_at", null),
      db
        .from("onboarding_requirements")
        .select("job_id, key, label, group_key, required, status, verified_auto")
        .in("job_id", chunk),
      canSeeMoney
        ? db
            .from("job_ledger")
            .select("job_id, contract_cents, collected_cents")
            .in("job_id", chunk)
        : Promise.resolve({
            data: [] as {
              job_id: string | null;
              contract_cents: number | null;
              collected_cents: number | null;
            }[],
          }),
      canSeeMoney && viewer.can("invoices:read")
        ? db
            .from("invoices")
            .select("job_id, total_cents")
            .in("job_id", chunk)
            .eq("invoice_type", "deposit")
            .neq("status", "void")
        : Promise.resolve({ data: [] as { job_id: string; total_cents: number }[] }),
    ]);
    holds.push(...(h.data ?? []));
    reqs.push(...(r.data ?? []));
    for (const x of f.data ?? []) {
      if (!x.job_id) continue;
      money.set(x.job_id, Number(x.contract_cents ?? 0));
      collected.set(x.job_id, Number(x.collected_cents ?? 0));
    }
    for (const x of d.data ?? []) deposits.set(x.job_id, Number(x.total_cents));
  }

  const [labels, rules] = await Promise.all([
    db
      .from("picklist_values")
      .select("value, label, picklists!inner(key)")
      .eq("picklists.key", "hold_type"),
    db.from("attention_rules").select("rule_key, enabled, thresholds"),
  ]);
  const holdLabel = new Map((labels.data ?? []).map((v) => [v.value, v.label]));
  const days = (key: string, fallback: number | undefined) => {
    const r = (rules.data ?? []).find((x) => x.rule_key === key);
    const t = r?.thresholds;
    const v = t && typeof t === "object" && !Array.isArray(t) ? t.days : undefined;
    return typeof v === "number" ? v : fallback;
  };
  const thresholds: LaneThresholds = {
    deposit_hold: days("sold_no_deposit", DEFAULT_LANE_THRESHOLDS.deposit_hold),
    needs_onboarding: days("onboarding_stalled", DEFAULT_LANE_THRESHOLDS.needs_onboarding),
    on_hold: days("onboarding_stalled", DEFAULT_LANE_THRESHOLDS.on_hold),
    ready: days("ready_not_scheduled", DEFAULT_LANE_THRESHOLDS.ready),
  };

  const out: BoardJob[] = [];
  for (const j of jobs) {
    if (!isJobStageId(j.stage)) continue;
    const myHolds = holds
      .filter((h) => h.job_id === j.id)
      .map((h) => ({
        type: h.hold_type,
        label: holdLabel.get(h.hold_type) ?? h.hold_type,
        blocksScheduling: h.blocks_scheduling,
        placedAt: h.placed_at,
      }));
    const rows = reqs
      .filter((r) => r.job_id === j.id)
      .map((r) => ({
        key: r.key,
        label: r.label,
        group: r.group_key,
        required: r.required,
        status: r.status,
        verifiedAuto: r.verified_auto,
      }));
    const summary = rows.length ? checklistSummary(rows) : null;
    out.push({
      id: j.id,
      jobNumber: j.job_number,
      name: j.name,
      accountName: j.account?.display_name ?? null,
      city: j.property?.city ?? null,
      workTypes: j.work_types,
      stage: j.stage,
      stageEnteredAt: j.stage_entered_at,
      holds: myHolds,
      contractCents: canSeeMoney ? (money.get(j.id) ?? null) : null,
      collectedCents: canSeeMoney ? (collected.get(j.id) ?? null) : null,
      depositCents: deposits.get(j.id) ?? null,
      soldAt: j.estimate_accepted_at,
      paidInFullAt: j.paid_in_full_at,
      onboarding: summary ? { required: summary.required, cleared: summary.cleared } : null,
      readyToSchedule:
        !!summary && summary.open.length === 0 && !myHolds.some((h) => h.blocksScheduling),
      leadSafe: j.property?.lead_safe_required === true,
      hasHoa: j.property?.has_hoa === true,
      priority: j.priority,
      auditIssues: dataAuditIssues({
        stage: j.stage,
        hasPrimaryContact: Boolean(j.primary_contact_id),
        contactMobile: j.contact?.mobile ?? null,
        contactEmail: j.contact?.email ?? null,
        hasProperty: Boolean(j.property_id),
        pointOfContactId: j.point_of_contact_id,
        promisedStartDate: j.promised_start_date,
        soldAt: j.estimate_accepted_at,
        hasChecklist: rows.length > 0,
      }),
    });
  }
  return { jobs: out, canSeeMoney, thresholds, truncated };
}
