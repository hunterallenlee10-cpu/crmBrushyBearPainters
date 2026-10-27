import type { Condition, WorkflowDefinition } from "./types";

/**
 * The 17 seeded workflows of SPEC §11.2 (all ON). System-defined: the
 * definitions live here, versioned with the code; the database keeps each
 * one's switch (`workflows.enabled`) and its runs (`workflow_runs`).
 *
 * One source of truth for customer messages: the built-in automations that
 * used to send directly (schedule notices, rain-delay text, daily updates,
 * overdue reminders, the on-time credit notice) now raise their event and the
 * matching workflow sends. Turning a workflow off stops those messages.
 * Stage moves, holds, invoices and attention rules stay built in (they are
 * business rules and gates, not messages); each workflow lists them under
 * "Built in".
 *
 * Every workflow here has a dry-run test in catalog.test.ts.
 */

const stageIs = (stage: string): Condition => ({
  field: "event.payload.to",
  op: "eq",
  value: stage,
  label: `the job moved to ${stage.replace(/_/g, " ")}`,
});

const notifyCustomer: Condition = {
  field: "schedule.notify_customer",
  op: "truthy",
  label: "the scheduler chose to tell the customer",
};

export const WORKFLOWS: readonly WorkflowDefinition[] = [
  {
    key: "lead_text_back",
    number: 1,
    name: "New web lead → instant text-back",
    description:
      "Texts a new website lead within minutes, assigns an owner by territory, and asks for a call within 10 minutes.",
    triggerLabel: "Lead.CREATED",
    subject: "lead",
    triggers: [
      {
        event: "lead.created",
        when: [
          {
            field: "lead.intake_channel",
            op: "eq",
            value: "website",
            label: "the lead came from the website",
          },
        ],
      },
    ],
    builtIn: [
      "The speed-to-lead clock starts; the first call, text or email from a person stops it.",
      "Attention: “Untouched new lead” opens after the text-back SLA (Company Settings).",
    ],
    actions: [
      {
        id: "assign",
        kind: "assign_owner",
        strategy: "territory_round_robin",
        label: "Assign an owner (the territory's estimators, round robin) if nobody owns it yet",
        when: [{ field: "lead.owner_id", op: "missing", label: "the lead has no owner" }],
      },
      {
        id: "text_back",
        kind: "send",
        template: "lead_text_back",
        channel: "sms_or_email",
        to: "customer",
        label: "Text the lead (email if there's no mobile)",
      },
      {
        id: "call_task",
        kind: "task",
        title: "Call {{lead.first_name}} within 10 minutes",
        dueIn: { minutes: 10 },
        assignee: ["lead_owner", "owners"],
        priority: "high",
        label: "Task for the owner: call within 10 minutes",
      },
    ],
  },
  {
    key: "walkthrough_booked",
    number: 2,
    name: "Walkthrough booked → confirmation and reminders",
    description:
      "Confirms the walkthrough by text and email, adds the calendar event, and reminds the customer 24 hours and 2 hours before.",
    triggerLabel: "Appointment.CREATED",
    subject: "appointment",
    triggers: [
      {
        event: "appointment.created",
        when: [
          {
            field: "appointment.type",
            op: "eq",
            value: "walkthrough",
            label: "it's a walkthrough",
          },
        ],
      },
    ],
    builtIn: ["Booking converts the lead to a job (Company Settings, default on)."],
    exitWhen: [
      {
        field: "appointment.status",
        op: "in",
        value: ["canceled", "completed", "no_show", "rescheduled"],
      },
      { field: "appointment.deleted", op: "truthy" },
    ],
    exitLabel: "Stops if the walkthrough is canceled, rescheduled, done or deleted.",
    actions: [
      {
        id: "confirm",
        kind: "send",
        template: "walkthrough_confirmation",
        channel: "sms_and_email",
        to: "customer",
        label: "Confirmation by text and email (date, time, who's coming, what to expect)",
      },
      { id: "calendar", kind: "calendar", label: "Add the calendar event (calendar adapter)" },
      {
        id: "wait_24h",
        kind: "wait",
        until: { field: "appointment.start", offset: { hours: 24 }, before: true },
        ifPast: "skip_next",
        label: "Wait until 24 hours before",
      },
      {
        id: "reminder_24h",
        kind: "send",
        template: "walkthrough_reminder_24h",
        channel: "sms_or_email",
        to: "customer",
        label: "Reminder the day before",
      },
      {
        id: "wait_2h",
        kind: "wait",
        until: { field: "appointment.start", offset: { hours: 2 }, before: true },
        ifPast: "skip_next",
        label: "Wait until 2 hours before",
      },
      {
        id: "reminder_2h",
        kind: "send",
        template: "walkthrough_reminder_2h",
        channel: "sms",
        to: "customer",
        label: "Text 2 hours before",
      },
    ],
  },
  {
    key: "walkthrough_completed",
    number: 3,
    name: "Walkthrough completed → send the estimate within 24 hours",
    description: "Gives the estimator a “Send estimate” task due in 24 hours.",
    triggerLabel: "Appointment.COMPLETED",
    subject: "appointment",
    triggers: [
      {
        event: "appointment.completed",
        when: [
          {
            field: "appointment.type",
            op: "eq",
            value: "walkthrough",
            label: "it's a walkthrough",
          },
          {
            field: "appointment.result",
            op: "eq",
            value: "measured",
            label: "the result is Measured",
          },
        ],
      },
    ],
    builtIn: [
      "The job moves to Walkthrough Complete (stage gate).",
      "Attention: “Estimate SLA” warns at 20 hours and breaches at 24 hours.",
    ],
    actions: [
      {
        id: "task",
        kind: "task",
        title: "Send the estimate for {{job.name}}",
        dueIn: { hours: 24 },
        assignee: ["job_owner", "point_of_contact", "owners"],
        priority: "high",
        label: "Task “Send estimate” due in 24 hours",
        when: [{ field: "job.id", op: "exists", label: "the walkthrough is on a job" }],
      },
      {
        id: "notify",
        kind: "notify",
        audience: ["job_owner"],
        template: "internal_estimate_due",
        notificationType: "estimate",
        label: "Tell the estimator the estimate is due",
        when: [{ field: "job.id", op: "exists" }],
      },
    ],
  },
  {
    key: "estimate_follow_up",
    number: 4,
    name: "Estimate sent → follow-ups on day 2, 5 and 10",
    description:
      "A text on day 2, an email on day 5 and a text from the owner on day 10, each with a fresh link. Stops when the customer answers.",
    triggerLabel: "Estimate.SENT",
    subject: "estimate",
    triggers: [{ event: "estimate.sent" }],
    builtIn: [
      "Attention: “Estimate awaiting reply” after 3 days and “Expiring estimate” 5 days before it expires.",
    ],
    exitWhen: [
      {
        field: "estimate.status",
        op: "in",
        value: ["accepted", "declined", "expired", "superseded"],
      },
      { field: "estimate.replied_after_viewing", op: "truthy" },
      { field: "job.closed", op: "truthy" },
    ],
    exitLabel:
      "Stops when the estimate is accepted, declined, expired or replaced, the job closes, or the customer opened it and replied.",
    actions: [
      { id: "wait_2d", kind: "wait", for: { days: 2 }, label: "Wait 2 days" },
      {
        id: "day2",
        kind: "send",
        template: "estimate_follow_up_day2",
        channel: "sms_or_email",
        to: "customer",
        prepare: "estimate_link",
        label: "Day 2: text with the link",
      },
      { id: "wait_5d", kind: "wait", for: { days: 3 }, label: "Wait until day 5" },
      {
        id: "day5",
        kind: "send",
        template: "estimate_follow_up_day5",
        channel: "email_or_sms",
        to: "customer",
        prepare: "estimate_link",
        label: "Day 5: email with the link",
      },
      { id: "wait_10d", kind: "wait", for: { days: 5 }, label: "Wait until day 10" },
      {
        id: "day10",
        kind: "send",
        template: "estimate_follow_up_day10",
        channel: "sms_or_email",
        to: "customer",
        prepare: "estimate_link",
        label: "Day 10: text from the owner",
      },
    ],
  },
  {
    key: "estimate_accepted",
    number: 5,
    name: "Estimate accepted → welcome and what happens next",
    description: "Welcomes the customer with what happens next and how to get the house ready.",
    triggerLabel: "Estimate.ACCEPTED",
    subject: "job",
    triggers: [{ event: "estimate.accepted", subjectFrom: { payload: "job_id" } }],
    builtIn: [
      "The job moves to Sold and then Onboarding (stage gates).",
      "The signed proposal and contract PDF is stored in Documents.",
      "The deposit invoice is drafted and a Deposit Hold placed.",
      "The onboarding checklist, paint order, work orders and color schedule are created.",
    ],
    actions: [
      {
        id: "welcome",
        kind: "send",
        template: "welcome",
        channel: "email_or_sms",
        to: "customer",
        label: "Welcome email (what happens next, prep instructions); text if there's no email",
      },
    ],
  },
  {
    key: "deposit_paid",
    number: 6,
    name: "Deposit paid → tell the office",
    description: "Tells the office and the point of contact that the deposit is in.",
    triggerLabel: "Job.HOLD_RELEASED (deposit)",
    subject: "job",
    triggers: [
      {
        event: "job.hold_released",
        when: [
          {
            field: "event.payload.hold_type",
            op: "eq",
            value: "deposit",
            label: "it was the Deposit Hold",
          },
        ],
        testPayload: { hold_type: "deposit" },
      },
    ],
    builtIn: [
      "Recording the deposit clears the onboarding item and releases the Deposit Hold (onboarding check).",
    ],
    actions: [
      {
        id: "notify",
        kind: "notify",
        audience: ["finance", "point_of_contact"],
        template: "internal_deposit_paid",
        notificationType: "finance",
        label: "Tell the office and the point of contact",
      },
    ],
  },
  {
    key: "onboarding_cleared",
    number: 7,
    name: "Onboarding cleared → tell the scheduler",
    description: "Tells whoever publishes the schedule that a job is Ready to Schedule.",
    triggerLabel: "Job.STAGE_CHANGED → Ready to Schedule",
    subject: "job",
    triggers: [
      {
        event: "job.stage_changed",
        when: [stageIs("ready_to_schedule")],
        testPayload: { to: "ready_to_schedule" },
      },
    ],
    builtIn: [
      "The job moves to Ready to Schedule on its own when every required item is cleared and no hold blocks it.",
      "The job's team hears about the stage change.",
    ],
    actions: [
      {
        id: "notify",
        kind: "notify",
        audience: ["schedulers"],
        excludeJobPeople: true,
        template: "internal_ready_to_schedule",
        notificationType: "schedule",
        label: "Tell the scheduler (people not already on the job)",
      },
    ],
  },
  {
    key: "schedule_published",
    number: 8,
    name: "Schedule published → customer and crew notices, day-before reminder",
    description:
      "Tells the customer the start date, crew lead and the rain-day promise, tells the crew, and reminds the customer the afternoon before.",
    triggerLabel: "Schedule.PUBLISHED",
    subject: "job",
    triggers: [
      {
        event: "job.schedule_published",
        testPayload: { change: "scheduled", notify_customer: true },
      },
    ],
    builtIn: [
      "Publish sets the promised start date, the on-time guarantee date and the crew.",
      "The job moves Ready to Schedule → Scheduled.",
    ],
    exitWhen: [
      { field: "schedule.still_current", op: "falsy", label: "the dates changed again" },
      { field: "job.closed", op: "truthy" },
    ],
    exitLabel:
      "The day-before reminder is skipped if the dates change again (the new publish sends its own).",
    actions: [
      {
        id: "scheduled",
        kind: "send",
        template: "schedule_published",
        channel: "sms_or_email",
        to: "customer",
        label: "Customer: you're on the schedule (start date, crew lead, rain-day promise)",
        when: [{ field: "schedule.change", op: "eq", value: "scheduled" }, notifyCustomer],
      },
      {
        id: "moved",
        kind: "send",
        template: "schedule_moved",
        channel: "sms_or_email",
        to: "customer",
        label: "Customer: your dates changed",
        when: [{ field: "schedule.change", op: "eq", value: "moved" }, notifyCustomer],
      },
      {
        id: "unscheduled",
        kind: "send",
        template: "schedule_unscheduled",
        channel: "sms_or_email",
        to: "customer",
        label: "Customer: taken off the schedule",
        when: [{ field: "schedule.change", op: "eq", value: "unscheduled" }, notifyCustomer],
      },
      {
        id: "crew_changed",
        kind: "send",
        template: "schedule_crew_changed",
        channel: "sms_or_email",
        to: "customer",
        label: "Customer: your crew changed",
        when: [{ field: "schedule.change", op: "eq", value: "crew_changed" }, notifyCustomer],
      },
      {
        id: "crew_notice",
        kind: "send",
        template: "crew_schedule_notice",
        channel: "sms_or_email",
        to: "crew_lead",
        label: "Crew lead: schedule update",
        when: [{ field: "schedule.crew_changes", op: "exists" }],
      },
      {
        id: "crew_app",
        kind: "notify",
        audience: ["crew"],
        template: "crew_schedule_notice",
        notificationType: "schedule",
        label: "Crew: in-app notice",
        when: [{ field: "schedule.crew_changes", op: "exists" }],
      },
      {
        id: "wait_day_before",
        kind: "wait",
        until: {
          field: "schedule.start_date",
          offset: { days: 1 },
          before: true,
          atPacificTime: "16:00",
        },
        ifPast: "skip_next",
        label: "Wait until 4:00 pm the day before the start",
        when: [
          { field: "schedule.change", op: "in", value: ["scheduled", "moved"] },
          notifyCustomer,
        ],
      },
      {
        id: "day_before",
        kind: "send",
        template: "schedule_day_before",
        channel: "sms_or_email",
        to: "customer",
        label: "Customer: we start tomorrow (arrival window)",
        when: [
          { field: "schedule.change", op: "in", value: ["scheduled", "moved"] },
          notifyCustomer,
        ],
      },
    ],
  },
  {
    key: "rain_delay",
    number: 9,
    name: "Weather / rain delay → customer text",
    description:
      "When a rain delay is marked, texts the customer the rain-day promise: next dry day, first on the list, no cost.",
    triggerLabel: "Job.RAIN_DELAY",
    subject: "job",
    triggers: [
      {
        event: "job.rain_delay",
        when: [
          {
            field: "rain_delay.notify_customer",
            op: "truthy",
            label: "the person chose to text the customer",
          },
        ],
      },
    ],
    builtIn: [
      "The job is flagged priority reschedule and pinned to the top of the Master Schedule tray.",
      "A rain delay never drafts an on-time credit or any charge.",
      "Attention: “Weather risk” with a suggested reschedule (runs when weather is connected).",
    ],
    actions: [
      {
        id: "text",
        kind: "send",
        template: "rain_delay",
        channel: "sms_or_email",
        to: "customer",
        record: "rain_delay_message",
        label: "Text the customer (email if texting isn't possible)",
      },
    ],
  },
  {
    key: "start_missed",
    number: 10,
    name: "Promised start missed (not weather) → owner approves the credit",
    description: "Tells the owners an On-Time Guarantee credit is waiting for their approval.",
    triggerLabel: "OnTimeCredit.CREATED",
    subject: "job",
    triggers: [{ event: "on_time_credit.created", subjectFrom: { payload: "job_id" } }],
    builtIn: [
      "Attention: “Start date missed” (Critical).",
      "The On-Time Guarantee credit (amount from Company Settings) is drafted for owner approval.",
    ],
    actions: [
      {
        id: "notify",
        kind: "notify",
        audience: ["owners"],
        template: "internal_start_missed",
        notificationType: "approval",
        label: "Tell the owners: approve or waive the credit",
      },
    ],
  },
  {
    key: "daily_log_update",
    number: 11,
    name: "Daily log submitted → customer update",
    description:
      "Sends the customer today's update from the crew lead's daily log, signed by the point of contact.",
    triggerLabel: "DailyLog.SUBMITTED",
    subject: "daily_log",
    triggers: [{ event: "daily_log.submitted" }],
    builtIn: [
      "Attention: “Missed daily update” at 7 pm on a production day with no log (owned by the crew lead).",
    ],
    actions: [
      {
        id: "update",
        kind: "send",
        template: "daily_update",
        channel: "sms_or_email",
        to: "customer",
        record: "daily_log_update",
        label: "Customer update: finished today, next up, photos (email if texting isn't possible)",
      },
    ],
  },
  {
    key: "work_orders_complete",
    number: 12,
    name: "Work orders complete → final walkthrough request",
    description:
      "Asks the customer for a final walkthrough time and gives the PM a task to book it.",
    triggerLabel: "Job.STAGE_CHANGED → Final Walkthrough",
    subject: "job",
    triggers: [
      {
        event: "job.stage_changed",
        when: [stageIs("final_walkthrough")],
        testPayload: { to: "final_walkthrough" },
      },
    ],
    builtIn: ["The job moves to Final Walkthrough when every work order is complete."],
    actions: [
      {
        id: "request",
        kind: "send",
        template: "final_walkthrough_request",
        channel: "sms_or_email",
        to: "customer",
        label: "Ask the customer for a walkthrough time",
      },
      {
        id: "task",
        kind: "task",
        title: "Book the final walkthrough for {{job.name}}",
        dueIn: { days: 1 },
        assignee: ["project_manager", "point_of_contact", "job_owner"],
        priority: "normal",
        label: "Task for the PM: book the final walkthrough",
      },
    ],
  },
  {
    key: "final_walkthrough_signed_off",
    number: 13,
    name: "Final walkthrough signed off → send the final invoice",
    description: "Tells the office the final invoice is drafted and asks them to send it.",
    triggerLabel: "Job.STAGE_CHANGED → Completed",
    subject: "job",
    triggers: [
      {
        event: "job.stage_changed",
        when: [stageIs("completed")],
        testPayload: { to: "completed" },
      },
    ],
    builtIn: [
      "The job moves to Completed when the customer signs off (or the walkthrough is done with no open items).",
      "The final invoice is drafted, with any approved credits.",
    ],
    actions: [
      {
        id: "notify",
        kind: "notify",
        audience: ["finance", "point_of_contact"],
        template: "internal_final_invoice_ready",
        notificationType: "finance",
        label: "Tell the office the final invoice is ready",
      },
      {
        id: "task",
        kind: "task",
        title: "Review and send the final invoice for {{job.name}}",
        dueIn: { days: 1 },
        assignee: ["finance", "owners"],
        priority: "normal",
        label: "Task: send the final invoice",
      },
    ],
  },
  {
    key: "invoice_overdue",
    number: 14,
    name: "Invoice overdue 7 / 30 days → reminder",
    description:
      "A friendly reminder to the customer and a note to the job's people and the owners.",
    triggerLabel: "Invoice.OVERDUE",
    subject: "invoice",
    triggers: [{ event: "invoice.overdue", testPayload: { days: 7 } }],
    builtIn: ["Attention: “Overdue invoice” (medium at 7 days, high at 30)."],
    actions: [
      {
        id: "reminder",
        kind: "send",
        template: "invoice_reminder",
        channel: "sms_or_email",
        to: "customer",
        label: "Reminder to the customer (text, else email)",
        when: [{ field: "invoice.open", op: "truthy", label: "money is still owed" }],
      },
      {
        id: "notify",
        kind: "notify",
        audience: ["job_owner", "point_of_contact", "owners"],
        template: "internal_invoice_overdue",
        notificationType: "finance",
        label: "Tell the job's people and the owners",
        when: [{ field: "invoice.open", op: "truthy" }],
      },
    ],
  },
  {
    key: "paid_in_full",
    number: 15,
    name: "Paid in full → thank-you, review, referral invite, 1-year check-in",
    description:
      "Thanks the customer with warranty info, asks for a review a few days later, invites them to Bear Champions two weeks later, and checks in after a year.",
    triggerLabel: "Job.STAGE_CHANGED → Paid in Full",
    subject: "job",
    triggers: [
      {
        event: "job.stage_changed",
        when: [stageIs("paid_in_full")],
        testPayload: { to: "paid_in_full" },
      },
    ],
    builtIn: ["The job closes as Closed Won 3 days after Paid in Full (if the balance stays $0)."],
    actions: [
      {
        id: "thanks",
        kind: "send",
        template: "paid_in_full_thanks",
        channel: "email_or_sms",
        to: "customer",
        label: "Thank-you with warranty info",
      },
      {
        id: "wait_review",
        kind: "wait",
        for: { days: 2 },
        setting: "review_delay_days",
        label: "Wait (review delay, Reviews settings; default 2 days)",
      },
      {
        id: "review",
        kind: "send",
        template: "review_request",
        channel: "sms_or_email",
        to: "customer",
        prepare: "review_link",
        label: "Review request with a tracked link",
      },
      {
        id: "wait_referral",
        kind: "wait",
        until: { field: "job.paid_in_full_at", offset: { days: 14 } },
        setting: "referral_invite_delay_days",
        ifPast: "continue",
        label: "Wait until 14 days after Paid in Full (Referral Program settings)",
      },
      {
        id: "referral",
        kind: "send",
        template: "referral_invite",
        channel: "sms_or_email",
        to: "customer",
        prepare: "referral_code",
        label: "Bear Champions invite with their code",
      },
      {
        id: "wait_year",
        kind: "wait",
        until: { field: "job.paid_in_full_at", offset: { days: 365 } },
        ifPast: "skip_next",
        label: "Wait one year",
      },
      {
        id: "check_in",
        kind: "send",
        template: "one_year_check_in",
        channel: "sms_or_email",
        to: "customer",
        label: "“How's the paint holding up?” check-in",
      },
    ],
  },
  {
    key: "nurture",
    number: 16,
    name: "Lead stale 14 days / just planning → nurture drips",
    description:
      "Enrolls just-planning and stale leads in the nurture drip, and exterior leads in the exterior pre-season drip (Feb, Mar, Apr).",
    triggerLabel: "Lead.STALE / Lead.CREATED (just planning)",
    subject: "lead",
    triggers: [
      { event: "lead.stale" },
      {
        event: "lead.created",
        when: [
          {
            field: "lead.timeline",
            op: "eq",
            value: "just_planning",
            label: "the lead is just planning",
          },
        ],
      },
      {
        event: "lead.updated",
        when: [
          {
            field: "event.payload.changed",
            op: "includes",
            value: "status",
            label: "the status changed",
          },
          { field: "lead.status", op: "eq", value: "nurture", label: "to Nurture" },
        ],
      },
    ],
    builtIn: ["Attention: “Aging lead” at 3, 7 and 14 days without activity."],
    actions: [
      {
        id: "nurture",
        kind: "enroll_drip",
        drip: "just_planning_nurture",
        subject: "lead",
        label: "Enroll in the just-planning nurture drip",
        when: [{ field: "lead.open", op: "truthy", label: "the lead is still open" }],
      },
      {
        id: "preseason",
        kind: "enroll_drip",
        drip: "exterior_pre_season",
        subject: "lead",
        label: "Exterior or deck leads: enroll in the exterior pre-season drip",
        when: [
          { field: "lead.open", op: "truthy" },
          {
            field: "lead.service_keys",
            op: "includes",
            value: ["exterior", "deck_fence"],
            label: "asked for exterior or deck work",
          },
        ],
      },
    ],
  },
  {
    key: "sub_compliance",
    number: 17,
    name: "Subcontractor paperwork expiring → owners and the sub",
    description:
      "Tells the owners and emails the subcontractor when insurance, license or W-9 is missing or expires soon.",
    triggerLabel: "Subcontractor.COMPLIANCE_EXPIRING",
    subject: "subcontractor",
    triggers: [{ event: "subcontractor.compliance_expiring" }],
    builtIn: [
      "Attention: “Sub compliance expiring” 30 days ahead.",
      "Expired paperwork blocks scheduling the sub's crews.",
    ],
    actions: [
      {
        id: "notify",
        kind: "notify",
        audience: ["owners"],
        template: "internal_sub_compliance",
        notificationType: "subcontractor",
        label: "Tell the owners",
      },
      {
        id: "sub",
        kind: "send",
        template: "sub_compliance_notice",
        channel: "email_or_sms",
        to: "subcontractor",
        label: "Remind the subcontractor's contact",
      },
    ],
  },
];

export function getWorkflow(key: string): WorkflowDefinition | undefined {
  return WORKFLOWS.find((w) => w.key === key);
}

export const WORKFLOW_KEYS: readonly string[] = WORKFLOWS.map((w) => w.key);

/** Workflows listening to an event type. */
export function workflowsForEvent(type: string): WorkflowDefinition[] {
  return WORKFLOWS.filter((w) => w.triggers.some((t) => t.event === type));
}

/** Template keys a workflow uses (for "Templates used" and the seed check). */
export function templatesUsed(def: WorkflowDefinition): string[] {
  const keys = new Set<string>();
  for (const a of def.actions) if (a.kind === "send" || a.kind === "notify") keys.add(a.template);
  return [...keys];
}
