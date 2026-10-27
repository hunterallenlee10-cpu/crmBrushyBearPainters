import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { pacificToday, type IsoDate } from "@/lib/domain/scheduling/dates";
import { isProductionDay } from "@/lib/domain/scheduling/daily-updates";

type Db = SupabaseClient<Database>;

/**
 * What the field screens show (SPEC §8.8 My Projects, §16 crew tab bar):
 * the jobs a person can open (their own client, so crew see only the jobs
 * they're on), with dates, crew, today's work order, scope, colors, access
 * notes, open punch items and whether today's log is in. Crew members of the
 * job's crews are read with the service client (for the hours list).
 */

export const PRODUCTION_STEPS = [
  { stage: "ready_to_schedule", label: "Ready" },
  { stage: "scheduled", label: "Scheduled" },
  { stage: "in_progress", label: "Started" },
  { stage: "final_walkthrough", label: "Work done" },
  { stage: "completed", label: "Walkthrough" },
  { stage: "invoiced", label: "Complete" },
] as const;

const ORDER: Record<string, number> = {
  ready_to_schedule: 1,
  scheduled: 2,
  in_progress: 3,
  final_walkthrough: 4,
  completed: 5,
  invoiced: 6,
  paid_in_full: 6,
  closed_won: 6,
};

export type FieldJob = {
  id: string;
  label: string;
  name: string;
  jobNumber: string;
  stage: string;
  stepsDone: number;
  city: string | null;
  address: string | null;
  accessNotes: string | null;
  pets: string | null;
  parking: string | null;
  workTypes: readonly string[];
  crewName: string | null;
  published: { startsOn: IsoDate; endsOn: IsoDate }[];
  firstDay: IsoDate | null;
  lastDay: IsoDate | null;
  onToday: boolean;
  loggedToday: boolean;
  workOrders: { id: string; number: string; label: string; status: string; scope: string | null }[];
  colors: {
    area: string;
    surface: string;
    color: string | null;
    code: string | null;
    sheen: string | null;
  }[];
  openPunch: number;
  members: { userId: string | null; name: string }[];
  isPriorityReschedule: boolean;
};

