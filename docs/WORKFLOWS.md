# Workflows

> Skeleton. The workflow engine and the 17 seeded workflows are built in **Phase 8** (SPEC §11). Each will be documented here with trigger, conditions, actions, templates and its dry-run test.

## Engine rules

- Domain events land in `events`; workflows match on event type + conditions and run ordered actions.
- Idempotency key per (workflow, event); every run is logged in `workflow_runs`.
- Messages respect business hours (overnight texts queue until 8 am unless the customer started the thread), consent and Do Not Contact.
- While providers are disconnected, every send goes to `integration_outbox` as "Simulated – not sent".

## Seeded workflows (to be documented)

| #   | Workflow                                                                 | Trigger                             |
| --- | ------------------------------------------------------------------------ | ----------------------------------- |
| 1   | New web lead → instant text-back                                         | `lead.created` (source Website)     |
| 2   | Walkthrough booked → confirmation + reminders                            | `appointment.created` (Walkthrough) |
| 3   | Walkthrough completed → "Send estimate" task (+24h)                      | `appointment.completed` (measured)  |
| 4   | Estimate sent → follow-ups day 2 / 5 / 10                                | `estimate.sent`                     |
| 5   | Estimate accepted → Sold, contract, deposit invoice, onboarding          | `estimate.accepted`                 |
| 6   | Deposit paid → release Deposit Hold                                      | `payment.created`                   |
| 7   | Onboarding cleared → Ready to Schedule                                   | `job.stage_changed`                 |
| 8   | Schedule published → customer + crew notices, day-before reminder        | `schedule.published`                |
| 9   | Weather risk → Attention, rain-delay text, priority reschedule           | `weather.risk_detected`             |
| 10  | Promised start missed (not weather) → draft $250 credit                  | scheduled check                     |
| 11  | Daily log submitted → customer update                                    | `daily_log.submitted`               |
| 12  | Work orders complete → Final Walkthrough request                         | `job.stage_changed`                 |
| 13  | Final walkthrough signed off → Completed, final invoice draft            | `job.stage_changed`                 |
| 14  | Invoice overdue 7 / 30 days → reminders                                  | `invoice.overdue`                   |
| 15  | Paid in full → thank-you, review (+2d), referral (+14d), 1-year check-in | `job.stage_changed`                 |
| 16  | Stale / just planning → nurture; exterior pre-season drip                | scheduled check                     |
| 17  | Sub compliance expiring → notify owner + sub                             | scheduled check                     |

## Estimating events (Phase 4)

These already fire (from database triggers and the send/accept functions) and the worker handles the ones marked ✓. Workflow automations on top of them arrive in Phase 8.

| Event                                                                       | When                                     | Worker today                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `estimate.sent`                                                             | A version is sent (simulated text/email) | — (follow-ups are workflow #4)                                                  |
| `estimate.viewed`                                                           | The customer first opens the link        | ✓ notifies the job's point of contact / owner                                   |
| `estimate.accepted`                                                         | Accept & Sign                            | ✓ finishes acceptance if needed (signed PDF, stage moves) and notifies the team |
| `estimate.declined`                                                         | The customer declines                    | ✓ notifies the team                                                             |
| `change_order.sent` / `change_order.signed` / `change_order.declined`       | Change-order link life cycle             | ✓ signed: stores the signed PDF, updates the contract; notifies                 |
| `approval.created` (`estimate_discount`)                                    | A discount over the sender's limit       | ✓ notifies owners                                                               |
| row events on estimates, lines, invoices, onboarding, paint and work orders | Every change                             | audit + events only                                                             |

Expired links: the worker run calls `expire_proposals()` each minute, which marks unanswered versions past their date as Expired.

## Onboarding (Phase 5)

| Trigger                                                                                                                                                               | What happens                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimate accepted (`completeAcceptance`), change order signed, any onboarding action, document change, "Re-verify all", worker every minute (jobs in Sold/Onboarding) | The onboarding checks run (`lib/onboarding/checks.ts`); changed results are written; a manual clear is never overwritten.                                |
| The deposit item is cleared                                                                                                                                           | The Deposit Hold is released (database trigger), with the note.                                                                                          |
| Every required item cleared and no blocking hold                                                                                                                      | The job moves Onboarding → Ready to Schedule through the normal gate (workflow #7; the scheduler notification itself arrives with workflows in Phase 8). |
| "Request from customer" / "Prep instructions"                                                                                                                         | A simulated text or email with draft wording (template key `onboarding_*` / `prep_instructions`); the Prep item clears once one is logged.               |
| Job in Onboarding past the threshold (7 days) with items open or a hold                                                                                               | Attention "Onboarding stalled" lists what's open and the holds; it closes once the job moves on.                                                         |
| Photos shared with the customer                                                                                                                                       | One simulated message (`photo_share`); the photos are marked shared.                                                                                     |

Events: row events for `job_photo.*`, `document.*` and `onboarding_requirement.*` (audit + outbox; workflows in Phase 8).

## Production (Phase 6)

| Trigger                                                                                         | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft saved (tray drag, bar drag/resize, Schedule dialog, approved recommendation)              | Conflicts are checked (`checkPlacement`) and shown with reasons; nothing is sent.                                                                                                                                                                                                                                                                                                                                                                                |
| **Publish changes**                                                                             | Refused if any draft still has a blocking conflict. Otherwise drafts become the published schedule; each job gets its promised start, guarantee date (first publish; weather/customer moves shift it), crew and estimated completion; the customer gets one notice (text, else email; template `schedule_published`, draft wording) and each crew lead one notice (outbox + in-app); event `schedule.published`; Ready to Schedule → Scheduled through the gate. |
| **Start job** (crew lead or office), or the first daily log on a production day                 | Actual start recorded, event `job.started`, Scheduled → In Progress when materials are ready; the on-time check runs.                                                                                                                                                                                                                                                                                                                                            |
| Start later than the guarantee date, no rain delay covering it                                  | Draft on-time credit (Company Settings amount) for owner approval; owners notified; event `job.on_time_evaluated`.                                                                                                                                                                                                                                                                                                                                               |
| **Mark rain delay**                                                                             | `rain_delays` row, job flagged priority reschedule (top of the tray), customer text with the rain-day promise (template `rain_delay`, simulated), event `job.rain_delay`. Never drafts a credit.                                                                                                                                                                                                                                                                 |
| Daily log uploaded (online or from the offline queue)                                           | Hours become time entries; the customer update (template `daily_update`, signed by the point of contact) is recorded as simulated; events `daily_log.submitted`, `daily_log.customer_update`. Worker sends any update still in draft after 2 minutes.                                                                                                                                                                                                            |
| Last work order completed                                                                       | In Progress → Final Walkthrough.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Customer sign-off captured, or final-walkthrough appointment completed with no open punch items | Final Walkthrough → Completed; event `job.customer_signed_off`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Worker every minute                                                                             | `sweepProduction` (gates for production jobs, on-time checks), `sweepDailyUpdates`, subcontractor status refresh; every 15 minutes: crew recommendations.                                                                                                                                                                                                                                                                                                        |
| Attention engine (every minute)                                                                 | Missing crew (5 days before start), paint not ordered (3 days), missed daily update (after 7 pm Pacific on a production day, owner = crew lead), punch list open (3 days), start date missed, subcontractor paperwork expiring (30 days), weather risk (dormant until weather is connected). Thresholds editable in Admin → Attention Rules.                                                                                                                     |

Workflow table rows #8 (schedule published), #9 (rain delay), #10 (daily update), #11 (missed daily log) and #17 (sub compliance) now run as built-in production automation; Phase 8 workflows can add to them.
