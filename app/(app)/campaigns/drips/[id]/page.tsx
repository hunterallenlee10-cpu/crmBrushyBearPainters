import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { validateDripSteps } from "@/lib/domain/drips";
import { formatDateTime } from "@/lib/format/dates";
import { CancelEnrollmentButton, DripEditor } from "./drip-editor";

export const metadata: Metadata = { title: "Drip" };

/** One drip (SPEC §8.11): its steps and exit rules, and who is in it now. */
export default async function DripPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requirePermission("campaigns:manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: d } = await supabase.from("drips").select("*").eq("id", id).maybeSingle();
  if (!d) notFound();
  const [templates, enrollments] = await Promise.all([
    supabase
      .from("message_templates")
      .select("key, name")
      .neq("category", "internal")
      .eq("active", true)
      .order("name"),
    supabase
      .from("drip_enrollments")
      .select(
        "id, subject_type, subject_id, status, current_step, next_run_at, enrolled_at, exit_reason, source",
      )
      .eq("drip_id", id)
      .order("enrolled_at", { ascending: false })
      .limit(200),
  ]);
  const rows = enrollments.data ?? [];
  const leadIds = rows.filter((r) => r.subject_type === "lead").map((r) => r.subject_id);
  const contactIds = rows.filter((r) => r.subject_type === "contact").map((r) => r.subject_id);
  const [leads, contacts] = await Promise.all([
    leadIds.length
      ? supabase.from("leads").select("id, first_name, last_name").in("id", leadIds)
      : Promise.resolve({ data: [] }),
    contactIds.length
      ? supabase.from("contacts").select("id, first_name, last_name").in("id", contactIds)
      : Promise.resolve({ data: [] }),
  ]);
  const names = new Map<string, string>();
  for (const p of [...(leads.data ?? []), ...(contacts.data ?? [])]) {
    names.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(" "));
  }
  const unique = new Map((templates.data ?? []).map((t) => [t.key, t.name]));
  const steps = validateDripSteps(d.steps).steps;

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title={d.name}
        description={
          <>
            Steps go out at 10:00 am Pacific; texts respect quiet hours and every step checks
            consent again.{" "}
            <Link href="/campaigns?tab=drips" className="text-bb-forest underline">
              All drips
            </Link>
          </>
        }
      />
      <DripEditor
        readOnly={viewer.impersonating}
        templates={[...unique.entries()].map(([key, name]) => ({ key, name }))}
        drip={{
          id: d.id,
          name: d.name,
          description: d.description ?? "",
          active: d.active,
          steps,
          exitConditions: d.exit_conditions,
        }}
      />
      <section aria-labelledby="d-enrolled" className="flex flex-col gap-2">
        <h2 id="d-enrolled" className="text-base font-semibold">
          Enrollments
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
            Nobody yet. Workflow 16 enrolls just-planning, stale and exterior leads.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Enrollments</caption>
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Who
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Next step
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Enrolled
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const name = names.get(e.subject_id) ?? "Someone you can't open";
                  return (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <Link
                          href={
                            e.subject_type === "lead"
                              ? `/leads/${e.subject_id}`
                              : e.subject_type === "contact"
                                ? `/contacts/${e.subject_id}`
                                : `/jobs/${e.subject_id}`
                          }
                          className="text-bb-forest hover:underline"
                        >
                          {name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={e.status === "active" ? "info" : "neutral"}>
                          {e.status}
                        </Badge>
                        {e.exit_reason && (
                          <div className="mt-1 text-xs text-muted-foreground">{e.exit_reason}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {e.status === "active" && e.next_run_at
                          ? `Step ${e.current_step + 1} · ${formatDateTime(e.next_run_at)}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {formatDateTime(e.enrolled_at)} ·{" "}
                        {e.source === "workflow" ? "workflow" : "by hand"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {e.status === "active" && (
                          <CancelEnrollmentButton
                            id={e.id}
                            name={name}
                            readOnly={viewer.impersonating}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageContainer>
  );
}
