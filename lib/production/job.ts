import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { loadPhotoThumbs, type PhotoThumb } from "@/lib/photos/thumbs";
import { loadProductionJobs, type ProductionJobRow } from "./queues";
import type { CrewRecord, SchedulingConfig } from "./context";

type Db = SupabaseClient<Database>;
type Clients = { supabase: Db; service: Db };

/**
 * Job Detail production sections (SPEC §8.5 #3 Schedule, #8 Work Orders,
 * #9 Daily Logs, #13 Punch List). Rows are read with the person's own client
 * so row security decides what they see; the scheduling facts come from the
 * production queues (service, whole schedule) for this one job.
 */

export type ChecklistView = {
  id: string;
  name: string;
  status: string;
  workOrderId: string | null;
  items: { id: string; label: string; required: boolean; done: boolean; doneAt: string | null }[];
};

export type ScheduleSectionData = {
  row: ProductionJobRow | null;
  crews: CrewRecord[];
  config: SchedulingConfig;
  guaranteeStartDate: string | null;
  isPriorityReschedule: boolean;
  rainDelays: { id: string; date: string; note: string | null; customerNotified: boolean }[];
  /** Null when the person can't see money (financials:read). */
  credits:
    | {
        id: string;
        amountCents: number;
        status: string;
        promisedDate: string;
        actualStartDate: string | null;
        reason: string;
        decisionNote: string | null;
        decidedAt: string | null;
      }[]
    | null;
};

export async function loadChecklists(supabase: Db, jobId: string): Promise<ChecklistView[]> {
  const { data: instances } = await supabase
    .from("checklist_instances")
    .select("id, name, status, work_order_id, created_at")
    .eq("job_id", jobId)
    .order("created_at");
  const ids = (instances ?? []).map((i) => i.id);
  const { data: items } = ids.length
    ? await supabase
        .from("checklist_items")
        .select("id, instance_id, label, required, done, done_at, sort_order")
        .in("instance_id", ids)
        .order("sort_order")
    : { data: [] };
  return (instances ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    status: i.status,
    workOrderId: i.work_order_id,
    items: (items ?? [])
      .filter((x) => x.instance_id === i.id)
      .map((x) => ({
        id: x.id,
        label: x.label,
        required: x.required,
        done: x.done,
        doneAt: x.done_at,
      })),
  }));
}

