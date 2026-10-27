import Link from "next/link";
import {
  CalendarRange,
  Camera,
  ClipboardList,
  FileText,
  HardHat,
  ListTodo,
  NotebookPen,
  Ruler,
  Wallet,
} from "lucide-react";
import { EmptySection } from "@/components/jobs/empty-section";
import { JOB_SECTIONS } from "@/lib/domain/jobs/constants";
import type { JobDetailData } from "./types";
import { sectionHref } from "./utils";
import { Overview } from "./overview";
import { OnboardingSection } from "./onboarding-section";
import { AdminSection } from "./admin-section";
import { AppointmentsCard } from "./appointments-card";
import {
  ActivitySection,
  CustomerSection,
  MessagesSection,
  NotesSection,
  TasksSection,
} from "./_sections";

const linkClass = "text-sm font-semibold text-bb-forest underline";

/** Renders the section picked by `?section=` (SPEC §8.5). */
export function SectionContent({ data, tab }: { data: JobDetailData; tab?: string }) {
  const { job, can, section } = data;
  const title = JOB_SECTIONS.find((s) => s.id === section)?.label ?? "Overview";
  const editReason = data.readOnly
    ? "You're viewing as another user. Exit View as user to make changes."
    : !can.update
      ? "You can only change jobs you're on or that you own."
      : null;

  let body: React.ReactNode;
  switch (section) {
    case "overview":
      body = <Overview data={data} />;
      break;
    case "onboarding":
      body = (
        <OnboardingSection
          jobId={job.id}
          holds={data.holds}
          holdTypes={data.options.picklists.hold_type}
          canEdit={can.update}
          editReason={editReason}
          tasksDue={data.counts.tasksDue}
          openTasks={data.counts.openTasks}
          tasksHref={sectionHref(job.id, "tasks")}
          initialTab={tab}
        />
      );
      break;
    case "schedule":
      body = (
        <div className="flex flex-col gap-4">
          {can.readAppointments && (
            <AppointmentsCard
              jobId={job.id}
              appointments={data.appointments}
              users={data.options.users}
              defaultAssignee={job.ownerId ?? data.viewerId}
              canManage={can.manageAppointments}
              readOnly={data.readOnly}
            />
          )}
          <EmptySection icon={CalendarRange} title="Production schedule" phase={6}>
            <p>
              The production timeline, dispatch readiness and recommended crews arrive with the
              Master Schedule. Book walkthroughs, color consultations and final walkthroughs above
              today.
            </p>
          </EmptySection>
        </div>
      );
      break;
    case "estimate":
      body = (
        <EmptySection icon={Ruler} title="Estimate & scope" phase={4}>
          <p>
            Build the estimate room by room, pick colors, and send the proposal for signature. Until
            then, an owner can record a contract baseline in Admin.
          </p>
        </EmptySection>
      );
      break;
    case "financial":
      body = (
        <EmptySection icon={Wallet} title="Financial" phase={7}>
          <p>
            {can.readFinancials
              ? "Invoices, payments, the money summary and job costing arrive with Money. The contract baseline shows on the Overview."
              : "Invoices and payments arrive with Money. Your role doesn't include job money."}
          </p>
        </EmptySection>
      );
      break;
    case "photos":
      body = (
        <EmptySection
          icon={Camera}
          title="Photos"
          phase={5}
          action={
            job.leadId ? (
              <Link href={`/leads/${job.leadId}`} className={linkClass}>
                See the photos on the original lead
              </Link>
            ) : undefined
          }
        >
          <p>
            Before, progress and after photos with the required-shot checklist.
            {job.leadId && " Photos the customer sent with their request stay on the lead."}
          </p>
        </EmptySection>
      );
      break;
    case "documents":
      body = (
        <EmptySection icon={FileText} title="Documents" phase={5}>
          <p>
            Proposals, contracts, HOA approvals and lead-safe paperwork get stored here. Keep
            anything important in a note for now.
          </p>
        </EmptySection>
      );
      break;
    case "work-orders":
      body = (
        <EmptySection icon={HardHat} title="Work orders" phase={6}>
          <p>
            Prep, paint and touch-up work orders for crews and subcontractors, plus paint orders.
          </p>
        </EmptySection>
      );
      break;
    case "daily-logs":
      body = (
        <EmptySection icon={NotebookPen} title="Daily logs" phase={6}>
          <p>
            Crew leads post what got done, what&apos;s next and cleanup photos each production day.
          </p>
        </EmptySection>
      );
      break;
    case "punch-list":
      body = (
        <EmptySection icon={ListTodo} title="Punch list" phase={6}>
          <p>Touch-up items by area with photos, and the customer&apos;s sign-off.</p>
        </EmptySection>
      );
      break;
    case "customer":
      body = <CustomerSection jobId={job.id} canEdit={can.update} />;
      break;
    case "messages":
      body = <MessagesSection jobId={job.id} canEdit={can.update} />;
      break;
    case "tasks":
      body = <TasksSection jobId={job.id} canEdit={can.update} />;
      break;
    case "notes":
      body = <NotesSection jobId={job.id} canEdit={can.update} />;
      break;
    case "activity":
      body = <ActivitySection jobId={job.id} canEdit={can.update} />;
      break;
    case "admin":
      body = (
        <AdminSection
          jobId={job.id}
          stage={job.stage}
          gate={data.gate}
          milestones={job.milestones}
          promisedStartDate={job.promisedStartDate}
          contractCents={data.contractBaselineCents}
          canSeeMoney={can.readFinancials}
          onTimeStatus={job.onTimeStatus}
          activeHoldCount={data.holds.filter((h) => !h.releasedAt).length}
          canEdit={can.override && can.update}
        />
      );
      break;
    default:
      body = (
        <EmptySection icon={ClipboardList} title={title}>
          <p>This section isn&apos;t available.</p>
        </EmptySection>
      );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 id="job-section-title" className="text-lg font-semibold">
        {title}
      </h2>
      {body}
    </div>
  );
}
