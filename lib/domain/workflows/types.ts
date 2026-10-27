import type { MergeContext } from "@/lib/domain/templates/merge";

/**
 * Workflow engine types (SPEC §11.1). A workflow is system-defined (catalog.ts):
 * one or more triggers (event type + conditions) → ordered actions. The
 * database keeps only its on/off switch and the run log (`workflow_runs`).
 */

export type ConditionOp =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "exists"
  | "missing"
  | "truthy"
  | "falsy"
  | "includes"
  | "excludes"
  | "gte"
  | "lte";

export type ConditionValue = string | number | boolean | null | readonly (string | number)[];

/** A test on the run's context, e.g. `{ field: "event.payload.to", op: "eq", value: "sold" }`. */
export type Condition = { field: string; op: ConditionOp; value?: ConditionValue; label?: string };

export type Duration = { minutes?: number; hours?: number; days?: number };

/** Company settings a wait can read its length from (Admin → Reviews / Referral Program). */
export type DurationSetting = "review_delay_days" | "referral_invite_delay_days";

export type SendChannel = "sms" | "email" | "sms_or_email" | "email_or_sms" | "sms_and_email";

/** People a staff notice or task can go to (resolved by the server per run). */
export const AUDIENCES = [
  "owners",
  "schedulers",
  "finance",
  "job_owner",
  "point_of_contact",
  "project_manager",
  "crew_lead",
  "crew",
  "lead_owner",
] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<Audience, string> = {
  owners: "the owners",
  schedulers: "whoever publishes the schedule",
  finance: "whoever records payments",
  job_owner: "the job's estimator",
  point_of_contact: "the point of contact",
  project_manager: "the project manager",
  crew_lead: "the crew lead",
  crew: "the crew",
  lead_owner: "the lead's owner",
};

/** Fields a workflow may change (SPEC §11.1 "change field (allow-listed)"). */
export const SETTABLE_FIELDS = {
  "lead.status": { table: "leads", column: "status", values: ["nurture", "contacted"] },
  "lead.nurture_until": { table: "leads", column: "nurture_until", values: null },
  "job.priority": { table: "jobs", column: "priority", values: ["normal", "high", "urgent"] },
} as const;
export type SettableField = keyof typeof SETTABLE_FIELDS;

type Base = {
  /** Stable id within the workflow (run logs refer to it). */
  id: string;
  /** Plain-words summary shown on the workflow page. */
  label: string;
  /** Only run this step when every condition holds. */
  when?: readonly Condition[];
};

export type SendAction = Base & {
  kind: "send";
  template: string;
  channel: SendChannel;
  to: "customer" | "crew_lead" | "subcontractor";
  /**
   * Something to prepare right before sending: a fresh proposal link, a tracked
   * review link (creates the review request), or the customer's champion code.
   */
  prepare?: "estimate_link" | "review_link" | "referral_code";
  /** After a successful send, record it on the record that caused it. */
  record?: "daily_log_update" | "rain_delay_message";
};

export type NotifyAction = Base & {
  kind: "notify";
  audience: readonly Audience[];
  /** Internal template: the email subject is the title, the SMS body the text. */
  template: string;
  notificationType: string;
  /** Leave out people the built-in stage notice already told (owner, point of contact, PM). */
  excludeJobPeople?: boolean;
};

export type TaskAction = Base & {
  kind: "task";
  /** Merge fields allowed. */
  title: string;
  dueIn: Duration;
  assignee: readonly Audience[];
  priority: "low" | "normal" | "high";
};

export type AttentionAction = Base & {
  kind: "attention";
  title: string;
  priority: "critical" | "high" | "medium" | "low";
  category: "communication" | "tasks" | "scheduling" | "sales" | "production" | "qa" | "customer";
};

export type HoldAction = Base & {
  kind: "hold";
  mode: "add" | "release";
  holdType: string;
  reason: string;
};

export type SetFieldAction = Base & {
  kind: "set_field";
  field: SettableField;
  /** A literal, or `{ days: n }` for a date n days from now (Pacific). */
  value: string | { days: number };
};