export async function loadScheduleSection(
  db: Clients,
  input: { orgId: string; jobId: string; canSeeMoney: boolean },
): Promise<ScheduleSectionData> {
  const { supabase } = db;
  const [{ jobs, crews, config }, job, rain, credits] = await Promise.all([
    loadProductionJobs(db, {
      orgId: input.orgId,
      stages: [
        "onboarding",
        "ready_to_schedule",
        "scheduled",
        "in_progress",
        "final_walkthrough",
        "completed",
        "invoiced",
        "paid_in_full",
        "closed_won",
      ],
      jobIds: [input.jobId],
      rank: true,
    }),
    supabase
      .from("jobs")
      .select("guarantee_start_date, is_priority_reschedule")
      .eq("id", input.jobId)
      .maybeSingle(),
    supabase
      .from("rain_delays")
      .select("id, delay_date, note, customer_message_id")
      .eq("job_id", input.jobId)
      .order("delay_date", { ascending: false })
      .limit(50),
    input.canSeeMoney
      ? supabase
          .from("on_time_credits")
          .select(
            "id, amount_cents, status, promised_date, actual_start_date, reason, decision_note, decided_at",
          )
          .eq("job_id", input.jobId)
          .order("drafted_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);
  return {
    row: jobs[0] ?? null,
    crews,
    config,
    guaranteeStartDate: job.data?.guarantee_start_date ?? null,
    isPriorityReschedule: job.data?.is_priority_reschedule ?? false,
    rainDelays: (rain.data ?? []).map((r) => ({
      id: r.id,
      date: r.delay_date,
      note: r.note,
      customerNotified: !!r.customer_message_id,
    })),
    credits: credits.data
      ? credits.data.map((c) => ({
          id: c.id,
          amountCents: c.amount_cents,
          status: c.status,
          promisedDate: c.promised_date,
          actualStartDate: c.actual_start_date,
          reason: c.reason,
          decisionNote: c.decision_note,
          decidedAt: c.decided_at,
        }))
      : null,
  };
}

export type WorkOrderView = {
  id: string;
  number: string;
  title: string;
  phase: string;
  status: string;
  priority: string;
  crewId: string | null;
  scope: string | null;
  budgetedHours: number;
  actualHours: number | null;
  loggedHours: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedAt: string | null;
};

export type PaintOrderView = {
  id: string;
  number: string;
  status: string;
  supplier: string | null;
  expectedOn: string | null;
  fulfillment: string | null;
  totalCostCents: number;
};

export async function loadWorkOrdersSection(
  db: Clients,
  input: { orgId: string; jobId: string },
): Promise<{
  workOrders: WorkOrderView[];
  paintOrders: PaintOrderView[];
  crews: { id: string; name: string; type: string }[];
  hoursByCrewType: { employee: number; subcontractor: number; unassigned: number };
}> {
  const { supabase, service } = db;
  const [wos, pos, hours, crews] = await Promise.all([
    supabase
      .from("work_orders")
      .select(
        "id, work_order_number, title, phase, status, priority, crew_id, scope_summary, budgeted_hours, actual_hours, scheduled_start, scheduled_end, completed_at",
      )
      .eq("job_id", input.jobId)
      .is("deleted_at", null)
      .order("created_at"),
    supabase
      .from("paint_orders")
      .select("id, po_number, status, supplier, expected_on, fulfillment, total_cost_cents")
      .eq("job_id", input.jobId)
      .is("deleted_at", null)
      .order("created_at"),
    supabase.from("time_entries").select("work_order_id, hours").eq("job_id", input.jobId),
    service
      .from("crews")
      .select("id, name, crew_type, active")
      .eq("org_id", input.orgId)
      .is("deleted_at", null)
      .order("name"),
  ]);
  const logged = new Map<string, number>();
  for (const h of hours.data ?? []) {
    if (h.work_order_id)
      logged.set(h.work_order_id, (logged.get(h.work_order_id) ?? 0) + Number(h.hours));
  }
  const crewType = new Map((crews.data ?? []).map((c) => [c.id, c.crew_type]));
  const split = { employee: 0, subcontractor: 0, unassigned: 0 };
  const workOrders = (wos.data ?? []).map((w) => {
    const v: WorkOrderView = {
      id: w.id,
      number: w.work_order_number,
      title: w.title,
      phase: w.phase,
      status: w.status,
      priority: w.priority,
      crewId: w.crew_id,
      scope: w.scope_summary,
      budgetedHours: Number(w.budgeted_hours),
      actualHours: w.actual_hours === null ? null : Number(w.actual_hours),
      loggedHours: logged.get(w.id) ?? 0,
      scheduledStart: w.scheduled_start,
      scheduledEnd: w.scheduled_end,
      completedAt: w.completed_at,
    };
    if (w.status !== "canceled") {
      const t = w.crew_id ? crewType.get(w.crew_id) : null;
      const key =
        t === "subcontractor" ? "subcontractor" : t === "employee" ? "employee" : "unassigned";
      split[key] += v.budgetedHours;
    }
    return v;
  });
  return {
    workOrders,
    paintOrders: (pos.data ?? []).map((p) => ({
      id: p.id,
      number: p.po_number,
      status: p.status,
      supplier: p.supplier,
      expectedOn: p.expected_on,
      fulfillment: p.fulfillment,
      totalCostCents: p.total_cost_cents,
    })),
    crews: (crews.data ?? [])
      .filter((c) => c.active)
      .map((c) => ({ id: c.id, name: c.name, type: c.crew_type })),
    hoursByCrewType: split,
  };
}

export type DailyLogView = {
  id: string;
  date: string;
  authorName: string | null;
  workOrderLabel: string | null;
  finishedToday: string;
  nextUp: string | null;
  issues: string | null;
  weatherObserved: string | null;
  cleanupDone: boolean;
  cleanupPhoto: PhotoThumb | null;
  photos: PhotoThumb[];
  hours: { name: string; hours: number }[];
  customerUpdateStatus: string;
  customerUpdateNote: string | null;
  source: string;
  createdAt: string;
};

export async function loadDailyLogsSection(
  db: Clients,
  input: { jobId: string; limit?: number },
): Promise<DailyLogView[]> {
  const { supabase } = db;
  const { data: logs } = await supabase
    .from("daily_logs")
    .select(
      "id, log_date, author_id, work_order_id, finished_today, next_up, issues, weather_observed, cleanup_done, cleanup_photo_id, customer_update_status, customer_update_note, source, created_at",
    )
    .eq("job_id", input.jobId)
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 30);
  const rows = logs ?? [];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const authorIds = [...new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x))];
  const woIds = [...new Set(rows.map((r) => r.work_order_id).filter((x): x is string => !!x))];
  const [photos, cleanup, hours, people, wos] = await Promise.all([
    loadPhotoThumbs(db, { jobId: input.jobId, dailyLogIds: ids, limit: 200 }),
    loadPhotoThumbs(db, {
      jobId: input.jobId,
      ids: rows.map((r) => r.cleanup_photo_id),
      limit: 200,
    }),
    supabase
      .from("time_entries")
      .select("daily_log_id, user_id, member_name, hours")
      .in("daily_log_id", ids),
    authorIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", authorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    woIds.length
      ? supabase.from("work_orders").select("id, work_order_number, title").in("id", woIds)
      : Promise.resolve({ data: [] as { id: string; work_order_number: string; title: string }[] }),
  ]);
  const hourUserIds = [
    ...new Set((hours.data ?? []).map((h) => h.user_id).filter((x): x is string => !!x)),
  ];
  const { data: hourPeople } = hourUserIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", hourUserIds)
    : { data: [] as { id: string; full_name: string }[] };
  const name = new Map(
    [...(people.data ?? []), ...(hourPeople ?? [])].map((p) => [p.id, p.full_name]),
  );
  const wo = new Map((wos.data ?? []).map((w) => [w.id, `${w.work_order_number} · ${w.title}`]));
  const cleanupById = new Map(cleanup.map((p) => [p.id, p]));
  return rows.map((r) => ({
    id: r.id,
    date: r.log_date,
    authorName: r.author_id ? (name.get(r.author_id) ?? null) : null,
    workOrderLabel: r.work_order_id ? (wo.get(r.work_order_id) ?? null) : null,
    finishedToday: r.finished_today,
    nextUp: r.next_up,
    issues: r.issues,
    weatherObserved: r.weather_observed,
    cleanupDone: r.cleanup_done,
    cleanupPhoto: cleanupById.get(r.cleanup_photo_id) ?? null,
    photos: photos.filter((p) => p.dailyLogId === r.id && p.id !== r.cleanup_photo_id),
    hours: (hours.data ?? [])
      .filter((h) => h.daily_log_id === r.id)
      .map((h) => ({
        name: h.user_id ? (name.get(h.user_id) ?? "Teammate") : (h.member_name ?? "Crew member"),
        hours: Number(h.hours),
      })),
    customerUpdateStatus: r.customer_update_status,
    customerUpdateNote: r.customer_update_note,
    source: r.source,
    createdAt: r.created_at,
  }));
}

