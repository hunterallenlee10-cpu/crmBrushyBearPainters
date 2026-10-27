import { ListChecks } from "lucide-react";
import { EmptySection } from "@/components/jobs/empty-section";

/**
 * Stub so the Job Detail shell builds. The Sections work replaces this file
 * with the real Tasks & Checklists section (SPEC §8.5 #12).
 */
export async function TasksSection({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  return (
    <EmptySection icon={ListChecks} title="Tasks & Checklists">
      <p data-job-id={jobId} data-can-edit={canEdit ? "true" : "false"}>
        Follow-ups and checklists for this job show here.
      </p>
    </EmptySection>
  );
}
