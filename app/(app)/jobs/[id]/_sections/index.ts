/**
 * Job Detail sections built alongside the page shell (SPEC §8.5 #10–12, #14, #15).
 * Each is an async Server Component: ({ jobId, canEdit }) => ReactNode, loading
 * its own data with the viewer's Supabase client. `canEdit` = the viewer may
 * edit this job and isn't viewing as someone else. The page renders them at
 * /jobs/<id>?section=customer|messages|tasks|notes|activity.
 */
export { CustomerSection } from "./customer-section";
export { ActivitySection, MessagesSection, NotesSection, TasksSection } from "./sections";
