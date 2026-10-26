import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarCheck,
  Clock,
  Flame,
  List,
  PhoneCall,
  Plus,
  Sparkles,
  UserRoundSearch,
  UserX,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/kpi/chart-card";
import { BarChart } from "@/components/kpi/bar-chart";
import { CHART_COLORS } from "@/components/kpi/chart-colors";
import { ViewDataDialog } from "@/components/kpi/view-data-dialog";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadLeadOptions } from "@/lib/leads/service";
import { logError } from "@/lib/log";
import {
  OPEN_LEAD_STATUSES,
  type Grade,
  type LeadStatus,
  type Temperature,
} from "@/lib/domain/leads/constants";
import {
  LEAD_BREAKDOWN_CAPTIONS,
  formatPercent,
  leadAging,
  leadCities,
  leadFunnel,
  leadMetricValue,
  leadSources,
  leadStatusDistribution,
  parseLeadStats,
} from "@/lib/metrics/registry";
import { LeadMiniList, type MiniLead } from "./_dashboard/lead-mini-list";
import { ConversionFunnel } from "./_dashboard/conversion-funnel";
import { agingHref, cityHref, leadListHref, sourceHref, statusHref } from "./_dashboard/links";

export const metadata: Metadata = { title: "Lead Dashboard" };

const MINI_SELECT =
  "id, first_name, last_name, status, city, lead_source, grade, score, temperature, created_at";

const list = (items: readonly { label: string; value: number }[]) =>
  items.map((i) => `${i.label} ${i.value.toLocaleString("en-US")}`).join(", ");

