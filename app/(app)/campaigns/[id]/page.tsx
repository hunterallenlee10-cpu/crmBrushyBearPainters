import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { parseAudience } from "@/lib/campaigns/worker";
import {
  AUDIENCE_MODULE_LABELS,
  CAMPAIGN_STATUS_LABELS,
  type CampaignStatus,
} from "@/lib/domain/campaigns";
import { formatDateTime } from "@/lib/format/dates";
import { CampaignEditor } from "../campaign-editor";
import { CampaignStatusControls } from "../campaign-status-controls";
import { loadAudienceFields, loadCampaignTemplates } from "../load";

export const metadata: Metadata = { title: "Campaign" };

const RECIPIENT_STATUS: Record<
  string,
  { label: string; variant: "info" | "success" | "neutral" | "danger" | "warning" }
> = {
  pending: { label: "Waiting", variant: "info" },
  deferred: { label: "Waiting (quiet hours)", variant: "warning" },
  sent: { label: "Sent (simulated)", variant: "success" },
  excluded: { label: "Left out", variant: "neutral" },
  failed: { label: "Failed", variant: "danger" },
};

/** One campaign: the editor while it's a draft, then its progress and recipients (SPEC §8.11). */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requirePermission("campaigns:manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: c } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const status = c.status as CampaignStatus;
  const audience = parseAudience(c.audience);
  const readOnly = viewer.impersonating;

  if (status === "draft") {
    const [fields, templates] = await Promise.all([
      loadAudienceFields(supabase),
      loadCampaignTemplates(supabase),
    ]);
    return (
      <PageContainer className="flex flex-col gap-4">
        <PageHeader
          title={c.name}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">Draft</Badge>
              {c.last_test_at ? <span>Last test {formatDateTime(c.last_test_at)}</span> : null}
              <Link href="/campaigns" className="text-bb-forest underline">
                All campaigns
              </Link>
            </span>
          }
          actions={<CampaignStatusControls id={c.id} status={status} readOnly={readOnly} />}
        />
        <CampaignEditor
          initial={{
            id: c.id,
            name: c.name,
            channel: c.channel === "sms" ? "sms" : "email",
            audience,
            templateId: c.template_id,
            subject: c.subject ?? "",
            body: c.body ?? "",
          }}
          fieldsByModule={fields}
          templates={templates}
          readOnly={readOnly}
        />
      </PageContainer>
    );
  }

  const [counts, recipients] = await Promise.all([
    Promise.all(
      (["pending", "deferred", "sent", "excluded", "failed"] as const).map(async (s) => {
        const { count } = await supabase
          .from("campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", id)
          .eq("status", s);
        return [s, count ?? 0] as const;
      }),
    ),
    supabase
      .from("campaign_recipients")
      .select(
        "id, name, address, status, exclusion_reason, sent_at, replied_at, converted_at, error",
      )
      .eq("campaign_id", id)
      .order("status")
      .order("name")
      .limit(300),
  ]);
  const byStatus = Object.fromEntries(counts) as Record<string, number>;
  const { count: replies } = await supabase
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id)
    .not("replied_at", "is", null);

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge
              variant={status === "sent" ? "success" : status === "canceled" ? "neutral" : "info"}
            >
              {CAMPAIGN_STATUS_LABELS[status]}
            </Badge>
            <span>{c.channel === "sms" ? "Text" : "Email"}</span>
            <span aria-hidden>·</span>
            <span>{AUDIENCE_MODULE_LABELS[audience.module]}</span>
            <Link href="/campaigns" className="text-bb-forest underline">
              All campaigns
            </Link>
          </span>
        }
        actions={<CampaignStatusControls id={c.id} status={status} readOnly={readOnly} />}
      />
      <dl className="grid gap-3 rounded-2xl border bg-card p-5 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <dt className="text-muted-foreground">Scheduled</dt>
          <dd>{c.scheduled_at ? formatDateTime(c.scheduled_at) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Started</dt>
          <dd>{c.started_at ? formatDateTime(c.started_at) : "Not yet"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sent</dt>
          <dd className="font-semibold tabular-nums">{byStatus.sent ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Waiting</dt>
          <dd className="tabular-nums">{(byStatus.pending ?? 0) + (byStatus.deferred ?? 0)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Left out</dt>
          <dd className="tabular-nums">{byStatus.excluded ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Replies</dt>
          <dd className="tabular-nums">{replies ?? 0}</dd>
        </div>
      </dl>
      <section aria-labelledby="c-msg" className="rounded-2xl border bg-card p-5">
        <h2 id="c-msg" className="mb-2 text-base font-semibold">
          Message
        </h2>
        {c.subject && <p className="font-medium">{c.subject}</p>}
        <p className="text-sm whitespace-pre-wrap">{c.body}</p>
      </section>
      <section aria-labelledby="c-recipients" className="flex flex-col gap-2">
        <h2 id="c-recipients" className="text-base font-semibold">
          Recipients
        </h2>
        {(recipients.data ?? []).length === 0 ? (
          <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
            The list is made when the campaign starts sending.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Recipients</caption>
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    To
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {(recipients.data ?? []).map((r) => {
                  const s = RECIPIENT_STATUS[r.status] ?? {
                    label: r.status,
                    variant: "neutral" as const,
                  };
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{r.name ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.address ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={s.variant}>{s.label}</Badge>
                        {r.replied_at && (
                          <Badge variant="info" className="ml-1">
                            Replied
                          </Badge>
                        )}
                        {r.converted_at && (
                          <Badge variant="success" className="ml-1">
                            Booked
                          </Badge>
                        )}
                        {(r.exclusion_reason || r.error) && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {r.exclusion_reason ?? r.error}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.sent_at ? formatDateTime(r.sent_at) : "—"}
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
