import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { RememberRecent } from "@/components/shell/recent-records";
import { loadJobOptions, labelFor } from "@/lib/jobs/options";
import { loadGateContext } from "@/lib/jobs/stage";
import { isJobStageId, type JobStageId } from "@/lib/domain/stages";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  JOB_PRIORITIES,
  JOB_STATUSES,
  MILESTONE_FIELDS,
  ON_TIME_STATUSES,
  WALKTHROUGH_RESULTS,
  type MilestoneField,
} from "@/lib/domain/jobs/constants";
import type {
  ActivityItem,
  AppointmentItem,
  HistoryItem,
  HoldItem,
  JobDetailData,
  PendingApproval,
} from "./types";
import { jobScopeAllows, parseHealthFactors, parseSection } from "./utils";
import { JobDetailShell } from "./job-detail-shell";
import { SectionContent } from "./section-content";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Browser tab shows the job name (row security applies; hidden jobs read "Job"). */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return { title: "Job" };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("jobs")
    .select("job_number, name")
    .eq("id", id)
    .maybeSingle();
  return { title: data ? `${data.job_number} · ${data.name}` : "Job" };
}

/** Lists on the page are capped; paging arrives with the full sections. */
const LIMIT = 100;

const JOB_SELECT =
  "id, org_id, job_number, name, account_id, property_id, primary_contact_id, lead_id, work_types, stage, stage_entered_at, status, lost_reason, priority, priority_reason, owner_id, point_of_contact_id, project_manager_id, lead_source, lead_sub_source, territory_id, target_season, promised_start_date, actual_start_date, estimated_duration_days, estimated_completion_date, health_score, health_factors, health_checked_at, tags, on_time_guarantee_status, team_user_ids, created_by, created_at, updated_at, lead_created_at, first_contact_at, walkthrough_scheduled_at, walkthrough_completed_at, estimate_sent_at, estimate_accepted_at, contract_signed_at, deposit_paid_at, onboarding_started_at, onboarding_completed_at, ready_to_schedule_at, scheduled_at, work_completed_at, final_walkthrough_at, completed_at, final_invoiced_at, paid_in_full_at, closed_at, lost_at, account:accounts(id, display_name), property:properties(id, street, unit, city, state, zip, year_built, lead_safe_required, property_type, stories, siding_type, has_hoa, hoa_name, hoa_color_approval_required, access_notes, pets, parking, occupancy), contact:contacts!jobs_primary_contact_id_fkey(id, first_name, last_name, mobile, phone, email), owner:profiles!jobs_owner_id_fkey(full_name), poc:profiles!jobs_point_of_contact_id_fkey(full_name), pm:profiles!jobs_project_manager_id_fkey(full_name), territory:territories(name)";

