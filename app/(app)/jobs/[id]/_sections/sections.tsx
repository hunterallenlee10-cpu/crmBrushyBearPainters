import { Info, MessageSquareText } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { JobRecipient } from "@/lib/jobs/messaging";
import type { TaskPriority } from "@/app/(app)/leads/[id]/schemas";
import {
  FEED_LIMIT,
  loadActiveUsers,
  loadCallOutcomes,
  loadFeed,
  loadJobCore,
  loadMessages,
  loadNames,
} from "./data";
import { MessageEntry } from "./entries";
import { JobFeed } from "./feed";
import { MessageComposer } from "./message-composer";
import { NoAccess, Unavailable } from "./section-card";
import { JobTasks, type JobTask } from "./tasks";
import { loadChecklists } from "@/lib/production/job";
import { ChecklistsCard } from "../production/schedule-client";

type SectionProps = { jobId: string; canEdit: boolean };

function labelMap(options: { value: string; label: string }[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.value, o.label]));
}

// --- Messages (SPEC §8.5 #11) -------------------------------------------------------

export async function MessagesSection({ jobId }: SectionProps): Promise<React.ReactNode> {
  const [viewer, job] = await Promise.all([requireViewer(), loadJobCore(jobId)]);
  if (!job) return <Unavailable />;
  if (!viewer.can("messages:read")) {
    return (
      <NoAccess>
        Customer messages are hidden for your role. Ask an owner for the &ldquo;View customer
        messages&rdquo; permission.
      </NoAccess>
    );
  }
  const supabase = await createSupabaseServerClient();
  const [messages, outcomes, contactRes, leadRes] = await Promise.all([
    loadMessages(job),
    loadCallOutcomes(),
    job.primaryContactId
      ? supabase
          .from("contacts")
          .select("id, first_name, last_name, mobile, phone, email, do_not_contact, opted_out_at")
          .eq("id", job.primaryContactId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    job.leadId
      ? supabase.from("leads").select("disposition").eq("id", job.leadId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const c = contactRes.data;
  const contact: JobRecipient | null = c
    ? {
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(" "),
        mobile: c.mobile,
        phone: c.phone,
        email: c.email,
        doNotContact: c.do_not_contact,
        optedOutAt: c.opted_out_at,
      }
    : null;
  const outcomeLabels = labelMap(outcomes);
  const canSend = viewer.can("messages:send");

  return (
    <div className="flex flex-col gap-4">
      <p
        role="note"
        className="flex items-start gap-2 rounded-2xl border border-info/30 bg-info-bg p-3 text-sm text-info"
      >
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        Customer-facing. Internal notes and comments stay separate.
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <div>
          {canSend ? (
            <MessageComposer
              jobId={job.id}
              contact={contact}
              leadDisposition={leadRes.data?.disposition ?? null}
              outcomes={outcomes}
              readOnly={viewer.impersonating}
            />
          ) : (
            <NoAccess>
              You can read this job&apos;s messages but not message customers. Ask an owner for the
              &ldquo;Send customer messages&rdquo; permission.
            </NoAccess>
          )}
        </div>
        <section
          aria-labelledby="job-messages-title"
          className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5"
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="job-messages-title" className="text-base font-semibold">
              Messages
            </h2>
            <span className="text-xs text-muted-foreground">Newest first · Pacific time</span>
          </div>
          {messages.items.length === 0 ? (
            <EmptyState icon={MessageSquareText} title="No messages yet" className="py-8">
              Texts, emails and calls with the customer show up here.
            </EmptyState>
          ) : (
            <ol className="flex flex-col gap-3" aria-label="Customer messages">
              {messages.items.map((m) => (
                <li key={m.id}>
                  <MessageEntry item={m} outcomeLabels={outcomeLabels} />
                </li>
              ))}
            </ol>
          )}
          {messages.truncated && (
            <p className="mt-2 text-xs text-muted-foreground">Showing the latest 200 messages.</p>
          )}
        </section>
      </div>
    </div>
  );
}

// --- Tasks & Checklists (SPEC §8.5 #12) ------------------------------------------------

export async function TasksSection({ jobId, canEdit }: SectionProps): Promise<React.ReactNode> {
  const [viewer, job] = await Promise.all([requireViewer(), loadJobCore(jobId)]);
  if (!job) return <Unavailable />;
  const canRead = viewer.can("tasks:read");
  const canManage = viewer.can("tasks:manage") && !viewer.impersonating;
  const supabase = await createSupabaseServerClient();
  const [tasksRes, users, checklists, templates] = await Promise.all([
    canRead
      ? supabase
          .from("tasks")
          .select("id, title, due_at, status, priority, assignee_id, completed_at")
          .eq("subject_type", "job")
          .eq("subject_id", job.id)
          .order("status", { ascending: false }) // open before done
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(FEED_LIMIT)
      : Promise.resolve({ data: [] }),
    loadActiveUsers(),
    loadChecklists(supabase, job.id),
    supabase
      .from("checklist_templates")
      .select("id, name, sort_order")
      .eq("active", true)
      .order("sort_order"),
  ]);
  const rows = tasksRes.data ?? [];
  const names = await loadNames(rows.map((t) => t.assignee_id));
  const now = Date.now();
  const tasks: JobTask[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    dueAt: t.due_at,
    status: t.status === "done" ? "done" : "open",
    priority: t.priority as TaskPriority,
    assigneeName: names.get(t.assignee_id) ?? null,
    completedAt: t.completed_at,
    overdue: t.status === "open" && t.due_at !== null && new Date(t.due_at).getTime() < now,
  }));

  return (
    <div className="flex flex-col gap-6">
      {canRead ? (
        <JobTasks
          jobId={job.id}
          tasks={tasks}
          canManage={canManage}
          readOnly={viewer.impersonating}
          users={users}
          viewerId={viewer.id}
          truncated={rows.length >= FEED_LIMIT}
        />
      ) : (
        <NoAccess>Tasks are hidden for your role.</NoAccess>
      )}
      <ChecklistsCard
        jobId={job.id}
        checklists={checklists}
        templates={(templates.data ?? []).map((t) => ({ id: t.id, name: t.name }))}
        canAdd={!viewer.impersonating && (viewer.can("work_orders:manage") || canEdit)}
        canTick={
          !viewer.impersonating &&
          (viewer.can("work_orders:manage") || viewer.can("daily_logs:create") || canEdit)
        }
      />
    </div>
  );
}

// --- Notes (#14) and Activity Log (#15) ----------------------------------------------------

async function FeedSection({
  jobId,
  scope,
}: {
  jobId: string;
  scope: "notes" | "all";
}): Promise<React.ReactNode> {
  const [viewer, job] = await Promise.all([requireViewer(), loadJobCore(jobId)]);
  if (!job) return <Unavailable />;
  const [feed, users, outcomes] = await Promise.all([
    loadFeed(job, { includeActivity: scope === "all" }),
    loadActiveUsers(),
    scope === "all" ? loadCallOutcomes() : Promise.resolve([]),
  ]);
  const readOnly = viewer.impersonating;
  return (
    <JobFeed
      jobId={job.id}
      scope={scope}
      items={feed.items}
      truncated={feed.truncated}
      canReadNotes={feed.canReadNotes}
      canReadMessages={viewer.can("messages:read")}
      canWrite={viewer.can("notes:write") && !readOnly}
      canManageTasks={viewer.can("tasks:manage") && !readOnly}
      readOnly={readOnly}
      viewerId={viewer.id}
      users={users}
      outcomeLabels={labelMap(outcomes)}
    />
  );
}

/** Notes: the feed pre-filtered to notes and comments, with the composer. */
export async function NotesSection({ jobId }: SectionProps): Promise<React.ReactNode> {
  return <FeedSection jobId={jobId} scope="notes" />;
}

/** Activity Log: everything on the job, plus the converted lead's history. */
export async function ActivitySection({ jobId }: SectionProps): Promise<React.ReactNode> {
  return <FeedSection jobId={jobId} scope="all" />;
}
