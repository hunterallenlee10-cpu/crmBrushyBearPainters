import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { pacificToday, type IsoDate } from "@/lib/domain/scheduling/dates";
import type {
  ConflictContext,
  CrewFacts,
  JobFacts,
  ScheduledBar,
} from "@/lib/domain/scheduling/conflicts";
import { effectiveSlot, type EntryState } from "@/lib/domain/scheduling/publish";
import { resolveWorkRules, type WorkRule, type WorkRuleKey } from "@/lib/domain/scheduling/rules";
import { productionWorkType, type CrewSkill } from "@/lib/domain/scheduling/skills";
import type { RescheduleReason } from "@/lib/domain/scheduling/on-time";
import { loadWeather } from "./weather";

type Db = SupabaseClient<Database>;

/**
 * Loaders for the scheduling domain (lib/domain/scheduling): company
 * scheduling settings and work rules, crews with skills / time off /
 * subcontractor paperwork, job facts and the bars already on the schedule.
 * Work with either client: with the person's own client, row security decides
 * which job names they see; the service client is used by trusted code (Publish,
 * the worker) after permission checks.
 */

export type ScheduleSettings = {
  productionDays: number[];
  dayStart: string;
  arrivalWindowMinutes: number;
  crewDayHours: number;
  requireApproval: boolean;
  autoExecute: boolean;
  undoWindowMinutes: number;
};

export type SchedulingConfig = {
  orgId: string;
  settings: ScheduleSettings;
  rules: Record<WorkRuleKey, WorkRule>;
  context: ConflictContext;
  onTimeCreditCents: number;
  companyName: string;
};

const ENTRY_SELECT =
  "id, job_id, work_order_id, work_type, status, crew_id, starts_on, ends_on, published_at, draft_action, draft_crew_id, draft_starts_on, draft_ends_on, draft_reason, draft_note, allow_split, override_rules, override_reason";

export type EntryRow = {
  id: string;
  job_id: string;
  work_order_id: string | null;
  work_type: string;
  status: string;
  crew_id: string | null;
  starts_on: string | null;
  ends_on: string | null;
  published_at: string | null;
  draft_action: string | null;
  draft_crew_id: string | null;
  draft_starts_on: string | null;
  draft_ends_on: string | null;
  draft_reason: string | null;
  draft_note: string | null;
  allow_split: boolean;
  override_rules: string[];
  override_reason: string | null;
};

export function toEntryState(r: EntryRow): EntryState {
  const reason = r.draft_reason;
  return {
    id: r.id,
    jobId: r.job_id,
    status: r.status === "published" || r.status === "canceled" ? r.status : "draft",
    crewId: r.crew_id,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    draftAction:
      r.draft_action === "create" || r.draft_action === "update" || r.draft_action === "cancel"
        ? r.draft_action
        : null,
    draftCrewId: r.draft_crew_id,
    draftStartsOn: r.draft_starts_on,
    draftEndsOn: r.draft_ends_on,
    draftReason:
      reason === "company" || reason === "weather" || reason === "customer"
        ? (reason as RescheduleReason)
        : null,
  };
}

