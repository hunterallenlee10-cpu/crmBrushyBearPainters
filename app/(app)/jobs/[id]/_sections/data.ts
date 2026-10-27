import "server-only";
import { cache } from "react";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { Option } from "@/lib/leads/service";
import type { CommentCategory, NotePriority } from "@/app/(app)/leads/[id]/schemas";
import type { FeedItem, FeedMessage } from "./feed-utils";

/**
 * Data for the Job Detail sections, read with the viewer's own Supabase
 * client so row security decides what shows. Loaders are cached per request:
 * several sections (and the Shell) can ask for the same job cheaply.
 */

/** Lists are capped per source; older entries arrive with paging later (like the lead page). */
export const FEED_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type JobCore = {
  id: string;
  orgId: string;
  jobNumber: string;
  name: string;
  stage: string;
  status: string;
  accountId: string;
  propertyId: string | null;
  primaryContactId: string | null;
  leadId: string | null;
  ownerId: string | null;
  pointOfContactId: string | null;
  projectManagerId: string | null;
};

/** The job as the viewer may see it, or null (hidden or missing). */
export const loadJobCore = cache(async (jobId: string): Promise<JobCore | null> => {
  if (!UUID.test(jobId)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, org_id, job_number, name, stage, status, account_id, property_id, primary_contact_id, lead_id, owner_id, point_of_contact_id, project_manager_id",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    orgId: data.org_id,
    jobNumber: data.job_number,
    name: data.name,
    stage: data.stage,
    status: data.status,
    accountId: data.account_id,
    propertyId: data.property_id,
    primaryContactId: data.primary_contact_id,
    leadId: data.lead_id,
    ownerId: data.owner_id,
    pointOfContactId: data.point_of_contact_id,
    projectManagerId: data.project_manager_id,
  };
});

/** Active teammates for pickers (assignee, @mention, add teammate). */
export const loadActiveUsers = cache(async (): Promise<Option[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .order("full_name")
    .limit(500);
  return (data ?? []).map((u) => ({ value: u.id, label: u.full_name }));
});

/** Names for the people on a page (authors, actors, assignees, mentions). */
export async function loadNames(ids: Iterable<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((v): v is string => Boolean(v)))];
  if (!unique.length) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p.full_name]));
}

