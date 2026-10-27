"use client";

import * as React from "react";
import {
  CircleAlert,
  CirclePause,
  ClipboardList,
  FolderOpen,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptySection } from "@/components/jobs/empty-section";
import type { ChecklistSummary } from "@/lib/domain/onboarding/checklist";
import type { Option } from "@/lib/leads/service";
import type { HoldItem } from "./types";
import { HoldsPanel } from "./holds-panel";

const TABS = ["checklist", "cases", "tasks", "holds"] as const;
type Tab = (typeof TABS)[number];

/**
 * Onboarding (SPEC §8.5 #2): stat tiles, sub-tabs Checklist · Cases · Tasks ·
 * Holds, the job summary and the footnote from SPEC §6.4.
 */
export function OnboardingSection({
  jobId,
  holds,
  holdTypes,
  canEdit,
  editReason,
  tasksDue,
  openTasks,
  initialTab,
  checklist,
  summary,
  jobSummary,
  tasks,
}: {
  jobId: string;
  holds: HoldItem[];
  holdTypes: Option[];
  canEdit: boolean;
  editReason: string | null;
  tasksDue: number | null;
  openTasks: number | null;
  initialTab: string | undefined;
  /** The requirement checklist, once the estimate is accepted. */
  checklist?: React.ReactNode;
  summary?: ChecklistSummary | null;
  jobSummary?: { label: string; value: string }[];
  /** The job's tasks (rendered on the server). */
  tasks?: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<Tab>(
    (TABS as readonly string[]).includes(initialTab ?? "")
      ? (initialTab as Tab)
      : checklist
        ? "checklist"
        : "holds",
  );
  const active = holds.filter((h) => !h.releasedAt);
  const blocking = active.filter((h) => h.blocksScheduling);
  const pct = summary?.percent;

  const select = (next: string) => {
    const t = next as Tab;
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="Checklist progress"
          value={pct === null || pct === undefined ? "—" : `${Math.round(pct * 100)}%`}
          caption={
            summary
              ? `${summary.cleared}/${summary.required} required cleared`
              : "Starts when the estimate is accepted"
          }
          icon={ClipboardList}
        />
        <Tile
          label="Auto-verified"
          value={summary ? String(summary.autoVerified) : "—"}
          caption="Cleared by the checks"
          icon={ShieldCheck}
        />
        <Tile
          label="Needs attention"
          value={summary ? String(summary.needAttention) : "—"}
          caption="Missing or needs review"
          icon={CircleAlert}
          tone={summary?.needAttention ? "warning" : undefined}
        />
        <Tile label="Open cases" value="—" caption="Cases arrive in Phase 8" icon={FolderOpen} />
        <Tile
          label="Tasks due"
          value={tasksDue === null ? "—" : String(tasksDue)}
          caption={openTasks === null ? "Not available to you" : `${openTasks} open in total`}
          icon={ListChecks}
        />
        <Tile
          label="Active holds"
          value={String(active.length)}
          caption={
            blocking.length ? `${blocking.length} block scheduling` : "None block scheduling"
          }
          icon={CirclePause}
          tone={blocking.length ? "warning" : undefined}
        />
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <Tabs value={tab} onValueChange={select} className="min-w-0 flex-1 gap-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList aria-label="Onboarding">
              <TabsTrigger value="checklist">
                Checklist
                {summary && summary.open.length > 0 && (
                  <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">
                    {summary.open.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="cases">Cases</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="holds">
                Holds
                {active.length > 0 && (
                  <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">
                    {active.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="checklist">
            {checklist ?? (
              <EmptySection icon={ShieldAlert} title="Onboarding checklist">
                <p>
                  The checklist (signed contract, deposit, colors, HOA approval, lead-safe plan,
                  paint order, crew, prep instructions) is built when the customer accepts the
                  estimate. Until then, use holds to show what the job is waiting on.
                </p>
              </EmptySection>
            )}
          </TabsContent>
          <TabsContent value="cases">
            <EmptySection icon={FolderOpen} title="Cases" phase={8}>
              <p>
                Customer issues and warranty requests get their own cases with Communication &amp;
                growth. For now, add a task or a note so nothing is missed.
              </p>
            </EmptySection>
          </TabsContent>
          <TabsContent value="tasks">{tasks}</TabsContent>
          <TabsContent value="holds">
            <HoldsPanel
              jobId={jobId}
              holds={holds}
              holdTypes={holdTypes}
              canEdit={canEdit}
              editReason={editReason}
            />
          </TabsContent>
        </Tabs>

        {jobSummary && (
          <aside
            className="rounded-2xl border bg-card p-4 xl:w-72"
            aria-labelledby="ob-job-summary"
          >
            <h3 id="ob-job-summary" className="mb-2 text-sm font-semibold">
              Job summary
            </h3>
            <dl className="flex flex-col gap-2 text-sm">
              {jobSummary.map((r) => (
                <div key={r.label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="text-right font-medium">{r.value}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Active holds</dt>
                <dd className="text-right font-medium">
                  {active.length ? active.map((h) => h.label).join(", ") : "None"}
                </dd>
              </div>
            </dl>
          </aside>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Ready to Schedule = every required item cleared and no blocking holds.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  caption,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: "warning";
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-2xl border bg-card p-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </div>
      <span
        className={
          tone === "warning"
            ? "grid size-8 shrink-0 place-items-center rounded-lg bg-warning-bg text-warning"
            : "grid size-8 shrink-0 place-items-center rounded-lg bg-bb-forest/10 text-bb-forest"
        }
      >
        <Icon className="size-4" aria-hidden />
      </span>
    </div>
  );
}