export async function loadSchedulingConfig(
  db: Db,
  orgId: string,
  now = new Date(),
): Promise<SchedulingConfig> {
  const [settings, rules, skills, workTypes, company, blackouts, weather] = await Promise.all([
    db.from("schedule_settings").select("*").eq("org_id", orgId).maybeSingle(),
    db
      .from("work_rules")
      .select("key, label, enabled, severity, owner_override, requires_weather, params")
      .eq("org_id", orgId),
    db.from("skills").select("key, label").eq("org_id", orgId),
    db.from("work_types").select("key, label, required_skill_key, active").eq("org_id", orgId),
    db
      .from("company_settings")
      .select("company_name, exterior_season_start, exterior_season_end, on_time_guarantee_cents")
      .eq("org_id", orgId)
      .maybeSingle(),
    db
      .from("crew_availability")
      .select("starts_on, ends_on, reason")
      .eq("org_id", orgId)
      .eq("kind", "blackout")
      .is("deleted_at", null)
      .gte("ends_on", pacificToday(now)),
    loadWeather(),
  ]);
  const s = settings.data;
  const resolved = resolveWorkRules(rules.data ?? []);
  const scheduleSettings: ScheduleSettings = {
    productionDays: (s?.production_days ?? [1, 2, 3, 4, 5]).map(Number),
    dayStart: s?.day_start ?? "08:00",
    arrivalWindowMinutes: s?.arrival_window_minutes ?? 30,
    crewDayHours: Number(s?.crew_day_hours ?? 8),
    requireApproval: s?.recommendations_require_approval ?? true,
    autoExecute: s?.recommendations_auto_execute ?? false,
    undoWindowMinutes: s?.undo_window_minutes ?? 15,
  };
  return {
    orgId,
    settings: scheduleSettings,
    rules: resolved,
    onTimeCreditCents: Number(company.data?.on_time_guarantee_cents ?? 25_000),
    companyName: company.data?.company_name ?? "Brushy Bear Painters",
    context: {
      today: pacificToday(now),
      productionDays: scheduleSettings.productionDays,
      season: {
        start: company.data?.exterior_season_start ?? "06-01",
        end: company.data?.exterior_season_end ?? "09-30",
      },
      blackouts: (blackouts.data ?? []).map((b) => ({
        startsOn: b.starts_on,
        endsOn: b.ends_on,
        reason: b.reason,
      })),
      rules: resolved,
      skillLabels: Object.fromEntries((skills.data ?? []).map((k) => [k.key, k.label])),
      workTypeSkills: Object.fromEntries(
        (workTypes.data ?? []).map((w) => [w.key, w.required_skill_key]),
      ),
      workTypeLabels: Object.fromEntries((workTypes.data ?? []).map((w) => [w.key, w.label])),
      weather: { connected: weather.connected },
    },
  };
}

export type CrewRecord = CrewFacts & {
  homeTerritoryId: string | null;
  color: string | null;
  leadUserId: string | null;
  leadName: string | null;
  subcontractorId: string | null;
  members: { userId: string | null; name: string; role: string }[];
  dailyCapacityHours: number;
  sortOrder: number;
};

