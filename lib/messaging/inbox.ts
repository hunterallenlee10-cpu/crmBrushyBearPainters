import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

type Db = SupabaseClient<Database>;

/**
 * Inbox loaders (SPEC §5.7 message threads): conversations newest first with
 * unread state, and one conversation's messages. Read with the person's own
 * client, so row security decides which conversations they see.
 */

export const INBOX_TABS = [
  { id: "unread", label: "Unread" },
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
] as const;
export type InboxTab = (typeof INBOX_TABS)[number]["id"];

export type ThreadListItem = {
  id: string;
  subjectType: string;
  subjectId: string;
  title: string;
  subtitle: string | null;
  href: string | null;
  unread: boolean;
  lastAt: string | null;
  lastInboundAt: string | null;
  lastDirection: string | null;
  lastChannel: string | null;
  preview: string | null;
  messageCount: number;
};

export const INBOX_PAGE = 40;

async function mySubjects(db: Db, userId: string) {
  const [jobs, leads] = await Promise.all([
    db
      .from("jobs")
      .select("id")
      .or(`owner_id.eq.${userId},point_of_contact_id.eq.${userId},project_manager_id.eq.${userId}`)
      .limit(2000),
    db
      .from("leads")
      .select("id")
      .or(`owner_id.eq.${userId},point_of_contact_id.eq.${userId}`)
      .limit(2000),
  ]);
  return [...(jobs.data ?? []).map((j) => j.id), ...(leads.data ?? []).map((l) => l.id)];
}

async function names(db: Db, rows: readonly { subject_type: string; subject_id: string }[]) {
  const ids = (t: string) => [
    ...new Set(rows.filter((r) => r.subject_type === t).map((r) => r.subject_id)),
  ];
  const [jobs, leads, contacts, accounts] = await Promise.all([
    ids("job").length
      ? db.from("jobs").select("id, name, job_number").in("id", ids("job"))
      : Promise.resolve({ data: [] }),
    ids("lead").length
      ? db.from("leads").select("id, first_name, last_name, city").in("id", ids("lead"))
      : Promise.resolve({ data: [] }),
    ids("contact").length
      ? db.from("contacts").select("id, first_name, last_name").in("id", ids("contact"))
      : Promise.resolve({ data: [] }),
    ids("account").length
      ? db.from("accounts").select("id, display_name").in("id", ids("account"))
      : Promise.resolve({ data: [] }),
  ]);
  const out = new Map<string, { title: string; subtitle: string | null; href: string | null }>();
  for (const j of (jobs.data ?? []) as { id: string; name: string; job_number: string }[]) {
    out.set(`job:${j.id}`, {
      title: j.name,
      subtitle: j.job_number,
      href: `/jobs/${j.id}?section=messages`,
    });
  }
  for (const l of (leads.data ?? []) as {
    id: string;
    first_name: string;
    last_name: string | null;
    city: string | null;
  }[]) {
    out.set(`lead:${l.id}`, {
      title: [l.first_name, l.last_name].filter(Boolean).join(" "),
      subtitle: `Lead${l.city ? ` · ${l.city}` : ""}`,
      href: `/leads/${l.id}?tab=activity`,
    });
  }
  for (const c of (contacts.data ?? []) as {
    id: string;
    first_name: string;
    last_name: string | null;
  }[]) {
    out.set(`contact:${c.id}`, {
      title: [c.first_name, c.last_name].filter(Boolean).join(" "),
      subtitle: "Contact",
      href: `/contacts/${c.id}`,
    });
  }
  for (const a of (accounts.data ?? []) as { id: string; display_name: string }[]) {
    out.set(`account:${a.id}`, {
      title: a.display_name,
      subtitle: "Customer",
      href: `/accounts/${a.id}`,
    });
  }
  return out;
}

