import { History } from "lucide-react";
import { EmptySection } from "@/components/jobs/empty-section";

/**
 * Stub so the Job Detail shell builds. The Sections work replaces this file
 * with the real Activity Log section (SPEC §8.5 #15).
 */
export async function ActivitySection({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  return (
    <EmptySection icon={History} title="Activity Log">
      <p data-job-id={jobId} data-can-edit={canEdit ? "true" : "false"}>
        Everything that happened on this job shows here.
      </p>
    </EmptySection>
  );
}
