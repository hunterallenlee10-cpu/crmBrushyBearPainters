import { StickyNote } from "lucide-react";
import { EmptySection } from "@/components/jobs/empty-section";

/**
 * Stub so the Job Detail shell builds. The Sections work replaces this file
 * with the real Notes section (SPEC §8.5 #14).
 */
export async function NotesSection({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  return (
    <EmptySection icon={StickyNote} title="Notes">
      <p data-job-id={jobId} data-can-edit={canEdit ? "true" : "false"}>
        Notes and team comments on this job show here.
      </p>
    </EmptySection>
  );
}
