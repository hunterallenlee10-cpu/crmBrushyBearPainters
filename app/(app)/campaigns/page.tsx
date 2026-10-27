import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone, MessageSquareReply, Plus, Send, Timer, Workflow } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from "@/lib/domain/campaigns";
import { describeDripStep, validateDripSteps } from "@/lib/domain/drips";
import { formatDateTime, formatRelative } from "@/lib/format/dates";
import { loadCommunicationStats } from "@/lib/messaging/stats";
import { communicationMetricValue, type CommunicationMetricId } from "@/lib/metrics/registry";
import { loadWorkflowList } from "@/lib/workflows/admin";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Campaigns" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TABS = [
  { id: "campaigns", label: "Campaigns" },
  { id: "drips", label: "Drips" },
  { id: "automations", label: "Automations" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const KPIS: { id: CommunicationMetricId; icon: typeof Send }[] = [
  { id: "campaigns.active", icon: Megaphone },
  { id: "campaigns.sends", icon: Send },
  { id: "campaigns.replies", icon: MessageSquareReply },
  { id: "drips.active", icon: Timer },
];

const STATUS_VARIANT: Record<CampaignStatus, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral",
  scheduled: "info",
  sending: "info",
  paused: "warning",
  sent: "success",
  canceled: "neutral",
};

/**
 * Campaigns & Drips (SPEC §8.11): one-off email and text campaigns to an
 * audience built from rules, the seasonal drips, and the automations that
 * enroll people in them. Everything is marketing: consent rules apply and
 * every send is "Simulated – not sent" while texting and email aren't
 * connected.
 */
export default async function CampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("campaigns:manage");
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === one(sp.tab)) ? (one(sp.tab) as Tab) : "campaigns";
  const supabase = await createSupabaseServerClient();
  const stats = await loadCommunicationStats(supabase, { days: 90 });

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="Campaigns"
        description="Email and text campaigns, seasonal drips and the automations behind them. Marketing consent, opt-outs and quiet hours always apply."
        actions={
          !viewer.impersonating ? (
            <Button asChild>
              <Link href="/campaigns/new">
                <Plus className="size-4" aria-hidden /> New campaign
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k) => {
          const v = communicationMetricValue(k.id, stats);
          return (
            <KpiCard
              key={k.id}
              label={v.label}
              value={v.display}
              caption={v.caption}
              icon={k.icon}
            />
          );
        })}
      </div>
      <nav aria-label="Campaign sections" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/campaigns?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              t.id === tab ? "border-bb-forest bg-bb-forest text-white" : "hover:bg-muted",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "campaigns" && <CampaignList />}
      {tab === "drips" && <DripList />}
      {tab === "automations" && <Automations />}
    </PageContainer>
  );
}

async function CampaignList() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, channel, status, scheduled_at, finished_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = data ?? [];
  const ids = rows.map((r) => r.id);
  const { data: sentRows } = ids.length
    ? await supabase
        .from("campaign_recipients")
        .select("campaign_id")
        .in("campaign_id", ids)
        .eq("status", "sent")
        .limit(10000)
    : { data: [] };
  const sent = new Map<string, number>();
  for (const r of sentRows ?? []) sent.set(r.campaign_id, (sent.get(r.campaign_id) ?? 0) + 1);
  if (!rows.length) {
    return (
      <EmptyState icon={Megaphone} title="No campaigns yet">
        Start one with New campaign: pick who gets it, write the message, run the checks, then
        schedule it.
      </EmptyState>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">Campaigns</caption>
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Campaign
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Channel
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              When
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Sent
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const s = c.status as CampaignStatus;
            return (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="font-medium text-bb-forest hover:underline"
                  >
                    {c.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    Edited {formatRelative(c.updated_at)}
                  </div>
                </td>
                <td className="px-3 py-2">{c.channel === "sms" ? "Text" : "Email"}</td>
                <td className="px-3 py-2">
                  <Badge variant={STATUS_VARIANT[s] ?? "neutral"}>
                    {CAMPAIGN_STATUS_LABELS[s] ?? c.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs">
                  {c.finished_at
                    ? `Finished ${formatDateTime(c.finished_at)}`
                    : c.scheduled_at
                      ? formatDateTime(c.scheduled_at)
                      : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{sent.get(c.id) ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function DripList() {
  const supabase = await createSupabaseServerClient();
  const [{ data: drips }, { data: enrollments }] = await Promise.all([
    supabase
      .from("drips")
      .select("id, key, name, description, steps, active, is_system")
      .is("archived_at", null)
      .order("name"),
    supabase.from("drip_enrollments").select("drip_id").eq("status", "active").limit(10000),
  ]);
  const active = new Map<string, number>();
  for (const e of enrollments ?? []) active.set(e.drip_id, (active.get(e.drip_id) ?? 0) + 1);
  if (!drips?.length) {
    return (
      <EmptyState icon={Timer} title="No drips">
        The seeded drips appear here.
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {drips.map((d) => {
        const { steps } = validateDripSteps(d.steps);
        return (
          <li key={d.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/campaigns/drips/${d.id}`}
                className="font-semibold text-bb-forest hover:underline"
              >
                {d.name}
              </Link>
              {d.active ? (
                <Badge variant="success">On</Badge>
              ) : (
                <Badge variant="neutral">Off</Badge>
              )}
              {d.is_system && <Badge variant="neutral">System</Badge>}
              <span className="ml-auto text-xs text-muted-foreground">
                {active.get(d.id) ?? 0} enrolled now
              </span>
            </div>
            {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
            <ol className="list-decimal pl-5 text-sm">
              {steps.map((s, i) => (
                <li key={i}>{describeDripStep(s)}</li>
              ))}
            </ol>
          </li>
        );
      })}
    </ul>
  );
}

async function Automations() {
  const supabase = await createSupabaseServerClient();
  const rows = await loadWorkflowList(supabase);
  return (
    <section aria-label="Automations" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        These workflows send messages on their own and enroll people in drips. Switch them on or off
        and see every run in{" "}
        <Link href="/admin/workflows" className="text-bb-forest underline">
          Admin → Workflows
        </Link>
        .
      </p>
      <ul className="divide-y rounded-2xl border bg-card">
        {rows.map((r) => (
          <li key={r.def.key} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
            <Workflow className="size-4 text-muted-foreground" aria-hidden />
            <span className="w-6 text-xs text-muted-foreground tabular-nums">{r.def.number}</span>
            <Link
              href={`/admin/workflows/${r.def.key}`}
              className="font-medium text-bb-forest hover:underline"
            >
              {r.def.name}
            </Link>
            {r.enabled ? <Badge variant="success">On</Badge> : <Badge variant="neutral">Off</Badge>}
            <span className="ml-auto text-xs text-muted-foreground">
              {r.runs} runs{r.lastRunAt ? ` · last ${formatRelative(r.lastRunAt)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
