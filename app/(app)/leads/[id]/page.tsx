import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { loadLeadOptions } from "@/lib/leads/service";
import type {
  Grade,
  HomeBuilt,
  LeadStatus,
  Service,
  Temperature,
  Timeline,
} from "@/lib/domain/leads/constants";
import { RememberRecent } from "@/components/shell/recent-records";
import type { CommentCategory, NotePriority, TaskPriority } from "./schemas";
import type { LeadDetailData, PhotoItem, ThreadItem } from "./types";
import { nameInitials, parseTab, scopeAllows } from "./utils";
import { LeadDetail } from "./lead-detail";
import { CustomFieldsCard } from "@/components/custom-fields/custom-fields-card";
import { loadLayout } from "@/lib/custom-fields/server";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Browser tab shows the lead's name (RLS applies; unknown or hidden leads read "Lead"). */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return { title: "Lead" };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("leads")
    .select("first_name, last_name")
    .eq("id", id)
    .maybeSingle();
  return { title: data ? [data.first_name, data.last_name].filter(Boolean).join(" ") : "Lead" };
}

/** Lists on the page are capped; older items arrive with paging later. */
const LIMIT = 200;
/** Signed photo links expire quickly (SPEC §13.1). */
const SIGNED_URL_SECONDS = 600;

