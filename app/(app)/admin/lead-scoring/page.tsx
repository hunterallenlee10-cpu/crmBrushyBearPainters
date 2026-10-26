import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { BASE_SCORE, SCORING_FACTORS, type ScoringFactor } from "@/lib/domain/leads/scoring";
import { LeadScoringEditor, type EditableRule } from "./lead-scoring-editor";

export const metadata: Metadata = { title: "Lead Scoring" };

const GRADES = [
  { grade: "A", range: "85–100", temperature: "Hot" },
  { grade: "B", range: "70–84", temperature: "Warm" },
  { grade: "C", range: "55–69", temperature: "Warm" },
  { grade: "D", range: "40–54", temperature: "Cold" },
  { grade: "F", range: "0–39", temperature: "Cold" },
] as const;

export default async function LeadScoringPage() {
  const viewer = await requirePermission("settings:manage");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_scoring_rules")
    .select("id, factor, label, points, active, sort_order")
    .order("sort_order")
    .order("factor");
  if (error) throw error;

  const known = new Set<string>(SCORING_FACTORS);
  const rules: EditableRule[] = (data ?? [])
    .filter((r) => known.has(r.factor))
    .map((r) => ({
      id: r.id,
      factor: r.factor as ScoringFactor,
      label: r.label,
      points: r.points,
      active: r.active,
    }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lead Scoring"
        description="How every lead gets its score, grade and Hot / Warm / Cold label. Changes save to the audit log."
      />

      <section
        aria-labelledby="how-it-works"
        className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-[1fr_auto]"
      >
        <div className="flex flex-col gap-2 text-sm">
          <h2 id="how-it-works" className="text-base font-semibold">
            How it works
          </h2>
          <p>
            Every lead starts at <strong>{BASE_SCORE}</strong>. Each rule below that fits the lead
            adds its points (or takes them away when the number is negative). The total is kept
            between <strong>0 and 100</strong>.
          </p>
          <p>
            The score is plain arithmetic, so anyone can see why a lead scored what it did. The lead
            page lists the rules that counted. Nothing is guessed by AI.
          </p>
          <p className="text-muted-foreground">
            Turn a rule off to ignore it without losing its points. Leads are rescored automatically
            whenever they change; use <em>Recalculate open leads</em> below to apply new weights to
            every open lead right away.
          </p>
        </div>
        <table className="h-fit w-full min-w-56 overflow-hidden rounded-lg border text-sm md:w-auto">
          <caption className="sr-only">Grades and temperatures</caption>
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                Grade
              </th>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                Score
              </th>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                Label
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {GRADES.map((g) => (
              <tr key={g.grade}>
                <th scope="row" className="px-3 py-1.5 text-left font-semibold">
                  {g.grade}
                </th>
                <td className="px-3 py-1.5 tabular-nums">{g.range}</td>
                <td className="px-3 py-1.5">{g.temperature}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <LeadScoringEditor
        rules={rules}
        canRecalculate={viewer.can("leads:update") && !viewer.impersonating}
        readOnly={viewer.impersonating}
      />
    </div>
  );
}
