import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";
import type { Database } from "@/lib/db/types";
import { addDays, pacificToday } from "@/lib/domain/scheduling/dates";
import {
  FOLLOW_UP_LISTS,
  isResting,
  type Attempt,
  type FollowUpListDef,
  type FollowUpListKey,
} from "@/lib/domain/follow-ups";
import { PACIFIC } from "@/lib/domain/workflows/compliance";

type Db = SupabaseClient<Database>;

/**
 * Follow-up list membership (SPEC §11.4). Each list is a rule over leads,
 * jobs or customers, read with the person's own client (row security decides
 * which records they see). A record that was dispositioned on a list rests
 * there for the list's cooldown, unless a callback brings it back sooner.
 * Do Not Contact records never show. Capped at MEMBER_CAP rows per list.
 */

export const MEMBER_CAP = 300;

export type SubjectType = "lead" | "job" | "account";

export type QueueItem = {
  /** `${subjectType}:${subjectId}` */
  key: string;
  subjectType: SubjectType;
  subjectId: string;
  name: string;
  reason: string;
  href: string;
  phone: string | null;
  email: string | null;
  /** For messages: the lead or job the conversation lives on. */
  messageSubject: { type: "lead" | "job"; id: string } | null;
  lastAttempt: { at: string; disposition: string; notes: string | null } | null;
  callbackAt: string | null;
  sortKey: number;
};

type Candidate = Omit<QueueItem, "key" | "lastAttempt" | "callbackAt">;

const OPEN_LEAD = ["new", "contacted", "walkthrough_scheduled", "nurture"];
const name = (first: string | null, last: string | null) =>
  [first, last].filter(Boolean).join(" ") || "No name";
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 24 * 3_600_000;

function pacificMidnight(day: string): Date {
  return fromZonedTime(`${day}T00:00:00`, PACIFIC);
}

type LeadRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  score: number | null;
  status: string;
  disposition: string | null;
  created_at: string;
  last_activity_at: string;
};
const LEAD_COLS =
  "id, first_name, last_name, mobile, phone, email, city, score, status, disposition, created_at, last_activity_at";

function leadCandidate(l: LeadRow, reason: string, sortKey: number): Candidate | null {
  if (l.disposition === "do_not_contact") return null;
  return {
    subjectType: "lead",
    subjectId: l.id,
    name: name(l.first_name, l.last_name),
    reason,
    href: `/leads/${l.id}`,
    phone: l.mobile ?? l.phone,
    email: l.email,
    messageSubject: { type: "lead", id: l.id },
    sortKey,
  };
}

type JobRow = {
  id: string;
  name: string;
  job_number: string;
  stage: string;
  account_id: string | null;
  primary_contact: {
    first_name: string;
    last_name: string | null;
    mobile: string | null;
    phone: string | null;
    email: string | null;
    do_not_contact: boolean;
  } | null;
};
const JOB_COLS =
  "id, name, job_number, stage, account_id, primary_contact:contacts!jobs_primary_contact_id_fkey(first_name, last_name, mobile, phone, email, do_not_contact)";

function jobCandidate(j: JobRow, reason: string, sortKey: number): Candidate | null {
  if (j.primary_contact?.do_not_contact) return null;
  const c = j.primary_contact;
  return {
    subjectType: "job",
    subjectId: j.id,
    name: c ? `${name(c.first_name, c.last_name)} · ${j.name}` : j.name,
    reason,
    href: `/jobs/${j.id}`,
    phone: c ? (c.mobile ?? c.phone) : null,
    email: c?.email ?? null,
    messageSubject: { type: "job", id: j.id },
    sortKey,
  };
}

