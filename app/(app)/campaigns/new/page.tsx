import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { CampaignEditor } from "../campaign-editor";
import { loadAudienceFields, loadCampaignTemplates } from "../load";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const viewer = await requirePermission("campaigns:manage");
  const supabase = await createSupabaseServerClient();
  const [fields, templates] = await Promise.all([
    loadAudienceFields(supabase),
    loadCampaignTemplates(supabase),
  ]);
  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="New campaign"
        description={
          <>
            Build the audience, write the message, run the checks, then test and schedule.{" "}
            <Link href="/campaigns" className="text-bb-forest underline">
              All campaigns
            </Link>
          </>
        }
      />
      <CampaignEditor
        initial={{
          name: "",
          channel: "email",
          audience: { module: "contacts", match: "all", rules: [] },
          templateId: null,
          subject: "",
          body: "",
        }}
        fieldsByModule={fields}
        templates={templates}
        readOnly={viewer.impersonating}
      />
    </PageContainer>
  );
}
