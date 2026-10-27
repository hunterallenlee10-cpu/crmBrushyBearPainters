import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { initials } from "@/lib/auth/access";
import { formatDateTime, formatRelative } from "@/lib/format/dates";
import type { AttentionItemView, PersonOption } from "@/components/attention/types";
import { dueCountdown, openedLabel } from "@/components/attention/time";
import {
  PAGE_SIZE,
  URGENCY_CAP,
  attentionFilterOps,
  isCategory,
  isPriority,
  prioritiesFor,
  priorityPageSlices,
  ruleLabel,
  sortByUrgency,
  type AttentionQuery,
  type FilterOp,
} from "./query";
import type { AttentionPriority } from "@/lib/domain/attention/rules";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

/**
 * Loads one page of attention items as the signed-in person (row security
 * decides what they see). Default order: priority, then due time (earliest
 * first, no due time last), then oldest. "Prioritize" ranks by urgency score
 * on the server. Resolved items: most recently resolved first.
 */

const SUBJECT_LABEL = {
  job: "Job",
  lead: "Lead",
  subcontractor: "Subcontractor",
  case: "Case",
} as const;

const COLUMNS =
  "id, rule_key, category, priority, title, detail, subject_type, subject_id, owner_id, due_at, status, snoozed_until, resolution, resolution_note, resolved_at, resolved_by, opened_at";

type Filterable<Q> = { filter(column: string, operator: string, value: unknown): Q };

function apply<Q extends Filterable<Q>>(query: Q, ops: readonly FilterOp[]): Q {
  let q = query;
  for (const op of ops) q = q.filter(op.column, op.op, op.value);
  return q;
}

export type AttentionPage = {
  items: AttentionItemView[];
  total: number;
  /** Urgency sort only ranks the first URGENCY_CAP matches. */
  capped: boolean;
  people: PersonOption[];
  error: boolean;
};

type ItemRow = {
  id: string;
  rule_key: string;
  category: string;
  priority: string;
  title: string;
  detail: string | null;
  subject_type: string;
  subject_id: string;
  owner_id: string | null;
  due_at: string | null;
  status: string;
  snoozed_until: string | null;
  resolution: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  opened_at: string;
};

async function rowsByPriority(
  db: Db,
  q: AttentionQuery,
  ops: FilterOp[],
): Promise<{ rows: ItemRow[]; total: number }> {
  const priorities = prioritiesFor(q.priority);
  const counts = await Promise.all(
    priorities.map(async (p) => {
      const { count, error } = await apply(
        db.from("attention_items").select("id", { count: "exact", head: true }),
        ops,
      ).eq("priority", p);
      if (error) throw error;
      return [p, count ?? 0] as const;
    }),
  );
  const byPriority: Partial<Record<AttentionPriority, number>> = Object.fromEntries(counts);
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  const slices = priorityPageSlices(byPriority, (q.page - 1) * PAGE_SIZE, PAGE_SIZE);
  const parts = await Promise.all(
    slices.map(async (s) => {
      const { data, error } = await apply(db.from("attention_items").select(COLUMNS), ops)
        .eq("priority", s.priority)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("opened_at", { ascending: true })
        .order("id", { ascending: true })
        .range(s.from, s.to);
      if (error) throw error;
      return data ?? [];
    }),
  );
  return { rows: parts.flat(), total };
}

async function rowsByUrgency(
  db: Db,
  q: AttentionQuery,
  ops: FilterOp[],
  now: Date,
): Promise<{ rows: ItemRow[]; total: number; capped: boolean }> {
  let light = apply(
    db
      .from("attention_items")
      .select("id, priority, due_at, opened_at", { count: "exact" })
      .order("id"),
    ops,
  );
  const priorities = prioritiesFor(q.priority);
  if (priorities.length < 4) light = light.in("priority", priorities);
  const { data, count, error } = await light.limit(URGENCY_CAP);
  if (error) throw error;
  const ranked = sortByUrgency(
    (data ?? []).flatMap((r) =>
      isPriority(r.priority)
        ? [{ id: r.id, priority: r.priority, dueAt: r.due_at, openedAt: r.opened_at }]
        : [],
    ),
    now,
  );
  const pageIds = ranked.slice((q.page - 1) * PAGE_SIZE, q.page * PAGE_SIZE).map((r) => r.id);
  if (!pageIds.length) return { rows: [], total: count ?? 0, capped: (count ?? 0) > URGENCY_CAP };
  const { data: full, error: fullError } = await db
    .from("attention_items")
    .select(COLUMNS)
    .in("id", pageIds);
  if (fullError) throw fullError;
  const order = new Map(pageIds.map((id, i) => [id, i]));
  const rows = [...(full ?? [])].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { rows, total: count ?? 0, capped: (count ?? 0) > URGENCY_CAP };
}

