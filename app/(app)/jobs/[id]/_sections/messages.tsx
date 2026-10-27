import { MessageSquareText } from "lucide-react";
import { EmptySection } from "@/components/jobs/empty-section";

/**
 * Stub so the Job Detail shell builds. The Sections work replaces this file
 * with the real Messages section (SPEC §8.5 #11).
 */
export async function MessagesSection({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  return (
    <EmptySection icon={MessageSquareText} title="Messages">
      <p data-job-id={jobId} data-can-edit={canEdit ? "true" : "false"}>
        Texts, emails and calls with the customer show here.
      </p>
    </EmptySection>
  );
}
