import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import {
  type Bell,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  Hammer,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  NotebookPen,
  Plus,
  ShieldAlert,
  Siren,
  Sparkles,
  UserPlus,
  Users,
  Wrench,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SyncIndicator } from "@/components/offline/sync-indicator";
import { ViewDataDialog } from "@/components/kpi/view-data-dialog";
import type { Viewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { logError } from "@/lib/log";
import { DISPLAY_TZ, formatAppointment, formatRelative } from "@/lib/format/dates";
import {
  LEAD_STATUS_LABELS,
  SERVICE_LABELS,
  type LeadStatus,
  type Service,
} from "@/lib/domain/leads/constants";
import { CATEGORY_LABELS, type AttentionCategory } from "@/lib/domain/attention/rules";
import { countsLine, greeting, readyScore } from "@/lib/domain/analytics/ready-score";
import { pacificToday, resolvePeriod, ymdString } from "@/lib/domain/analytics/periods";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_METRICS,
  parseWorkspaceSummary,
  workspaceMetricValue,
  type WorkspaceMetricId,
  type WorkspaceSummary,
} from "@/lib/metrics/registry";

/**
 * Workspace "My Day" (SPEC §8.3): the default home for everyone but owners
 * (owners can switch). Counts come from workspace_summary() through the
 * registry; the lists are small, row-security-scoped queries.
 */

type CountCard = {
  title: string;
  icon: typeof Bell;
  href: string;
  items: { id: WorkspaceMetricId; href?: string }[];
};

