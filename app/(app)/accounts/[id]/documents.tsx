import { DocumentList } from "@/components/documents/document-list";
import { createSupabaseServerClient } from "@/lib/db/server";
import { DOCUMENT_COLUMNS, toDocumentItems } from "@/lib/documents/load";

/**
 * The customer's documents (SPEC §8.10, §8.5 #7): on the customer itself or
 * on any of their jobs. Uploads here belong to the customer; move one to a
 * job from its menu.
 */
export async function AccountDocuments({
  accountId,
  canManage,
}: {
  accountId: string;
  canManage: boolean;
}) {
  const supabase = await createSupabaseServerClient();
  const [docs, jobs] = await Promise.all([
    supabase
      .from("documents")
      .select(DOCUMENT_COLUMNS)
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("jobs")
      .select("id, job_number, name")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const items = await toDocumentItems(supabase, docs.data ?? []);
  return (
    <DocumentList
      items={items}
      canManage={canManage}
      uploadTarget={{ accountId }}
      jobOptions={(jobs.data ?? []).map((j) => ({
        id: j.id,
        label: `${j.job_number} · ${j.name}`,
      }))}
      showLinked
      emptyText="Signed proposals, HOA approvals and other papers for this customer show up here."
    />
  );
}