export type EnrollDripAction = Base & {
  kind: "enroll_drip";
  drip: string;
  subject: "lead" | "contact" | "job";
};

export type AssignOwnerAction = Base & {
  kind: "assign_owner";
  strategy: "territory_round_robin";
};

export type CalendarAction = Base & { kind: "calendar" };

export type WaitAction = Base & {
  kind: "wait";
  /** Wait a fixed time (days may come from a setting). */
  for?: Duration;
  setting?: DurationSetting;
  /** Or wait until a time taken from the context (e.g. 24 h before the appointment). */
  until?: {
    field: string;
    offset?: Duration;
    /** Negative offset ("before"). */
    before?: boolean;
    /** Use this Pacific clock time on the resulting day (e.g. "16:00" the day before). */
    atPacificTime?: string;
  };
  /** When the time has already passed: skip the next step (a reminder that's too late) or go on. */
  ifPast?: "skip_next" | "continue";
};

export type WebhookAction = Base & { kind: "webhook"; url: string };

export type WorkflowAction =
  | SendAction
  | NotifyAction
  | TaskAction
  | AttentionAction
  | HoldAction
  | SetFieldAction
  | EnrollDripAction
  | AssignOwnerAction
  | CalendarAction
  | WaitAction
  | WebhookAction;

export type WorkflowSubject =
  | "lead"
  | "job"
  | "appointment"
  | "estimate"
  | "daily_log"
  | "invoice"
  | "subcontractor"
  | "rain_delay";

export type WorkflowTrigger = {
  event: string;
  when?: readonly Condition[];
  /** Where the subject's id is: the event's aggregate id (default) or a payload field. */
  subjectFrom?: "aggregate" | { payload: string };
  /** Payload for a dry run against a chosen record. */
  testPayload?: Record<string, string | number | boolean>;
};

export type WorkflowDefinition = {
  key: string;
  /** SPEC §11.2 number. */
  number: number;
  name: string;
  description: string;
  /** Shown like "Estimate.ACCEPTED". */
  triggerLabel: string;
  subject: WorkflowSubject;
  triggers: readonly WorkflowTrigger[];
  /** What already happens without this workflow (stage engine, holds, attention rules). */
  builtIn: readonly string[];
  actions: readonly WorkflowAction[];
  /** Checked before each step after the first: any one true stops the run. */
  exitWhen?: readonly Condition[];
  /** Plain words for exitWhen. */
  exitLabel?: string;
};

// --- Run context ----------------------------------------------------------------

export type Recipient = {
  kind: "contact" | "lead" | "staff" | "subcontractor";
  id: string | null;
  name: string;
  mobile: string | null;
  email: string | null;
  doNotContact: boolean;
  smsOptedOut: boolean;
  emailOptedOut: boolean;
  /** Explicit marketing opt-in (contacts); null when there's no record of one (leads). */
  smsOptIn: boolean | null;
  emailOptIn: boolean | null;
};

export type Person = { id: string; name: string };

/** Everything a run can read: merge fields plus routing facts. Built by the server. */
export type RunContext = {
  /** Merge-field context (contact, company, job, appointment, …). */
  merge: MergeContext;
  /** Conditions read from here too (event.payload.*, job.stage, …); same object as merge plus extras. */
  facts: MergeContext;
  recipients: {
    customer: Recipient | null;
    crew_lead: Recipient | null;
    subcontractor: Recipient | null;
  };
  people: Partial<Record<Audience, readonly Person[]>>;
  /** The customer texted us within the window: quiet hours don't apply to replies. */
  customerInitiated: boolean;
};

export type QuietHours = {
  enabled: boolean;
  /** "HH:MM" Pacific. */
  start: string;
  end: string;
};

export type EngineSettings = {
  quietHours: QuietHours;
  reviewDelayDays: number;
  referralInviteDelayDays: number;
};

export type TemplateRecord = {
  key: string;
  channel: "sms" | "email";
  subject: string | null;
  body: string;
  active: boolean;
  status: "draft" | "approved";
  messageType: "transactional" | "marketing";
};

export type TemplateLookup = (key: string, channel: "sms" | "email") => TemplateRecord | null;
