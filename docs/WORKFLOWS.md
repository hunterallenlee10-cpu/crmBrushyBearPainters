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

| Event | When | Worker today |
| --- | --- | --- |
| `estimate.sent` | A version is sent (simulated text/email) | — (follow-ups are workflow #4) |
| `estimate.viewed` | The customer first opens the link | ✓ notifies the job's point of contact / owner |
| `estimate.accepted` | Accept & Sign | ✓ finishes acceptance if needed (signed PDF, stage moves) and notifies the team |
| `estimate.declined` | The customer declines | ✓ notifies the team |
| `change_order.sent` / `change_order.signed` / `change_order.declined` | Change-order link life cycle | ✓ signed: stores the signed PDF, updates the contract; notifies |
| `approval.created` (`estimate_discount`) | A discount over the sender's limit | ✓ notifies owners |
| row events on estimates, lines, invoices, onboarding, paint and work orders | Every change | audit + events only |

Expired links: the worker run calls `expire_proposals()` each minute, which marks unanswered versions past their date as Expired.
