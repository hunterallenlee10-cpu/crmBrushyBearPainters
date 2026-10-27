import type { Metadata } from "next";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarPlus,
  ClipboardList,
  Pencil,
  Users,
} from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { isCalendarView } from "@/lib/domain/scheduling/calendar";
import { isIsoDate, pacificToday } from "@/lib/domain/scheduling/dates";
import {
  parseProductionStats,
  productionMetricValue,
  scheduleBoardMetricValue,
} from "@/lib/metrics/registry";
import { loadBoard } from "@/lib/production/board";
import { MasterSchedule } from "./master-client";

export const metadata: Metadata = { title: "Master Schedule" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Master Schedule (SPEC §8.6): tray + crew-row calendar, drafts until "Publish changes". */
export default async function MasterSchedulePage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("schedule:read");
  const sp = await searchParams;
  const view = isCalendarView(one(sp.view)) ? (one(sp.view) as "day" | "week" | "multi") : "week";
  const today = pacificToday(new Date());
  const rawAnchor = one(sp.date);
  const anchor = rawAnchor && isIsoDate(rawAnchor) ? rawAnchor : today;
  const supabase = await createSupabaseServerClient();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const [board, statsRes] = await Promise.all([
    loadBoard({ supabase, service }, { orgId: viewer.orgId, view, anchor }),
    supabase.rpc("production_stats"),
  ]);
  const stats = parseProductionStats(statsRes.data);
  const kpi = [
    {
      m: productionMetricValue("production.ready", stats),
      icon: ClipboardList,
      tone: "brand" as const,
    },
    {
      m: productionMetricValue("production.scheduled", stats),
      icon: CalendarCheck,
      tone: "info" as const,
    },
    {
      m: productionMetricValue("production.at_risk", stats),
      icon: AlertTriangle,
      tone: "danger" as const,
    },
    {
      m: productionMetricValue("production.unscheduled", stats),
      icon: CalendarPlus,
      tone: "warning" as const,
    },
    { m: productionMetricValue("production.crews", stats), icon: Users, tone: "neutral" as const },
    {
      m: scheduleBoardMetricValue("schedule.conflicts", board.stats),
      icon: AlertTriangle,
      tone: "warning" as const,
    },
    {
      m: scheduleBoardMetricValue("schedule.drafts", board.stats),
      icon: Pencil,
      tone: "brand" as const,
    },
  ];
  const readOnly = viewer.impersonating;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Master Schedule"
        description="Drag jobs from the tray onto a crew and day. Changes stay drafts until you choose Publish changes, which tells customers and crews."
      />
      <section
        aria-label="Schedule KPIs"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-7"
      >
        {kpi.map(({ m, icon, tone }) => (
          <KpiCard
            key={m.id}
            label={m.label}
            value={m.display}
            caption={m.caption}
            icon={icon}
            tone={tone}
          />
        ))}
      </section>
      <MasterSchedule
        board={{
          view: board.view,
          anchor: board.anchor,
          days: board.days,
          today: board.today,
          productionDays: board.config.settings.productionDays,
          crews: board.crews.map((c) => ({
            id: c.id,
            name: c.name,
            active: c.active,
            color: c.color,
            crewType: c.crewType,
            leadName: c.leadName,
            skills: c.skills.map((s) => board.config.context.skillLabels[s.key] ?? s.key),
            timeOff: c.timeOff.map((t) => ({
              startsOn: t.startsOn,
              endsOn: t.endsOn,
              who: t.memberName,
            })),
          })),
          bars: board.bars,
          tray: board.tray.map((t) => ({ ...t, ranking: t.ranking.slice(0, 3) })),
          weatherConnected: board.weatherConnected,
        }}
        can={{
          manage: viewer.can("schedule:manage") && !readOnly,
          publish: viewer.can("schedule:publish") && !readOnly,
          override: viewer.can("job_admin:override") && !readOnly,
        }}
      />
    </div>
  );
}
