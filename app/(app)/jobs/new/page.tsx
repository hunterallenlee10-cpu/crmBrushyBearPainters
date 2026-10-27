import type { Metadata } from "next";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadJobOptions } from "@/lib/jobs/options";
import { pacificIsoDate } from "@/lib/format/dates";
import { loadAccountChoice } from "./account-choice";
import { NewJobForm } from "./new-job-form";

export const metadata: Metadata = { title: "New Job" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** New Job (SPEC §8.5): for repeat customers and referrals that skip the lead step. */
export default async function NewJobPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("jobs:create");
  const sp = await searchParams;
  const raw = Array.isArray(sp.account) ? sp.account[0] : sp.account;
  const accountId = raw && z.uuid().safeParse(raw).success ? raw : null;

  const supabase = await createSupabaseServerClient();
  const [options, initialAccount] = await Promise.all([
    loadJobOptions(supabase),
    accountId ? loadAccountChoice(supabase, accountId) : Promise.resolve(null),
  ]);
  const year = Number(pacificIsoDate().slice(0, 4));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="New Job"
        description="Start a job for an existing customer. It begins at Walkthrough Scheduled; book the walkthrough from the job page."
      />
      <NewJobForm
        options={{
          workTypes: options.picklists.work_type.filter((o) => o.active !== false),
          leadSources: options.picklists.lead_source.filter((o) => o.active !== false),
          users: options.users,
        }}
        initialAccount={initialAccount}
        accountMissing={accountId !== null && initialAccount === null}
        viewerId={viewer.id}
        canAssign={viewer.can("jobs:assign")}
        canWriteNotes={viewer.can("notes:write")}
        readOnly={viewer.impersonating}
        seasons={[year, year + 1, year + 2]}
      />
    </div>
  );
}
