/**
 * Notification events (SPEC §8.18 Settings → Notifications, §8.19 Admin →
 * Notification Settings). Every in-app notification has one of these types.
 * The company sets the defaults per type (in-app / email / text, and whether
 * people may turn the in-app one off); each person can change their own.
 * In-app notifications are real; email and text copies are simulated through
 * the outbox. A database trigger on `notifications` applies the choices.
 */

export type NotificationType = {
  type: string;
  label: string;
  description: string;
  defaults: { inApp: boolean; email: boolean; sms: boolean; locked: boolean };
};

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  {
    type: "mention",
    label: "Mentions",
    description: "Someone @mentions you in a note or comment.",
    defaults: { inApp: true, email: true, sms: false, locked: true },
  },
  {
    type: "attention",
    label: "Attention items",
    description: "A critical or high-priority Attention item is assigned to you.",
    defaults: { inApp: true, email: false, sms: false, locked: true },
  },
  {
    type: "approval",
    label: "Approvals",
    description:
      "Discounts, overrides and on-time credits waiting for a decision, and the answers to your requests.",
    defaults: { inApp: true, email: true, sms: false, locked: true },
  },
  {
    type: "message",
    label: "Customer messages",
    description: "A customer texts or emails on a lead or job you own.",
    defaults: { inApp: true, email: false, sms: false, locked: false },
  },
  {
    type: "lead_resubmitted",
    label: "Repeat website requests",
    description: "Someone who's already a lead sends the website form again.",
    defaults: { inApp: true, email: false, sms: false, locked: false },
  },
  {
    type: "job_stage",
    label: "Job stage changes",
    description: "A job you're on moves to a new stage.",
    defaults: { inApp: true, email: false, sms: false, locked: false },
  },
  {
    type: "estimate",
    label: "Estimates",
    description: "A customer opens, accepts or declines an estimate, or one is due.",
    defaults: { inApp: true, email: false, sms: false, locked: false },
  },
  {
    type: "change_order",
    label: "Change orders",
    description: "A change order is reported from the field, signed or declined.",
    defaults: { inApp: true, email: false, sms: false, locked: false },
  },
  {
    type: "schedule",
    label: "Schedule",
    description: "Your crew's schedule changes, or a job is ready to schedule.",
    defaults: { inApp: true, email: false, sms: false, locked: false },
  },
  {
    type: "finance",
    label: "Money",
    description: "Deposits, overdue invoices, bounced payments and final invoices ready to send.",
    defaults: { inApp: true, email: false, sms: false, locked: false },
  },
  {
    type: "case",
    label: "Warranty and service cases",
    description: "A case is opened or assigned to you.",
    defaults: { inApp: true, email: false, sms: false, locked: false },
  },
  {
    type: "subcontractor",
    label: "Subcontractor paperwork",
    description: "A subcontractor's insurance, license or W-9 is missing or expires soon.",
    defaults: { inApp: true, email: true, sms: false, locked: false },
  },
  {
    type: "referral",
    label: "Referrals",
    description: "A Bear Champion refers someone, or a reward becomes payable.",
    defaults: { inApp: true, email: false, sms: false, locked: false },
  },
  {
    type: "workflow",
    label: "Workflow problems",
    description: "An automation failed and needs a look.",
    defaults: { inApp: true, email: false, sms: false, locked: false },
  },
];

export function notificationType(type: string): NotificationType | undefined {
  return NOTIFICATION_TYPES.find((t) => t.type === type);
}

export type ChannelChoice = { inApp: boolean; email: boolean; sms: boolean };

/** What a person gets for a type: their choice over the company default; locked keeps in-app on. */
export function effectiveChoice(
  companyDefault: (ChannelChoice & { locked: boolean }) | null,
  personal: ChannelChoice | null,
  fallback: NotificationType["defaults"] = { inApp: true, email: false, sms: false, locked: false },
): ChannelChoice & { locked: boolean } {
  const d = companyDefault ?? fallback;
  const c = personal ?? d;
  return { inApp: c.inApp || d.locked, email: c.email, sms: c.sms, locked: d.locked };
}
