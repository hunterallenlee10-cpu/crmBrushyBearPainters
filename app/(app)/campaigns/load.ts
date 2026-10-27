import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { audienceFields } from "@/lib/campaigns/audience";
import type { AudienceModule } from "@/lib/domain/campaigns";
import { loadJobOptions } from "@/lib/jobs/options";
import { loadLeadOptions } from "@/lib/leads/service";
import type { FieldDef } from "@/lib/lists/filters";
import { withOptions } from "@/lib/lists/server";
import type { CampaignTemplate } from "./campaign-editor";

type Db = SupabaseClient<Database>;

/** Audience fields per module with their picklist, user and territory options filled in. */
export async function loadAudienceFields(db: Db): Promise<Record<AudienceModule, FieldDef[]>> {
  const [leadOpts, jobOpts] = await Promise.all([loadLeadOptions(db), loadJobOptions(db)]);
  return {
    contacts: [...audienceFields("contacts")],
    leads: withOptions(audienceFields("leads"), leadOpts),
    jobs: withOptions(audienceFields("jobs"), jobOpts),
  };
}

/** Templates a campaign can start from: marketing first, then the rest (no internal ones). */
export async function loadCampaignTemplates(db: Db): Promise<CampaignTemplate[]> {
  const { data } = await db
    .from("message_templates")
    .select("id, key, name, channel, subject, body, status, message_type, category")
    .eq("active", true)
    .neq("category", "internal")
    .order("name");
  return (data ?? [])
    .map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      channel: t.channel === "email" ? ("email" as const) : ("sms" as const),
      subject: t.subject,
      body: t.body,
      status: t.status === "approved" ? ("approved" as const) : ("draft" as const),
      marketing: t.message_type === "marketing",
    }))
    .sort((a, b) => Number(b.marketing) - Number(a.marketing));
}