/** Call outcomes (the lead_disposition picklist, active values). */
export async function loadCallOutcomes(): Promise<Option[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("picklists")
    .select("picklist_values(value, label, active, sort_order)")
    .eq("key", "lead_disposition")
    .maybeSingle();
  return [...(data?.picklist_values ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((v) => ({ value: v.value, label: v.label, active: v.active }));
}

type MessageRow = {
  id: string;
  channel: string;
  direction: string;
  status: string;
  to_address: string | null;
  email_subject: string | null;
  body: string | null;
  call_outcome: string | null;
  call_duration_seconds: number | null;
  sent_by: string | null;
  created_at: string;
  workflow_run_id: string | null;
  campaign_id: string | null;
};

const MESSAGE_SELECT =
  "id, channel, direction, status, to_address, email_subject, body, call_outcome, call_duration_seconds, sent_by, created_at, workflow_run_id, campaign_id";

function toMessage(m: MessageRow, fromLead: boolean, names: Map<string, string>): FeedMessage {
  return {
    kind: "message",
    id: m.id,
    at: m.created_at,
    fromLead,
    authorName: m.sent_by ? (names.get(m.sent_by) ?? null) : null,
    channel: m.channel as FeedMessage["channel"],
    direction: m.direction === "inbound" ? "inbound" : "outbound",
    status: m.status,
    to: m.to_address,
    subject: m.email_subject,
    body: m.body,
    callOutcome: m.call_outcome,
    callDurationSeconds: m.call_duration_seconds,
    automatic: !!m.workflow_run_id || !!m.campaign_id,
  };
}

/** Customer messages on the job plus (read-only) the lead's earlier ones. */
export async function loadMessages(job: JobCore): Promise<{
  items: FeedMessage[];
  truncated: boolean;
}> {
  const supabase = await createSupabaseServerClient();
  const none = Promise.resolve({ data: [] as MessageRow[], error: null });
  const [own, lead] = await Promise.all([
    supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("subject_type", "job")
      .eq("subject_id", job.id)
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    job.leadId
      ? supabase
          .from("messages")
          .select(MESSAGE_SELECT)
          .eq("subject_type", "lead")
          .eq("subject_id", job.leadId)
          .order("created_at", { ascending: false })
          .limit(FEED_LIMIT)
      : none,
  ]);
  const ownRows = own.data ?? [];
  const leadRows = lead.data ?? [];
  const names = await loadNames([...ownRows, ...leadRows].map((m) => m.sent_by));
  const items = [
    ...ownRows.map((m) => toMessage(m, false, names)),
    ...leadRows.map((m) => toMessage(m, true, names)),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    items,
    truncated: ownRows.length >= FEED_LIMIT || leadRows.length >= FEED_LIMIT,
  };
}

/**
 * The job's feed: notes and comments (with notes:read), plus — for the
 * Activity Log — job activity, the converted lead's activity ("From the lead")
 * and customer messages (with messages:read).
 */
export async function loadFeed(
  job: JobCore,
  opts: { includeActivity: boolean },
): Promise<{ items: FeedItem[]; truncated: boolean; canReadNotes: boolean }> {
  const viewer = await requireViewer();
  const supabase = await createSupabaseServerClient();
  const canReadNotes = viewer.can("notes:read");
  const canReadMessages = viewer.can("messages:read");
  type ActivityRow = {
    id: string;
    type: string;
    summary: string;
    actor_id: string | null;
    created_at: string;
  };
  const emptyActivity = Promise.resolve({ data: [] as ActivityRow[], error: null });

  const [notes, comments, activity, leadActivity, messages] = await Promise.all([
    canReadNotes
      ? supabase
          .from("notes")
          .select("id, body, pinned, priority, created_at, updated_at, created_by")
          .eq("subject_type", "job")
          .eq("subject_id", job.id)
          .order("created_at", { ascending: false })
          .limit(FEED_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    canReadNotes
      ? supabase
          .from("comments")
          .select("id, body, category, mentions, created_at, edited_at, created_by")
          .eq("subject_type", "job")
          .eq("subject_id", job.id)
          .order("created_at", { ascending: false })
          .limit(FEED_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    opts.includeActivity
      ? supabase
          .from("activity")
          .select("id, type, summary, actor_id, created_at")
          .eq("subject_type", "job")
          .eq("subject_id", job.id)
          .order("created_at", { ascending: false })
          .limit(FEED_LIMIT)
      : emptyActivity,
    opts.includeActivity && job.leadId
      ? supabase
          .from("activity")
          .select("id, type, summary, actor_id, created_at")
          .eq("subject_type", "lead")
          .eq("subject_id", job.leadId)
          .order("created_at", { ascending: false })
          .limit(FEED_LIMIT)
      : emptyActivity,
    opts.includeActivity && canReadMessages
      ? loadMessages(job)
      : Promise.resolve({ items: [] as FeedMessage[], truncated: false }),
  ]);

  const noteRows = notes.data ?? [];
  const commentRows = comments.data ?? [];
  const jobEvents = activity.data ?? [];
  const leadEvents = leadActivity.data ?? [];
  const names = await loadNames([
    ...noteRows.map((n) => n.created_by),
    ...commentRows.flatMap((c) => [c.created_by, ...c.mentions]),
    ...jobEvents.map((a) => a.actor_id),
    ...leadEvents.map((a) => a.actor_id),
  ]);
  const nameOf = (uid: string | null) => (uid ? (names.get(uid) ?? null) : null);
  const me = viewer.real.id;

  const items: FeedItem[] = [
    ...noteRows.map((n): FeedItem => ({
      kind: "note",
      id: n.id,
      at: n.created_at,
      fromLead: false,
      authorName: nameOf(n.created_by),
      body: n.body,
      pinned: n.pinned,
      priority: n.priority as NotePriority,
      updatedAt: n.updated_at,
      mine: n.created_by === me,
    })),
    ...commentRows.map((c): FeedItem => ({
      kind: "comment",
      id: c.id,
      at: c.created_at,
      fromLead: false,
      authorName: nameOf(c.created_by),
      body: c.body,
      category: c.category as CommentCategory,
      mentions: c.mentions.map((m) => ({ id: m, name: nameOf(m) ?? "Former teammate" })),
      editedAt: c.edited_at,
      mine: c.created_by === me,
    })),
    ...jobEvents.map((a): FeedItem => ({
      kind: "event",
      id: a.id,
      at: a.created_at,
      fromLead: false,
      authorName: nameOf(a.actor_id),
      type: a.type,
      summary: a.summary,
    })),
    ...leadEvents.map((a): FeedItem => ({
      kind: "event",
      id: a.id,
      at: a.created_at,
      fromLead: true,
      authorName: nameOf(a.actor_id),
      type: a.type,
      summary: a.summary,
    })),
    ...messages.items,
  ];

  const truncated =
    [noteRows, commentRows, jobEvents, leadEvents].some((r) => r.length >= FEED_LIMIT) ||
    messages.truncated;
  return { items, truncated, canReadNotes };
}
