import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { LOCKED_RULES, isWorkRuleKey } from "@/lib/domain/scheduling/rules";
import {
  ChecklistTemplates,
  PoliciesForm,
  SkillsEditor,
  WorkRulesEditor,
  WorkTypesEditor,
  type ChecklistTemplateView,
  type SkillRow,
  type WorkRuleRow,
  type WorkTypeRow,
} from "./schedule-admin-client";

export const metadata: Metadata = { title: "Schedule Admin" };

const SECTIONS = [
  { id: "policies", label: "Hours & policies" },
  { id: "work-types", label: "Work types" },
  { id: "work-rules", label: "Work rules" },
  { id: "skills", label: "Skills" },
  { id: "checklists", label: "Checklists" },
] as const;

/** Admin → Schedule Admin (SPEC §8.19, §15.1). */
export default async function ScheduleAdminPage() {
  const viewer = await requirePermission("settings:manage");
  const supabase = await createSupabaseServerClient();
  const [settings, types, rules, skills, templates, territories] = await Promise.all([
    supabase.from("schedule_settings").select("*").eq("org_id", viewer.orgId).maybeSingle(),
    supabase.from("work_types").select("*").order("sort_order"),
    supabase.from("work_rules").select("*").order("sort_order"),
    supabase.from("skills").select("*").order("sort_order").order("label"),
    supabase
      .from("checklist_templates")
      .select("id, key, name, applies_to, items, active")
      .order("sort_order"),
    supabase.from("territories").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const s = settings.data;
  const skillRows: SkillRow[] = (skills.data ?? []).map((k) => ({
    id: k.id,
    key: k.key,
    label: k.label,
    description: k.description,
    isCertification: k.is_certification,
    active: k.active,
  }));
  const typeRows: WorkTypeRow[] = (types.data ?? []).map((t) => ({
    key: t.key,
    label: t.label,
    defaultMinutes: t.default_minutes,
    assignedRole:
      t.assigned_role === "estimator" || t.assigned_role === "pm" ? t.assigned_role : "crew",
    requiredSkillKey: t.required_skill_key,
    isProduction: t.is_production,
    active: t.active,
  }));
  const ruleRows: WorkRuleRow[] = (rules.data ?? []).flatMap((r) =>
    isWorkRuleKey(r.key)
      ? [
          {
            key: r.key,
            label: r.label,
            description: r.description,
            enabled: r.enabled,
            severity: r.severity === "warn" ? "warn" : "block",
            ownerOverride: r.owner_override,
            requiresWeather: r.requires_weather,
            locked: LOCKED_RULES.has(r.key),
            params:
              r.params && typeof r.params === "object" && !Array.isArray(r.params)
                ? Object.fromEntries(
                    Object.entries(r.params as Record<string, unknown>).filter(
                      (e): e is [string, number | string] =>
                        typeof e[1] === "number" || typeof e[1] === "string",
                    ),
                  )
                : {},
          },
        ]
      : [],
  );
  const checklistRows: ChecklistTemplateView[] = (templates.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    appliesTo: t.applies_to,
    active: t.active,
    items: Array.isArray(t.items)
      ? t.items.flatMap((i) =>
          i && typeof i === "object" && !Array.isArray(i) && typeof i.label === "string"
            ? [i.label]
            : [],
        )
      : [],
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Schedule Admin"
        description="Production days, work types, the rules the Master Schedule enforces, crew skills and checklists."
      />
      <nav aria-label="Schedule Admin sections" className="flex flex-wrap gap-2">
        {SECTIONS.map((x) => (
          <a
            key={x.id}
            href={`#${x.id}`}
            className="rounded-full border bg-card px-3 py-1 text-sm hover:border-bb-forest/40"
          >
            {x.label}
          </a>
        ))}
        <Link
          href="/admin/territories"
          className="rounded-full border bg-card px-3 py-1 text-sm hover:border-bb-forest/40"
        >
          Territories ({territories.count ?? 0})
        </Link>
        <Link
          href="/schedule/resources"
          className="rounded-full border bg-card px-3 py-1 text-sm hover:border-bb-forest/40"
        >
          Crews & resources
        </Link>
        <Link
          href="/admin/subcontractors"
          className="rounded-full border bg-card px-3 py-1 text-sm hover:border-bb-forest/40"
        >
          Subcontractors
        </Link>
      </nav>
      <PoliciesForm
        initial={{
          productionDays: (s?.production_days ?? [1, 2, 3, 4, 5]).map(Number),
          dayStart: (s?.day_start ?? "08:00").slice(0, 5),
          arrivalWindowMinutes: s?.arrival_window_minutes ?? 30,
          crewDayHours: Number(s?.crew_day_hours ?? 8),
          requireApproval: s?.recommendations_require_approval ?? true,
          autoExecute: s?.recommendations_auto_execute ?? false,
          undoWindowMinutes: s?.undo_window_minutes ?? 15,
        }}
      />
      <WorkTypesEditor rows={typeRows} skills={skillRows.filter((k) => k.active)} />
      <WorkRulesEditor rows={ruleRows} />
      <SkillsEditor rows={skillRows} />
      <ChecklistTemplates rows={checklistRows} />
    </div>
  );
}
