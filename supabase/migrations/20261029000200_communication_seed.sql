-- Phase 8 · Communication & growth configuration seed (SPEC §11.2, §11.3,
-- §11.4, §8.11, §8.16, §8.18, §8.19, §9, §15.1).
--
-- Real configuration only, no messages or campaigns. Generated from the
-- TypeScript defaults by scripts/gen-communication-seed.mts (a unit test keeps
-- them in step):
-- - SMS and email templates for every seeded workflow, the onboarding requests,
--   the drips and warranty cases, all "Draft – owner to approve";
-- - the 17 workflows of SPEC §11.2, all ON (definitions live in
--   lib/domain/workflows/catalog.ts; this is their switch);
-- - the 8 follow-up lists and the dispositions (Positive / Negative / Callback /
--   No Contact / Won);
-- - the just-planning nurture and exterior pre-season drips;
-- - notification defaults per event, messaging settings (quiet hours 8 pm–8 am
--   Pacific), referral settings (reward stays in Company Settings, unset), and
--   the two new attention rules (unread customer message, warranty request).
--
-- Idempotent (on conflict do nothing): safe to run on a database that already
-- has Phases 0–7 and never overwrites what owners have edited.
--
-- Rollback: supabase/rollbacks/20261029000200_communication_seed.down.sql

