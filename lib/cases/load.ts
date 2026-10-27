import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { isOpenCase } from "@/lib/domain/cases";

type Db = SupabaseClient<Database>;

/**
 * Case loaders (SPEC §8.16 Warranty & service). Read with the person's own
 * client, so row security decides which cases they see.
 */

export const CASE_PAGE = 50;

export const CASE_FILTERS = [
  { id: "open", label: "Open" },
  { id: "overdue", label: "Past SLA" },
  { id: "warranty", label: "Warranty" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
] as const;
export type CaseFilter = (typeof CASE_FILTERS)[number]["id"];

export type CaseListItem = {
  id: string;
  number: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  source: string;
  slaDueAt: string;
  overdue: boolean;
  createdAt: string;
  resolvedAt: string | null;
  job: { id: string; name: string; number: string } | null;
  account: { id: string; name: string } | null;
  ownerName: string | null;
};

const SELECT =
  "id, case_number, title, type, status, priority, source, sla_due_at, created_at, resolved_at, owner_id, job:jobs(id, name, job_number), account:accounts(id, display_name)";

type Row = {
  id: string;
  case_number: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  source: string;
  sla_due_at: string;
  created_at: string;
  resolved_at: string | null;
  owner_id: string | null;
  job: { id: string; name: string; job_number: string } | null;
  account: { id: string; display_name: string } | null;
};

async function ownerNames(db: Db, rows: readonly { owner_id: string | null }[]) {
  const ids = [...new Set(rows.map((r) => r.owner_id).filter((x): x is string => !!x))];
  if (!ids.length) return new Map<string, string>();
  const { data } = await db.from("profiles").select("id, full_name").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, p.full_name]));
}

function toItem(r: Row, names: Map<string, string>, now: Date): CaseListItem {
  return {
    id: r.id,
    number: r.case_number,
    title: r.title,
    type: r.type,
    status: r.status,
    priority: r.priority,
    source: r.source,
    slaDueAt: r.sla_due_at,
    overdue: isOpenCase(r.status) && new Date(r.sla_due_at).getTime() <= now.getTime(),
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    job: r.job ? { id: r.job.id, name: r.job.name, number: r.job.job_number } : null,
    account: r.account ? { id: r.account.id, name: r.account.display_name } : null,
    ownerName: r.owner_id ? (names.get(r.owner_id) ?? null) : null,
  };
}

const OPEN = ["new", "in_progress", "scheduled", "waiting_on_customer"];

export async function loadCases(
  db: Db,
  opts: { filter: CaseFilter; page: number; jobId?: string | null; now?: Date },
): Promise<{ items: CaseListItem[]; total: number }> {
  const now = opts.now ?? new Date();
  let q = db
    .from("cases")
    .select(SELECT, { count: "exact" })
    .order("sla_due_at", { ascending: opts.filter !== "resolved" })
    .order("id")
    .range((opts.page - 1) * CASE_PAGE, opts.page * CASE_PAGE - 1);
  if (opts.jobId) q = q.eq("job_id", opts.jobId);
  switch (opts.filter) {
    case "open":
      q = q.in("status", OPEN);
      break;
    case "overdue":
      q = q.in("status", OPEN).lte("sla_due_at", now.toISOString());
      break;
    case "warranty":
      q = q.in("status", OPEN).in("type", ["warranty", "touch_up"]);
      break;
    case "resolved":
      q = q.in("status", ["resolved", "closed"]);
      break;
    case "all":
      break;
  }
  const { data, count, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  const names = await ownerNames(db, rows);
  return { items: rows.map((r) => toItem(r, names, now)), total: count ?? rows.length };
}

export type CaseDetail = CaseListItem & {
  description: string | null;
  resolution: string | null;
  firstResponseAt: string | null;
  closedAt: string | null;
  ownerId: string | null;
  contact: { id: string; name: string; mobile: string | null; email: string | null } | null;
  visits: {
    id: string;
    startsAt: string;
    endsAt: string;
    status: string;
    location: string | null;
    who: string[];
  }[];
};

export async function loadCase(db: Db, id: string, now = new Date()): Promise<CaseDetail | null> {
  const { data: r, error } = await db
    .from("cases")
    .select(
      `${SELECT}, description, resolution, first_response_at, closed_at, contact:contacts(id, first_name, last_name, mobile, email)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!r) return null;
  const { data: appts } = await db
    .from("appointments")
    .select("id, starts_at, ends_at, status, location, assigned_user_ids")
    .eq("case_id", id)
    .is("deleted_at", null)
    .order("starts_at", { ascending: false })
    .limit(20);
  const people = [...new Set((appts ?? []).flatMap((a) => a.assigned_user_ids ?? []))];
  const names = await ownerNames(db, [
    { owner_id: r.owner_id },
    ...people.map((p) => ({ owner_id: p })),
  ]);
  return {
    ...toItem(r, names, now),
    description: r.description,
    resolution: r.resolution,
    firstResponseAt: r.first_response_at,
    closedAt: r.closed_at,
    ownerId: r.owner_id,
    contact: r.contact
      ? {
          id: r.contact.id,
          name: [r.contact.first_name, r.contact.last_name].filter(Boolean).join(" "),
          mobile: r.contact.mobile,
          email: r.contact.email,
        }
      : null,
    visits: (appts ?? []).map((a) => ({
      id: a.id,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      status: a.status,
      location: a.location,
      who: (a.assigned_user_ids ?? []).map((u) => names.get(u) ?? "Someone"),
    })),
  };
}

/** Open-case counts for a job (Onboarding tile, job header). */
export async function openCaseCount(db: Db, jobId: string): Promise<number> {
  const { count } = await db
    .from("cases")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .in("status", OPEN);
  return count ?? 0;
}