/** Every crew (active first) with skills, members, time off and subcontractor paperwork. */
export async function loadCrews(
  db: Db,
  opts: { includeInactive?: boolean; from?: IsoDate; orgId?: string } = {},
): Promise<CrewRecord[]> {
  let q = db
    .from("crews")
    .select(
      "id, name, crew_type, subcontractor_id, lead_user_id, color, home_territory_id, max_jobs_per_day, daily_capacity_hours, active, sort_order",
    )
    .is("deleted_at", null)
    .order("sort_order")
    .order("name");
  if (!opts.includeInactive) q = q.eq("active", true);
  if (opts.orgId) q = q.eq("org_id", opts.orgId);
  const { data: crews, error } = await q;
  if (error) throw error;
  const ids = (crews ?? []).map((c) => c.id);
  if (!ids.length) return [];
  const subIds = [
    ...new Set((crews ?? []).map((c) => c.subcontractor_id).filter((x): x is string => !!x)),
  ];
  const [skills, members, timeOff, subs] = await Promise.all([
    db.from("crew_skills").select("crew_id, expires_on, skill:skills(key)").in("crew_id", ids),
    db
      .from("crew_members")
      .select("crew_id, user_id, display_name, role, active, profile:profiles(full_name)")
      .in("crew_id", ids)
      .eq("active", true),
    db
      .from("crew_availability")
      .select("crew_id, user_id, starts_on, ends_on, reason")
      .eq("kind", "time_off")
      .is("deleted_at", null)
      .gte("ends_on", opts.from ?? "2000-01-01"),
    subIds.length
      ? db
          .from("subcontractors")
          .select("id, company_name, status, lni_expires_on, coi_expires_on, suspended_reason")
          .in("id", subIds)
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);
  const memberRows = members.data ?? [];
  const leadIds = [
    ...new Set((crews ?? []).map((c) => c.lead_user_id).filter((x): x is string => !!x)),
  ];
  const leads = leadIds.length
    ? ((await db.from("profiles").select("id, full_name").in("id", leadIds)).data ?? [])
    : [];
  const leadName = new Map(leads.map((p) => [p.id, p.full_name]));
  const subById = new Map((subs.data ?? []).map((s) => [s.id, s]));
  return (crews ?? []).map((c) => {
    const mine = memberRows.filter((m) => m.crew_id === c.id);
    const nameOfUser = new Map(
      mine
        .filter((m) => m.user_id)
        .map((m) => [m.user_id as string, m.profile?.full_name ?? m.display_name ?? "Teammate"]),
    );
    const sub = c.subcontractor_id ? subById.get(c.subcontractor_id) : undefined;
    return {
      id: c.id,
      name: c.name,
      active: c.active,
      crewType: c.crew_type === "subcontractor" ? "subcontractor" : "employee",
      maxJobsPerDay: c.max_jobs_per_day,
      dailyCapacityHours: Number(c.daily_capacity_hours),
      sortOrder: c.sort_order,
      homeTerritoryId: c.home_territory_id,
      color: c.color,
      leadUserId: c.lead_user_id,
      leadName: c.lead_user_id ? (leadName.get(c.lead_user_id) ?? null) : null,
      subcontractorId: c.subcontractor_id,
      skills: (skills.data ?? [])
        .filter((s) => s.crew_id === c.id && s.skill)
        .map((s): CrewSkill => ({ key: s.skill?.key ?? "", expiresOn: s.expires_on })),
      members: mine.map((m) => ({
        userId: m.user_id,
        name: m.profile?.full_name ?? m.display_name ?? "Teammate",
        role: m.role,
      })),
      timeOff: (timeOff.data ?? [])
        .filter((t) => t.crew_id === c.id || (t.user_id !== null && nameOfUser.has(t.user_id)))
        .map((t) => ({
          startsOn: t.starts_on,
          endsOn: t.ends_on,
          reason: t.reason,
          memberName:
            t.crew_id === c.id && !t.user_id
              ? null
              : (nameOfUser.get(t.user_id ?? "") ?? "A crew member"),
        })),
      subcontractor: sub
        ? {
            name: sub.company_name,
            status:
              sub.status === "suspended"
                ? "suspended"
                : sub.status === "expiring"
                  ? "expiring"
                  : "active",
            lniExpiresOn: sub.lni_expires_on,
            coiExpiresOn: sub.coi_expires_on,
            suspendedReason: sub.suspended_reason,
          }
        : null,
    };
  });
}

export type JobRecord = JobFacts & {
  name: string;
  jobNumber: string;
  crewId: string | null;
  territoryId: string | null;
  city: string | null;
  promisedStartDate: string | null;
  guaranteeDate: string | null;
  isPriorityReschedule: boolean;
  pointOfContactId: string | null;
  projectManagerId: string | null;
  primaryContactId: string | null;
  estimatedDurationDays: number | null;
  budgetedHours: number;
  paintOrderStatuses: string[];
  onTimeStatus: string;
  actualStartDate: string | null;
};

const SEASONAL_HOA = new Set(["exterior"]);

/** Facts the conflict checks read, for the given jobs (the client decides visibility). */
export async function loadJobFacts(
  db: Db,
  jobIds: readonly string[],
): Promise<Map<string, JobRecord>> {
  const out = new Map<string, JobRecord>();
  const ids = [...new Set(jobIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [jobs, walks, holds, holdLabels, hoa, wos, paint] = await Promise.all([
      db
        .from("jobs")
        .select(
          "id, name, job_number, stage, work_types, crew_id, territory_id, promised_start_date, guarantee_start_date, is_priority_reschedule, point_of_contact_id, project_manager_id, primary_contact_id, estimated_duration_days, on_time_guarantee_status, actual_start_date, property:properties!jobs_property_id_fkey(city, stories, lead_safe_required, has_hoa)",
        )
        .in("id", chunk)
        .is("deleted_at", null),
      db
        .from("appointments")
        .select("job_id")
        .in("job_id", chunk)
        .eq("type", "walkthrough")
        .eq("status", "completed")
        .is("deleted_at", null),
      db
        .from("job_holds")
        .select("job_id, hold_type")
        .in("job_id", chunk)
        .is("released_at", null)
        .eq("blocks_scheduling", true),
      db
        .from("picklist_values")
        .select("value, label, picklists!inner(key)")
        .eq("picklists.key", "hold_type"),
      db
        .from("onboarding_requirements")
        .select("job_id, status, required")
        .in("job_id", chunk)
        .eq("key", "hoa_approval"),
      db
        .from("work_orders")
        .select("job_id, phase, budgeted_hours, status")
        .in("job_id", chunk)
        .is("deleted_at", null)
        .neq("status", "canceled"),
      db
        .from("paint_orders")
        .select("job_id, status")
        .in("job_id", chunk)
        .is("deleted_at", null)
        .neq("status", "canceled"),
    ]);
    if (jobs.error) throw jobs.error;
    const label = new Map((holdLabels.data ?? []).map((v) => [v.value, v.label]));
    const walked = new Set((walks.data ?? []).map((w) => w.job_id));
    for (const j of jobs.data ?? []) {
      const p = j.property;
      const hoaRow = (hoa.data ?? []).find((h) => h.job_id === j.id);
      const myWos = (wos.data ?? []).filter((w) => w.job_id === j.id);
      out.set(j.id, {
        id: j.id,
        label: `${j.job_number} · ${j.name}`,
        name: j.name,
        jobNumber: j.job_number,
        stage: j.stage,
        workTypes: j.work_types,
        stories: p?.stories ?? null,
        leadSafe: p?.lead_safe_required === true,
        walkthroughDone: walked.has(j.id),
        blockingHolds: (holds.data ?? [])
          .filter((h) => h.job_id === j.id)
          .map((h) => ({ type: h.hold_type, label: label.get(h.hold_type) ?? h.hold_type })),
        hoaApprovalPending:
          j.work_types.some((w) => SEASONAL_HOA.has(w)) &&
          p?.has_hoa === true &&
          (hoaRow ? hoaRow.required && hoaRow.status !== "verified" : true),
        workOrderPhases: myWos.map((w) => w.phase),
        crewId: j.crew_id,
        territoryId: j.territory_id,
        city: p?.city ?? null,
        promisedStartDate: j.promised_start_date,
        guaranteeDate: j.guarantee_start_date,
        isPriorityReschedule: j.is_priority_reschedule,
        pointOfContactId: j.point_of_contact_id,
        projectManagerId: j.project_manager_id,
        primaryContactId: j.primary_contact_id,
        estimatedDurationDays: j.estimated_duration_days,
        budgetedHours: myWos.reduce((s, w) => s + Number(w.budgeted_hours ?? 0), 0),
        paintOrderStatuses: (paint.data ?? [])
          .filter((x) => x.job_id === j.id)
          .map((x) => x.status),
        onTimeStatus: j.on_time_guarantee_status,
        actualStartDate: j.actual_start_date,
      });
    }
  }
  return out;
}

/** Working days a job needs: estimated duration, else budgeted hours ÷ crew-day hours, else 1. */
export function jobWorkingDays(
  job: Pick<JobRecord, "estimatedDurationDays" | "budgetedHours">,
  crewDayHours: number,
): number {
  if (job.estimatedDurationDays && job.estimatedDurationDays > 0) return job.estimatedDurationDays;
  if (job.budgetedHours > 0)
    return Math.max(1, Math.ceil(job.budgetedHours / Math.max(1, crewDayHours)));
  return 1;
}

export function defaultEntryWorkType(workTypes: readonly string[]): string {
  return productionWorkType(workTypes);
}

/** Live entries (not canceled) overlapping a window, or for some jobs. */
export async function loadEntries(
  db: Db,
  opts: { from?: IsoDate; to?: IsoDate; jobIds?: readonly string[]; orgId?: string },
): Promise<EntryRow[]> {
  let q = db.from("schedule_entries").select(ENTRY_SELECT).neq("status", "canceled");
  if (opts.orgId) q = q.eq("org_id", opts.orgId);
  if (opts.jobIds) q = q.in("job_id", [...opts.jobIds]);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  const rows = (data ?? []) as EntryRow[];
  if (!opts.from && !opts.to) return rows;
  return rows.filter((r) => {
    const slot = effectiveSlot(toEntryState(r));
    const pub =
      r.status === "published" && r.starts_on && r.ends_on
        ? { s: r.starts_on, e: r.ends_on }
        : null;
    const hit = (s: string, e: string) =>
      (!opts.to || s <= opts.to) && (!opts.from || e >= opts.from);
    return (slot && hit(slot.startsOn, slot.endsOn)) || (pub && hit(pub.s, pub.e));
  });
}

/** Bars as the conflict checks see them (effective dates, the draft when pending). */
export function toBars(
  rows: readonly EntryRow[],
  jobs: ReadonlyMap<string, { label: string }>,
): ScheduledBar[] {
  const out: ScheduledBar[] = [];
  for (const r of rows) {
    const slot = effectiveSlot(toEntryState(r));
    if (!slot) continue;
    out.push({
      id: r.id,
      jobId: r.job_id,
      jobLabel: jobs.get(r.job_id)?.label ?? "another job",
      crewId: slot.crewId,
      startsOn: slot.startsOn,
      endsOn: slot.endsOn,
      allowSplit: r.allow_split,
    });
  }
  return out;
}
