import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { pacificToday } from "@/lib/domain/scheduling/dates";
import { effectiveSlot } from "@/lib/domain/scheduling/publish";
import {
  crewCovers,
  missingSkills,
  requiredSkills,
  type CrewSkill,
} from "@/lib/domain/scheduling/skills";
import { resolveWorkRules } from "@/lib/domain/scheduling/rules";
import { toEntryState, type EntryRow } from "./context";

type Db = SupabaseClient<Database>;

/**
 * Does the job's crew have what the job needs (SPEC §6.4 "Crew assigned with
 * required skills", §13.3 "certified renovator assigned")? The job's crews are
 * its assigned crew plus any crew on its live schedule entries; their skills
 * are pooled. Certificates must still be valid on the last scheduled day (or
 * today when nothing is scheduled). Service client, after a visibility check.
 */
export type CrewCoverage = {
  crewIds: string[];
  /** null when no crew is assigned. */
  coversSkills: boolean | null;
  missing: string[];
  certifiedRenovator: boolean | null;
};

export async function loadCrewCoverage(
  service: Db,
  jobId: string,
  now = new Date(),
): Promise<CrewCoverage> {
  const { data: job } = await service
    .from("jobs")
    .select(
      "org_id, crew_id, work_types, property:properties!jobs_property_id_fkey(stories, lead_safe_required)",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { crewIds: [], coversSkills: null, missing: [], certifiedRenovator: null };
  const [entries, rules, workTypes, wos, skillLabels] = await Promise.all([
    service
      .from("schedule_entries")
      .select(
        "id, job_id, work_order_id, work_type, status, crew_id, starts_on, ends_on, published_at, draft_action, draft_crew_id, draft_starts_on, draft_ends_on, draft_reason, draft_note, allow_split, override_rules, override_reason",
      )
      .eq("job_id", jobId)
      .neq("status", "canceled"),
    service
      .from("work_rules")
      .select("key, label, enabled, severity, owner_override, requires_weather, params")
      .eq("org_id", job.org_id),
    service.from("work_types").select("key, required_skill_key").eq("org_id", job.org_id),
    service
      .from("work_orders")
      .select("phase")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .neq("status", "canceled"),
    service.from("skills").select("key, label").eq("org_id", job.org_id),
  ]);
  const rows = (entries.data ?? []) as EntryRow[];
  const slots = rows.map((r) => effectiveSlot(toEntryState(r))).filter((s) => s !== null);
  const crewIds = [
    ...new Set([job.crew_id, ...slots.map((s) => s.crewId)].filter((x): x is string => !!x)),
  ];
  if (!crewIds.length)
    return { crewIds, coversSkills: null, missing: [], certifiedRenovator: null };
  const { data: skills } = await service
    .from("crew_skills")
    .select("expires_on, skill:skills(key)")
    .in("crew_id", crewIds);
  const pooled: CrewSkill[] = (skills ?? []).map((s) => ({
    key: s.skill?.key ?? "",
    expiresOn: s.expires_on,
  }));
  const lastDay =
    slots
      .map((s) => s.endsOn)
      .sort()
      .pop() ?? pacificToday(now);
  const ruleSet = resolveWorkRules(rules.data ?? []);
  const needs = requiredSkills(
    {
      workTypes: job.work_types,
      stories: job.property?.stories ?? null,
      leadSafe: job.property?.lead_safe_required === true,
      entryWorkTypes: rows.length ? rows.map((r) => r.work_type) : undefined,
      workOrderPhases: (wos.data ?? []).map((w) => w.phase),
    },
    ruleSet,
    Object.fromEntries((workTypes.data ?? []).map((w) => [w.key, w.required_skill_key])),
  );
  const labels = new Map((skillLabels.data ?? []).map((s) => [s.key, s.label]));
  const rrp = needs.filter((n) => n.skill === "rrp_certified");
  return {
    crewIds,
    coversSkills: crewCovers(needs, pooled, lastDay),
    missing: missingSkills(needs, pooled, lastDay).map(
      (m) => labels.get(m.need.skill) ?? m.need.skill,
    ),
    certifiedRenovator: crewCovers(
      rrp.length
        ? rrp
        : [{ skill: "rrp_certified", reason: "Lead-safe work", rule: "lead_safe_renovator" }],
      pooled,
      lastDay,
    ),
  };
}
