/**
 * Follow-up lists (SPEC §11.4): dynamic call lists with counts, a power-dialer
 * view, and dispositions grouped Positive / Negative / Callback / No Contact /
 * Won (§8.19). The list rules live in the server loader (lib/follow-ups);
 * this module holds the definitions and the pure queue logic.
 */

export const DISPOSITION_GROUPS = [
  "positive",
  "negative",
  "callback",
  "no_contact",
  "won",
] as const;
export type DispositionGroup = (typeof DISPOSITION_GROUPS)[number];

export const DISPOSITION_GROUP_LABELS: Record<DispositionGroup, string> = {
  positive: "Positive",
  negative: "Negative",
  callback: "Callback",
  no_contact: "No Contact",
  won: "Won",
};

export type FollowUpListKey =
  | "hot_new_leads"
  | "confirm_walkthroughs"
  | "estimates_awaiting_reply"
  | "callbacks"
  | "just_planning"
  | "pre_season_exterior"
  | "lost_reengage"
  | "past_customers";

export type FollowUpListDef = {
  key: FollowUpListKey;
  name: string;
  description: string;
  script: string;
  cooldownHours: number;
  /** What a row is. */
  subject: "lead" | "job" | "account";
};

export const FOLLOW_UP_LISTS: readonly FollowUpListDef[] = [
  {
    key: "hot_new_leads",
    name: "Hot New Leads",
    description:
      "New and contacted leads from the last 24 hours with no walkthrough yet, best score first.",
    script:
      "Hi, this is [your name] with Brushy Bear Painters. You asked about painting on our website. Do you have a minute?\n\n- What are you looking to have painted?\n- When would you like it done?\n- Could we come by for a walkthrough? It takes about an hour and you get a written estimate within 24 hours.\n\nDraft script – owner to approve.",
    cooldownHours: 4,
    subject: "lead",
  },
  {
    key: "confirm_walkthroughs",
    name: "Confirm Tomorrow's Walkthroughs",
    description: "Walkthroughs tomorrow (Pacific) that aren't confirmed yet.",
    script:
      "Hi, this is [your name] with Brushy Bear Painters. I'm calling to confirm your walkthrough tomorrow at [time]. Does that still work?\n\nDraft script – owner to approve.",
    cooldownHours: 20,
    subject: "lead",
  },
  {
    key: "estimates_awaiting_reply",
    name: "Estimates Awaiting Reply",
    description: "Estimates sent more than 3 days ago that haven't been accepted or declined.",
    script:
      "Hi, this is [your name] with Brushy Bear Painters. I'm following up on the estimate we sent. Any questions, or anything you'd like to change in the scope?\n\nDraft script – owner to approve.",
    cooldownHours: 48,
    subject: "job",
  },
  {
    key: "callbacks",
    name: "Callbacks Scheduled",
    description: "Callbacks due today or overdue.",
    script:
      "Pick up where the last call left off (see the last note).\n\nDraft script – owner to approve.",
    cooldownHours: 0,
    subject: "lead",
  },
  {
    key: "just_planning",
    name: "Just-Planning Nurture",
    description: "Open leads that are just planning or in Nurture.",
    script:
      "Hi, this is [your name] with Brushy Bear Painters. You mentioned you were planning a painting project. Is the timing getting closer? Happy to come by for a walkthrough whenever you're ready.\n\nDraft script – owner to approve.",
    cooldownHours: 24 * 14,
    subject: "lead",
  },
  {
    key: "pre_season_exterior",
    name: "Pre-Season Exterior",
    description:
      "Open exterior and deck leads, and unsold exterior estimates, ahead of the exterior season.",
    script:
      "Hi, this is [your name] with Brushy Bear Painters. Exterior dates for this summer are filling up. Would you like to get on the schedule?\n\nDraft script – owner to approve.",
    cooldownHours: 24 * 21,
    subject: "lead",
  },
  {
    key: "lost_reengage",
    name: "Lost – Re-engage (90 days)",
    description: "Leads and jobs lost at least 90 days ago (and less than a year).",
    script:
      "Hi, this is [your name] with Brushy Bear Painters. We talked a few months ago about painting. Is that project still on your list?\n\nDraft script – owner to approve.",
    cooldownHours: 24 * 90,
    subject: "lead",
  },
  {
    key: "past_customers",
    name: "Past Customers (annual check-in)",
    description:
      "Customers whose job was paid in full about a year ago or more, not called in the last year.",
    script:
      "Hi, this is [your name] with Brushy Bear Painters. It's been about a year since we painted for you. How's everything holding up? Any other rooms or projects on your list?\n\nDraft script – owner to approve.",
    cooldownHours: 24 * 330,
    subject: "account",
  },
];

