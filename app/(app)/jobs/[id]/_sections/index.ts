/**
 * Job Detail sections built alongside the shell (SPEC §8.5): Customer,
 * Messages, Tasks & Checklists, Notes and Activity Log. Each is an async
 * Server Component taking `{ jobId, canEdit }`; the page renders them for
 * `?section=customer|messages|tasks|notes|activity`.
 */
export { CustomerSection } from "./customer";
export { MessagesSection } from "./messages";
export { TasksSection } from "./tasks";
export { NotesSection } from "./notes";
export { ActivitySection } from "./activity";
