import { UsersRound } from "lucide-react";
import { EmptySection } from "@/components/jobs/empty-section";

/**
 * Stub so the Job Detail shell builds. The Sections work replaces this file
 * with the real Customer section (SPEC §8.5 #10).
 */
export async function CustomerSection({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  return (
    <EmptySection icon={UsersRound} title="Customer">
      <p data-job-id={jobId} data-can-edit={canEdit ? "true" : "false"}>
        The customer&apos;s account, property, team and contacts show here.
      </p>
    </EmptySection>
  );
}