export type PunchItemView = {
  id: string;
  area: string;
  description: string;
  status: string;
  assignedTo: string | null;
  waivedNote: string | null;
  fixedAt: string | null;
  photo: PhotoThumb | null;
  fixedPhoto: PhotoThumb | null;
};

export type SignoffView = {
  id: string;
  signerName: string;
  signedAt: string;
  openItems: number;
  note: string | null;
  statement: string;
};

export async function loadPunchSection(
  db: Clients,
  input: { jobId: string },
): Promise<{ items: PunchItemView[]; signoffs: SignoffView[]; photos: PhotoThumb[] }> {
  const { supabase } = db;
  const [items, signoffs, photos] = await Promise.all([
    supabase
      .from("punch_items")
      .select(
        "id, area, description, status, assigned_to, waived_note, fixed_at, photo_id, fixed_photo_id, sort_order, created_at",
      )
      .eq("job_id", input.jobId)
      .order("area")
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("punch_signoffs")
      .select("id, signer_name, signed_at, open_items, note, statement")
      .eq("job_id", input.jobId)
      .order("signed_at", { ascending: false }),
    loadPhotoThumbs(db, { jobId: input.jobId, limit: 60 }),
  ]);
  const extraIds = (items.data ?? [])
    .flatMap((i) => [i.photo_id, i.fixed_photo_id])
    .filter((x): x is string => !!x && !photos.some((p) => p.id === x));
  const extra = extraIds.length
    ? await loadPhotoThumbs(db, { jobId: input.jobId, ids: extraIds, limit: 200 })
    : [];
  const byId = new Map([...photos, ...extra].map((p) => [p.id, p]));
  return {
    items: (items.data ?? []).map((i) => ({
      id: i.id,
      area: i.area,
      description: i.description,
      status: i.status,
      assignedTo: i.assigned_to,
      waivedNote: i.waived_note,
      fixedAt: i.fixed_at,
      photo: i.photo_id ? (byId.get(i.photo_id) ?? null) : null,
      fixedPhoto: i.fixed_photo_id ? (byId.get(i.fixed_photo_id) ?? null) : null,
    })),
    signoffs: (signoffs.data ?? []).map((s) => ({
      id: s.id,
      signerName: s.signer_name,
      signedAt: s.signed_at,
      openItems: s.open_items,
      note: s.note,
      statement: s.statement,
    })),
    photos,
  };
}
