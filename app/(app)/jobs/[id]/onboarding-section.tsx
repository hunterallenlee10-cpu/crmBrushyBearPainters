"use client";

import * as React from "react";
import Link from "next/link";
import { CirclePause, ClipboardList, FolderOpen, ListChecks, ShieldAlert } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptySection } from "@/components/jobs/empty-section";
import type { Option } from "@/lib/leads/service";
import type { HoldItem } from "./types";
import { HoldsPanel } from "./holds-panel";

const TABS = ["checklist", "holds", "cases", "tasks"] as const;
type Tab = (typeof TABS)[number];

/**
 * Onboarding (SPEC §8.5 #2): the requirement checklist (seeded on acceptance,
 * verified in Phase 5) and holds. Footnote per SPEC §6.4.
 */
export function OnboardingSection({
  jobId,
  holds,
  holdTypes,
  canEdit,
  editReason,
  tasksDue,
  openTasks,
  tasksHref,
  initialTab,
  checklist,
  progress,
}: {
  jobId: string;
  holds: HoldItem[];
  holdTypes: Option[];
  canEdit: boolean;
  editReason: string | null;
  tasksDue: number | null;
  openTasks: number | null;
  tasksHref: string;
  initialTab: string | undefined;
  /** The requirement checklist, once the estimate is accepted (rendered on the server). */
  checklist?: React.ReactNode;
  progress?: { required: number; cleared: number } | null;
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

  const select = (next: string) => {
    const t = next as Tab;
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Checklist progress"
          value={progress ? `${progress.cleared}/${progress.required}` : "—"}
          caption={progress ? "Required items cleared" : "Starts when the estimate is accepted"}
          icon={ClipboardList}
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
        <Tile label="Open cases" value="—" caption="Arrives in Phase 5" icon={FolderOpen} />
        <Tile
          label="Tasks due"
          value={tasksDue === null ? "—" : String(tasksDue)}
          caption={openTasks === null ? "Not available to you" : `${openTasks} open in total`}
          icon={ListChecks}
        />
      </div>

      <Tabs value={tab} onValueChange={select} className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList aria-label="Onboarding">
            <TabsTrigger value="checklist">Checklist</TabsTrigger>
            <TabsTrigger value="holds">
              Holds
              {active.length > 0 && (
                <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">
                  {active.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="cases">Cases</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="checklist">
          {checklist ?? (
            <EmptySection icon={ShieldAlert} title="Onboarding checklist">
              <p>
                The checklist (signed contract, deposit, colors, HOA approval, lead-safe plan, paint
                order, crew, prep instructions) is built when the customer accepts the estimate.
                Until then, use holds to show what the job is waiting on.
              </p>
            </EmptySection>
          )}
        </TabsContent>
        <TabsContent value="holds">
          <HoldsPanel
            jobId={jobId}
            holds={holds}
            holdTypes={holdTypes}
            canEdit={canEdit}
            editReason={editReason}
          />
        </TabsContent>
        <TabsContent value="cases">
          <EmptySection icon={FolderOpen} title="Cases" phase={5}>
            <p>
              Customer issues and warranty requests get their own cases. For now, add a task or a
              note so nothing is missed.
            </p>
          </EmptySection>
        </TabsContent>
        <TabsContent value="tasks">
          <EmptySection
            icon={ListChecks}
            title="Onboarding tasks"
            action={
              <Link href={tasksHref} className="text-sm font-semibold text-bb-forest underline">
                Open Tasks &amp; Checklists
              </Link>
            }
          >
            <p>Follow-ups for this job live in Tasks &amp; Checklists.</p>
          </EmptySection>
        </TabsContent>
      </Tabs>

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