async function rowsResolved(
  db: Db,
  q: AttentionQuery,
  ops: FilterOp[],
): Promise<{ rows: ItemRow[]; total: number }> {
  let query = apply(db.from("attention_items").select(COLUMNS, { count: "exact" }), ops);
  const priorities = prioritiesFor(q.priority);
  if (priorities.length < 4) query = query.in("priority", priorities);
  const { data, count, error } = await query
    .order("resolved_at", { ascending: false })
    .order("id", { ascending: true })
    .range((q.page - 1) * PAGE_SIZE, q.page * PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

function personName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ") || "Unnamed lead";
}

export async function loadAttentionPage(
  db: Db,
  q: AttentionQuery,
  viewerId: string,
  now: Date,
): Promise<AttentionPage> {
  const ops = attentionFilterOps(q, viewerId, now);
  const peopleRes = await db.from("profiles").select("id, full_name, is_active").order("full_name");
  const profiles = peopleRes.data ?? [];
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));
  const people = profiles.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.full_name }));

  let rows: ItemRow[] = [];
  let total = 0;
  let capped = false;
  try {
    if (q.status === "resolved") ({ rows, total } = await rowsResolved(db, q, ops));
    else if (q.sort === "urgency") ({ rows, total, capped } = await rowsByUrgency(db, q, ops, now));
    else ({ rows, total } = await rowsByPriority(db, q, ops));
  } catch (e) {
    logError("attention.list", e);
    return { items: [], total: 0, capped: false, people, error: true };
  }

  // Name the related lead or job (only the ones this person can see).
  const leadIds = rows.filter((r) => r.subject_type === "lead").map((r) => r.subject_id);
  const jobIds = rows.filter((r) => r.subject_type === "job").map((r) => r.subject_id);
  const subIds = rows.filter((r) => r.subject_type === "subcontractor").map((r) => r.subject_id);
  const caseIds = rows.filter((r) => r.subject_type === "case").map((r) => r.subject_id);
  const [leadsRes, jobsRes, subsRes, casesRes] = await Promise.all([
    leadIds.length
      ? db.from("leads").select("id, first_name, last_name").in("id", leadIds)
      : Promise.resolve(null),
    jobIds.length
      ? db.from("jobs").select("id, name, job_number").in("id", jobIds)
      : Promise.resolve(null),
    subIds.length
      ? db.from("subcontractors").select("id, company_name").in("id", subIds)
      : Promise.resolve(null),
    caseIds.length
      ? db.from("cases").select("id, case_number, title").in("id", caseIds)
      : Promise.resolve(null),
  ]);
  const caseNames = new Map(
    (casesRes?.data ?? []).map((c) => [c.id, `${c.title} (${c.case_number})`]),
  );
  const subNames = new Map((subsRes?.data ?? []).map((x) => [x.id, x.company_name]));
  const leadNames = new Map(
    (leadsRes?.data ?? []).map((l) => [l.id, personName(l.first_name, l.last_name)]),
  );
  const jobNames = new Map((jobsRes?.data ?? []).map((j) => [j.id, `${j.name} (${j.job_number})`]));

  const items = rows.flatMap((r): AttentionItemView[] => {
    if (!isPriority(r.priority) || !isCategory(r.category)) return [];
    const type =
      r.subject_type === "job"
        ? "job"
        : r.subject_type === "subcontractor"
          ? "subcontractor"
          : r.subject_type === "case"
            ? "case"
            : "lead";
    const status =
      r.status === "in_progress" || r.status === "snoozed" || r.status === "resolved"
        ? r.status
        : "pending";
    const subjectName =
      type === "job"
        ? jobNames.get(r.subject_id)
        : type === "subcontractor"
          ? subNames.get(r.subject_id)
          : type === "case"
            ? caseNames.get(r.subject_id)
            : leadNames.get(r.subject_id);
    const due = dueCountdown(r.due_at, now);
    const ownerName = r.owner_id ? nameById.get(r.owner_id) : undefined;
    return [
      {
        id: r.id,
        title: r.title,
        detail: r.detail,
        category: r.category,
        priority: r.priority,
        ruleLabel: ruleLabel(r.rule_key),
        status,
        subject: {
          type,
          id: r.subject_id,
          href:
            type === "job"
              ? `/jobs/${r.subject_id}`
              : type === "subcontractor"
                ? `/admin/subcontractors?id=${r.subject_id}`
                : type === "case"
                  ? `/cases/${r.subject_id}`
                  : `/leads/${r.subject_id}`,
          label: `${SUBJECT_LABEL[type]}: ${subjectName ?? "open record"}`,
        },
        owner:
          r.owner_id && ownerName
            ? { id: r.owner_id, name: ownerName, initials: initials(ownerName) }
            : null,
        opened: { label: openedLabel(r.opened_at, now), title: formatDateTime(r.opened_at) },
        due: due ? { ...due, title: `Due ${formatDateTime(r.due_at)}` } : null,
        snoozedUntil: r.snoozed_until ? formatDateTime(r.snoozed_until) : null,
        resolution:
          status === "resolved" && r.resolved_at
            ? {
                how: r.resolution === "auto" ? "auto" : "manual",
                note: r.resolution === "auto" ? null : r.resolution_note,
                when: formatRelative(r.resolved_at, now),
                by: r.resolved_by ? (nameById.get(r.resolved_by) ?? null) : null,
              }
            : null,
      },
    ];
  });

  return { items, total, capped, people, error: false };
}
