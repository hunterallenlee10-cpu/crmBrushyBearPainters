import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { MergeContext } from "@/lib/domain/templates/merge";
import { WORKFLOWS, templatesUsed } from "@/lib/domain/workflows/catalog";

type Db = SupabaseClient<Database>;

/** Company merge fields and recent jobs for the template editor preview (person's own client). */
export async function loadTemplateEditorContext(db: Db): Promise<{
  company: MergeContext;
  jobs: { id: string; label: string }[];
}> {
  const [company, jobs] = await Promise.all([
    db
      .from("company_settings")
      .select("company_name, phone, email, hours_text, website_url")
      .maybeSingle(),
    db
      .from("jobs")
      .select("id, name, job_number")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(25),
  ]);
  const c = company.data;
  return {
    company: {
      name: c?.company_name ?? "Brushy Bear Painters",
      phone: c?.phone ?? "[PHONE]",
      email: c?.email ?? "[EMAIL]",
      hours: c?.hours_text ?? "[HOURS]",
      website: c?.website_url ?? "brushybear.vercel.app",
    },
    jobs: (jobs.data ?? []).map((j) => ({ id: j.id, label: `${j.job_number} · ${j.name}` })),
  };
}

export function workflowsUsing(key: string): string[] {
  return WORKFLOWS.filter((w) => templatesUsed(w).includes(key)).map(
    (w) => `${w.number}. ${w.name}`,
  );
}