export async function loadFieldJobs(
  db: { supabase: Db; service: Db },
  input: {
    orgId: string;
    viewerId: string;
    onlyMine: boolean;
    stages?: readonly string[];
    jobIds?: readonly string[];
    now?: Date;
  },
): Promise<{ jobs: FieldJob[]; today: IsoDate; workdays: number[] }> {
  const { supabase, service } = db;
  const today = pacificToday(input.now ?? new Date());
  let q = supabase
    .from("jobs")
    .select(
      "id, name, job_number, stage, work_types, crew_id, team_user_ids, is_priority_reschedule, property:properties!jobs_property_id_fkey(street, unit, city, state, zip, access_notes, pets, parking)",
    )
    .in("stage", [
      ...(input.stages ?? [
        "ready_to_schedule",
        "scheduled",
        "in_progress",
        "final_walkthrough",
        "completed",
      ]),
    ])
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (input.onlyMine) q = q.contains("team_user_ids", [input.viewerId]);
  if (input.jobIds) q = q.in("id", [...input.jobIds]);
  const { data: jobs } = await q;
  const ids = (jobs ?? []).map((j) => j.id);
  if (!ids.length) return { jobs: [], today, workdays: [1, 2, 3, 4, 5] };
  const [entries, wos, colors, punch, logs, settings] = await Promise.all([
    service
      .from("schedule_entries")
      .select("job_id, crew_id, starts_on, ends_on")
      .in("job_id", ids)
      .eq("status", "published"),
    supabase
      .from("work_orders")
      .select("id, job_id, work_order_number, title, status, scope_summary")
      .in("job_id", ids)
      .neq("status", "canceled")
      .order("created_at"),
    supabase
      .from("color_selections")
      .select("job_id, area, surface, color_name, color_code, sheen, sort_order")
      .in("job_id", ids)
      .is("deleted_at", null)
      .order("sort_order"),
    supabase.from("punch_items").select("job_id").in("job_id", ids).eq("status", "open"),
    service
      .from("daily_logs")
      .select("job_id")
      .in("job_id", ids)
      .eq("log_date", today)
      .is("deleted_at", null),
    service
      .from("schedule_settings")
      .select("production_days")
      .eq("org_id", input.orgId)
      .maybeSingle(),
  ]);
  const workdays = (settings.data?.production_days ?? [1, 2, 3, 4, 5]).map(Number);
  const crewIds = [
    ...new Set(
      [...(jobs ?? []).map((j) => j.crew_id), ...(entries.data ?? []).map((e) => e.crew_id)].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
  const [crews, members] = crewIds.length
    ? await Promise.all([
        service.from("crews").select("id, name").in("id", crewIds),
        service
          .from("crew_members")
          .select("crew_id, user_id, display_name, profile:profiles(full_name)")
          .in("crew_id", crewIds)
          .eq("active", true),
      ])
    : [{ data: [] as { id: string; name: string }[] }, { data: [] as never[] }];
  const crewName = new Map((crews.data ?? []).map((c) => [c.id, c.name]));
  const out: FieldJob[] = (jobs ?? []).map((j) => {
    const p = j.property;
    const mine = (entries.data ?? []).filter((e) => e.job_id === j.id && e.starts_on && e.ends_on);
    const ranges = mine.map((e) => ({
      startsOn: e.starts_on as string,
      endsOn: e.ends_on as string,
    }));
    const jobCrews = new Set(
      [j.crew_id, ...mine.map((e) => e.crew_id)].filter((x): x is string => !!x),
    );
    const people = (members.data ?? [])
      .filter((m) => jobCrews.has(m.crew_id))
      .map((m) => ({
        userId: m.user_id,
        name: m.profile?.full_name ?? m.display_name ?? "Crew member",
      }));
    const seen = new Set<string>();
    return {
      id: j.id,
      label: `${j.job_number} · ${j.name}`,
      name: j.name,
      jobNumber: j.job_number,
      stage: j.stage,
      stepsDone: ORDER[j.stage] ?? 0,
      city: p?.city ?? null,
      address: p
        ? [
            [p.street, p.unit].filter(Boolean).join(" "),
            p.city,
            [p.state, p.zip].filter(Boolean).join(" "),
          ]
            .filter(Boolean)
            .join(", ") || null
        : null,
      accessNotes: p?.access_notes ?? null,
      pets: p?.pets ?? null,
      parking: p?.parking ?? null,
      workTypes: j.work_types,
      crewName: j.crew_id
        ? (crewName.get(j.crew_id) ?? null)
        : mine[0]?.crew_id
          ? (crewName.get(mine[0].crew_id) ?? null)
          : null,
      published: ranges.sort((a, b) => a.startsOn.localeCompare(b.startsOn)),
      firstDay: ranges.map((r) => r.startsOn).sort()[0] ?? null,
      lastDay:
        ranges
          .map((r) => r.endsOn)
          .sort()
          .pop() ?? null,
      onToday: isProductionDay(today, ranges, workdays),
      loggedToday: (logs.data ?? []).some((l) => l.job_id === j.id),
      workOrders: (wos.data ?? [])
        .filter((w) => w.job_id === j.id)
        .map((w) => ({
          id: w.id,
          number: w.work_order_number,
          label: `${w.work_order_number} · ${w.title}`,
          status: w.status,
          scope: w.scope_summary,
        })),
      colors: (colors.data ?? [])
        .filter((c) => c.job_id === j.id)
        .map((c) => ({
          area: c.area,
          surface: c.surface,
          color: c.color_name,
          code: c.color_code,
          sheen: c.sheen,
        })),
      openPunch: (punch.data ?? []).filter((x) => x.job_id === j.id).length,
      members: people.filter((m) => {
        const k = m.userId ?? m.name;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
      isPriorityReschedule: j.is_priority_reschedule,
    };
  });
  return { jobs: out, today, workdays };
}