const pick = <T extends string>(list: readonly T[], value: string | null, fallback: T): T =>
  (list as readonly string[]).includes(value ?? "") ? (value as T) : fallback;

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const viewer = await requirePermission("jobs:read");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();

  // Row security decides visibility: a job outside the viewer's scope is simply not found.
  const { data: jobRow, error } = await supabase
    .from("jobs")
    .select(JOB_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!jobRow || !isJobStageId(jobRow.stage)) notFound();
  const j = jobRow;
  const stage: JobStageId = jobRow.stage;

  const can = {
    readFinancials: viewer.can("financials:read"),
    readAppointments: viewer.can("appointments:read"),
    readNotes: viewer.can("notes:read"),
    readTasks: viewer.can("tasks:read"),
  };
  const none = Promise.resolve({ data: null, error: null, count: null });
  const nowIso = new Date().toISOString();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });

  const [
    options,
    me,
    accountJobs,
    holds,
    appointments,
    approvals,
    history,
    activity,
    financials,
    notesCount,
    openTasks,
    tasksDue,
    propertyPicklists,
    gate,
    docCount,
    photoCount,
  ] = await Promise.all([
    loadJobOptions(supabase),
    supabase.from("profiles").select("default_territory_id").eq("id", viewer.id).maybeSingle(),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("account_id", j.account_id),
    supabase
      .from("job_holds")
      .select(
        "id, hold_type, reason, blocks_scheduling, placed_by, placed_at, released_by, released_at, release_note",
      )
      .eq("job_id", id)
      .order("placed_at", { ascending: false })
      .limit(LIMIT),
    can.readAppointments
      ? supabase
          .from("appointments")
          .select("id, type, starts_at, ends_at, status, result, assigned_user_ids, notes")
          .eq("job_id", id)
          .order("starts_at", { ascending: true })
          .limit(LIMIT)
      : none,
    supabase
      .from("approval_requests")
      .select("id, requested_by, requested_at, reason, payload")
      .eq("job_id", id)
      .eq("status", "pending")
      .limit(1),
    supabase
      .from("stage_history")
      .select("id, from_stage, to_stage, changed_at, changed_by, override, reason")
      .eq("job_id", id)
      .order("seq", { ascending: false })
      .limit(20),
    supabase
      .from("activity")
      .select("id, summary, actor_id, created_at")
      .eq("subject_type", "job")
      .eq("subject_id", id)
      .order("created_at", { ascending: false })
      .limit(3),
    can.readFinancials
      ? supabase
          .from("job_financials")
          .select("contract_baseline_cents, contract_cents, estimate_contract_cents")
          .eq("job_id", id)
          .maybeSingle()
      : none,
    can.readNotes
      ? supabase
          .from("notes")
          .select("id", { count: "exact", head: true })
          .eq("subject_type", "job")
          .eq("subject_id", id)
      : none,
    can.readTasks
      ? supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("subject_type", "job")
          .eq("subject_id", id)
          .eq("status", "open")
      : none,
    can.readTasks
      ? supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("subject_type", "job")
          .eq("subject_id", id)
          .eq("status", "open")
          .lte("due_at", nowIso)
      : none,
    supabase
      .from("picklists")
      .select("key, picklist_values(value, label)")
      .in("key", ["siding_type", "property_type"]),
    // Gate facts (walkthrough measured, blocking holds) after the visibility check above.
    loadGateContext(service, id),
    viewer.can("documents:read")
      ? supabase.from("documents").select("id", { count: "exact", head: true }).eq("job_id", id)
      : none,
    viewer.can("photos:read")
      ? supabase.from("job_photos").select("id", { count: "exact", head: true }).eq("job_id", id)
      : none,
  ]);

  // Names for everyone who appears on the page.
  const personIds = new Set<string>();
  for (const h of holds.data ?? []) {
    if (h.placed_by) personIds.add(h.placed_by);
    if (h.released_by) personIds.add(h.released_by);
  }
  for (const a of appointments.data ?? []) for (const u of a.assigned_user_ids) personIds.add(u);
  for (const r of approvals.data ?? []) personIds.add(r.requested_by);
  for (const h of history.data ?? []) if (h.changed_by) personIds.add(h.changed_by);
  for (const a of activity.data ?? []) if (a.actor_id) personIds.add(a.actor_id);
  const people = personIds.size
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", [...personIds])
    : { data: [] };
  const names = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const nameOf = (uid: string | null) => (uid ? (names.get(uid) ?? null) : null);

  const holdItems: HoldItem[] = (holds.data ?? []).map((h) => ({
    id: h.id,
    type: h.hold_type,
    label: labelFor(options.picklists.hold_type, h.hold_type),
    reason: h.reason,
    blocksScheduling: h.blocks_scheduling,
    placedAt: h.placed_at,
    placedByName: nameOf(h.placed_by),
    releasedAt: h.released_at,
    releasedByName: nameOf(h.released_by),
    releaseNote: h.release_note,
  }));

  const appointmentItems: AppointmentItem[] = (appointments.data ?? []).map((a) => ({
    id: a.id,
    type: pick(APPOINTMENT_TYPES, a.type, "walkthrough"),
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    status: pick(APPOINTMENT_STATUSES, a.status, "scheduled"),
    result: a.result ? pick(WALKTHROUGH_RESULTS, a.result, "measured") : null,
    assignees: a.assigned_user_ids.map((u) => ({ id: u, name: nameOf(u) ?? "Former teammate" })),
    notes: a.notes,
  }));

  const pendingRow = approvals.data?.[0];
  const payload =
    pendingRow?.payload &&
    typeof pendingRow.payload === "object" &&
    !Array.isArray(pendingRow.payload)
      ? pendingRow.payload
      : {};
  const requestedTo = typeof payload.to_stage === "string" ? payload.to_stage : "";
  const pendingApproval: PendingApproval | null =
    pendingRow && isJobStageId(requestedTo)
      ? {
          id: pendingRow.id,
          toStage: requestedTo,
          reason: pendingRow.reason,
          requestedAt: pendingRow.requested_at,
          requestedByName: nameOf(pendingRow.requested_by),
          mine: pendingRow.requested_by === viewer.id,
        }
      : null;

  const historyItems: HistoryItem[] = (history.data ?? []).flatMap((h) =>
    isJobStageId(h.to_stage)
      ? [
          {
            id: h.id,
            from: h.from_stage && isJobStageId(h.from_stage) ? h.from_stage : null,
            to: h.to_stage,
            at: h.changed_at,
            byName: nameOf(h.changed_by),
            override: h.override,
            reason: h.reason,
          },
        ]
      : [],
  );

  const recentActivity: ActivityItem[] = (activity.data ?? []).map((a) => ({
    id: a.id,
    summary: a.summary,
    at: a.created_at,
    byName: nameOf(a.actor_id),
  }));

  const labelMap = (key: string) =>
    Object.fromEntries(
      ((propertyPicklists.data ?? []).find((l) => l.key === key)?.picklist_values ?? []).map(
        (v) => [v.value, v.label],
      ),
    ) as Record<string, string>;

  const p = j.property;
  const address = p
    ? [
        p.street && [p.street, p.unit].filter(Boolean).join(" "),
        p.city,
        [p.state, p.zip].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ") || null
    : null;
  const milestones = Object.fromEntries(MILESTONE_FIELDS.map(([f]) => [f, j[f]])) as Record<
    MilestoneField,
    string | null
  >;

  const readOnly = viewer.impersonating;
  const writable = (ok: boolean) => ok && !readOnly;
  const territoryId = me.data?.default_territory_id ?? null;
  const scoped = {
    ownerId: j.owner_id,
    createdBy: j.created_by,
    teamUserIds: j.team_user_ids,
    territoryId: j.territory_id,
  };
  const canUpdate = jobScopeAllows(viewer.permissions["jobs:update"], scoped, {
    id: viewer.id,
    territoryId,
  });
  const canOverride = viewer.can("job_admin:override");

  const data: JobDetailData = {
    job: {
      id: j.id,
      number: j.job_number,
      name: j.name,
      stage,
      status: pick(JOB_STATUSES, j.status, "open"),
      stageEnteredAt: j.stage_entered_at,
      lostReason: j.lost_reason,
      priority: pick(JOB_PRIORITIES, j.priority, "normal"),
      priorityReason: j.priority_reason,
      workTypes: j.work_types,
      accountId: j.account_id,
      accountName: j.account?.display_name ?? null,
      accountJobCount: accountJobs.count ?? 1,
      propertyId: j.property_id,
      property: p
        ? {
            id: p.id,
            address,
            city: p.city,
            yearBuilt: p.year_built,
            leadSafe: p.lead_safe_required === true,
            propertyType: p.property_type,
            stories: p.stories,
            sidingType: p.siding_type,
            hasHoa: p.has_hoa,
            hoaName: p.hoa_name,
            hoaColorApproval: p.hoa_color_approval_required,
            accessNotes: p.access_notes,
            pets: p.pets,
            parking: p.parking,
            occupancy: p.occupancy,
          }
        : null,
      contactId: j.primary_contact_id,
      contact: j.contact
        ? {
            id: j.contact.id,
            name: [j.contact.first_name, j.contact.last_name].filter(Boolean).join(" "),
            mobile: j.contact.mobile,
            phone: j.contact.phone,
            email: j.contact.email,
          }
        : null,
      leadId: j.lead_id,
      leadSource: j.lead_source,
      leadSubSource: j.lead_sub_source,
      territoryName: j.territory?.name ?? null,
      ownerId: j.owner_id,
      ownerName: j.owner?.full_name ?? null,
      pocId: j.point_of_contact_id,
      pocName: j.poc?.full_name ?? null,
      pmId: j.project_manager_id,
      pmName: j.pm?.full_name ?? null,
      targetSeason: j.target_season,
      promisedStartDate: j.promised_start_date,
      actualStartDate: j.actual_start_date,
      estimatedDurationDays: j.estimated_duration_days,
      estimatedCompletionDate: j.estimated_completion_date,
      tags: j.tags,
      healthScore: j.health_score,
      healthFactors: parseHealthFactors(j.health_factors),
      healthCheckedAt: j.health_checked_at,
      onTimeStatus: pick(ON_TIME_STATUSES, j.on_time_guarantee_status, "n/a"),
      milestones,
      createdAt: j.created_at,
      updatedAt: j.updated_at,
    },
    options,
    propertyLabels: { siding: labelMap("siding_type"), propertyType: labelMap("property_type") },
    holds: holdItems,
    appointments: appointmentItems,
    pendingApproval,
    history: historyItems,
    recentActivity,
    contractCents: financials.data?.contract_cents ?? null,
    contractBaselineCents: financials.data?.contract_baseline_cents ?? null,
    contractFromEstimate: financials.data?.estimate_contract_cents != null,
    gate,
    counts: {
      notes: notesCount.count ?? null,
      openTasks: openTasks.count ?? null,
      tasksDue: tasksDue.count ?? null,
      documents: docCount.count ?? null,
      photos: photoCount.count ?? null,
      onboardingOpen: gate.onboardingOpen?.length ?? null,
    },
    can: {
      update: writable(canUpdate),
      assign: writable(viewer.can("jobs:assign")),
      advance: writable(viewer.can("jobs:advance_stage")),
      override: writable(canOverride),
      delete: writable(viewer.can("jobs:delete") && canUpdate),
      readFinancials: can.readFinancials,
      readEstimates: viewer.can("estimates:read"),
      readDocuments: viewer.can("documents:read"),
      readInvoices: viewer.can("invoices:read"),
      editEstimates: writable(viewer.can("estimates:create") && canUpdate),
      sendEstimates: writable(viewer.can("estimates:send") && canUpdate),
      draftChangeOrders: writable(viewer.can("change_orders:draft")),
      readAppointments: can.readAppointments,
      manageAppointments: writable(viewer.can("appointments:manage")),
      readMessages: viewer.can("messages:read"),
      readNotes: can.readNotes,
      readTasks: can.readTasks,
      sendMessages: writable(viewer.can("messages:send")),
      manageDocuments: writable(viewer.can("documents:manage")),
      manageTasks: writable(viewer.can("tasks:manage")),
      readPhotos: viewer.can("photos:read"),
      uploadPhotos: writable(viewer.can("photos:upload")),
      deletePhotos: writable(viewer.can("photos:delete")),
      managePaintOrders: writable(viewer.can("paint_orders:manage")),
      createDailyLogs: writable(viewer.can("daily_logs:create")),
    },
    viewerId: viewer.id,
    readOnly,
    // Admin follows the (viewed) user's rights; it is read-only while viewing as someone.
    section: parseSection(sp.section, { canAdmin: canOverride }),
  };

  return (
    <>
      <RememberRecent
        kind="job"
        id={j.id}
        title={`${j.job_number} · ${j.name}`}
        href={`/jobs/${j.id}`}
      />
      <JobDetailShell data={data}>
        <SectionContent
          data={data}
          tab={typeof sp.tab === "string" ? sp.tab : undefined}
          limit={typeof sp.limit === "string" ? Number(sp.limit) || undefined : undefined}
        />
      </JobDetailShell>
    </>
  );
}