create or replace function app.seed_communication_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.message_templates (org_id, key, channel, name, description, category, subject, body, message_type, is_system)
  values
    (p_org, 'lead_text_back', 'sms', 'New lead text-back', 'Sent within minutes of a new website lead.', 'lead', null, 'Hi {{contact.first_name | default:"there"}}, this is {{poc.first_name}} with {{company.name}}. Got your request for {{lead.services}}. When''s a good time for a quick walkthrough?', 'transactional', true),
    (p_org, 'lead_text_back', 'email', 'New lead text-back', 'Sent within minutes of a new website lead.', 'lead', 'Got your painting request', 'Hi {{contact.first_name | default:"there"}},

This is {{poc.first_name}} with {{company.name}}. We got your request for {{lead.services}}.

When''s a good time for a quick walkthrough? We''ll look at the work, measure, and talk colors. It takes about an hour.

Just reply with a day and time that works.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'walkthrough_confirmation', 'sms', 'Walkthrough confirmation', 'Sent when a walkthrough is booked.', 'walkthrough', null, 'Hi {{contact.first_name | default:"there"}}, you''re booked: {{appointment.with | default:"we"}} will come by {{appointment.start | datetime}} for your walkthrough. It takes about an hour. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'walkthrough_confirmation', 'email', 'Walkthrough confirmation', 'Sent when a walkthrough is booked.', 'walkthrough', 'Your walkthrough: {{appointment.start | date}}', 'Hi {{contact.first_name | default:"there"}},

You''re booked for a walkthrough on {{appointment.start | datetime}}. {{appointment.with | default:"Someone from our team"}} will come by.

What to expect:
- We walk through each area you want painted and take measurements.
- We point out any repairs we see, like soft wood or drywall damage.
- We talk about colors and sheens.

It takes about an hour. You''ll have a written estimate within 24 hours.

Need a different time? Just reply.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'walkthrough_reminder_24h', 'sms', 'Walkthrough reminder (day before)', 'Sent 24 hours before the walkthrough.', 'walkthrough', null, 'Hi {{contact.first_name | default:"there"}}, a reminder that we''ll see you tomorrow, {{appointment.start | datetime}}, for your walkthrough. Need to move it? Just reply. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'walkthrough_reminder_24h', 'email', 'Walkthrough reminder (day before)', 'Sent 24 hours before the walkthrough.', 'walkthrough', 'See you tomorrow: {{appointment.start | time}}', 'Hi {{contact.first_name | default:"there"}},

A reminder that we''ll see you tomorrow, {{appointment.start | datetime}}, for your walkthrough.

Need to move it? Just reply.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'walkthrough_reminder_2h', 'sms', 'Walkthrough reminder (2 hours)', 'Sent 2 hours before the walkthrough.', 'walkthrough', null, 'Hi {{contact.first_name | default:"there"}}, {{appointment.with | default:"we"}} will be there at {{appointment.start | time}} for your walkthrough. See you soon. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'walkthrough_reminder_2h', 'email', 'Walkthrough reminder (2 hours)', 'Sent 2 hours before the walkthrough.', 'walkthrough', 'See you at {{appointment.start | time}}', 'Hi {{contact.first_name | default:"there"}},

We''ll be there at {{appointment.start | time}} for your walkthrough. See you soon.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'internal_estimate_due', 'sms', 'Estimate due in 24 hours (staff)', 'Tells the estimator the written estimate is due.', 'internal', null, 'Walkthrough done for {{job.name}}. The written estimate is due within 24 hours.', 'transactional', true),
    (p_org, 'internal_estimate_due', 'email', 'Estimate due in 24 hours (staff)', 'Tells the estimator the written estimate is due.', 'internal', 'Estimate due: {{job.name}}', 'The walkthrough for {{job.name}} is done. The written estimate is due within 24 hours.

{{job.link}}', 'transactional', true),
    (p_org, 'estimate_follow_up_day2', 'sms', 'Estimate follow-up (day 2)', 'Two days after the estimate was sent.', 'estimate', null, 'Hi {{contact.first_name | default:"there"}}, it''s {{poc.first_name}} with {{company.name}}. Any questions on your estimate? Here it is again: {{estimate.link}} - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'estimate_follow_up_day2', 'email', 'Estimate follow-up (day 2)', 'Two days after the estimate was sent.', 'estimate', 'Questions on your estimate?', 'Hi {{contact.first_name | default:"there"}},

Checking in on the estimate we sent {{estimate.sent_at | date}}. Happy to answer any questions or adjust the scope.

You can open it here: {{estimate.link}}

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'estimate_follow_up_day5', 'sms', 'Estimate follow-up (day 5)', 'Five days after the estimate was sent.', 'estimate', null, 'Hi {{contact.first_name | default:"there"}}, just checking in on your painting estimate. Want to change anything in the scope? Reply here or open it: {{estimate.link}} - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'estimate_follow_up_day5', 'email', 'Estimate follow-up (day 5)', 'Five days after the estimate was sent.', 'estimate', 'Your painting estimate', 'Hi {{contact.first_name | default:"there"}},

Just checking in on your estimate ({{estimate.number}}).

If you''d like a different option, fewer areas, or other colors, tell us and we''ll update it. Add-ons are listed as options, so you pick the scope.

Open your estimate: {{estimate.link}}

It''s good until {{estimate.expires_at | date}}.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'estimate_follow_up_day10', 'sms', 'Estimate follow-up (day 10, from the owner)', 'Ten days after the estimate was sent, from the job''s owner.', 'estimate', null, 'Hi {{contact.first_name | default:"there"}}, this is {{job.owner.first_name | default:"the owner"}}, one of the owners of {{company.name}}. Wanted to make sure your estimate made sense. Anything I can help with? {{estimate.link}}', 'transactional', true),
    (p_org, 'estimate_follow_up_day10', 'email', 'Estimate follow-up (day 10, from the owner)', 'Ten days after the estimate was sent, from the job''s owner.', 'estimate', 'A note from {{company.name}}', 'Hi {{contact.first_name | default:"there"}},

This is {{job.owner.first_name | default:"one of the owners"}} at {{company.name}}. I wanted to make sure the estimate we sent made sense and answered your questions.

If the timing isn''t right, that''s fine too. Just let me know.

Your estimate: {{estimate.link}}

{{job.owner.full_name | default:"Brushy Bear Painters"}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'welcome', 'sms', 'Welcome – what happens next', 'Sent when the customer accepts and signs. Includes the prep list, so it also clears the Prep instructions item.', 'sold_onboarding', null, 'Hi {{contact.first_name | default:"there"}}, thank you for choosing {{company.name}}! I''m {{poc.first_name}}, your point of contact for the whole project. Next up: the deposit, then colors, then we text you a start date. Questions? Just reply.', 'transactional', true),
    (p_org, 'welcome', 'email', 'Welcome – what happens next', 'Sent when the customer accepts and signs. Includes the prep list, so it also clears the Prep instructions item.', 'sold_onboarding', 'Welcome to {{company.name}}: what happens next', 'Hi {{contact.first_name | default:"there"}},

Thank you for choosing us. I''m {{poc.first_name}}, your point of contact for the whole project.

What happens next:
1. Deposit: your deposit invoice is on its way.
2. Colors: we''ll confirm a color for every surface with you.
3. Scheduling: once the deposit and colors are set, we put you on the schedule and text you the start date.
4. During the work: a photo update every day, and a clean house every evening.

Getting the house ready:
{{job.prep_list}}

Questions any time? Just reply.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'internal_deposit_paid', 'sms', 'Deposit paid (staff)', 'Tells the office the deposit is in and the Deposit Hold is released.', 'internal', null, 'Deposit paid on {{job.name}}. The Deposit Hold is released.', 'transactional', true),
    (p_org, 'internal_deposit_paid', 'email', 'Deposit paid (staff)', 'Tells the office the deposit is in and the Deposit Hold is released.', 'internal', 'Deposit paid: {{job.name}}', 'The deposit on {{job.name}} is paid and the Deposit Hold is released.

{{job.link}}', 'transactional', true),
    (p_org, 'internal_ready_to_schedule', 'sms', 'Ready to schedule (staff)', 'Tells the scheduler a job cleared onboarding.', 'internal', null, '{{job.name}} cleared onboarding and is Ready to Schedule.', 'transactional', true),
    (p_org, 'internal_ready_to_schedule', 'email', 'Ready to schedule (staff)', 'Tells the scheduler a job cleared onboarding.', 'internal', 'Ready to schedule: {{job.name}}', '{{job.name}} cleared every onboarding item and is Ready to Schedule.

Open the Master Schedule to place it.

{{job.link}}', 'transactional', true),
    (p_org, 'schedule_published', 'sms', 'You''re on the schedule', 'Sent when a job''s dates are published for the first time.', 'schedule', null, 'Hi {{contact.first_name | default:"there"}}, you''re on the schedule! We start {{schedule.start_date | date}} ({{schedule.dates}}). We''ll arrive between {{schedule.arrival_window}}. {{schedule.crew_lead_first_name | default:"Our crew lead"}} leads your crew. If rain gets in the way, you''re first on the schedule when it clears, and the delay never costs you anything. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'schedule_published', 'email', 'You''re on the schedule', 'Sent when a job''s dates are published for the first time.', 'schedule', 'You''re on the schedule: {{schedule.start_date | date}}', 'Hi {{contact.first_name | default:"there"}},

You''re on the schedule. We start {{schedule.start_date | date}} ({{schedule.dates}}) and arrive between {{schedule.arrival_window}}. {{schedule.crew_lead_first_name | default:"Our crew lead"}} leads your crew.

Our rain-day promise: if rain gets in the way, you''re first on the schedule when it clears, and the delay never costs you anything.

Reply to this message or call us if anything changes on your side.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'schedule_moved', 'sms', 'Your dates changed', 'Sent when published dates move.', 'schedule', null, 'Hi {{contact.first_name | default:"there"}}, your painting dates have changed. We now start {{schedule.start_date | date}} ({{schedule.dates}}). We''ll arrive between {{schedule.arrival_window}}. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'schedule_moved', 'email', 'Your dates changed', 'Sent when published dates move.', 'schedule', 'New start date: {{schedule.start_date | date}}', 'Hi {{contact.first_name | default:"there"}},

Your painting dates have changed. We now start {{schedule.start_date | date}} ({{schedule.dates}}) and arrive between {{schedule.arrival_window}}.

Reply to this message or call us if the new dates don''t work.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'schedule_unscheduled', 'sms', 'Taken off the schedule', 'Sent when a job''s dates are taken off the schedule.', 'schedule', null, 'Hi {{contact.first_name | default:"there"}}, we''ve taken your painting dates off the schedule for now. I''ll call you to set new ones. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'schedule_unscheduled', 'email', 'Taken off the schedule', 'Sent when a job''s dates are taken off the schedule.', 'schedule', 'Your painting dates', 'Hi {{contact.first_name | default:"there"}},

We''ve taken your painting dates off the schedule for now. I''ll call you to set new ones.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'schedule_crew_changed', 'sms', 'Your crew changed', 'Sent when the crew changes but the dates stay.', 'schedule', null, 'Hi {{contact.first_name | default:"there"}}, a quick update: your dates stay {{schedule.dates}}. {{schedule.crew_lead_first_name | default:"Our crew lead"}} leads your crew. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'schedule_crew_changed', 'email', 'Your crew changed', 'Sent when the crew changes but the dates stay.', 'schedule', 'Your crew for the painting work', 'Hi {{contact.first_name | default:"there"}},

A quick update: your dates stay {{schedule.dates}}. {{schedule.crew_lead_first_name | default:"Our crew lead"}} leads your crew.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'schedule_day_before', 'sms', 'We start tomorrow', 'Sent the afternoon before the first production day.', 'schedule', null, 'Hi {{contact.first_name | default:"there"}}, we start tomorrow! We''ll arrive between {{schedule.arrival_window}}. Please clear the work area if you can. See you then. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'schedule_day_before', 'email', 'We start tomorrow', 'Sent the afternoon before the first production day.', 'schedule', 'We start tomorrow', 'Hi {{contact.first_name | default:"there"}},

We start tomorrow, {{schedule.start_date | date}}. We''ll arrive between {{schedule.arrival_window}}.

A quick reminder of how to get ready:
{{job.prep_list}}

See you then.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'crew_schedule_notice', 'sms', 'Schedule update for the crew (staff)', 'Sent to the crew lead when their schedule changes.', 'internal', null, 'Schedule update: {{schedule.crew_changes}}. Open My Projects for scope, colors and access notes.', 'transactional', true),
    (p_org, 'crew_schedule_notice', 'email', 'Schedule update for the crew (staff)', 'Sent to the crew lead when their schedule changes.', 'internal', 'Schedule update: {{job.name}}', 'Schedule changes:
{{schedule.crew_changes}}

Open My Projects for scope, colors and access notes.', 'transactional', true),
    (p_org, 'rain_delay', 'sms', 'Rain delay', 'Sent when a rain delay is marked on an exterior or deck job.', 'weather', null, 'Hi {{contact.first_name | default:"there"}}, rain''s coming in {{rain_delay.date | weekday}}. We''ll move your start to the next dry day, and you''re first on the list. No cost to you. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'rain_delay', 'email', 'Rain delay', 'Sent when a rain delay is marked on an exterior or deck job.', 'weather', 'Rain delay: we''ll move your start to the next dry day', 'Hi {{contact.first_name | default:"there"}},

Rain''s coming in {{rain_delay.date | weekday}}. We''ll move your start to the next dry day, and you''re first on the list. No cost to you.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'internal_start_missed', 'sms', 'Start date missed (staff)', 'Tells the owners a start slipped and the on-time credit is drafted.', 'internal', null, '{{job.name}} didn''t start on its promised date. An On-Time Guarantee credit is drafted for your approval.', 'transactional', true),
    (p_org, 'internal_start_missed', 'email', 'Start date missed (staff)', 'Tells the owners a start slipped and the on-time credit is drafted.', 'internal', 'Start date missed: {{job.name}}', '{{job.name}} didn''t start on its promised date, and it wasn''t the weather. An On-Time Guarantee credit is drafted and waiting for an owner to approve or waive it (Job → Schedule).

{{job.link}}', 'transactional', true),
    (p_org, 'daily_update', 'sms', 'Daily update', 'Sent from the crew lead''s daily log.', 'daily_update', null, 'Hi {{contact.first_name | default:"there"}}, today''s update: {{daily_log.finished_today}}. Next up: {{daily_log.next_up | default:"more of the same tomorrow"}}. The work area is cleaned up for the evening. {{daily_log.photo_note | default:""}} - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'daily_update', 'email', 'Daily update', 'Sent from the crew lead''s daily log.', 'daily_update', 'Today''s update on your painting project', 'Hi {{contact.first_name | default:"there"}},

Finished today: {{daily_log.finished_today}}
Next up: {{daily_log.next_up | default:"more of the same tomorrow"}}

The work area is cleaned up for the evening. {{daily_log.photo_note | default:""}}

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'final_walkthrough_request', 'sms', 'Final walkthrough request', 'Sent when all work orders are complete.', 'completion', null, 'Hi {{contact.first_name | default:"there"}}, the painting is done! Let''s do a final walkthrough together so we can fix any touch-ups on the spot. What day and time work for you? - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'final_walkthrough_request', 'email', 'Final walkthrough request', 'Sent when all work orders are complete.', 'completion', 'Time for your final walkthrough', 'Hi {{contact.first_name | default:"there"}},

The painting is done. Let''s walk through it together so we can fix any touch-ups on the spot.

What day and time work for you? It takes about 45 minutes.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'internal_final_invoice_ready', 'sms', 'Final invoice drafted (staff)', 'Tells the office the job is complete and the final invoice is drafted.', 'internal', null, '{{job.name}} is Completed. The final invoice is drafted. Review and send it.', 'transactional', true),
    (p_org, 'internal_final_invoice_ready', 'email', 'Final invoice drafted (staff)', 'Tells the office the job is complete and the final invoice is drafted.', 'internal', 'Final invoice ready to send: {{job.name}}', '{{job.name}} is Completed and the final invoice is drafted. Review it and send it from Job → Financial.

{{job.link}}', 'transactional', true),
    (p_org, 'invoice_reminder', 'sms', 'Invoice reminder', 'Sent 7 and 30 days after an invoice is due.', 'billing', null, 'Hi {{contact.first_name | default:"there"}}, a friendly note from {{company.name}}: invoice {{invoice.number}} has {{invoice.balance_cents | money}} still open. {{invoice.how_to_pay}} Already paid? Thank you, and ignore this.', 'transactional', true),
    (p_org, 'invoice_reminder', 'email', 'Invoice reminder', 'Sent 7 and 30 days after an invoice is due.', 'billing', 'Reminder: invoice {{invoice.number}}', 'Hi {{contact.first_name | default:"there"}},

A friendly reminder that invoice {{invoice.number}} has {{invoice.balance_cents | money}} still open ({{invoice.days_past_due}} days past due).

{{invoice.how_to_pay}}

Already paid? Thank you, and please ignore this. Questions? Just reply.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'internal_invoice_overdue', 'sms', 'Invoice overdue (staff)', 'Tells the job''s people and the owners an invoice is past due.', 'internal', null, 'Invoice {{invoice.number}} is {{invoice.days_past_due}} days past due on {{job.name}}: {{invoice.balance_cents | money}} open.', 'transactional', true),
    (p_org, 'internal_invoice_overdue', 'email', 'Invoice overdue (staff)', 'Tells the job''s people and the owners an invoice is past due.', 'internal', 'Invoice {{invoice.number}} is past due: {{job.name}}', 'Invoice {{invoice.number}} on {{job.name}} is {{invoice.days_past_due}} days past due with {{invoice.balance_cents | money}} still open. A reminder went to the customer if they can be reached.

{{job.link}}', 'transactional', true),
    (p_org, 'paid_in_full_thanks', 'sms', 'Thank you + warranty', 'Sent when the balance reaches $0.', 'completion', null, 'Hi {{contact.first_name | default:"there"}}, thank you! You''re paid in full. It was a pleasure working on your home. Your warranty details are in your email. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'paid_in_full_thanks', 'email', 'Thank you + warranty', 'Sent when the balance reaches $0.', 'completion', 'Thank you from {{company.name}}', 'Hi {{contact.first_name | default:"there"}},

Thank you. You''re paid in full, and it was a pleasure working on your home.

Your warranty: [WARRANTY_TERMS]

If anything doesn''t look right, reply here or call {{company.phone}} and we''ll come take a look.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'review_request', 'sms', 'Review request', 'Sent a few days after Paid in Full (delay in Reviews settings).', 'review_referral', null, 'Hi {{contact.first_name | default:"there"}}, it''s {{poc.first_name}} with {{company.name}}. If you''re happy with the work, would you leave us a quick review? It helps a small local company a lot: {{review.link}}', 'transactional', true),
    (p_org, 'review_request', 'email', 'Review request', 'Sent a few days after Paid in Full (delay in Reviews settings).', 'review_referral', 'Would you leave us a quick review?', 'Hi {{contact.first_name | default:"there"}},

If you''re happy with how your home turned out, would you leave us a quick review? It takes a minute and helps a small local company a lot.

{{review.link}}

Thank you!

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'referral_invite', 'sms', 'Bear Champions invite', 'Sent two weeks after Paid in Full with the customer''s champion code.', 'review_referral', null, 'Hi {{contact.first_name | default:"there"}}, know a neighbor who needs painting? Share your code {{referral.code}}. When they book with us, you get {{referral.reward}}. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'referral_invite', 'email', 'Bear Champions invite', 'Sent two weeks after Paid in Full with the customer''s champion code.', 'review_referral', 'Know someone who needs painting?', 'Hi {{contact.first_name | default:"there"}},

If a friend or neighbor needs painting, we''d love to help them too.

Your Bear Champion code is {{referral.code}}. When someone books with your code and their project is paid in full, you get {{referral.reward}}.

They can mention the code when they call, or enter it on our estimate form.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'one_year_check_in', 'sms', 'One-year check-in', 'Sent a year after Paid in Full.', 'completion', null, 'Hi {{contact.first_name | default:"there"}}, it''s been a year since we painted your home. How''s the paint holding up? If anything needs a touch-up, just reply. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'one_year_check_in', 'email', 'One-year check-in', 'Sent a year after Paid in Full.', 'completion', 'How''s the paint holding up?', 'Hi {{contact.first_name | default:"there"}},

It''s been about a year since we painted your home. How''s it holding up?

If you see peeling, cracking or anything that doesn''t look right, reply here and we''ll take a look.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'nurture_just_planning_1', 'sms', 'Just planning – 1', 'First step of the just-planning nurture drip.', 'marketing', null, 'Hi {{contact.first_name | default:"there"}}, it''s {{poc.first_name}} with {{company.name}}. No rush on your project. When you''re ready for a walkthrough, just reply. - {{poc.first_name}}, {{company.name}}', 'marketing', true),
    (p_org, 'nurture_just_planning_1', 'email', 'Just planning – 1', 'First step of the just-planning nurture drip.', 'marketing', 'Whenever you''re ready', 'Hi {{contact.first_name | default:"there"}},

No rush on your painting project. When you''re ready, we''ll come out for a walkthrough, measure, and send a written estimate within 24 hours.

Just reply when the timing is right.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'marketing', true),
    (p_org, 'nurture_just_planning_2', 'sms', 'Just planning – 2', 'Second step of the just-planning nurture drip.', 'marketing', null, 'Hi {{contact.first_name | default:"there"}}, still thinking about painting? Happy to come by and give you a written estimate, no pressure. - {{poc.first_name}}, {{company.name}}', 'marketing', true),
    (p_org, 'nurture_just_planning_2', 'email', 'Just planning – 2', 'Second step of the just-planning nurture drip.', 'marketing', 'Still thinking about painting?', 'Hi {{contact.first_name | default:"there"}},

Still thinking about your painting project? A walkthrough is free and there''s no pressure. You''ll get an itemized estimate with add-ons listed as options, so you pick the scope.

Reply with a day that works.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'marketing', true),
    (p_org, 'nurture_just_planning_3', 'sms', 'Just planning – 3', 'Last step of the just-planning nurture drip.', 'marketing', null, 'Hi {{contact.first_name | default:"there"}}, checking in one last time about your painting project. Reply any time and we''ll set up a walkthrough. - {{poc.first_name}}, {{company.name}}', 'marketing', true),
    (p_org, 'nurture_just_planning_3', 'email', 'Just planning – 3', 'Last step of the just-planning nurture drip.', 'marketing', 'Checking in about your painting project', 'Hi {{contact.first_name | default:"there"}},

Checking in one last time. Whenever you''re ready, reply here and we''ll set up a walkthrough.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'marketing', true),
    (p_org, 'exterior_preseason_feb', 'sms', 'Exterior pre-season – February', 'Exterior pre-season drip, February.', 'marketing', null, 'Hi {{contact.first_name | default:"there"}}, it''s {{company.name}}. Exterior dates for this summer are starting to fill up. Want a walkthrough before the rush? - {{poc.first_name}}, {{company.name}}', 'marketing', true),
    (p_org, 'exterior_preseason_feb', 'email', 'Exterior pre-season – February', 'Exterior pre-season drip, February.', 'marketing', 'Exterior dates for this summer are filling up', 'Hi {{contact.first_name | default:"there"}},

Exterior painting season runs roughly June through September here, and dates are starting to fill up.

If you''d like your house painted this summer, now is a good time for a walkthrough. You''ll get a written estimate within 24 hours.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'marketing', true),
    (p_org, 'exterior_preseason_mar', 'sms', 'Exterior pre-season – March', 'Exterior pre-season drip, March.', 'marketing', null, 'Hi {{contact.first_name | default:"there"}}, exterior dates for this summer are filling up. Reply if you''d like a walkthrough. - {{poc.first_name}}, {{company.name}}', 'marketing', true),
    (p_org, 'exterior_preseason_mar', 'email', 'Exterior pre-season – March', 'Exterior pre-season drip, March.', 'marketing', 'Exterior dates for this summer are filling up', 'Hi {{contact.first_name | default:"there"}},

A quick note: exterior dates for this summer are filling up. Booking early means you get the dates you want.

Reply with a day that works for a walkthrough.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'marketing', true),
    (p_org, 'exterior_preseason_apr', 'sms', 'Exterior pre-season – April', 'Exterior pre-season drip, April.', 'marketing', null, 'Hi {{contact.first_name | default:"there"}}, a few exterior dates are still open this summer. Want one? Reply and we''ll set up a walkthrough. - {{poc.first_name}}, {{company.name}}', 'marketing', true),
    (p_org, 'exterior_preseason_apr', 'email', 'Exterior pre-season – April', 'Exterior pre-season drip, April.', 'marketing', 'A few exterior dates are still open', 'Hi {{contact.first_name | default:"there"}},

A few exterior dates are still open this summer. If you''d like one, reply and we''ll set up a walkthrough.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'marketing', true),
    (p_org, 'internal_sub_compliance', 'sms', 'Subcontractor paperwork expiring (staff)', 'Tells the owners a subcontractor''s paperwork expires soon.', 'internal', null, '{{subcontractor.company_name}}: {{subcontractor.issues}}', 'transactional', true),
    (p_org, 'internal_sub_compliance', 'email', 'Subcontractor paperwork expiring (staff)', 'Tells the owners a subcontractor''s paperwork expires soon.', 'internal', 'Subcontractor paperwork: {{subcontractor.company_name}}', '{{subcontractor.company_name}} needs attention:
{{subcontractor.issues}}

Update it in Admin → Subcontractors. Expired paperwork blocks scheduling their crews.', 'transactional', true),
    (p_org, 'sub_compliance_notice', 'sms', 'Paperwork reminder to the subcontractor', 'Sent to the subcontractor''s contact.', 'internal', null, 'Hi from {{company.name}}. A reminder about your paperwork with us: {{subcontractor.issues}} Please send the updated copy when you can.', 'transactional', true),
    (p_org, 'sub_compliance_notice', 'email', 'Paperwork reminder to the subcontractor', 'Sent to the subcontractor''s contact.', 'internal', 'Updated paperwork for {{company.name}}', 'Hello,

A reminder about your paperwork with {{company.name}}:
{{subcontractor.issues}}

Please send the updated copy when you can. Thank you.

{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'prep_instructions', 'sms', 'Prep instructions', 'How to get the house ready. Clears the Prep instructions onboarding item.', 'sold_onboarding', null, 'Hi {{contact.first_name | default:"there"}}, it''s {{poc.first_name}} with {{company.name}}. Before we start, here''s how to get ready. I''ve emailed the full list. Questions? Just reply.', 'transactional', true),
    (p_org, 'prep_instructions', 'email', 'Prep instructions', 'How to get the house ready. Clears the Prep instructions onboarding item.', 'sold_onboarding', 'Getting ready for your paint project', 'Hi {{contact.first_name | default:"there"}},

A few things that help us start on time and keep your home clean:

{{job.prep_list}}

If any of this is hard to do, tell us and we''ll work it out.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'onboarding_contact', 'sms', 'Best way to reach you', 'Asks for a mobile number and email for updates.', 'sold_onboarding', null, 'Hi {{contact.first_name | default:"there"}}, it''s {{poc.first_name}} with {{company.name}}. What''s the best mobile number and email for updates during your project?', 'transactional', true),
    (p_org, 'onboarding_contact', 'email', 'Best way to reach you', 'Asks for a mobile number and email for updates.', 'sold_onboarding', 'Best way to reach you during the project', 'Hi {{contact.first_name | default:"there"}},

We send a short photo update each day we''re working. What''s the best mobile number and email to use?

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'onboarding_access', 'sms', 'Access questions', 'Asks about access, pets, parking and occupancy.', 'sold_onboarding', null, 'Hi {{contact.first_name | default:"there"}}, it''s {{poc.first_name}} with {{company.name}}. Quick questions before we start: how do we get in, any pets, where should the crew park, and will anyone be home?', 'transactional', true),
    (p_org, 'onboarding_access', 'email', 'Access questions', 'Asks about access, pets, parking and occupancy.', 'sold_onboarding', 'A few questions before we start', 'Hi {{contact.first_name | default:"there"}},

So the crew shows up ready, could you tell us:
- How we get in (gate, lockbox, someone home)
- Any pets we should know about
- Where the crew should park
- Whether the home will be occupied while we work

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'onboarding_colors', 'sms', 'Color choices', 'Asks for the remaining color choices.', 'sold_onboarding', null, 'Hi {{contact.first_name | default:"there"}}, it''s {{poc.first_name}} with {{company.name}}. We still need your color choices for a few surfaces. Want to go over them by phone, or send them over?', 'transactional', true),
    (p_org, 'onboarding_colors', 'email', 'Color choices', 'Asks for the remaining color choices.', 'sold_onboarding', 'Your color choices', 'Hi {{contact.first_name | default:"there"}},

We still need colors for a few surfaces on your color sheet. Send the color names (and brand if you know it), or reply and we''ll set up a quick call.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'onboarding_hoa', 'sms', 'HOA color approval', 'Asks for the HOA''s approval of exterior colors.', 'sold_onboarding', null, 'Hi {{contact.first_name | default:"there"}}, it''s {{poc.first_name}} with {{company.name}}. Has your HOA approved the exterior colors yet? When you have the approval, reply with a photo or forward the email.', 'transactional', true),
    (p_org, 'onboarding_hoa', 'email', 'HOA color approval', 'Asks for the HOA''s approval of exterior colors.', 'sold_onboarding', 'HOA color approval', 'Hi {{contact.first_name | default:"there"}},

Your HOA needs to approve exterior color changes before we can schedule. When you have the approval letter or email, please forward it to us.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'onboarding_lead_safe', 'sms', 'Lead-safe pamphlet', 'Asks the customer to read and sign the lead-safe pamphlet acknowledgment.', 'sold_onboarding', null, 'Hi {{contact.first_name | default:"there"}}, it''s {{poc.first_name}} with {{company.name}}. Because your home was built before 1978, we follow lead-safe practices. I''ve emailed the pamphlet to read and sign.', 'transactional', true),
    (p_org, 'onboarding_lead_safe', 'email', 'Lead-safe pamphlet', 'Asks the customer to read and sign the lead-safe pamphlet acknowledgment.', 'sold_onboarding', 'Lead-safe work at your home', 'Hi {{contact.first_name | default:"there"}},

Homes built before 1978 may have lead paint, so we follow lead-safe work practices. Before we start, please read the “Renovate Right” pamphlet and sign the acknowledgment. Reply if you have any questions.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'case_received', 'sms', 'We got your request', 'Acknowledges a warranty or service request.', 'warranty', null, 'Hi {{contact.first_name | default:"there"}}, we got your note about {{case.title}} (case {{case.number}}). {{poc.first_name}} will call you within 2 business days to set up a visit. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'case_received', 'email', 'We got your request', 'Acknowledges a warranty or service request.', 'warranty', 'We got your request ({{case.number}})', 'Hi {{contact.first_name | default:"there"}},

We got your note about {{case.title}} (case {{case.number}}).

{{poc.first_name}} will call you within 2 business days to talk it through and set up a visit if one is needed.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true),
    (p_org, 'case_visit_booked', 'sms', 'Warranty visit booked', 'Confirms a warranty visit.', 'warranty', null, 'Hi {{contact.first_name | default:"there"}}, we''ll come by {{appointment.start | datetime}} to look at {{case.title}}. - {{poc.first_name}}, {{company.name}}', 'transactional', true),
    (p_org, 'case_visit_booked', 'email', 'Warranty visit booked', 'Confirms a warranty visit.', 'warranty', 'Warranty visit: {{appointment.start | date}}', 'Hi {{contact.first_name | default:"there"}},

We''ll come by {{appointment.start | datetime}} to look at {{case.title}} (case {{case.number}}).

Need a different time? Just reply.

{{poc.full_name}}
{{company.name}}
{{company.phone}}', 'transactional', true)
  on conflict (org_id, key, channel) do nothing;
  insert into public.workflows (org_id, key)
  values
    (p_org, 'lead_text_back'),
    (p_org, 'walkthrough_booked'),
    (p_org, 'walkthrough_completed'),
    (p_org, 'estimate_follow_up'),
    (p_org, 'estimate_accepted'),
    (p_org, 'deposit_paid'),
    (p_org, 'onboarding_cleared'),
    (p_org, 'schedule_published'),
    (p_org, 'rain_delay'),
    (p_org, 'start_missed'),
    (p_org, 'daily_log_update'),
    (p_org, 'work_orders_complete'),
    (p_org, 'final_walkthrough_signed_off'),
    (p_org, 'invoice_overdue'),
    (p_org, 'paid_in_full'),
    (p_org, 'nurture'),
    (p_org, 'sub_compliance')
  on conflict (org_id, key) do nothing;

  insert into public.follow_up_lists (org_id, key, name, description, script, cooldown_hours, sort_order)
  values
    (p_org, 'hot_new_leads', 'Hot New Leads', 'New and contacted leads from the last 24 hours with no walkthrough yet, best score first.', 'Hi, this is [your name] with Brushy Bear Painters. You asked about painting on our website. Do you have a minute?

- What are you looking to have painted?
- When would you like it done?
- Could we come by for a walkthrough? It takes about an hour and you get a written estimate within 24 hours.

Draft script – owner to approve.', 4, 10),
    (p_org, 'confirm_walkthroughs', 'Confirm Tomorrow''s Walkthroughs', 'Walkthroughs tomorrow (Pacific) that aren''t confirmed yet.', 'Hi, this is [your name] with Brushy Bear Painters. I''m calling to confirm your walkthrough tomorrow at [time]. Does that still work?

Draft script – owner to approve.', 20, 20),
    (p_org, 'estimates_awaiting_reply', 'Estimates Awaiting Reply', 'Estimates sent more than 3 days ago that haven''t been accepted or declined.', 'Hi, this is [your name] with Brushy Bear Painters. I''m following up on the estimate we sent. Any questions, or anything you''d like to change in the scope?

Draft script – owner to approve.', 48, 30),
    (p_org, 'callbacks', 'Callbacks Scheduled', 'Callbacks due today or overdue.', 'Pick up where the last call left off (see the last note).

Draft script – owner to approve.', 0, 40),
    (p_org, 'just_planning', 'Just-Planning Nurture', 'Open leads that are just planning or in Nurture.', 'Hi, this is [your name] with Brushy Bear Painters. You mentioned you were planning a painting project. Is the timing getting closer? Happy to come by for a walkthrough whenever you''re ready.

Draft script – owner to approve.', 336, 50),
    (p_org, 'pre_season_exterior', 'Pre-Season Exterior', 'Open exterior and deck leads, and unsold exterior estimates, ahead of the exterior season.', 'Hi, this is [your name] with Brushy Bear Painters. Exterior dates for this summer are filling up. Would you like to get on the schedule?

Draft script – owner to approve.', 504, 60),
    (p_org, 'lost_reengage', 'Lost – Re-engage (90 days)', 'Leads and jobs lost at least 90 days ago (and less than a year).', 'Hi, this is [your name] with Brushy Bear Painters. We talked a few months ago about painting. Is that project still on your list?

Draft script – owner to approve.', 2160, 70),
    (p_org, 'past_customers', 'Past Customers (annual check-in)', 'Customers whose job was paid in full about a year ago or more, not called in the last year.', 'Hi, this is [your name] with Brushy Bear Painters. It''s been about a year since we painted for you. How''s everything holding up? Any other rooms or projects on your list?

Draft script – owner to approve.', 7920, 80)
  on conflict (org_id, key) do nothing;

  insert into public.follow_up_dispositions (org_id, key, label, disposition_group, lead_disposition,
    requires_callback, sets_do_not_contact, sort_order)
  values
    (p_org, 'walkthrough_booked', 'Walkthrough booked', 'positive', 'walkthrough_scheduled', false, false, 10),
    (p_org, 'confirmed', 'Confirmed', 'positive', null, false, false, 20),
    (p_org, 'interested', 'Interested – sending info', 'positive', null, false, false, 30),
    (p_org, 'ready_to_sign', 'Ready to sign', 'won', null, false, false, 40),
    (p_org, 'booked_new_job', 'Booked a new project', 'won', null, false, false, 50),
    (p_org, 'call_back', 'Call back later', 'callback', 'call_back', true, false, 60),
    (p_org, 'just_planning', 'Still just planning', 'callback', 'just_planning', true, false, 70),
    (p_org, 'no_answer', 'No answer', 'no_contact', 'no_answer', false, false, 80),
    (p_org, 'left_voicemail', 'Left voicemail', 'no_contact', 'left_voicemail', false, false, 90),
    (p_org, 'texted_no_reply', 'Texted, no reply', 'no_contact', 'texted_no_reply', false, false, 100),
    (p_org, 'not_interested', 'Not interested', 'negative', 'not_interested', false, false, 110),
    (p_org, 'hired_someone_else', 'Hired someone else', 'negative', 'hired_someone_else', false, false, 120),
    (p_org, 'price_shopping', 'Price shopping', 'negative', 'price_shopping', false, false, 130),
    (p_org, 'diy', 'Doing it themselves', 'negative', 'diy', false, false, 140),
    (p_org, 'wrong_number', 'Wrong number', 'negative', 'wrong_number', false, false, 150),
    (p_org, 'do_not_contact', 'Do not contact', 'negative', 'do_not_contact', false, true, 160)
  on conflict (org_id, key) do nothing;

  insert into public.drips (org_id, key, name, description, steps, exit_conditions, is_system)
  values
    (p_org, 'just_planning_nurture', 'Just-planning nurture', 'For leads who are just planning or went quiet: three friendly check-ins over two months.', '[{"delay_days":3,"channel":"email_or_sms","template_key":"nurture_just_planning_1"},{"delay_days":21,"channel":"email_or_sms","template_key":"nurture_just_planning_2"},{"delay_days":35,"channel":"email_or_sms","template_key":"nurture_just_planning_3"}]'::jsonb, '{replied,booked,converted,lost,opted_out}'::text[], true),
    (p_org, 'exterior_pre_season', 'Exterior pre-season', 'Exterior and deck leads: “Exterior dates for this summer are filling up” in February, March and April.', '[{"on_date":"02-01","channel":"email_or_sms","template_key":"exterior_preseason_feb"},{"on_date":"03-01","channel":"email_or_sms","template_key":"exterior_preseason_mar"},{"on_date":"04-01","channel":"email_or_sms","template_key":"exterior_preseason_apr"}]'::jsonb, '{replied,booked,converted,lost,opted_out}'::text[], true)
  on conflict (org_id, key) where key is not null do nothing;

  insert into public.notification_settings (org_id, type, in_app, email, sms, locked)
  values
    (p_org, 'mention', true, true, false, true),
    (p_org, 'attention', true, false, false, true),
    (p_org, 'approval', true, true, false, true),
    (p_org, 'message', true, false, false, false),
    (p_org, 'lead_resubmitted', true, false, false, false),
    (p_org, 'job_stage', true, false, false, false),
    (p_org, 'estimate', true, false, false, false),
    (p_org, 'change_order', true, false, false, false),
    (p_org, 'schedule', true, false, false, false),
    (p_org, 'finance', true, false, false, false),
    (p_org, 'case', true, false, false, false),
    (p_org, 'subcontractor', true, true, false, false),
    (p_org, 'referral', true, false, false, false),
    (p_org, 'workflow', true, false, false, false)
  on conflict (org_id, type) do nothing;

  insert into public.messaging_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  insert into public.referral_settings (org_id, program_note)
  values (p_org, 'Draft – owner to approve: past customers share their code; when a referred job is paid in full, the champion gets the reward in Company Settings.')
  on conflict (org_id) do nothing;

  insert into public.attention_rules (org_id, rule_key, enabled, thresholds) values
    (p_org, 'unread_message', true, '{"minutes": 30}'::jsonb),
    (p_org, 'warranty_request', true, '{}'::jsonb)
  on conflict (org_id, rule_key) do nothing;
end;
$$;
revoke execute on function app.seed_communication_defaults(uuid) from public, anon, authenticated;

select app.seed_communication_defaults(id) from public.organizations;
