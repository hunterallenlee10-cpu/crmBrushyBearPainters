import { ClipboardList } from "lucide-react";
import { EmptySection } from "@/components/jobs/empty-section";
import { JOB_SECTIONS } from "@/lib/domain/jobs/constants";
import type { JobDetailData } from "./types";
import { Overview } from "./overview";
import { OnboardingWithChecklist } from "./onboarding-checklist";
import { FinancialSection } from "./financial-section";
import { EstimateSection } from "./estimate/section";
import { AdminSection } from "./admin-section";
import { PhotosSection } from "./photos/section";
import { DocumentsSection } from "./documents-section/section";
import { DailyLogsSection } from "./production/daily-logs-section";
import { PunchListSection } from "./production/punch-list-section";
import { ScheduleSection } from "./production/schedule-section";
import { WorkOrdersSection } from "./production/work-orders-section";
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
      body = <ScheduleSection data={data} />;
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
          readOnly={data.readOnly}
          initialTab={tab}
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
      body = <WorkOrdersSection data={data} />;
      break;
    case "daily-logs":
      body = <DailyLogsSection data={data} />;
      break;
    case "punch-list":
      body = <PunchListSection data={data} />;
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
