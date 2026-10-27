import type { Metadata } from "next";
import Link from "next/link";
import { CloudOff, CloudRain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { addDays, formatDay, formatRange, pacificToday } from "@/lib/domain/scheduling/dates";
import { loadWeather } from "@/lib/production/weather";
import { RainDelayForm } from "./rain-delay-form";

export const metadata: Metadata = { title: "Weather" };

/**
 * Weather panel (SPEC §8.6): exterior and deck jobs in the next 14 days. The
 * weather integration isn't connected, so there's no forecast; a PM marks a
 * rain delay by hand (the job goes first in line and it never costs the customer).
 */
export default async function WeatherPage() {
  const viewer = await requirePermission("schedule:read");
  const supabase = await createSupabaseServerClient();
  const today = pacificToday(new Date());
  const weather = await loadWeather();
  const { data: entries } = await supabase
    .from("schedule_entries")
    .select(
      "id, job_id, starts_on, ends_on, job:jobs(id, name, job_number, work_types, is_priority_reschedule, property:properties!jobs_property_id_fkey(city))",
    )
    .eq("status", "published")
    .lte("starts_on", addDays(today, 14))
    .gte("ends_on", today)
    .order("starts_on")
    .limit(300);
  const ext = (entries ?? []).filter(
    (e) => e.job && e.job.work_types.some((w) => w === "exterior" || w === "deck_fence"),
  );
  const jobIds = [...new Set(ext.map((e) => e.job_id))];
  const { data: delays } = jobIds.length
    ? await supabase
        .from("rain_delays")
        .select("job_id, delay_date")
        .in("job_id", jobIds)
        .order("delay_date", { ascending: false })
    : { data: [] as { job_id: string; delay_date: string }[] };
  const canMark =
    (viewer.can("schedule:manage") || viewer.can("daily_logs:create")) && !viewer.impersonating;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Weather"
        description="Exterior and deck & fence days in the next 14 days."
      />
      {!weather.connected && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-dashed bg-card p-4 text-sm"
        >
          <CloudOff className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-medium">Weather not connected</p>
            <p className="text-muted-foreground">
              No forecast is pulled until the weather integration is connected in{" "}
              <Link href="/admin/integrations" className="underline">
                Admin → Integrations
              </Link>
              . Check the forecast yourself and mark a rain delay below: the job goes first in line
              when it clears, and the delay never costs the customer anything.
            </p>
          </div>
        </div>
      )}
      {ext.length === 0 ? (
        <EmptyState icon={CloudRain} title="No exterior days in the next 14 days">
          <p>Published exterior and deck & fence jobs show here.</p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {ext.map((e) => {
            const marked = (delays ?? [])
              .filter((d) => d.job_id === e.job_id)
              .map((d) => d.delay_date);
            const start = (e.starts_on as string) < today ? today : (e.starts_on as string);
            return (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4"
              >
                <div>
                  <Link
                    href={`/jobs/${e.job_id}?section=schedule`}
                    className="font-medium text-bb-forest hover:underline"
                  >
                    {e.job?.job_number} · {e.job?.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {e.job?.property?.city ?? "—"} ·{" "}
                    {formatRange(e.starts_on as string, e.ends_on as string)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.job?.is_priority_reschedule && (
                      <Badge variant="warning">Priority reschedule</Badge>
                    )}
                    {marked.slice(0, 3).map((d) => (
                      <Badge key={d} variant="info">
                        Rain {formatDay(d)}
                      </Badge>
                    ))}
                  </div>
                </div>
                {canMark && (
                  <RainDelayForm
                    jobId={e.job_id}
                    label={e.job?.name ?? "job"}
                    defaultDate={start}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