export type DispositionDef = {
  key: string;
  label: string;
  group: DispositionGroup;
  leadDisposition: string | null;
  requiresCallback: boolean;
  setsDoNotContact: boolean;
};

/** Seeded dispositions; lead dispositions are the Phase 2 picklist keys. */
export const DEFAULT_DISPOSITIONS: readonly DispositionDef[] = [
  {
    key: "walkthrough_booked",
    label: "Walkthrough booked",
    group: "positive",
    leadDisposition: "walkthrough_scheduled",
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "confirmed",
    label: "Confirmed",
    group: "positive",
    leadDisposition: null,
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "interested",
    label: "Interested – sending info",
    group: "positive",
    leadDisposition: null,
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "ready_to_sign",
    label: "Ready to sign",
    group: "won",
    leadDisposition: null,
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "booked_new_job",
    label: "Booked a new project",
    group: "won",
    leadDisposition: null,
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "call_back",
    label: "Call back later",
    group: "callback",
    leadDisposition: "call_back",
    requiresCallback: true,
    setsDoNotContact: false,
  },
  {
    key: "just_planning",
    label: "Still just planning",
    group: "callback",
    leadDisposition: "just_planning",
    requiresCallback: true,
    setsDoNotContact: false,
  },
  {
    key: "no_answer",
    label: "No answer",
    group: "no_contact",
    leadDisposition: "no_answer",
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "left_voicemail",
    label: "Left voicemail",
    group: "no_contact",
    leadDisposition: "left_voicemail",
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "texted_no_reply",
    label: "Texted, no reply",
    group: "no_contact",
    leadDisposition: "texted_no_reply",
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "not_interested",
    label: "Not interested",
    group: "negative",
    leadDisposition: "not_interested",
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "hired_someone_else",
    label: "Hired someone else",
    group: "negative",
    leadDisposition: "hired_someone_else",
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "price_shopping",
    label: "Price shopping",
    group: "negative",
    leadDisposition: "price_shopping",
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "diy",
    label: "Doing it themselves",
    group: "negative",
    leadDisposition: "diy",
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "wrong_number",
    label: "Wrong number",
    group: "negative",
    leadDisposition: "wrong_number",
    requiresCallback: false,
    setsDoNotContact: false,
  },
  {
    key: "do_not_contact",
    label: "Do not contact",
    group: "negative",
    leadDisposition: "do_not_contact",
    requiresCallback: false,
    setsDoNotContact: true,
  },
];

export type Attempt = { listKey: string; createdAt: string; callbackAt: string | null };

/**
 * Is a record resting in this list after a recent disposition? A callback
 * time brings it back at that time (Callbacks list); otherwise the list's
 * cooldown applies.
 */
export function isResting(
  listKey: string,
  cooldownHours: number,
  attempts: readonly Attempt[],
  now: Date,
): boolean {
  const last = attempts
    .filter((a) => a.listKey === listKey)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (!last) return false;
  if (last.callbackAt) return new Date(last.callbackAt).getTime() > now.getTime();
  return now.getTime() - new Date(last.createdAt).getTime() < cooldownHours * 3_600_000;
}

/** The Callbacks list: the latest attempt per record has a callback due by the end of today. */
export function callbackDue(attempts: readonly Attempt[], endOfToday: Date): Attempt | null {
  const last = [...attempts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (!last?.callbackAt) return null;
  return new Date(last.callbackAt).getTime() <= endOfToday.getTime() ? last : null;
}

/** Next record in the power dialer after the current one (wraps to null at the end). */
export function nextInQueue<T extends { id: string }>(
  queue: readonly T[],
  currentId: string | null,
): T | null {
  if (!queue.length) return null;
  if (!currentId) return queue[0] ?? null;
  const i = queue.findIndex((q) => q.id === currentId);
  if (i < 0) return queue[0] ?? null;
  return queue[i + 1] ?? null;
}

export function groupDispositions<T extends { group: DispositionGroup; active?: boolean }>(
  items: readonly T[],
): { group: DispositionGroup; label: string; items: T[] }[] {
  return DISPOSITION_GROUPS.map((g) => ({
    group: g,
    label: DISPOSITION_GROUP_LABELS[g],
    items: items.filter((i) => i.group === g && i.active !== false),
  })).filter((g) => g.items.length > 0);
}
