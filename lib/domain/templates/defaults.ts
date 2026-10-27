/**
 * Default SMS and email templates (SPEC §11.3), one set for every seeded
 * workflow (§11.2), the onboarding requests (Phase 5 drafts, same keys), the
 * drips and warranty cases. Brushy Bear's voice: plain, friendly, specific, no
 * hype, short sentences, signed by a person (the job's point of contact).
 *
 * Every template is seeded as "Draft – owner to approve" by
 * supabase/migrations/20261029000200_communication_seed.sql; a unit test keeps
 * that file and this list in step. Placeholders ([PHONE], [WARRANTY_TERMS],
 * [HOW_TO_PAY — owner to provide], [REFERRAL_REWARD]) stay placeholders until
 * the owners give real values.
 */

export const TEMPLATE_CATEGORIES = [
  "lead",
  "walkthrough",
  "estimate",
  "sold_onboarding",
  "schedule",
  "daily_update",
  "weather",
  "completion",
  "billing",
  "review_referral",
  "warranty",
  "internal",
  "marketing",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  lead: "Lead",
  walkthrough: "Walkthrough",
  estimate: "Estimate",
  sold_onboarding: "Sold / Onboarding",
  schedule: "Schedule",
  daily_update: "Daily Update",
  weather: "Weather",
  completion: "Completion",
  billing: "Billing",
  review_referral: "Review / Referral",
  warranty: "Warranty",
  internal: "Internal",
  marketing: "Marketing",
};

export type TemplateChannel = "sms" | "email";
export type MessageType = "transactional" | "marketing";

export type DefaultTemplate = {
  key: string;
  channel: TemplateChannel;
  name: string;
  category: TemplateCategory;
  messageType: MessageType;
  description: string;
  subject?: string;
  body: string;
};

const SMS_SIGN = "- {{poc.first_name}}, {{company.name}}";
const EMAIL_SIGN = "{{poc.full_name}}\n{{company.name}}\n{{company.phone}}";
const HI = 'Hi {{contact.first_name | default:"there"}}';

