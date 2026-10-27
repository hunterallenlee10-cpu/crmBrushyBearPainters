import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadActiveUsers } from "@/app/(app)/jobs/[id]/_sections/data";
import { CaseForm } from "./case-form";

export const metadata: Metadata = { title: "New case" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f-]{36}$/i;

/** New warranty or service case (SPEC §8.16), from a job or a customer. */
export default async function NewCasePage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("cases:manage");
  const sp = await searchParams;
  const jobParam = one(sp.job);
  const accountParam = one(sp.account);
  const supabase = await createSupabaseServerClient();
  const [jobs, accounts, users] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, name, job_number, stage")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase.from("accounts").select("id, display_name").order("display_name").limit(500),
    loadActiveUsers(),
  ]);
  const jobOptions = (jobs.data ?? []).map((j) => ({
    value: j.id,
    label: `${j.name} · ${j.job_number}`,
  }));
  // A job asked for by link but not in the recent 300 still shows.
  if (jobParam && UUID.test(jobParam) && !jobOptions.some((j) => j.value === jobParam)) {
    const { data: j } = await supabase
      .from("jobs")
      .select("id, name, job_number")
      .eq("id", jobParam)
      .maybeSingle();
    if (j) jobOptions.unshift({ value: j.id, label: `${j.name} · ${j.job_number}` });
  }

  return (
    <PageContainer className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="New case"
        description={
          <>
            A warranty request, touch-up or service call.{" "}
            <Link href="/cases" className="text-bb-forest underline">
              Back to Warranty &amp; Service
            </Link>
          </>
        }
      />
      <CaseForm
        jobs={jobOptions}
        accounts={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.display_name }))}
        users={users}
        defaultJobId={jobParam && UUID.test(jobParam) ? jobParam : ""}
        defaultAccountId={accountParam && UUID.test(accountParam) ? accountParam : ""}
        viewerId={viewer.id}
        canMessage={viewer.can("messages:send")}
        readOnly={viewer.impersonating}
      />
    </PageContainer>
  );
}