async function candidates(db: Db, def: FollowUpListDef, now: Date): Promise<Candidate[]> {
  const today = pacificToday(now);
  switch (def.key) {
    case "hot_new_leads": {
      const { data } = await db
        .from("leads")
        .select(LEAD_COLS)
        .in("status", ["new", "contacted"])
        .is("deleted_at", null)
        .is("walkthrough_at", null)
        .gte("created_at", iso(now.getTime() - DAY))
        .order("score", { ascending: false, nullsFirst: false })
        .limit(MEMBER_CAP);
      return (data ?? []).flatMap(
        (l) =>
          leadCandidate(
            l,
            `${l.status === "new" ? "New" : "Contacted"} · score ${l.score ?? "—"}`,
            -(l.score ?? 0),
          ) ?? [],
      );
    }
    case "confirm_walkthroughs": {
      const start = pacificMidnight(addDays(today, 1));
      const end = pacificMidnight(addDays(today, 2));
      const { data } = await db
        .from("appointments")
        .select("id, starts_at, lead_id, job_id")
        .eq("type", "walkthrough")
        .eq("status", "scheduled")
        .is("deleted_at", null)
        .gte("starts_at", start.toISOString())
        .lt("starts_at", end.toISOString())
        .order("starts_at")
        .limit(MEMBER_CAP);
      const rows = data ?? [];
      const leadIds = rows.flatMap((a) => (a.lead_id && !a.job_id ? [a.lead_id] : []));
      const jobIds = rows.flatMap((a) => (a.job_id ? [a.job_id] : []));
      const [leads, jobs] = await Promise.all([
        leadIds.length
          ? db.from("leads").select(LEAD_COLS).in("id", leadIds)
          : Promise.resolve({ data: [] }),
        jobIds.length
          ? db.from("jobs").select(JOB_COLS).in("id", jobIds)
          : Promise.resolve({ data: [] }),
      ]);
      const lById = new Map((leads.data ?? []).map((l) => [l.id, l as LeadRow]));
      const jById = new Map(((jobs.data ?? []) as JobRow[]).map((j) => [j.id, j]));
      const time = (s: string) =>
        new Date(s).toLocaleTimeString("en-US", {
          timeZone: PACIFIC,
          hour: "numeric",
          minute: "2-digit",
        });
      return rows.flatMap((a) => {
        const reason = `Walkthrough tomorrow at ${time(a.starts_at)}`;
        const sk = new Date(a.starts_at).getTime();
        if (a.job_id) {
          const j = jById.get(a.job_id);
          return j ? (jobCandidate(j, reason, sk) ?? []) : [];
        }
        const l = a.lead_id ? lById.get(a.lead_id) : undefined;
        return l ? (leadCandidate(l, reason, sk) ?? []) : [];
      });
    }
    case "estimates_awaiting_reply": {
      const { data } = await db
        .from("estimates")
        .select("id, job_id, estimate_number, sent_at, viewed_at, status")
        .in("status", ["sent", "viewed"])
        .is("deleted_at", null)
        .is("accepted_at", null)
        .is("declined_at", null)
        .lte("sent_at", iso(now.getTime() - 3 * DAY))
        .order("sent_at")
        .limit(MEMBER_CAP);
      const rows = data ?? [];
      const ids = [...new Set(rows.map((e) => e.job_id))];
      const { data: jobs } = ids.length
        ? await db.from("jobs").select(JOB_COLS).in("id", ids).is("deleted_at", null)
        : { data: [] };
      const jById = new Map(((jobs ?? []) as JobRow[]).map((j) => [j.id, j]));
      const seen = new Set<string>();
      return rows.flatMap((e) => {
        const j = jById.get(e.job_id);
        if (!j || seen.has(j.id) || j.stage !== "estimate_sent") return [];
        seen.add(j.id);
        const days = Math.floor((now.getTime() - new Date(e.sent_at ?? now).getTime()) / DAY);
        return (
          jobCandidate(
            j,
            `${e.estimate_number} sent ${days} days ago${e.viewed_at ? " · viewed" : " · not opened"}`,
            new Date(e.sent_at ?? now).getTime(),
          ) ?? []
        );
      });
    }
    case "callbacks": {
      const endOfToday = pacificMidnight(addDays(today, 1));
      const { data } = await db
        .from("follow_up_attempts")
        .select("subject_type, subject_id, callback_at, created_at")
        .not("callback_at", "is", null)
        .lt("callback_at", endOfToday.toISOString())
        .gte("created_at", iso(now.getTime() - 120 * DAY))
        .order("created_at", { ascending: false })
        .limit(MEMBER_CAP);
      const due = new Map<string, { type: string; id: string; at: string }>();
      for (const a of data ?? []) {
        const k = `${a.subject_type}:${a.subject_id}`;
        if (!due.has(k) && a.callback_at)
          due.set(k, { type: a.subject_type, id: a.subject_id, at: a.callback_at });
      }
      // Only when that callback is still the latest word on the record.
      const all = [...due.values()];
      const latest = await latestAttempts(
        db,
        all.map((d) => ({ subjectType: d.type as SubjectType, subjectId: d.id })),
      );
      const current = all.filter((d) => latest.get(`${d.type}:${d.id}`)?.callbackAt === d.at);
      const leadIds = current.filter((d) => d.type === "lead").map((d) => d.id);
      const jobIds = current.filter((d) => d.type === "job").map((d) => d.id);
      const [leads, jobs] = await Promise.all([
        leadIds.length
          ? db.from("leads").select(LEAD_COLS).in("id", leadIds)
          : Promise.resolve({ data: [] }),
        jobIds.length
          ? db.from("jobs").select(JOB_COLS).in("id", jobIds)
          : Promise.resolve({ data: [] }),
      ]);
      const lById = new Map((leads.data ?? []).map((l) => [l.id, l as LeadRow]));
      const jById = new Map(((jobs.data ?? []) as JobRow[]).map((j) => [j.id, j]));
      const when = (s: string) =>
        new Date(s).toLocaleString("en-US", {
          timeZone: PACIFIC,
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      return current.flatMap((d) => {
        const sk = new Date(d.at).getTime();
        const reason = `${sk < now.getTime() ? "Overdue callback" : "Callback"} · ${when(d.at)}`;
        if (d.type === "lead") {
          const l = lById.get(d.id);
          return l ? (leadCandidate(l, reason, sk) ?? []) : [];
        }
        const j = jById.get(d.id);
        return j ? (jobCandidate(j, reason, sk) ?? []) : [];
      });
    }
    case "just_planning": {
      const { data } = await db
        .from("leads")
        .select(LEAD_COLS)
        .in("status", OPEN_LEAD)
        .is("deleted_at", null)
        .or("timeline.eq.just_planning,status.eq.nurture")
        .order("last_activity_at")
        .limit(MEMBER_CAP);
      return (data ?? []).flatMap(
        (l) =>
          leadCandidate(
            l,
            l.status === "nurture" ? "In Nurture" : "Just planning",
            new Date(l.last_activity_at).getTime(),
          ) ?? [],
      );
    }
    case "pre_season_exterior": {
      const [leads, jobs] = await Promise.all([
        db
          .from("leads")
          .select(LEAD_COLS)
          .in("status", OPEN_LEAD)
          .is("deleted_at", null)
          .overlaps("services", ["exterior", "deck_fence"])
          .order("score", { ascending: false, nullsFirst: false })
          .limit(MEMBER_CAP),
        db
          .from("jobs")
          .select(JOB_COLS)
          .in("stage", ["walkthrough_complete", "estimate_sent"])
          .is("deleted_at", null)
          .overlaps("work_types", ["exterior", "deck_fence"])
          .order("updated_at")
          .limit(MEMBER_CAP),
      ]);
      return [
        ...((jobs.data ?? []) as JobRow[]).flatMap(
          (j) => jobCandidate(j, "Unsold exterior estimate", 0) ?? [],
        ),
        ...(leads.data ?? []).flatMap(
          (l) => leadCandidate(l, "Exterior lead", 1_000_000 - (l.score ?? 0)) ?? [],
        ),
      ];
    }
    case "lost_reengage": {
      const from = iso(now.getTime() - 365 * DAY);
      const to = iso(now.getTime() - 90 * DAY);
      const [leads, jobs] = await Promise.all([
        db
          .from("leads")
          .select(LEAD_COLS)
          .eq("status", "lost")
          .is("deleted_at", null)
          .gte("last_activity_at", from)
          .lte("last_activity_at", to)
          .order("last_activity_at", { ascending: false })
          .limit(MEMBER_CAP),
        db
          .from("jobs")
          .select(JOB_COLS)
          .eq("stage", "closed_lost")
          .is("deleted_at", null)
          .gte("lost_at", from)
          .lte("lost_at", to)
          .order("lost_at", { ascending: false })
          .limit(MEMBER_CAP),
      ]);
      return [
        ...(leads.data ?? []).flatMap((l) => leadCandidate(l, "Lead lost 90+ days ago", 0) ?? []),
        ...((jobs.data ?? []) as JobRow[]).flatMap(
          (j) => jobCandidate(j, "Job lost 90+ days ago", 1) ?? [],
        ),
      ];
    }
    case "past_customers": {
      const { data } = await db
        .from("jobs")
        .select("id, name, account_id, paid_in_full_at")
        .not("paid_in_full_at", "is", null)
        .lte("paid_in_full_at", iso(now.getTime() - 330 * DAY))
        .is("deleted_at", null)
        .order("paid_in_full_at", { ascending: false })
        .limit(MEMBER_CAP);
      const latestJob = new Map<string, { id: string; name: string; paid: string }>();
      for (const j of data ?? []) {
        if (j.account_id && !latestJob.has(j.account_id) && j.paid_in_full_at) {
          latestJob.set(j.account_id, { id: j.id, name: j.name, paid: j.paid_in_full_at });
        }
      }
      const ids = [...latestJob.keys()];
      if (!ids.length) return [];
      // Customers with a newer paid job, or one in progress, aren't due a check-in.
      const [{ data: accounts }, { data: recent }] = await Promise.all([
        db
          .from("accounts")
          .select(
            "id, display_name, primary_contact:contacts!accounts_primary_contact_fk(mobile, phone, email, do_not_contact)",
          )
          .in("id", ids)
          .is("deleted_at", null),
        db
          .from("jobs")
          .select("account_id")
          .in("account_id", ids)
          .is("deleted_at", null)
          .or(
            `paid_in_full_at.gt.${iso(now.getTime() - 330 * DAY)},and(paid_in_full_at.is.null,stage.not.in.(closed_lost,closed_won))`,
          ),
      ]);
      const busy = new Set((recent ?? []).map((r) => r.account_id));
      return (accounts ?? []).flatMap((a) => {
        const c = a.primary_contact;
        if (busy.has(a.id) || c?.do_not_contact) return [];
        const j = latestJob.get(a.id);
        if (!j) return [];
        return [
          {
            subjectType: "account" as const,
            subjectId: a.id,
            name: a.display_name,
            reason: `Paid in full ${new Date(j.paid).toLocaleDateString("en-US", { timeZone: PACIFIC, month: "short", year: "numeric" })} · ${j.name}`,
            href: `/accounts/${a.id}`,
            phone: c ? (c.mobile ?? c.phone) : null,
            email: c?.email ?? null,
            messageSubject: { type: "job" as const, id: j.id },
            sortKey: new Date(j.paid).getTime(),
          },
        ];
      });
    }
  }
}

type Latest = { at: string; disposition: string; notes: string | null; callbackAt: string | null };

async function latestAttempts(
  db: Db,
  subjects: readonly { subjectType: SubjectType; subjectId: string }[],
): Promise<Map<string, Latest>> {
  const out = new Map<string, Latest>();
  if (!subjects.length) return out;
  const ids = [...new Set(subjects.map((s) => s.subjectId))].slice(0, MEMBER_CAP * 2);
  const { data } = await db
    .from("follow_up_attempts")
    .select("subject_type, subject_id, disposition_key, notes, callback_at, created_at")
    .in("subject_id", ids)
    .order("created_at", { ascending: false })
    .limit(2000);
  for (const a of data ?? []) {
    const k = `${a.subject_type}:${a.subject_id}`;
    if (!out.has(k)) {
      out.set(k, {
        at: a.created_at,
        disposition: a.disposition_key,
        notes: a.notes,
        callbackAt: a.callback_at,
      });
    }
  }
  return out;
}

async function attemptsByList(
  db: Db,
  listKey: string,
  ids: readonly string[],
): Promise<Map<string, Attempt[]>> {
  const out = new Map<string, Attempt[]>();
  if (!ids.length) return out;
  const { data } = await db
    .from("follow_up_attempts")
    .select("subject_type, subject_id, list_key, created_at, callback_at")
    .eq("list_key", listKey)
    .in("subject_id", [...new Set(ids)].slice(0, MEMBER_CAP * 2))
    .order("created_at", { ascending: false })
    .limit(2000);
  for (const a of data ?? []) {
    const k = `${a.subject_type}:${a.subject_id}`;
    out.set(k, [
      ...(out.get(k) ?? []),
      { listKey: a.list_key, createdAt: a.created_at, callbackAt: a.callback_at },
    ]);
  }
  return out;
}

export type ListRow = {
  key: FollowUpListKey;
  name: string;
  description: string;
  script: string;
  cooldownHours: number;
  active: boolean;
};

/** The org's list settings (name, script, cooldown, on/off) over the built-in rules. */
export async function loadListSettings(db: Db): Promise<ListRow[]> {
  const { data } = await db
    .from("follow_up_lists")
    .select("key, name, description, script, cooldown_hours, active, sort_order")
    .order("sort_order");
  const byKey = new Map((data ?? []).map((r) => [r.key, r]));
  return FOLLOW_UP_LISTS.map((d) => {
    const r = byKey.get(d.key);
    return {
      key: d.key,
      name: r?.name ?? d.name,
      description: r?.description ?? d.description,
      script: r?.script ?? d.script,
      cooldownHours: r?.cooldown_hours ?? d.cooldownHours,
      active: r?.active ?? true,
    };
  });
}

/** The queue for one list: members not resting, in call order. */
export async function loadQueue(
  db: Db,
  list: ListRow,
  now: Date = new Date(),
): Promise<QueueItem[]> {
  const def = FOLLOW_UP_LISTS.find((d) => d.key === list.key);
  if (!def) return [];
  const found = await candidates(db, def, now);
  const unique = new Map<string, Candidate>();
  for (const c of found) {
    const k = `${c.subjectType}:${c.subjectId}`;
    if (!unique.has(k)) unique.set(k, c);
  }
  const ids = [...unique.values()].map((c) => c.subjectId);
  const [byList, latest] = await Promise.all([
    list.key === "callbacks"
      ? Promise.resolve(new Map<string, Attempt[]>())
      : attemptsByList(db, list.key, ids),
    latestAttempts(
      db,
      [...unique.values()].map((c) => ({ subjectType: c.subjectType, subjectId: c.subjectId })),
    ),
  ]);
  return [...unique.entries()]
    .filter(
      ([k]) =>
        list.key === "callbacks" ||
        !isResting(list.key, list.cooldownHours, byList.get(k) ?? [], now),
    )
    .map(([k, c]) => {
      const l = latest.get(k);
      return {
        ...c,
        key: k,
        lastAttempt: l ? { at: l.at, disposition: l.disposition, notes: l.notes } : null,
        callbackAt: l?.callbackAt ?? null,
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey);
}

/** Counts for every active list (the Follow-up Lists page). */
export async function loadListCounts(db: Db, now: Date = new Date()) {
  const lists = await loadListSettings(db);
  const counts = await Promise.all(
    lists.map(async (l) => (l.active ? (await loadQueue(db, l, now)).length : 0)),
  );
  return lists.map((l, i) => ({
    ...l,
    count: counts[i] ?? 0,
    capped: (counts[i] ?? 0) >= MEMBER_CAP,
  }));
}