const LEAD_SELECT =
  "id, org_id, first_name, last_name, company, mobile, phone, email, street, unit, city, state, zip, out_of_area, territory_id, services, timeline, home_built, year_built, property_type, stories, siding_type, has_hoa, customer_notes, status, disposition, sms_opted_out_at, lost_reason, lead_source, lead_sub_source, lead_set_by, owner_id, created_by, score, grade, temperature, score_factors, scored_at, custom_field_values, walkthrough_at, nurture_until, first_contacted_at, speed_to_lead_seconds, intake_channel, created_at, updated_at, last_activity_at, owner:profiles!leads_owner_id_fkey(full_name), set_by:profiles!leads_lead_set_by_fkey(full_name), territory:territories(name)";

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const viewer = await requirePermission("leads:read");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();

  // RLS decides visibility: a lead outside the viewer's scope is simply not found.
  const { data: l, error } = await supabase
    .from("leads")
    .select(LEAD_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!l) notFound();

  const can = {
    readMessages: viewer.can("messages:read"),
    readNotes: viewer.can("notes:read"),
    readTasks: viewer.can("tasks:read"),
  };
  const none = Promise.resolve({ data: null, error: null });

  const [options, me, messages, activity, notes, comments, tasks, attachments, convo, templates] =
    await Promise.all([
      loadLeadOptions(supabase),
      supabase.from("profiles").select("default_territory_id").eq("id", viewer.id).maybeSingle(),
      can.readMessages
        ? supabase
            .from("messages")
            .select(
              "id, channel, direction, status, simulated, to_address, email_subject, body, call_outcome, call_duration_seconds, sent_by, created_at, workflow_run_id, campaign_id",
            )
            .eq("subject_type", "lead")
            .eq("subject_id", id)
            .order("created_at", { ascending: false })
            .limit(LIMIT)
        : none,
      supabase
        .from("activity")
        .select("id, type, summary, actor_id, created_at")
        .eq("subject_type", "lead")
        .eq("subject_id", id)
        .order("created_at", { ascending: false })
        .limit(LIMIT),
      can.readNotes
        ? supabase
            .from("notes")
            .select("id, body, pinned, priority, created_at, updated_at, created_by")
            .eq("subject_type", "lead")
            .eq("subject_id", id)
            .order("pinned", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(LIMIT)
        : none,
      can.readNotes
        ? supabase
            .from("comments")
            .select("id, body, category, mentions, created_at, edited_at, created_by")
            .eq("subject_type", "lead")
            .eq("subject_id", id)
            .order("created_at", { ascending: false })
            .limit(LIMIT)
        : none,
      can.readTasks
        ? supabase
            .from("tasks")
            .select("id, title, due_at, status, priority, assignee_id, completed_at")
            .eq("subject_type", "lead")
            .eq("subject_id", id)
            .order("status", { ascending: false }) // open before done
            .order("due_at", { ascending: true, nullsFirst: false })
            .limit(LIMIT)
        : none,
      supabase
        .from("lead_attachments")
        .select("id, storage_path, file_name, content_type, source, created_at")
        .eq("lead_id", id)
        .order("created_at", { ascending: true })
        .limit(50),
      can.readMessages
        ? supabase
            .from("message_threads")
            .select("id, unread, last_inbound_at")
            .eq("subject_type", "lead")
            .eq("subject_id", id)
            .maybeSingle()
        : none,
      viewer.can("messages:send")
        ? supabase
            .from("message_templates")
            .select("key, name, channel")
            .eq("active", true)
            .neq("category", "internal")
            .order("name")
        : Promise.resolve({
            data: [] as { key: string; name: string; channel: string }[],
            error: null,
          }),
    ]);

  // Names for everyone who appears on the page (authors, actors, assignees, mentions).
  const personIds = new Set<string>();
  for (const m of messages.data ?? []) if (m.sent_by) personIds.add(m.sent_by);
  for (const a of activity.data ?? []) if (a.actor_id) personIds.add(a.actor_id);
  for (const n of notes.data ?? []) if (n.created_by) personIds.add(n.created_by);
  for (const c of comments.data ?? []) {
    if (c.created_by) personIds.add(c.created_by);
    for (const m of c.mentions) personIds.add(m);
  }
  for (const t of tasks.data ?? []) personIds.add(t.assignee_id);
  const people = personIds.size
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", [...personIds])
    : { data: [] };
  const names = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const nameOf = (uid: string | null) => (uid ? (names.get(uid) ?? null) : null);

  // Photos: the user could read the attachment rows (RLS), so sign short-lived links.
  let photos: PhotoItem[] = [];
  const files = attachments.data ?? [];
  if (files.length) {
    const svc = await createSupabaseServiceClient({ actorId: viewer.id });
    const { data: signed } = await svc.storage.from("lead-attachments").createSignedUrls(
      files.map((f) => f.storage_path),
      SIGNED_URL_SECONDS,
    );
    const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    photos = files.map((f) => ({
      id: f.id,
      fileName: f.file_name,
      url: urlByPath.get(f.storage_path) ?? null,
      isImage: f.content_type.startsWith("image/") && !f.content_type.includes("hei"),
      source: f.source,
      createdAt: f.created_at,
    }));
  }

  const now = Date.now();
  const thread: ThreadItem[] = [
    ...(messages.data ?? []).map((m): ThreadItem => ({
      kind: "message",
      id: m.id,
      at: m.created_at,
      channel: m.channel as Extract<ThreadItem, { kind: "message" }>["channel"],
      direction: m.direction as "outbound" | "inbound",
      status: m.status,
      simulated: m.simulated,
      to: m.to_address,
      subject: m.email_subject,
      body: m.body,
      callOutcome: m.call_outcome,
      callDurationSeconds: m.call_duration_seconds,
      byName: nameOf(m.sent_by),
      automatic: !!m.workflow_run_id || !!m.campaign_id,
    })),
    ...(activity.data ?? []).map((a): ThreadItem => ({
      kind: "event",
      id: a.id,
      at: a.created_at,
      type: a.type,
      summary: a.summary,
      byName: nameOf(a.actor_id),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const territoryId = me.data?.default_territory_id ?? null;
  const record = { ownerId: l.owner_id, createdBy: l.created_by, territoryId: l.territory_id };
  const readOnly = viewer.impersonating;
  const writable = (ok: boolean) => ok && !readOnly;

  const address = [
    l.street && [l.street, l.unit].filter(Boolean).join(" "),
    l.city,
    [l.state, l.zip].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const factors = Array.isArray(l.score_factors)
    ? l.score_factors.flatMap((f) =>
        f && typeof f === "object" && !Array.isArray(f) && "label" in f && "points" in f
          ? [{ label: String(f.label), points: Number(f.points) }]
          : [],
      )
    : [];
  const name = [l.first_name, l.last_name].filter(Boolean).join(" ");

  const layout = await loadLayout(supabase, "leads");
  const data: LeadDetailData = {
    lead: {
      id: l.id,
      name,
      initials: nameInitials(l.first_name, l.last_name),
      firstName: l.first_name,
      lastName: l.last_name,
      company: l.company,
      mobile: l.mobile,
      phone: l.phone,
      email: l.email,
      street: l.street,
      unit: l.unit,
      city: l.city,
      state: l.state,
      zip: l.zip,
      address: address || null,
      outOfArea: l.out_of_area,
      territoryName: l.territory?.name ?? null,
      services: l.services as Service[],
      timeline: l.timeline as Timeline | null,
      homeBuilt: l.home_built as HomeBuilt | null,
      yearBuilt: l.year_built,
      leadSafe:
        (l.year_built !== null && l.year_built < 1978) ||
        l.home_built === "before_1978" ||
        l.home_built === "not_sure",
      propertyType: l.property_type,
      stories: l.stories,
      sidingType: l.siding_type,
      hasHoa: l.has_hoa,
      customerNotes: l.customer_notes,
      status: l.status as LeadStatus,
      disposition: l.disposition,
      smsOptedOutAt: l.sms_opted_out_at,
      lostReason: l.lost_reason,
      leadSource: l.lead_source,
      leadSubSource: l.lead_sub_source,
      leadSetById: l.lead_set_by,
      leadSetByName: l.set_by?.full_name ?? null,
      ownerId: l.owner_id,
      ownerName: l.owner?.full_name ?? null,
      score: l.score,
      grade: l.grade as Grade | null,
      temperature: l.temperature as Temperature | null,
      factors,
      scoredAt: l.scored_at,
      walkthroughAt: l.walkthrough_at,
      nurtureUntil: l.nurture_until,
      firstContactedAt: l.first_contacted_at,
      speedToLeadSeconds: l.speed_to_lead_seconds,
      intakeChannel: l.intake_channel,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
      lastActivityAt: l.last_activity_at,
    },
    options,
    thread,
    conversation: convo.data
      ? {
          id: convo.data.id,
          unread: !!convo.data.unread,
          lastInboundAt: convo.data.last_inbound_at,
        }
      : null,
    templates: (templates.data ?? []).map((t) => ({
      key: t.key,
      name: t.name,
      channel: t.channel === "email" ? ("email" as const) : ("sms" as const),
    })),
    notes: (notes.data ?? []).map((n) => ({
      id: n.id,
      body: n.body,
      pinned: n.pinned,
      priority: n.priority as NotePriority,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
      authorName: nameOf(n.created_by),
      mine: n.created_by === viewer.real.id,
    })),
    comments: (comments.data ?? []).map((c) => ({
      id: c.id,
      body: c.body,
      category: c.category as CommentCategory,
      mentions: c.mentions.map((m) => ({ id: m, name: nameOf(m) ?? "Former teammate" })),
      createdAt: c.created_at,
      editedAt: c.edited_at,
      authorName: nameOf(c.created_by),
      mine: c.created_by === viewer.real.id,
    })),
    tasks: (tasks.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.due_at,
      status: t.status as "open" | "done",
      priority: t.priority as TaskPriority,
      assigneeId: t.assignee_id,
      assigneeName: nameOf(t.assignee_id),
      completedAt: t.completed_at,
      overdue: t.status === "open" && t.due_at !== null && new Date(t.due_at).getTime() < now,
    })),
    photos,
    can: {
      update: writable(
        scopeAllows(viewer.permissions["leads:update"], record, { id: viewer.id, territoryId }),
      ),
      assign: writable(viewer.can("leads:assign")),
      delete: writable(viewer.can("leads:delete")),
      send: writable(viewer.can("messages:send")),
      readMessages: can.readMessages,
      readNotes: can.readNotes,
      writeNotes: writable(viewer.can("notes:write")),
      readTasks: can.readTasks,
      manageTasks: writable(viewer.can("tasks:manage")),
      manageScoring: viewer.can("settings:manage"),
    },
    viewerId: viewer.id,
    readOnly,
    initialTab: parseTab(sp.tab),
    openBooking: sp.book === "1",
    truncated: {
      thread: (messages.data?.length ?? 0) >= LIMIT || (activity.data?.length ?? 0) >= LIMIT,
      notes: (notes.data?.length ?? 0) >= LIMIT,
      comments: (comments.data?.length ?? 0) >= LIMIT,
      tasks: (tasks.data?.length ?? 0) >= LIMIT,
    },
  };

  return (
    <>
      <RememberRecent kind="lead" id={l.id} title={name} href={`/leads/${l.id}`} />
      <LeadDetail
        data={data}
        tabOrder={layout.filter((s) => s.visible && s.key !== "custom_fields").map((s) => s.key)}
        moreFields={
          layout.some((s) => s.key === "custom_fields" && s.visible) ? (
            <CustomFieldsCard
              module="leads"
              recordId={l.id}
              values={l.custom_field_values}
              canEdit={data.can.update && !data.readOnly && l.status !== "converted"}
            />
          ) : null
        }
      />
    </>
  );
}
