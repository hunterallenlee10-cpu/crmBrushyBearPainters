import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { pacificToday } from "@/lib/domain/scheduling/dates";
import { ResourcesClient, type CrewCard } from "./resources-client";

export const metadata: Metadata = { title: "Resources" };

/** Resources (SPEC §8.6): crews, members, skills, capacity, time off and blackout dates. */
export default async function ResourcesPage() {
  const viewer = await requirePermission("schedule:read");
  const supabase = await createSupabaseServerClient();
  const today = pacificToday(new Date());
  const [crews, members, skills, crewSkills, timeOff, people, territories, subs] =
    await Promise.all([
      supabase
        .from("crews")
        .select("*")
        .order("active", { ascending: false })
        .order("sort_order")
        .order("name"),
      supabase
        .from("crew_members")
        .select("id, crew_id, user_id, display_name, role, active, profile:profiles(full_name)")
        .eq("active", true),
      supabase
        .from("skills")
        .select("id, key, label, is_certification, active")
        .eq("active", true)
        .order("sort_order"),
      supabase.from("crew_skills").select("crew_id, skill_id, expires_on"),
      supabase
        .from("crew_availability")
        .select("id, crew_id, user_id, kind, starts_on, ends_on, reason")
        .gte("ends_on", today)
        .order("starts_on"),
      viewer.can("users:read") || viewer.can("crews:manage")
        ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name")
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      supabase.from("territories").select("id, name").eq("active", true).order("sort_order"),
      supabase.from("subcontractors").select("id, company_name, status").order("company_name"),
    ]);
  const personName = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const cards: CrewCard[] = (crews.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    crewType: c.crew_type === "subcontractor" ? "subcontractor" : "employee",
    subcontractorId: c.subcontractor_id,
    leadUserId: c.lead_user_id,
    color: c.color,
    homeTerritoryId: c.home_territory_id,
    maxJobsPerDay: c.max_jobs_per_day,
    dailyCapacityHours: Number(c.daily_capacity_hours),
    active: c.active,
    members: (members.data ?? [])
      .filter((m) => m.crew_id === c.id)
      .map((m) => ({
        id: m.id,
        name: m.profile?.full_name ?? m.display_name ?? "Teammate",
        role: m.role,
        userId: m.user_id,
      })),
    skills: (crewSkills.data ?? [])
      .filter((s) => s.crew_id === c.id)
      .map((s) => ({ skillId: s.skill_id, expiresOn: s.expires_on })),
    timeOff: (timeOff.data ?? [])
      .filter(
        (t) =>
          t.crew_id === c.id ||
          (t.user_id &&
            (members.data ?? []).some((m) => m.crew_id === c.id && m.user_id === t.user_id)),
      )
      .map((t) => ({
        id: t.id,
        startsOn: t.starts_on,
        endsOn: t.ends_on,
        reason: t.reason,
        who: t.user_id ? (personName.get(t.user_id) ?? "A member") : null,
      })),
  }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Resources"
        description="Crews, who's on them, their skills and daily capacity, time off and company blackout dates."
      />
      <ResourcesClient
        crews={cards}
        skills={(skills.data ?? []).map((s) => ({
          id: s.id,
          label: s.label,
          isCertification: s.is_certification,
        }))}
        people={people.data ?? []}
        territories={territories.data ?? []}
        subcontractors={(subs.data ?? []).map((s) => ({
          id: s.id,
          name: s.company_name,
          status: s.status,
        }))}
        blackouts={(timeOff.data ?? [])
          .filter((t) => t.kind === "blackout")
          .map((t) => ({ id: t.id, startsOn: t.starts_on, endsOn: t.ends_on, reason: t.reason }))}
        can={{
          manage: viewer.can("crews:manage") && !viewer.impersonating,
          timeOff:
            (viewer.can("crews:manage") || viewer.can("schedule:manage")) && !viewer.impersonating,
        }}
      />
    </div>
  );
}