export default async function LeadDashboardPage() {
  const viewer = await requirePermission("leads:read");
  const supabase = await createSupabaseServerClient();
  const now = new Date();

  const [statsRes, options, mineRes, recentRes] = await Promise.all([
    supabase.rpc("lead_stats", { p_now: now.toISOString() }),
    loadLeadOptions(supabase),
    supabase
      .from("leads")
      .select(MINI_SELECT)
      .eq("owner_id", viewer.id)
      .in("status", [...OPEN_LEAD_STATUSES])
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("leads").select(MINI_SELECT).order("created_at", { ascending: false }).limit(5),
  ]);
  if (statsRes.error) logError("leads.dashboard.stats", statsRes.error);
  const stats = parseLeadStats(statsRes.data);

  const sourceLabel = (value: string | null) =>
    value
      ? (options.picklists.lead_source.find((o) => o.value === value)?.label ?? value)
      : "No source";
  const toMini = (rows: typeof mineRes.data): MiniLead[] =>
    (rows ?? []).map((l) => ({
      id: l.id,
      name: [l.first_name, l.last_name].filter(Boolean).join(" "),
      status: l.status as LeadStatus,
      city: l.city,
      sourceLabel: l.lead_source ? sourceLabel(l.lead_source) : null,
      grade: l.grade as Grade | null,
      score: l.score,
      temperature: l.temperature as Temperature | null,
      createdAt: l.created_at,
    }));

  const m = {
    total: leadMetricValue("leads.total", stats),
    new: leadMetricValue("leads.new", stats),
    contacted: leadMetricValue("leads.contacted", stats),
    walkthrough: leadMetricValue("leads.walkthrough_scheduled", stats),
    contactRate: leadMetricValue("leads.contact_rate", stats),
    walkthroughRate: leadMetricValue("leads.walkthrough_rate", stats),
    conversionRate: leadMetricValue("leads.conversion_rate", stats),
    stale: leadMetricValue("leads.stale", stats),
    unassigned: leadMetricValue("leads.unassigned", stats),
    hot: leadMetricValue("leads.hot", stats),
    last7: leadMetricValue("leads.new_last_7_days", stats),
    speed: leadMetricValue("leads.speed_to_lead_median", stats),
  };

  const canCreate = viewer.can("leads:create") && !viewer.impersonating;
  const statusRows = leadStatusDistribution(stats);
  const sources = leadSources(stats);
  const cities = leadCities(stats);
  const aging = leadAging(stats);

  const header = (
    <PageHeader
      title="Lead Dashboard"
      description="Every number is aggregated on the server across all leads you can see, not just one page of the list."
      actions={
        <>
          <Button asChild variant="outline">
            <Link href={leadListHref()}>
              <List aria-hidden />
              Lead List
            </Link>
          </Button>
          {canCreate && (
            <Button asChild variant="cta">
              <Link href="/leads/new">
                <Plus aria-hidden />
                New Lead
              </Link>
            </Button>
          )}
        </>
      }
    />
  );

  const kpis = (
    <section
      aria-label="Lead totals"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <KpiCard
        label={m.total.label}
        value={m.total.display}
        caption={m.total.caption}
        icon={Users}
        href={leadListHref({ tab: "all" })}
      />
      <KpiCard
        label={m.new.label}
        value={m.new.display}
        caption={m.new.caption}
        icon={Sparkles}
        tone="info"
        href={statusHref("new")}
      />
      <KpiCard
        label={m.contacted.label}
        value={m.contacted.display}
        caption={m.contacted.caption}
        icon={PhoneCall}
        tone="warning"
        href={statusHref("contacted")}
      />
      <KpiCard
        label={m.walkthrough.label}
        value={m.walkthrough.display}
        caption={m.walkthrough.caption}
        icon={CalendarCheck}
        tone="success"
        href={statusHref("walkthrough_scheduled")}
      />
    </section>
  );

  if (stats.total === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        {kpis}
        <EmptyState
          icon={UserRoundSearch}
          title="No leads yet"
          action={
            canCreate ? (
              <Button asChild variant="cta">
                <Link href="/leads/new">
                  <Plus aria-hidden />
                  New Lead
                </Link>
              </Button>
            ) : undefined
          }
        >
          Website leads land here automatically. Once a few arrive you&apos;ll see where they come
          from, how fast they&apos;re reached and which ones need attention.
        </EmptyState>
      </div>
    );
  }

  const myLeads = toMini(mineRes.data);
  const recentLeads = toMini(recentRes.data);

  return (
    <div className="flex flex-col gap-5">
      {header}
      {kpis}

      <section aria-labelledby="needs-attention-title" className="flex flex-col gap-2">
        <h2 id="needs-attention-title" className="text-base font-semibold text-bb-ink">
          Needs Attention
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            label={m.stale.label}
            value={m.stale.display}
            caption={m.stale.caption}
            icon={Clock}
            tone={stats.stale > 0 ? "warning" : "neutral"}
            href={leadListHref({ chips: ["stale"] })}
          />
          <KpiCard
            label={m.unassigned.label}
            value={m.unassigned.display}
            caption={m.unassigned.caption}
            icon={UserX}
            tone={stats.unassigned > 0 ? "warning" : "neutral"}
            href={leadListHref({ chips: ["unassigned"] })}
          />
          <KpiCard
            label={m.hot.label}
            value={m.hot.display}
            caption={m.hot.caption}
            icon={Flame}
            tone={stats.hot > 0 ? "danger" : "neutral"}
            href={leadListHref({ chips: ["hot"] })}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <ChartCard
          id="lead-status"
          title="Lead Status Distribution"
          caption={LEAD_BREAKDOWN_CAPTIONS.status}
          action={
            <ViewDataDialog
              title="Lead Status Distribution"
              description={LEAD_BREAKDOWN_CAPTIONS.status}
              columns={[
                { key: "status", label: "Status" },
                { key: "leads", label: "Leads", align: "right" },
              ]}
              rows={statusRows.map((r) => ({
                status: { text: r.label, href: statusHref(r.status) },
                leads: r.leads,
              }))}
            />
          }
        >
          <BarChart
            ariaLabel={`Leads by status: ${list(statusRows.map((r) => ({ label: r.label, value: r.leads })))}`}
            series={[{ key: "leads", label: "Leads", color: CHART_COLORS.primary }]}
            data={statusRows.map((r) => ({
              label: r.label,
              leads: r.leads,
              total: r.leads,
              href: statusHref(r.status),
            }))}
          />
        </ChartCard>

        <LeadMiniList
          id="my-leads"
          title="My Leads"
          caption="Your five newest open leads"
          leads={myLeads}
          viewAllHref={leadListHref({ tab: "mine" })}
          viewAllLabel="All my leads"
          empty="No open leads assigned to you. Leads you own show up here."
          now={now}
        />

        <LeadMiniList
          id="recent-leads"
          title="Recent Leads"
          caption="The five newest leads you can see"
          leads={recentLeads}
          viewAllHref={leadListHref({ tab: "all" })}
          viewAllLabel="All leads"
          empty="No leads yet."
          now={now}
        />

        <ConversionFunnel
          steps={leadFunnel(stats)}
          rates={[m.contactRate, m.walkthroughRate, m.conversionRate]}
          footer={[m.speed, m.last7]}
        />

        <ChartCard
          id="lead-sources"
          title="Top Lead Sources"
          caption={LEAD_BREAKDOWN_CAPTIONS.sources}
          action={
            <ViewDataDialog
              title="Top Lead Sources"
              description={LEAD_BREAKDOWN_CAPTIONS.sources}
              columns={[
                { key: "source", label: "Source" },
                { key: "leads", label: "Leads", align: "right" },
                { key: "converted", label: "Converted", align: "right" },
                { key: "conversion", label: "Conversion", align: "right" },
              ]}
              rows={sources.map((r) => ({
                source: { text: sourceLabel(r.source), href: sourceHref(r.source) },
                leads: r.leads,
                converted: r.converted,
                conversion: formatPercent(r.conversion),
              }))}
            />
          }
        >
          {sources.length === 0 ? (
            <ChartEmpty>No sources recorded yet.</ChartEmpty>
          ) : (
            <BarChart
              ariaLabel={`Leads by source: ${sources
                .map((r) => `${sourceLabel(r.source)} ${r.leads} leads, ${r.converted} converted`)
                .join("; ")}`}
              series={[
                { key: "converted", label: "Converted", color: CHART_COLORS.primary },
                { key: "notConverted", label: "Not converted yet", color: CHART_COLORS.secondary },
              ]}
              data={sources.map((r) => ({
                label: sourceLabel(r.source),
                converted: r.converted,
                notConverted: r.notConverted,
                total: r.leads,
                href: sourceHref(r.source),
              }))}
            />
          )}
        </ChartCard>

        <ChartCard
          id="lead-cities"
          title="Leads by City"
          caption={LEAD_BREAKDOWN_CAPTIONS.cities}
          action={
            <ViewDataDialog
              title="Leads by City"
              description={LEAD_BREAKDOWN_CAPTIONS.cities}
              columns={[
                { key: "city", label: "City" },
                { key: "leads", label: "Leads", align: "right" },
                { key: "share", label: "Share of leads", align: "right" },
              ]}
              rows={cities.map((r) => {
                const href = cityHref(r.city, options.territories);
                return {
                  city: href ? { text: r.city, href } : r.city,
                  leads: r.leads,
                  share: formatPercent(r.share),
                };
              })}
            />
          }
        >
          {cities.length === 0 ? (
            <ChartEmpty>No cities yet.</ChartEmpty>
          ) : (
            <BarChart
              ariaLabel={`Leads by city: ${list(cities.map((r) => ({ label: r.city, value: r.leads })))}`}
              series={[{ key: "leads", label: "Leads", color: CHART_COLORS.primary }]}
              data={cities.map((r) => ({
                label: r.city,
                leads: r.leads,
                total: r.leads,
                href: cityHref(r.city, options.territories),
              }))}
            />
          )}
        </ChartCard>

        <ChartCard
          id="lead-aging"
          title="Lead Aging"
          caption={LEAD_BREAKDOWN_CAPTIONS.aging}
          action={
            <ViewDataDialog
              title="Lead Aging"
              description={`${LEAD_BREAKDOWN_CAPTIONS.aging}. The list opens by calendar day, so its edges can differ by part of a day.`}
              columns={[
                { key: "bucket", label: "Age" },
                { key: "leads", label: "Open leads", align: "right" },
              ]}
              rows={aging.map((r) => ({
                bucket: { text: r.label, href: agingHref(r.key, now) },
                leads: r.leads,
              }))}
            />
          }
        >
          {stats.open === 0 ? (
            <ChartEmpty>No open leads right now.</ChartEmpty>
          ) : (
            <BarChart
              orientation="vertical"
              ariaLabel={`Open leads by age: ${list(aging.map((r) => ({ label: r.label, value: r.leads })))}`}
              series={[{ key: "leads", label: "Open leads", color: CHART_COLORS.primary }]}
              data={aging.map((r) => ({
                label: r.label,
                leads: r.leads,
                total: r.leads,
                href: agingHref(r.key, now),
              }))}
            />
          )}
        </ChartCard>
      </div>
    </div>
  );
}