function pair(
  key: string,
  name: string,
  category: TemplateCategory,
  description: string,
  sms: string,
  email: { subject: string; body: string },
  messageType: MessageType = "transactional",
): DefaultTemplate[] {
  return [
    { key, channel: "sms", name, category, messageType, description, body: sms },
    {
      key,
      channel: "email",
      name,
      category,
      messageType,
      description,
      subject: email.subject,
      body: email.body,
    },
  ];
}

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  // 1. New web lead → instant text-back (SPEC §11.2 #1 wording).
  ...pair(
    "lead_text_back",
    "New lead text-back",
    "lead",
    "Sent within minutes of a new website lead.",
    `${HI}, this is {{poc.first_name}} with {{company.name}}. Got your request for {{lead.services}}. When's a good time for a quick walkthrough?`,
    {
      subject: "Got your painting request",
      body: `${HI},\n\nThis is {{poc.first_name}} with {{company.name}}. We got your request for {{lead.services}}.\n\nWhen's a good time for a quick walkthrough? We'll look at the work, measure, and talk colors. It takes about an hour.\n\nJust reply with a day and time that works.\n\n${EMAIL_SIGN}`,
    },
  ),

  // 2. Walkthrough booked → confirmation, reminders 24 h and 2 h before.
  ...pair(
    "walkthrough_confirmation",
    "Walkthrough confirmation",
    "walkthrough",
    "Sent when a walkthrough is booked.",
    `${HI}, you're booked: {{appointment.with | default:"we"}} will come by {{appointment.start | datetime}} for your walkthrough. It takes about an hour. ${SMS_SIGN}`,
    {
      subject: "Your walkthrough: {{appointment.start | date}}",
      body: `${HI},\n\nYou're booked for a walkthrough on {{appointment.start | datetime}}. {{appointment.with | default:"Someone from our team"}} will come by.\n\nWhat to expect:\n- We walk through each area you want painted and take measurements.\n- We point out any repairs we see, like soft wood or drywall damage.\n- We talk about colors and sheens.\n\nIt takes about an hour. You'll have a written estimate within 24 hours.\n\nNeed a different time? Just reply.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "walkthrough_reminder_24h",
    "Walkthrough reminder (day before)",
    "walkthrough",
    "Sent 24 hours before the walkthrough.",
    `${HI}, a reminder that we'll see you tomorrow, {{appointment.start | datetime}}, for your walkthrough. Need to move it? Just reply. ${SMS_SIGN}`,
    {
      subject: "See you tomorrow: {{appointment.start | time}}",
      body: `${HI},\n\nA reminder that we'll see you tomorrow, {{appointment.start | datetime}}, for your walkthrough.\n\nNeed to move it? Just reply.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "walkthrough_reminder_2h",
    "Walkthrough reminder (2 hours)",
    "walkthrough",
    "Sent 2 hours before the walkthrough.",
    `${HI}, {{appointment.with | default:"we"}} will be there at {{appointment.start | time}} for your walkthrough. See you soon. ${SMS_SIGN}`,
    {
      subject: "See you at {{appointment.start | time}}",
      body: `${HI},\n\nWe'll be there at {{appointment.start | time}} for your walkthrough. See you soon.\n\n${EMAIL_SIGN}`,
    },
  ),

  // 3. Walkthrough completed → estimate due (staff).
  ...pair(
    "internal_estimate_due",
    "Estimate due in 24 hours (staff)",
    "internal",
    "Tells the estimator the written estimate is due.",
    "Walkthrough done for {{job.name}}. The written estimate is due within 24 hours.",
    {
      subject: "Estimate due: {{job.name}}",
      body: "The walkthrough for {{job.name}} is done. The written estimate is due within 24 hours.\n\n{{job.link}}",
    },
  ),

  // 4. Estimate sent → follow-ups day 2 (text), 5 (email), 10 (text from the owner).
  ...pair(
    "estimate_follow_up_day2",
    "Estimate follow-up (day 2)",
    "estimate",
    "Two days after the estimate was sent.",
    `${HI}, it's {{poc.first_name}} with {{company.name}}. Any questions on your estimate? Here it is again: {{estimate.link}} ${SMS_SIGN}`,
    {
      subject: "Questions on your estimate?",
      body: `${HI},\n\nChecking in on the estimate we sent {{estimate.sent_at | date}}. Happy to answer any questions or adjust the scope.\n\nYou can open it here: {{estimate.link}}\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "estimate_follow_up_day5",
    "Estimate follow-up (day 5)",
    "estimate",
    "Five days after the estimate was sent.",
    `${HI}, just checking in on your painting estimate. Want to change anything in the scope? Reply here or open it: {{estimate.link}} ${SMS_SIGN}`,
    {
      subject: "Your painting estimate",
      body: `${HI},\n\nJust checking in on your estimate ({{estimate.number}}).\n\nIf you'd like a different option, fewer areas, or other colors, tell us and we'll update it. Add-ons are listed as options, so you pick the scope.\n\nOpen your estimate: {{estimate.link}}\n\nIt's good until {{estimate.expires_at | date}}.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "estimate_follow_up_day10",
    "Estimate follow-up (day 10, from the owner)",
    "estimate",
    "Ten days after the estimate was sent, from the job's owner.",
    `${HI}, this is {{job.owner.first_name | default:"the owner"}}, one of the owners of {{company.name}}. Wanted to make sure your estimate made sense. Anything I can help with? {{estimate.link}}`,
    {
      subject: "A note from {{company.name}}",
      body: `${HI},\n\nThis is {{job.owner.first_name | default:"one of the owners"}} at {{company.name}}. I wanted to make sure the estimate we sent made sense and answered your questions.\n\nIf the timing isn't right, that's fine too. Just let me know.\n\nYour estimate: {{estimate.link}}\n\n{{job.owner.full_name | default:"Brushy Bear Painters"}}\n{{company.name}}\n{{company.phone}}`,
    },
  ),

  // 5. Estimate accepted → welcome (what happens next, prep instructions, colors).
  ...pair(
    "welcome",
    "Welcome – what happens next",
    "sold_onboarding",
    "Sent when the customer accepts and signs. Includes the prep list, so it also clears the Prep instructions item.",
    `${HI}, thank you for choosing {{company.name}}! I'm {{poc.first_name}}, your point of contact for the whole project. Next up: the deposit, then colors, then we text you a start date. Questions? Just reply.`,
    {
      subject: "Welcome to {{company.name}}: what happens next",
      body: `${HI},\n\nThank you for choosing us. I'm {{poc.first_name}}, your point of contact for the whole project.\n\nWhat happens next:\n1. Deposit: your deposit invoice is on its way.\n2. Colors: we'll confirm a color for every surface with you.\n3. Scheduling: once the deposit and colors are set, we put you on the schedule and text you the start date.\n4. During the work: a photo update every day, and a clean house every evening.\n\nGetting the house ready:\n{{job.prep_list}}\n\nQuestions any time? Just reply.\n\n${EMAIL_SIGN}`,
    },
  ),

  // 6. Deposit paid → notify the office (staff).
  ...pair(
    "internal_deposit_paid",
    "Deposit paid (staff)",
    "internal",
    "Tells the office the deposit is in and the Deposit Hold is released.",
    "Deposit paid on {{job.name}}. The Deposit Hold is released.",
    {
      subject: "Deposit paid: {{job.name}}",
      body: "The deposit on {{job.name}} is paid and the Deposit Hold is released.\n\n{{job.link}}",
    },
  ),

  // 7. Onboarding cleared → notify the scheduler (staff).
  ...pair(
    "internal_ready_to_schedule",
    "Ready to schedule (staff)",
    "internal",
    "Tells the scheduler a job cleared onboarding.",
    "{{job.name}} cleared onboarding and is Ready to Schedule.",
    {
      subject: "Ready to schedule: {{job.name}}",
      body: "{{job.name}} cleared every onboarding item and is Ready to Schedule.\n\nOpen the Master Schedule to place it.\n\n{{job.link}}",
    },
  ),

  // 8. Schedule published → customer notice, crew notice, day-before reminder.
  ...pair(
    "schedule_published",
    "You're on the schedule",
    "schedule",
    "Sent when a job's dates are published for the first time.",
    `${HI}, you're on the schedule! We start {{schedule.start_date | date}} ({{schedule.dates}}). We'll arrive between {{schedule.arrival_window}}. {{schedule.crew_lead_first_name | default:"Our crew lead"}} leads your crew. If rain gets in the way, you're first on the schedule when it clears, and the delay never costs you anything. ${SMS_SIGN}`,
    {
      subject: "You're on the schedule: {{schedule.start_date | date}}",
      body: `${HI},\n\nYou're on the schedule. We start {{schedule.start_date | date}} ({{schedule.dates}}) and arrive between {{schedule.arrival_window}}. {{schedule.crew_lead_first_name | default:"Our crew lead"}} leads your crew.\n\nOur rain-day promise: if rain gets in the way, you're first on the schedule when it clears, and the delay never costs you anything.\n\nReply to this message or call us if anything changes on your side.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "schedule_moved",
    "Your dates changed",
    "schedule",
    "Sent when published dates move.",
    `${HI}, your painting dates have changed. We now start {{schedule.start_date | date}} ({{schedule.dates}}). We'll arrive between {{schedule.arrival_window}}. ${SMS_SIGN}`,
    {
      subject: "New start date: {{schedule.start_date | date}}",
      body: `${HI},\n\nYour painting dates have changed. We now start {{schedule.start_date | date}} ({{schedule.dates}}) and arrive between {{schedule.arrival_window}}.\n\nReply to this message or call us if the new dates don't work.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "schedule_unscheduled",
    "Taken off the schedule",
    "schedule",
    "Sent when a job's dates are taken off the schedule.",
    `${HI}, we've taken your painting dates off the schedule for now. I'll call you to set new ones. ${SMS_SIGN}`,
    {
      subject: "Your painting dates",
      body: `${HI},\n\nWe've taken your painting dates off the schedule for now. I'll call you to set new ones.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "schedule_crew_changed",
    "Your crew changed",
    "schedule",
    "Sent when the crew changes but the dates stay.",
    `${HI}, a quick update: your dates stay {{schedule.dates}}. {{schedule.crew_lead_first_name | default:"Our crew lead"}} leads your crew. ${SMS_SIGN}`,
    {
      subject: "Your crew for the painting work",
      body: `${HI},\n\nA quick update: your dates stay {{schedule.dates}}. {{schedule.crew_lead_first_name | default:"Our crew lead"}} leads your crew.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "schedule_day_before",
    "We start tomorrow",
    "schedule",
    "Sent the afternoon before the first production day.",
    `${HI}, we start tomorrow! We'll arrive between {{schedule.arrival_window}}. Please clear the work area if you can. See you then. ${SMS_SIGN}`,
    {
      subject: "We start tomorrow",
      body: `${HI},\n\nWe start tomorrow, {{schedule.start_date | date}}. We'll arrive between {{schedule.arrival_window}}.\n\nA quick reminder of how to get ready:\n{{job.prep_list}}\n\nSee you then.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "crew_schedule_notice",
    "Schedule update for the crew (staff)",
    "internal",
    "Sent to the crew lead when their schedule changes.",
    "Schedule update: {{schedule.crew_changes}}. Open My Projects for scope, colors and access notes.",
    {
      subject: "Schedule update: {{job.name}}",
      body: "Schedule changes:\n{{schedule.crew_changes}}\n\nOpen My Projects for scope, colors and access notes.",
    },
  ),

  // 9. Rain delay (SPEC §11.2 #9 wording).
  ...pair(
    "rain_delay",
    "Rain delay",
    "weather",
    "Sent when a rain delay is marked on an exterior or deck job.",
    `${HI}, rain's coming in {{rain_delay.date | weekday}}. We'll move your start to the next dry day, and you're first on the list. No cost to you. ${SMS_SIGN}`,
    {
      subject: "Rain delay: we'll move your start to the next dry day",
      body: `${HI},\n\nRain's coming in {{rain_delay.date | weekday}}. We'll move your start to the next dry day, and you're first on the list. No cost to you.\n\n${EMAIL_SIGN}`,
    },
  ),

  // 10. Promised start missed (staff).
  ...pair(
    "internal_start_missed",
    "Start date missed (staff)",
    "internal",
    "Tells the owners a start slipped and the on-time credit is drafted.",
    "{{job.name}} didn't start on its promised date. An On-Time Guarantee credit is drafted for your approval.",
    {
      subject: "Start date missed: {{job.name}}",
      body: "{{job.name}} didn't start on its promised date, and it wasn't the weather. An On-Time Guarantee credit is drafted and waiting for an owner to approve or waive it (Job → Schedule).\n\n{{job.link}}",
    },
  ),

  // 11. Daily log → customer update, signed by the point of contact.
  ...pair(
    "daily_update",
    "Daily update",
    "daily_update",
    "Sent from the crew lead's daily log.",
    `${HI}, today's update: {{daily_log.finished_today}}. Next up: {{daily_log.next_up | default:"more of the same tomorrow"}}. The work area is cleaned up for the evening. {{daily_log.photo_note | default:""}} ${SMS_SIGN}`,
    {
      subject: "Today's update on your painting project",
      body: `${HI},\n\nFinished today: {{daily_log.finished_today}}\nNext up: {{daily_log.next_up | default:"more of the same tomorrow"}}\n\nThe work area is cleaned up for the evening. {{daily_log.photo_note | default:""}}\n\n${EMAIL_SIGN}`,
    },
  ),

  // 12. Work orders complete → final walkthrough request.
  ...pair(
    "final_walkthrough_request",
    "Final walkthrough request",
    "completion",
    "Sent when all work orders are complete.",
    `${HI}, the painting is done! Let's do a final walkthrough together so we can fix any touch-ups on the spot. What day and time work for you? ${SMS_SIGN}`,
    {
      subject: "Time for your final walkthrough",
      body: `${HI},\n\nThe painting is done. Let's walk through it together so we can fix any touch-ups on the spot.\n\nWhat day and time work for you? It takes about 45 minutes.\n\n${EMAIL_SIGN}`,
    },
  ),

  // 13. Final walkthrough signed off → final invoice drafted (staff).
  ...pair(
    "internal_final_invoice_ready",
    "Final invoice drafted (staff)",
    "internal",
    "Tells the office the job is complete and the final invoice is drafted.",
    "{{job.name}} is Completed. The final invoice is drafted. Review and send it.",
    {
      subject: "Final invoice ready to send: {{job.name}}",
      body: "{{job.name}} is Completed and the final invoice is drafted. Review it and send it from Job → Financial.\n\n{{job.link}}",
    },
  ),

  // 14. Invoice overdue 7 / 30 days → reminder (key kept from Phase 7).
  ...pair(
    "invoice_reminder",
    "Invoice reminder",
    "billing",
    "Sent 7 and 30 days after an invoice is due.",
    `${HI}, a friendly note from {{company.name}}: invoice {{invoice.number}} has {{invoice.balance_cents | money}} still open. {{invoice.how_to_pay}} Already paid? Thank you, and ignore this.`,
    {
      subject: "Reminder: invoice {{invoice.number}}",
      body: `${HI},\n\nA friendly reminder that invoice {{invoice.number}} has {{invoice.balance_cents | money}} still open ({{invoice.days_past_due}} days past due).\n\n{{invoice.how_to_pay}}\n\nAlready paid? Thank you, and please ignore this. Questions? Just reply.\n\n${EMAIL_SIGN}`,
    },
  ),

  ...pair(
    "internal_invoice_overdue",
    "Invoice overdue (staff)",
    "internal",
    "Tells the job's people and the owners an invoice is past due.",
    "Invoice {{invoice.number}} is {{invoice.days_past_due}} days past due on {{job.name}}: {{invoice.balance_cents | money}} open.",
    {
      subject: "Invoice {{invoice.number}} is past due: {{job.name}}",
      body: "Invoice {{invoice.number}} on {{job.name}} is {{invoice.days_past_due}} days past due with {{invoice.balance_cents | money}} still open. A reminder went to the customer if they can be reached.\n\n{{job.link}}",
    },
  ),

  // 15. Paid in full → thank-you + warranty, review (+2 d), referral (+14 d), 1-year check-in.
  ...pair(
    "paid_in_full_thanks",
    "Thank you + warranty",
    "completion",
    "Sent when the balance reaches $0.",
    `${HI}, thank you! You're paid in full. It was a pleasure working on your home. Your warranty details are in your email. ${SMS_SIGN}`,
    {
      subject: "Thank you from {{company.name}}",
      body: `${HI},\n\nThank you. You're paid in full, and it was a pleasure working on your home.\n\nYour warranty: [WARRANTY_TERMS]\n\nIf anything doesn't look right, reply here or call {{company.phone}} and we'll come take a look.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "review_request",
    "Review request",
    "review_referral",
    "Sent a few days after Paid in Full (delay in Reviews settings).",
    `${HI}, it's {{poc.first_name}} with {{company.name}}. If you're happy with the work, would you leave us a quick review? It helps a small local company a lot: {{review.link}}`,
    {
      subject: "Would you leave us a quick review?",
      body: `${HI},\n\nIf you're happy with how your home turned out, would you leave us a quick review? It takes a minute and helps a small local company a lot.\n\n{{review.link}}\n\nThank you!\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "referral_invite",
    "Bear Champions invite",
    "review_referral",
    "Sent two weeks after Paid in Full with the customer's champion code.",
    `${HI}, know a neighbor who needs painting? Share your code {{referral.code}}. When they book with us, you get {{referral.reward}}. ${SMS_SIGN}`,
    {
      subject: "Know someone who needs painting?",
      body: `${HI},\n\nIf a friend or neighbor needs painting, we'd love to help them too.\n\nYour Bear Champion code is {{referral.code}}. When someone books with your code and their project is paid in full, you get {{referral.reward}}.\n\nThey can mention the code when they call, or enter it on our estimate form.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "one_year_check_in",
    "One-year check-in",
    "completion",
    "Sent a year after Paid in Full.",
    `${HI}, it's been a year since we painted your home. How's the paint holding up? If anything needs a touch-up, just reply. ${SMS_SIGN}`,
    {
      subject: "How's the paint holding up?",
      body: `${HI},\n\nIt's been about a year since we painted your home. How's it holding up?\n\nIf you see peeling, cracking or anything that doesn't look right, reply here and we'll take a look.\n\n${EMAIL_SIGN}`,
    },
  ),

  // 16. Nurture drips (marketing).
  ...pair(
    "nurture_just_planning_1",
    "Just planning – 1",
    "marketing",
    "First step of the just-planning nurture drip.",
    `${HI}, it's {{poc.first_name}} with {{company.name}}. No rush on your project. When you're ready for a walkthrough, just reply. ${SMS_SIGN}`,
    {
      subject: "Whenever you're ready",
      body: `${HI},\n\nNo rush on your painting project. When you're ready, we'll come out for a walkthrough, measure, and send a written estimate within 24 hours.\n\nJust reply when the timing is right.\n\n${EMAIL_SIGN}`,
    },
    "marketing",
  ),
  ...pair(
    "nurture_just_planning_2",
    "Just planning – 2",
    "marketing",
    "Second step of the just-planning nurture drip.",
    `${HI}, still thinking about painting? Happy to come by and give you a written estimate, no pressure. ${SMS_SIGN}`,
    {
      subject: "Still thinking about painting?",
      body: `${HI},\n\nStill thinking about your painting project? A walkthrough is free and there's no pressure. You'll get an itemized estimate with add-ons listed as options, so you pick the scope.\n\nReply with a day that works.\n\n${EMAIL_SIGN}`,
    },
    "marketing",
  ),
  ...pair(
    "nurture_just_planning_3",
    "Just planning – 3",
    "marketing",
    "Last step of the just-planning nurture drip.",
    `${HI}, checking in one last time about your painting project. Reply any time and we'll set up a walkthrough. ${SMS_SIGN}`,
    {
      subject: "Checking in about your painting project",
      body: `${HI},\n\nChecking in one last time. Whenever you're ready, reply here and we'll set up a walkthrough.\n\n${EMAIL_SIGN}`,
    },
    "marketing",
  ),
  ...pair(
    "exterior_preseason_feb",
    "Exterior pre-season – February",
    "marketing",
    "Exterior pre-season drip, February.",
    `${HI}, it's {{company.name}}. Exterior dates for this summer are starting to fill up. Want a walkthrough before the rush? ${SMS_SIGN}`,
    {
      subject: "Exterior dates for this summer are filling up",
      body: `${HI},\n\nExterior painting season runs roughly June through September here, and dates are starting to fill up.\n\nIf you'd like your house painted this summer, now is a good time for a walkthrough. You'll get a written estimate within 24 hours.\n\n${EMAIL_SIGN}`,
    },
    "marketing",
  ),
  ...pair(
    "exterior_preseason_mar",
    "Exterior pre-season – March",
    "marketing",
    "Exterior pre-season drip, March.",
    `${HI}, exterior dates for this summer are filling up. Reply if you'd like a walkthrough. ${SMS_SIGN}`,
    {
      subject: "Exterior dates for this summer are filling up",
      body: `${HI},\n\nA quick note: exterior dates for this summer are filling up. Booking early means you get the dates you want.\n\nReply with a day that works for a walkthrough.\n\n${EMAIL_SIGN}`,
    },
    "marketing",
  ),
  ...pair(
    "exterior_preseason_apr",
    "Exterior pre-season – April",
    "marketing",
    "Exterior pre-season drip, April.",
    `${HI}, a few exterior dates are still open this summer. Want one? Reply and we'll set up a walkthrough. ${SMS_SIGN}`,
    {
      subject: "A few exterior dates are still open",
      body: `${HI},\n\nA few exterior dates are still open this summer. If you'd like one, reply and we'll set up a walkthrough.\n\n${EMAIL_SIGN}`,
    },
    "marketing",
  ),

  // 17. Subcontractor paperwork expiring.
  ...pair(
    "internal_sub_compliance",
    "Subcontractor paperwork expiring (staff)",
    "internal",
    "Tells the owners a subcontractor's paperwork expires soon.",
    "{{subcontractor.company_name}}: {{subcontractor.issues}}",
    {
      subject: "Subcontractor paperwork: {{subcontractor.company_name}}",
      body: "{{subcontractor.company_name}} needs attention:\n{{subcontractor.issues}}\n\nUpdate it in Admin → Subcontractors. Expired paperwork blocks scheduling their crews.",
    },
  ),
  ...pair(
    "sub_compliance_notice",
    "Paperwork reminder to the subcontractor",
    "internal",
    "Sent to the subcontractor's contact.",
    `Hi from {{company.name}}. A reminder about your paperwork with us: {{subcontractor.issues}} Please send the updated copy when you can.`,
    {
      subject: "Updated paperwork for {{company.name}}",
      body: "Hello,\n\nA reminder about your paperwork with {{company.name}}:\n{{subcontractor.issues}}\n\nPlease send the updated copy when you can. Thank you.\n\n{{company.name}}\n{{company.phone}}",
    },
  ),

  // Onboarding requests (Phase 5 drafts; keys unchanged — the Prep check reads prep_instructions).
  ...pair(
    "prep_instructions",
    "Prep instructions",
    "sold_onboarding",
    "How to get the house ready. Clears the Prep instructions onboarding item.",
    `${HI}, it's {{poc.first_name}} with {{company.name}}. Before we start, here's how to get ready. I've emailed the full list. Questions? Just reply.`,
    {
      subject: "Getting ready for your paint project",
      body: `${HI},\n\nA few things that help us start on time and keep your home clean:\n\n{{job.prep_list}}\n\nIf any of this is hard to do, tell us and we'll work it out.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "onboarding_contact",
    "Best way to reach you",
    "sold_onboarding",
    "Asks for a mobile number and email for updates.",
    `${HI}, it's {{poc.first_name}} with {{company.name}}. What's the best mobile number and email for updates during your project?`,
    {
      subject: "Best way to reach you during the project",
      body: `${HI},\n\nWe send a short photo update each day we're working. What's the best mobile number and email to use?\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "onboarding_access",
    "Access questions",
    "sold_onboarding",
    "Asks about access, pets, parking and occupancy.",
    `${HI}, it's {{poc.first_name}} with {{company.name}}. Quick questions before we start: how do we get in, any pets, where should the crew park, and will anyone be home?`,
    {
      subject: "A few questions before we start",
      body: `${HI},\n\nSo the crew shows up ready, could you tell us:\n- How we get in (gate, lockbox, someone home)\n- Any pets we should know about\n- Where the crew should park\n- Whether the home will be occupied while we work\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "onboarding_colors",
    "Color choices",
    "sold_onboarding",
    "Asks for the remaining color choices.",
    `${HI}, it's {{poc.first_name}} with {{company.name}}. We still need your color choices for a few surfaces. Want to go over them by phone, or send them over?`,
    {
      subject: "Your color choices",
      body: `${HI},\n\nWe still need colors for a few surfaces on your color sheet. Send the color names (and brand if you know it), or reply and we'll set up a quick call.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "onboarding_hoa",
    "HOA color approval",
    "sold_onboarding",
    "Asks for the HOA's approval of exterior colors.",
    `${HI}, it's {{poc.first_name}} with {{company.name}}. Has your HOA approved the exterior colors yet? When you have the approval, reply with a photo or forward the email.`,
    {
      subject: "HOA color approval",
      body: `${HI},\n\nYour HOA needs to approve exterior color changes before we can schedule. When you have the approval letter or email, please forward it to us.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "onboarding_lead_safe",
    "Lead-safe pamphlet",
    "sold_onboarding",
    "Asks the customer to read and sign the lead-safe pamphlet acknowledgment.",
    `${HI}, it's {{poc.first_name}} with {{company.name}}. Because your home was built before 1978, we follow lead-safe practices. I've emailed the pamphlet to read and sign.`,
    {
      subject: "Lead-safe work at your home",
      body: `${HI},\n\nHomes built before 1978 may have lead paint, so we follow lead-safe work practices. Before we start, please read the “Renovate Right” pamphlet and sign the acknowledgment. Reply if you have any questions.\n\n${EMAIL_SIGN}`,
    },
  ),

  // Warranty / service cases.
  ...pair(
    "case_received",
    "We got your request",
    "warranty",
    "Acknowledges a warranty or service request.",
    `${HI}, we got your note about {{case.title}} (case {{case.number}}). {{poc.first_name}} will call you within 2 business days to set up a visit. ${SMS_SIGN}`,
    {
      subject: "We got your request ({{case.number}})",
      body: `${HI},\n\nWe got your note about {{case.title}} (case {{case.number}}).\n\n{{poc.first_name}} will call you within 2 business days to talk it through and set up a visit if one is needed.\n\n${EMAIL_SIGN}`,
    },
  ),
  ...pair(
    "case_visit_booked",
    "Warranty visit booked",
    "warranty",
    "Confirms a warranty visit.",
    `${HI}, we'll come by {{appointment.start | datetime}} to look at {{case.title}}. ${SMS_SIGN}`,
    {
      subject: "Warranty visit: {{appointment.start | date}}",
      body: `${HI},\n\nWe'll come by {{appointment.start | datetime}} to look at {{case.title}} (case {{case.number}}).\n\nNeed a different time? Just reply.\n\n${EMAIL_SIGN}`,
    },
  ),
];

export function defaultTemplate(
  key: string,
  channel: TemplateChannel,
): DefaultTemplate | undefined {
  return DEFAULT_TEMPLATES.find((t) => t.key === key && t.channel === channel);
}

export const DEFAULT_TEMPLATE_KEYS: readonly string[] = [
  ...new Set(DEFAULT_TEMPLATES.map((t) => t.key)),
];
