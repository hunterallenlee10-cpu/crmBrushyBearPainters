"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarPlus,
  ChevronRight,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Phone,
  Printer,
  Repeat2,
  Trash2,
  Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HotIcon, LeadStatusBadge } from "@/components/leads/lead-badges";
import { LeadAvatar } from "@/components/leads/lead-avatar";
import { ReasonButton } from "@/components/leads/reason-button";
import { ScoreSummary } from "@/components/leads/score-summary";
import { formatDate } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { contactBlockReason, type ContactChannel } from "@/lib/leads/messaging";
import { makeLabeler } from "./labels";
import type { LeadDetailData } from "./types";
import type { LeadTab } from "./utils";
import { DetailsTab } from "./details-tab";
import { ActivityTab, type ComposerMode } from "./activity-tab";
import { NotesTab } from "./notes-tab";
import { CommentsTab } from "./comments-tab";
import { TasksTab } from "./tasks-tab";
import { EditLeadDialog } from "./edit-lead-dialog";
import { StatusDialog } from "./status-dialog";
import { BookWalkthroughDialog } from "./book-walkthrough-dialog";
import { DeleteLeadDialog } from "./delete-lead-dialog";
import { ConvertDialog, useConversionInfo } from "./convert-dialog";
import { ConvertedBanner, jobNumberFromThread } from "./converted-banner";

type DialogName = "edit" | "status" | "book" | "delete" | "convert" | null;

