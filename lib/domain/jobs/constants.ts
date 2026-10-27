/**
 * Job labels and fixed choices shared by screens, actions and tests
 * (SPEC §5.3, §5.4, §6.3). Admin-editable choices (work types, hold types,
 * lost reasons) are picklists, not listed here.
 */

export const JOB_PRIORITIES = ["normal", "high", "urgent"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];
export const JOB_PRIORITY_LABELS: Record<JobPriority, string> = {
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const JOB_STATUSES = ["open", "on_hold", "won", "lost"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  open: "Open",
  on_hold: "On hold",
  won: "Won",
  lost: "Lost",
};

export const TEAM_ROLES = [
  "estimator",
  "point_of_contact",
  "project_manager",
  "office",
  "painter",
] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  estimator: "Estimator",
  point_of_contact: "Point of contact",
  project_manager: "Project manager / crew lead",
  office: "Office",
  painter: "Painter",
};

/** Scheduling work types (SPEC §15.1) with default lengths in minutes. */
export const APPOINTMENT_TYPES = [
  "walkthrough",
  "color_consultation",
  "interior_production",
  "exterior_production",
  "cabinet_shop",
  "deck_fence",
  "pressure_washing",
  "rot_repair",
  "final_walkthrough",
  "touch_up",
  "warranty_visit",
  "paint_pickup",
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  walkthrough: "Walkthrough / Estimate",
  color_consultation: "Color consultation",
  interior_production: "Interior production day",
  exterior_production: "Exterior production day",
  cabinet_shop: "Cabinet spray / shop day",
  deck_fence: "Deck & fence day",
  pressure_washing: "Pressure washing",
  rot_repair: "Rot repair",
  final_walkthrough: "Final walkthrough",
  touch_up: "Touch-up visit",
  warranty_visit: "Warranty visit",
  paint_pickup: "Paint pickup",
};
export const APPOINTMENT_DEFAULT_MINUTES: Record<AppointmentType, number> = {
  walkthrough: 60,
  color_consultation: 60,
  interior_production: 480,
  exterior_production: 480,
  cabinet_shop: 480,
  deck_fence: 480,
  pressure_washing: 240,
  rot_repair: 240,
  final_walkthrough: 45,
  touch_up: 120,
  warranty_visit: 60,
  paint_pickup: 60,
};
/** Appointment types people can book from a job (production days come from the Master Schedule). */
export const BOOKABLE_APPOINTMENT_TYPES = [
  "walkthrough",
  "color_consultation",
  "final_walkthrough",
  "touch_up",
  "warranty_visit",
] as const satisfies readonly AppointmentType[];

export const APPOINTMENT_STATUSES = [
  "tentative",
  "scheduled",
  "confirmed",
  "in_progress",
  "completed",
  "no_show",
  "rescheduled",
  "canceled",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  tentative: "Tentative",
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  no_show: "No-show",
  rescheduled: "Rescheduled",
  canceled: "Canceled",
};

export const WALKTHROUGH_RESULTS = [
  "measured",
  "needs_second_visit",
  "customer_no_show",
  "not_a_fit",
] as const;
export type WalkthroughResult = (typeof WALKTHROUGH_RESULTS)[number];
export const WALKTHROUGH_RESULT_LABELS: Record<WalkthroughResult, string> = {
  measured: "Measured",
  needs_second_visit: "Needs a second visit",
  customer_no_show: "Customer no-show",
  not_a_fit: "Not a fit",
};

/** Milestone dates (SPEC §6.3), in pipeline order, editable only in the job's Admin section. */
export const MILESTONE_FIELDS = [
  ["lead_created_at", "Lead created"],
  ["first_contact_at", "First contact"],
  ["walkthrough_scheduled_at", "Walkthrough scheduled"],
  ["walkthrough_completed_at", "Walkthrough completed"],
  ["estimate_sent_at", "Estimate sent"],
  ["estimate_accepted_at", "Estimate accepted"],
  ["contract_signed_at", "Contract signed"],
  ["deposit_paid_at", "Deposit paid"],
  ["onboarding_started_at", "Onboarding started"],
  ["onboarding_completed_at", "Onboarding completed"],
  ["ready_to_schedule_at", "Ready to schedule"],
  ["scheduled_at", "Scheduled"],
  ["work_completed_at", "Work completed"],
  ["final_walkthrough_at", "Final walkthrough"],
  ["completed_at", "Completed"],
  ["final_invoiced_at", "Final invoice sent"],
  ["paid_in_full_at", "Paid in full"],
  ["closed_at", "Closed"],
  ["lost_at", "Lost"],
] as const;
export type MilestoneField = (typeof MILESTONE_FIELDS)[number][0];

export const ON_TIME_STATUSES = [
  "n/a",
  "met",
  "missed_weather",
  "missed_credit_pending",
  "credit_applied",
  "waived_by_owner",
] as const;
export type OnTimeStatus = (typeof ON_TIME_STATUSES)[number];
export const ON_TIME_STATUS_LABELS: Record<OnTimeStatus, string> = {
  "n/a": "Not applicable",
  met: "Met",
  missed_weather: "Missed (weather)",
  missed_credit_pending: "Missed (credit pending)",
  credit_applied: "Credit applied",
  waived_by_owner: "Waived by owner",
};

/**
 * The 16 Job Detail sections (SPEC §8.5), in order. `phase` is when the
 * section gets its real content; earlier it shows a friendly empty state.
 */
export const JOB_SECTIONS = [
  { id: "overview", label: "Overview", phase: 3 },
  { id: "onboarding", label: "Onboarding", phase: 5 },
  { id: "schedule", label: "Schedule", phase: 6 },
  { id: "estimate", label: "Estimate & Scope", phase: 4 },
  { id: "financial", label: "Financial", phase: 7 },
  { id: "photos", label: "Photos", phase: 5 },
  { id: "documents", label: "Documents", phase: 5 },
  { id: "work-orders", label: "Work Orders", phase: 6 },
  { id: "daily-logs", label: "Daily Logs", phase: 6 },
  { id: "customer", label: "Customer", phase: 3 },
  { id: "messages", label: "Messages", phase: 3 },
  { id: "tasks", label: "Tasks & Checklists", phase: 3 },
  { id: "punch-list", label: "Punch List", phase: 6 },
  { id: "notes", label: "Notes", phase: 3 },
  { id: "activity", label: "Activity Log", phase: 3 },
  { id: "admin", label: "Admin", phase: 3 },
] as const;
export type JobSectionId = (typeof JOB_SECTIONS)[number]["id"];
