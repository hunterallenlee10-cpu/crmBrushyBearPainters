import { CalendarRange, ClipboardList, HardHat, ListTodo, NotebookPen } from "lucide-react";
import { EmptySection } from "@/components/jobs/empty-section";
import { JOB_SECTIONS } from "@/lib/domain/jobs/constants";
import type { JobDetailData } from "./types";
import { Overview } from "./overview";
import { OnboardingWithChecklist } from "./onboarding-checklist";
import { FinancialSection } from "./financial-section";
import { EstimateSection } from "./estimate/section";
import { AdminSection } from "./admin-section";
import { AppointmentsCard } from "./appointments-card";
import { PhotosSection } from "./photos/section";
import { DocumentsSection } from "./documents-section/section";
import {
  ActivitySection,
  CustomerSection,
  MessagesSection,
  NotesSection,
  TasksSection,
} from "./_sections";

/** Renders the section picked by `?section=` (SPEC §8.5). */
export function SectionContent({
  data,
  tab,
  limit,
}: {
  data: JobDetailData;
  tab?: string;
  limit?: number;
}) {
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
        <OnboardingWithChecklist
          data={data}
          users={data.options.users}
          jobId={job.id}
          holds={data.holds}
          holdTypes={data.options.picklists.hold_type}
          canEdit={can.update}
          editReason={editReason}
          tasksDue={data.counts.tasksDue}
          openTasks={data.counts.openTasks}
          initialTab={tab}
          tasks={<TasksSection jobId={job.id} canEdit={can.update} />}
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
        <EstimateSection
          jobId={job.id}
          can={{
            readEstimates: can.readEstimates,
            editEstimates: can.editEstimates,
            sendEstimates: can.sendEstimates,
            draftChangeOrders: can.draftChangeOrders,
            readDocuments: can.readDocuments,
          }}
        />
      );
      break;
    case "financial":
      body = (
        <FinancialSection
          jobId={job.id}
          canReadInvoices={can.readInvoices}
          canReadFinancials={can.readFinancials}
        />
      );
      break;
    case "photos":
      body = (
        <PhotosSection
          jobId={job.id}
          workTypes={job.workTypes}
          viewerId={data.viewerId}
          contactFirstName={job.contact?.name.split(/\s+/)[0] ?? null}
          limit={limit}
          can={{
            read: can.readPhotos,
            upload: can.uploadPhotos,
            delete: can.deletePhotos,
            share: can.sendMessages && can.update,
            edit: can.update,
          }}
        />
      );
      break;
    case "documents":
      body = (
        <DocumentsSection
          jobId={job.id}
          accountId={job.accountId}
          canRead={can.readDocuments}
          canManage={can.manageDocuments && can.update}
        />
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