/** Lead Detail (SPEC §8.4): sticky header with actions, then tabs. */
export function LeadDetail({ data }: { data: LeadDetailData }) {
  const { lead, can } = data;
  const label = React.useMemo(() => makeLabeler(data.options), [data.options]);
  const [tab, setTab] = React.useState<LeadTab>(data.initialTab);
  const [dialog, setDialog] = React.useState<DialogName>(null);
  const [composer, setComposer] = React.useState<{ mode: ComposerMode; nonce: number }>({
    mode: "sms",
    nonce: 0,
  });
  const converted = lead.status === "converted";
  const conversion = useConversionInfo(lead.id, converted);
  const jobNumber = conversion.job?.number ?? jobNumberFromThread(data.thread);
  const convertedReason = `This lead is now job ${jobNumber ?? "(see the job)"}. Make changes on the job.`;

  // Convert to Job needs edit rights on the lead and permission to create jobs.
  const convertReason: string | null = data.readOnly
    ? "You're viewing as another user. Exit View as user to convert."
    : !can.update
      ? "You can only convert leads you can edit."
      : conversion.loading
        ? "Checking your permissions…"
        : !conversion.canCreateJobs
          ? "You don't have permission to create jobs."
          : lead.status === "lost" || lead.status === "unqualified"
            ? "Reopen the lead (change its status) before converting it."
            : conversion.workTypes.length === 0
              ? "No work types are set up. Add them in Admin → Field Picklists."
              : null;

  // Tabs are linkable (?tab=…) without a server round trip.
  const selectTab = React.useCallback((next: string) => {
    const t = next as LeadTab;
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "details") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  // /leads/<id>?book=1 (from the New Lead wizard) opens Book Walkthrough once.
  React.useEffect(() => {
    if (!data.openBooking) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("book");
    window.history.replaceState(window.history.state, "", url);
    if (can.update && !converted) setDialog("book");
  }, [data.openBooking, can.update, converted]);

  const reasonFor = (channel: ContactChannel): string | null => {
    if (data.readOnly) return "You're viewing as another user. Exit View as user to reach out.";
    if (!can.send) return "You don't have permission to contact customers.";
    return contactBlockReason(lead, channel);
  };

  const openComposer = (mode: ComposerMode) => {
    selectTab("activity");
    setComposer((c) => ({ mode, nonce: c.nonce + 1 }));
  };

  const phone = lead.mobile ?? lead.phone;
  const openTasks = data.tasks.filter((t) => t.status === "open").length;

  return (
    <div className="flex flex-col gap-5">
      <header className="z-30 -mx-4 -mt-6 border-b bg-background/95 px-4 pt-4 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-6 sm:px-6 lg:sticky lg:top-14 print:static">
        <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted-foreground print:hidden">
          <ol className="flex items-center gap-1">
            <li>
              <Link href="/leads" className="hover:underline">
                Leads
              </Link>
            </li>
            <ChevronRight className="size-3" aria-hidden />
            <li>
              <Link href="/leads/list" className="hover:underline">
                Lead List
              </Link>
            </li>
            <ChevronRight className="size-3" aria-hidden />
            <li aria-current="page" className="max-w-48 truncate">
              {lead.name}
            </li>
          </ol>
        </nav>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <LeadAvatar initials={lead.initials} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="text-2xl font-bold tracking-tight break-words text-bb-ink">
                  {lead.name}
                </h1>
                <HotIcon temperature={lead.temperature} />
                <LeadStatusBadge status={lead.status} />
                <ScoreSummary
                  grade={lead.grade}
                  score={lead.score}
                  temperature={lead.temperature}
                />
              </div>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                {phone && (
                  <a href={`tel:${phone}`} className="tabular-nums hover:underline">
                    {formatPhone(phone)}
                  </a>
                )}
                {lead.company && <span>{lead.company}</span>}
                <span>Owner: {lead.ownerName ?? "Unassigned"}</span>
                <span>Created {formatDate(lead.createdAt)}</span>
              </p>
            </div>
          </div>

          <div
            className="flex flex-wrap gap-2 xl:shrink-0 xl:flex-nowrap print:hidden"
            aria-label="Lead actions"
            role="group"
          >
            <ReasonButton
              size="sm"
              variant="outline"
              disabledReason={reasonFor("call")}
              onClick={() => openComposer("call")}
            >
              <Phone aria-hidden />
              Call
            </ReasonButton>
            <ReasonButton
              size="sm"
              variant="outline"
              disabledReason={reasonFor("sms")}
              onClick={() => openComposer("sms")}
            >
              <MessageSquareText aria-hidden />
              SMS
            </ReasonButton>
            <ReasonButton
              size="sm"
              variant="outline"
              disabledReason={reasonFor("email")}
              onClick={() => openComposer("email")}
            >
              <Mail aria-hidden />
              Email
            </ReasonButton>
            {!converted && (
              <ReasonButton
                size="sm"
                variant="cta"
                disabledReason={convertReason}
                onClick={() => setDialog("convert")}
              >
                <Briefcase aria-hidden />
                Convert to Job
              </ReasonButton>
            )}
            {can.update && converted && (
              <>
                <ReasonButton size="sm" variant="outline" disabledReason={convertedReason}>
                  <CalendarPlus aria-hidden />
                  Book walkthrough
                </ReasonButton>
                <ReasonButton size="sm" variant="outline" disabledReason={convertedReason}>
                  <Repeat2 aria-hidden />
                  Change status
                </ReasonButton>
                <ReasonButton size="sm" variant="outline" disabledReason={convertedReason}>
                  <Pencil aria-hidden />
                  Edit lead
                </ReasonButton>
              </>
            )}
            {can.update && !converted && (
              <>
                <Button size="sm" variant="outline" onClick={() => setDialog("book")}>
                  <CalendarPlus aria-hidden />
                  Book walkthrough
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog("status")}>
                  <Repeat2 aria-hidden />
                  Change status
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog("edit")}>
                  <Pencil aria-hidden />
                  Edit lead
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="outline" aria-label="More actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => window.print()}>
                  <Printer aria-hidden />
                  Print
                </DropdownMenuItem>
                {can.delete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
                      <Trash2 aria-hidden />
                      Delete lead…
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {converted && (
        <ConvertedBanner
          jobId={conversion.job?.id ?? null}
          jobNumber={jobNumber}
          loading={conversion.loading}
        />
      )}

      <Tabs value={tab} onValueChange={selectTab} className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1 print:hidden">
          <TabsList aria-label="Lead sections">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            {can.readNotes && (
              <TabsTrigger value="notes">
                Notes{data.notes.length > 0 && <Count n={data.notes.length} />}
              </TabsTrigger>
            )}
            {can.readNotes && (
              <TabsTrigger value="comments">
                Comments{data.comments.length > 0 && <Count n={data.comments.length} />}
              </TabsTrigger>
            )}
            {can.readTasks && (
              <TabsTrigger value="tasks">
                Tasks{openTasks > 0 && <Count n={openTasks} />}
              </TabsTrigger>
            )}
          </TabsList>
        </div>
        <TabsContent value="details">
          <DetailsTab data={data} label={label} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab data={data} label={label} composer={composer} reasonFor={reasonFor} />
        </TabsContent>
        {can.readNotes && (
          <TabsContent value="notes">
            <NotesTab data={data} />
          </TabsContent>
        )}
        {can.readNotes && (
          <TabsContent value="comments">
            <CommentsTab data={data} />
          </TabsContent>
        )}
        {can.readTasks && (
          <TabsContent value="tasks">
            <TasksTab data={data} />
          </TabsContent>
        )}
      </Tabs>

      {can.update && !converted && (
        <>
          <ConvertDialog
            open={dialog === "convert"}
            onOpenChange={(o) => setDialog(o ? "convert" : null)}
            data={data}
            workTypes={conversion.workTypes}
          />
          <EditLeadDialog
            open={dialog === "edit"}
            onOpenChange={(o) => setDialog(o ? "edit" : null)}
            data={data}
          />
          <StatusDialog
            open={dialog === "status"}
            onOpenChange={(o) => setDialog(o ? "status" : null)}
            data={data}
          />
          <BookWalkthroughDialog
            open={dialog === "book"}
            onOpenChange={(o) => setDialog(o ? "book" : null)}
            data={data}
          />
        </>
      )}
      {can.delete && (
        <DeleteLeadDialog
          open={dialog === "delete"}
          onOpenChange={(o) => setDialog(o ? "delete" : null)}
          leadId={lead.id}
          leadName={lead.name}
        />
      )}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">
      {n}
    </span>
  );
}