export async function loadThreads(
  db: Db,
  opts: { tab: InboxTab; userId: string; page: number; kind?: "lead" | "job" | null },
): Promise<{ items: ThreadListItem[]; total: number; unread: number }> {
  let q = db
    .from("message_threads")
    .select("*", { count: "exact" })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .range((opts.page - 1) * INBOX_PAGE, opts.page * INBOX_PAGE - 1);
  if (opts.tab === "unread") q = q.eq("unread", true);
  if (opts.kind) q = q.eq("subject_type", opts.kind);
  if (opts.tab === "mine") {
    const mine = await mySubjects(db, opts.userId);
    if (!mine.length) return { items: [], total: 0, unread: 0 };
    q = q.in("subject_id", mine.slice(0, 500));
  }
  const [{ data, count, error }, unread] = await Promise.all([
    q,
    db.from("message_threads").select("id", { count: "exact", head: true }).eq("unread", true),
  ]);
  if (error) throw error;
  const rows = data ?? [];
  const n = await names(db, rows);
  return {
    items: rows.map((t) => {
      const nm = n.get(`${t.subject_type}:${t.subject_id}`);
      return {
        id: t.id,
        subjectType: t.subject_type,
        subjectId: t.subject_id,
        title: nm?.title ?? "A record you can't open",
        subtitle: nm?.subtitle ?? null,
        href: nm?.href ?? null,
        unread: !!t.unread,
        lastAt: t.last_message_at,
        lastInboundAt: t.last_inbound_at,
        lastDirection: t.last_direction,
        lastChannel: t.last_channel,
        preview: t.last_preview,
        messageCount: t.message_count,
      };
    }),
    total: count ?? rows.length,
    unread: unread.count ?? 0,
  };
}

export type ThreadMessage = {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  body: string | null;
  at: string;
  status: string;
  simulated: boolean;
  automatic: boolean;
  marketing: boolean;
  sentBy: string | null;
  callOutcome: string | null;
  templateKey: string | null;
};

export type ThreadDetail = ThreadListItem & {
  readAt: string | null;
  readBy: string | null;
  contact: {
    id: string;
    name: string;
    mobile: string | null;
    email: string | null;
    doNotContact: boolean;
    optedOutAt: string | null;
  } | null;
  messages: ThreadMessage[];
};

export async function loadThread(db: Db, id: string): Promise<ThreadDetail | null> {
  const { data: t } = await db.from("message_threads").select("*").eq("id", id).maybeSingle();
  if (!t) return null;
  const [msgs, n, contact] = await Promise.all([
    db
      .from("messages")
      .select(
        "id, channel, direction, email_subject, body, created_at, status, simulated, workflow_run_id, campaign_id, message_type, sent_by, call_outcome, template_key",
      )
      .eq("thread_id", id)
      .order("created_at", { ascending: true })
      .limit(300),
    names(db, [t]),
    t.contact_id
      ? db
          .from("contacts")
          .select("id, first_name, last_name, mobile, email, do_not_contact, opted_out_at")
          .eq("id", t.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const senderIds = [
    ...new Set(
      (msgs.data ?? [])
        .map((m) => m.sent_by)
        .filter((x): x is string => !!x)
        .concat(t.read_by ? [t.read_by] : []),
    ),
  ];
  const people = senderIds.length
    ? new Map(
        ((await db.from("profiles").select("id, full_name").in("id", senderIds)).data ?? []).map(
          (p) => [p.id, p.full_name],
        ),
      )
    : new Map<string, string>();
  const nm = n.get(`${t.subject_type}:${t.subject_id}`);
  const c = contact.data;
  return {
    id: t.id,
    subjectType: t.subject_type,
    subjectId: t.subject_id,
    title: nm?.title ?? "A record you can't open",
    subtitle: nm?.subtitle ?? null,
    href: nm?.href ?? null,
    unread: !!t.unread,
    lastAt: t.last_message_at,
    lastInboundAt: t.last_inbound_at,
    lastDirection: t.last_direction,
    lastChannel: t.last_channel,
    preview: t.last_preview,
    messageCount: t.message_count,
    readAt: t.read_at,
    readBy: t.read_by ? (people.get(t.read_by) ?? null) : null,
    contact: c
      ? {
          id: c.id,
          name: [c.first_name, c.last_name].filter(Boolean).join(" "),
          mobile: c.mobile,
          email: c.email,
          doNotContact: c.do_not_contact,
          optedOutAt: c.opted_out_at,
        }
      : null,
    messages: (msgs.data ?? []).map((m) => ({
      id: m.id,
      channel: m.channel,
      direction: m.direction,
      subject: m.email_subject,
      body: m.body,
      at: m.created_at,
      status: m.status,
      simulated: m.simulated,
      automatic: !!m.workflow_run_id || !!m.campaign_id,
      marketing: m.message_type === "marketing",
      sentBy: m.sent_by ? (people.get(m.sent_by) ?? null) : null,
      callOutcome: m.call_outcome,
      templateKey: m.template_key,
    })),
  };
}