function SectionCard({
  id,
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  id: string;
  title: string;
  icon: typeof Bell;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={`${id}-title`}
          className="flex items-center gap-2 text-base font-semibold text-bb-ink"
        >
          <Icon className="size-4 text-bb-forest" aria-hidden />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-muted px-3 py-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function CountsCard({ card, summary }: { card: CountCard; summary: WorkspaceSummary }) {
  return (
    <section aria-label={card.title} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <Link
        href={card.href}
        className="flex items-center gap-2 text-sm font-semibold text-bb-ink hover:underline"
      >
        <card.icon className="size-4 text-bb-forest" aria-hidden />
        {card.title}
      </Link>
      <ul className="grid grid-cols-2 gap-2">
        {card.items.map((it) => {
          const m = WORKSPACE_METRICS[it.id];
          const n = workspaceMetricValue(it.id, summary);
          const body = (
            <>
              <span className="block text-xs text-muted-foreground">{m.label}</span>
              <span className="block text-lg font-bold text-bb-ink tabular-nums">
                {n.toLocaleString("en-US")}
              </span>
            </>
          );
          return (
            <li key={it.id}>
              {it.href ? (
                <Link
                  href={it.href}
                  className="block rounded-lg bg-muted/40 px-2 py-1.5 hover:bg-muted"
                  title={m.description}
                >
                  {body}
                </Link>
              ) : (
                <div className="rounded-lg bg-muted/40 px-2 py-1.5" title={m.description}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const FEEDS = [
  { id: "team", label: "My Team" },
  { id: "territory", label: "My Territory" },
  { id: "company", label: "Company" },
] as const;
type FeedId = (typeof FEEDS)[number]["id"];

export async function MyDay({
  viewer,
  params,
  now = new Date(),
}: {
  viewer: Viewer;
  params: Record<string, string | string[] | undefined>;
  now?: Date;
}) {
  const db = await createSupabaseServerClient();
  const today = pacificToday(now);
  const day = ymdString(today);
  const { from: startIso, to: endIso } = resolvePeriod("today", now);
  const feedRaw = Array.isArray(params.feed) ? params.feed[0] : params.feed;
  const feed: FeedId = FEEDS.some((f) => f.id === feedRaw) ? (feedRaw as FeedId) : "company";
  const can = (p: Parameters<Viewer["can"]>[0]) => viewer.can(p);
  const me = viewer.id;

  const profile = await db
    .from("profiles")
    .select("default_territory_id")
    .eq("id", me)
    .maybeSingle();
  const myTerritory = profile.data?.default_territory_id ?? null;

  const [
    summaryRes,
    apptRes,
    entriesRes,
    leadsRes,
    tasksRes,
    jobsRes,
    attnRes,
    msgRes,
    mineActRes,
    viewsRes,
    teamRes,
  ] = await Promise.all([
    db.rpc("workspace_summary"),
    can("appointments:read")
      ? db
          .from("appointments")
          .select("id, type, title, starts_at, status, job_id, lead_id")
          .contains("assigned_user_ids", [me])
          .gte("starts_at", startIso)
          .lt("starts_at", endIso)
          .not("status", "in", "(canceled,rescheduled)")
          .order("starts_at")
          .limit(10)
      : Promise.resolve(null),
    can("schedule:read")
      ? db
          .from("schedule_entries")
          .select("id, job_id, starts_on, ends_on, jobs!inner(name, job_number, team_user_ids)")
          .eq("status", "published")
          .lte("starts_on", day)
          .gte("ends_on", day)
          .contains("jobs.team_user_ids", [me])
          .limit(10)
      : Promise.resolve(null),
    can("leads:read")
      ? db
          .from("leads")
          .select("id, first_name, last_name, status, services, city, lead_source")
          .eq("owner_id", me)
          .in("status", ["new", "contacted", "walkthrough_scheduled", "nurture"])
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve(null),
    can("tasks:read")
      ? db
          .from("tasks")
          .select("id, title, due_at, priority, subject_type, subject_id")
          .eq("assignee_id", me)
          .eq("status", "open")
          .is("deleted_at", null)
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(8)
      : Promise.resolve(null),
    can("jobs:read")
      ? db
          .from("jobs")
          .select("id, name, job_number, stage, health_score")
          .contains("team_user_ids", [me])
          .not("stage", "in", "(closed_won,closed_lost)")
          .order("updated_at", { ascending: false })
          .limit(8)
      : Promise.resolve(null),
    can("attention:read")
      ? db
          .from("attention_items")
          .select("id, title, priority, category, subject_type, subject_id, due_at")
          .eq("owner_id", me)
          .neq("status", "resolved")
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(6)
      : Promise.resolve(null),
    can("messages:read")
      ? db
          .from("message_threads")
          .select(
            "id, subject_type, subject_id, last_preview, last_channel, last_message_at, unread",
          )
          .not("last_inbound_at", "is", null)
          .order("unread", { ascending: false })
          .order("last_message_at", { ascending: false })
          .limit(6)
      : Promise.resolve(null),
    db
      .from("activity")
      .select("id, subject_type, subject_id, summary, created_at")
      .eq("actor_id", me)
      .order("created_at", { ascending: false })
      .limit(8),
    db
      .from("saved_views")
      .select("id, name, module, shared, user_id")
      .or(`user_id.eq.${me},shared.eq.true`)
      .order("name")
      .limit(12),
    feed === "team" && myTerritory
      ? db
          .from("profiles")
          .select("id")
          .eq("default_territory_id", myTerritory)
          .eq("is_active", true)
      : Promise.resolve(null),
  ]);
  for (const [k, r] of Object.entries({
    summaryRes,
    apptRes,
    entriesRes,
    leadsRes,
    tasksRes,
    jobsRes,
    attnRes,
    msgRes,
    mineActRes,
    viewsRes,
  })) {
    if (r && "error" in r && r.error) logError(`workspace.${k}`, r.error);
  }
  const summary = parseWorkspaceSummary(summaryRes.data);
  const ready = readyScore(summary);

  // Team Feed: company-wide, my teammates (same home territory) or my territory's leads and jobs.
  let feedQuery = db
    .from("activity")
    .select("id, subject_type, subject_id, summary, created_at, actor_id");
  if (feed === "team") {
    const ids = (teamRes?.data ?? []).map((p) => p.id);
    feedQuery = feedQuery.in("actor_id", ids.length ? ids : [me]);
  } else if (feed === "territory") {
    const [tl, tj] = myTerritory
      ? await Promise.all([
          db.from("leads").select("id").eq("territory_id", myTerritory).limit(200),
          db.from("jobs").select("id").eq("territory_id", myTerritory).limit(200),
        ])
      : [null, null];
    const ids = [...(tl?.data ?? []), ...(tj?.data ?? [])].map((r) => r.id);
    feedQuery = feedQuery.in(
      "subject_id",
      ids.length ? ids : ["00000000-0000-0000-0000-000000000000"],
    );
  }
  const feedRes = await feedQuery.order("created_at", { ascending: false }).limit(10);
  if (feedRes.error) logError("workspace.feed", feedRes.error);
  const actorIds = [
    ...new Set((feedRes.data ?? []).map((a) => a.actor_id).filter((v): v is string => !!v)),
  ];
  const actors = new Map<string, string>();
  if (actorIds.length) {
    const { data } = await db.from("profiles").select("id, full_name").in("id", actorIds);
    for (const p of data ?? []) actors.set(p.id, p.full_name);
  }

  const hour = Number(formatInTimeZone(now, DISPLAY_TZ, "H"));
  const firstName = viewer.name.split(" ")[0] ?? viewer.name;
  const localTime = formatInTimeZone(now, DISPLAY_TZ, "EEEE, MMMM d · h:mm a");
  const subjectHref = (type: string, id: string) =>
    type === "job"
      ? `/jobs/${id}`
      : type === "lead"
        ? `/leads/${id}`
        : type === "account"
          ? `/accounts/${id}`
          : type === "contact"
            ? `/contacts/${id}`
            : "#";

  const cards: CountCard[] = [
    {
      title: "Tasks",
      icon: ListChecks,
      href: "#my-tasks",
      items: [
        { id: "myday.tasks_due_today" },
        { id: "myday.tasks_overdue" },
        { id: "myday.tasks_upcoming" },
        { id: "myday.tasks_no_due" },
      ],
    },
    ...(can("jobs:read")
      ? [
          {
            title: "Jobs",
            icon: BriefcaseBusiness,
            href: "/jobs/list?tab=mine",
            items: [
              { id: "myday.jobs_active" as const, href: "/jobs/list?tab=mine" },
              { id: "myday.appointments_today" as const, href: "#agenda" },
              { id: "myday.jobs_need_action" as const, href: "/attention?mine=1" },
              { id: "myday.jobs_at_risk" as const },
            ],
          },
        ]
      : []),
    ...(can("leads:read")
      ? [
          {
            title: "Leads",
            icon: UserPlus,
            href: "/leads/list?tab=mine",
            items: [
              { id: "myday.leads_new" as const, href: "/leads/list?tab=mine" },
              { id: "myday.leads_awaiting_contact" as const, href: "/leads/list?tab=new" },
              { id: "myday.leads_follow_ups_today" as const, href: "#my-tasks" },
              { id: "myday.leads_converted_today" as const },
            ],
          },
        ]
      : []),
    ...(can("cases:read")
      ? [
          {
            title: "Cases",
            icon: Wrench,
            href: "/cases",
            items: [{ id: "myday.cases_open" as const }, { id: "myday.cases_overdue" as const }],
          },
        ]
      : []),
    {
      title: "Communications",
      icon: MessageSquare,
      href: can("messages:read") ? "/messages" : "#",
      items: [
        ...(can("messages:read")
          ? [{ id: "myday.unread_email" as const }, { id: "myday.unread_sms" as const }]
          : []),
        { id: "myday.mentions_unread" },
        { id: "myday.notifications_unread" },
      ],
    },
  ];

  const attentionCats: AttentionCategory[] = [
    "financial",
    "production",
    "customer",
    "documents",
    "scheduling",
    "qa",
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader
        title={`${greeting(hour)}, ${firstName}`}
        description={
          <>
            <span className="block" data-testid="counts-line">
              {countsLine(summary)}
            </span>
            <span className="block text-xs">{localTime} (Pacific)</span>
          </>
        }
        actions={
          viewer.can("analytics:read") ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/?view=executive">
                <LayoutDashboard aria-hidden />
                Executive Overview
              </Link>
            </Button>
          ) : undefined
        }
      />

      <section
        aria-labelledby="ready-title"
        className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center"
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid size-16 shrink-0 place-items-center rounded-full border-4 text-xl font-bold tabular-nums",
              ready.grade === "ready"
                ? "border-success text-success"
                : ready.grade === "busy"
                  ? "border-warning text-warning"
                  : "border-danger text-danger",
            )}
            aria-hidden
          >
            {ready.score}
          </span>
          <div>
            <h2 id="ready-title" className="text-base font-semibold text-bb-ink">
              Ready Score: <span data-testid="ready-score">{ready.score}</span> · {ready.label}
            </h2>
            <p className="text-xs text-muted-foreground">
              Starts at 100; loses points for what is waiting on you.
            </p>
          </div>
        </div>
        {ready.factors.length > 0 ? (
          <ul className="flex flex-wrap gap-2 sm:ml-auto">
            {ready.factors.map((f) => (
              <li key={f.key}>
                <Link
                  href={f.href}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full bg-muted px-3 text-xs hover:bg-accent"
                >
                  {f.label} <span className="text-muted-foreground">−{f.points}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground sm:ml-auto">
            Nothing is waiting on you. Nice.
          </p>
        )}
        <SyncIndicator className="sm:ml-4" />
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((c) => (
          <CountsCard key={c.title} card={c} summary={summary} />
        ))}
      </div>

      {can("attention:read") && (
        <section
          aria-label="Attention by category"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        >
          {attentionCats.map((c) => (
            <Link
              key={c}
              href={`/attention?mine=1&category=${c}`}
              className="rounded-xl border bg-card px-3 py-2 hover:border-bb-forest/40"
            >
              <span className="block text-xs text-muted-foreground">{CATEGORY_LABELS[c]}</span>
              <span className="text-lg font-bold tabular-nums">
                {summary.attention_by_category[c] ?? 0}
              </span>
            </Link>
          ))}
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {can("attention:read") && (
          <SectionCard
            id="needs-attention"
            title="Needs My Attention"
            icon={Siren}
            action={
              <Link
                href="/attention?mine=1"
                className="text-xs font-medium text-bb-forest hover:underline"
              >
                All
              </Link>
            }
          >
            {(attnRes?.data ?? []).length === 0 ? (
              <Empty>All caught up. Nothing in Attention is yours.</Empty>
            ) : (
              <ul className="flex flex-col divide-y">
                {(attnRes?.data ?? []).map((a) => (
                  <li key={a.id} className="py-2 text-sm">
                    <Link
                      href={subjectHref(a.subject_type, a.subject_id)}
                      className="font-medium hover:underline"
                    >
                      {a.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground capitalize">
                      {a.priority} ·{" "}
                      {a.due_at ? `due ${formatRelative(a.due_at, now)}` : "no due time"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        <SectionCard id="agenda" title="Today's Agenda" icon={CalendarDays}>
          {(apptRes?.data ?? []).length === 0 && (entriesRes?.data ?? []).length === 0 ? (
            <Empty>Nothing on your calendar today.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {(apptRes?.data ?? []).map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <Link
                    href={
                      a.job_id
                        ? `/jobs/${a.job_id}?section=schedule`
                        : a.lead_id
                          ? `/leads/${a.lead_id}`
                          : "#"
                    }
                    className="font-medium hover:underline"
                  >
                    {a.title ?? a.type.replaceAll("_", " ")}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {formatAppointment(a.starts_at)}
                  </span>
                </li>
              ))}
              {(entriesRes?.data ?? []).map((e) => (
                <li key={e.id} className="py-2 text-sm">
                  <Link
                    href={`/jobs/${e.job_id}?section=schedule`}
                    className="font-medium hover:underline"
                  >
                    <Hammer className="mr-1 inline size-3.5" aria-hidden />
                    {e.jobs?.name ?? "Production"}
                  </Link>
                  <span className="block text-xs text-muted-foreground">On the schedule today</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {can("jobs:read") && (
          <SectionCard
            id="my-jobs"
            title="My Jobs"
            icon={BriefcaseBusiness}
            action={
              <Link
                href="/jobs/list?tab=mine"
                className="text-xs font-medium text-bb-forest hover:underline"
              >
                All
              </Link>
            }
          >
            {(jobsRes?.data ?? []).length === 0 ? (
              <Empty>No open jobs you&apos;re on yet.</Empty>
            ) : (
              <ul className="flex flex-col divide-y">
                {(jobsRes?.data ?? []).map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link
                      href={`/jobs/${j.id}`}
                      className="min-w-0 truncate font-medium hover:underline"
                    >
                      {j.name}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{j.job_number}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        {can("leads:read") && (
          <SectionCard
            id="my-leads"
            title="My Leads"
            icon={UserPlus}
            action={
              <Link
                href="/leads/list?tab=mine"
                className="text-xs font-medium text-bb-forest hover:underline"
              >
                All
              </Link>
            }
          >
            {(leadsRes?.data ?? []).length === 0 ? (
              <Empty>No open leads assigned to you.</Empty>
            ) : (
              <ul className="flex flex-col divide-y">
                {(leadsRes?.data ?? []).map((l) => (
                  <li key={l.id} className="py-2 text-sm">
                    <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                      {[l.first_name, l.last_name].filter(Boolean).join(" ")}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {LEAD_STATUS_LABELS[l.status as LeadStatus] ?? l.status} ·{" "}
                      {(l.services as string[])
                        .map((s) => SERVICE_LABELS[s as Service] ?? s)
                        .join(", ") || "No service"}{" "}
                      · {l.city ?? "No city"} · {l.lead_source.replaceAll("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        {can("tasks:read") && (
          <SectionCard id="my-tasks" title="My Tasks" icon={ClipboardList}>
            {(tasksRes?.data ?? []).length === 0 ? (
              <Empty>No open tasks. Add a follow-up from a lead or job to stay on top of it.</Empty>
            ) : (
              <ul className="flex flex-col divide-y">
                {(tasksRes?.data ?? []).map((t) => (
                  <li key={t.id} className="py-2 text-sm">
                    {t.subject_type && t.subject_id ? (
                      <Link
                        href={`${subjectHref(t.subject_type, t.subject_id)}${t.subject_type === "job" ? "?section=tasks" : "?tab=tasks"}`}
                        className="font-medium hover:underline"
                      >
                        {t.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{t.title}</span>
                    )}
                    <span
                      className={cn(
                        "block text-xs",
                        t.due_at && new Date(t.due_at) < now
                          ? "font-medium text-danger"
                          : "text-muted-foreground",
                      )}
                    >
                      {t.due_at ? `Due ${formatAppointment(t.due_at)}` : "No due date"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        {can("messages:read") && (
          <SectionCard
            id="communications"
            title="Communications"
            icon={MessageSquare}
            action={
              <Link href="/messages" className="text-xs font-medium text-bb-forest hover:underline">
                Inbox
              </Link>
            }
          >
            {(msgRes?.data ?? []).length === 0 ? (
              <Empty>No customer messages yet.</Empty>
            ) : (
              <ul className="flex flex-col divide-y">
                {(msgRes?.data ?? []).map((m) => (
                  <li key={m.id} className="py-2 text-sm">
                    <Link
                      href={subjectHref(m.subject_type, m.subject_id)}
                      className={cn("hover:underline", m.unread && "font-semibold")}
                    >
                      {m.unread && <span className="sr-only">Unread: </span>}
                      {m.last_preview ?? "Message"}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {m.last_channel === "sms" ? "Text" : "Email"} ·{" "}
                      {formatRelative(m.last_message_at, now)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        <SectionCard id="recent-activity" title="Recent Activity" icon={NotebookPen}>
          {(mineActRes.data ?? []).length === 0 ? (
            <Empty>What you do shows up here.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {(mineActRes.data ?? []).map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <Link
                    href={subjectHref(a.subject_type, a.subject_id)}
                    className="hover:underline"
                  >
                    {a.summary}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {formatRelative(a.created_at, now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          id="team-feed"
          title="Team Feed"
          icon={Users}
          action={
            <nav aria-label="Team feed scope" className="flex gap-1">
              {FEEDS.map((f) => (
                <Link
                  key={f.id}
                  href={`?feed=${f.id}#team-feed`}
                  aria-current={feed === f.id ? "page" : undefined}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    feed === f.id
                      ? "bg-accent font-semibold text-bb-forest"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {f.label}
                </Link>
              ))}
            </nav>
          }
        >
          {feed !== "company" && !myTerritory ? (
            <Empty>Set your home territory (Admin → Users) to see your team and territory.</Empty>
          ) : (feedRes.data ?? []).length === 0 ? (
            <Empty>No team activity yet.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {(feedRes.data ?? []).map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <Link
                    href={subjectHref(a.subject_type, a.subject_id)}
                    className="hover:underline"
                  >
                    {a.summary}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {(a.actor_id && actors.get(a.actor_id)) ?? "System"} ·{" "}
                    {formatRelative(a.created_at, now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard id="saved-views" title="Saved Views" icon={LayoutDashboard}>
          {(viewsRes.data ?? []).length === 0 ? (
            <Empty>Save a view on any list (filters, columns) and it shows up here.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {(viewsRes.data ?? []).map((v) => {
                const base =
                  v.module === "leads"
                    ? "/leads/list"
                    : v.module === "jobs"
                      ? "/jobs/list"
                      : v.module === "invoices"
                        ? "/invoices"
                        : `/${v.module}`;
                return (
                  <li key={v.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`${base}?view=${v.id}`} className="font-medium hover:underline">
                      {v.name}
                    </Link>
                    <span className="text-xs text-muted-foreground capitalize">
                      {v.module}
                      {v.shared ? " · shared" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard id="shortcuts" title="Shortcuts" icon={Sparkles}>
          <div className="grid grid-cols-2 gap-2">
            {viewer.can("leads:create") && (
              <Button asChild variant="outline" size="touch">
                <Link href="/leads/new">
                  <Plus aria-hidden />
                  New Lead
                </Link>
              </Button>
            )}
            {viewer.can("jobs:create") && (
              <Button asChild variant="outline" size="touch">
                <Link href="/jobs/new">
                  <BriefcaseBusiness aria-hidden />
                  New Job
                </Link>
              </Button>
            )}
            {viewer.can("schedule:read") && (
              <Button asChild variant="outline" size="touch">
                <Link href={viewer.isCrew ? "/field/today" : "/schedule/master"}>
                  <CalendarDays aria-hidden />
                  Schedule
                </Link>
              </Button>
            )}
            {viewer.can("daily_logs:create") && (
              <Button asChild variant="outline" size="touch">
                <Link href="/field/daily-log">
                  <ShieldAlert aria-hidden />
                  Daily Log
                </Link>
              </Button>
            )}
          </div>
        </SectionCard>
      </div>
      <div className="flex justify-end">
        <ViewDataDialog
          title="My Day numbers"
          description="Every count on this page, from workspace_summary() (today, Pacific)."
          dataset="workspace_summary"
          kind="kpi_table"
          columns={[
            { key: "label", label: "Count" },
            { key: "value", label: "Value", align: "right" },
            { key: "id", label: "Registry id" },
          ]}
          rows={(Object.keys(WORKSPACE_METRICS) as WorkspaceMetricId[]).map((id) => ({
            label: WORKSPACE_METRICS[id].label,
            value: workspaceMetricValue(id, summary),
            id,
          }))}
        />
      </div>
    </div>
  );
}
