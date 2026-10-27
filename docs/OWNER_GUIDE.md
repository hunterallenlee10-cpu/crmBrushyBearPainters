# Owner guide — Erik & Hunter

> Draft outline. Each section is written as its feature ships, and finished in Phase 10.

## Daily routine

1. **My Day** (Workspace): today's appointments, tasks and new leads.
2. **Attention**: anything about to break a promise (untouched lead, estimate due, missed daily update). Clear it to zero.
3. **Follow-up Lists**: hot new leads, tomorrow's walkthroughs to confirm, estimates awaiting reply.

## Build and send an estimate in under 15 minutes _(Phase 4)_

1. Open the job → **Estimate & Scope** → **Start the estimate**. (The walkthrough must be completed as "Measured" before it can be sent.)
2. **Add an area** for each room or side of the house (Living room, North side, Kitchen cabinets…).
3. In each area, **Add line** and pick from the price book (search "walls", "trim", "door"…). Tap the ruler to measure: enter length × width × height and doors/windows and it fills the square feet. Set condition, prep, coats, primer, color change, height and paint; the price works itself out.
4. Want Good / Better / Best? **+ Option**, or duplicate an option and change it. Star the one you recommend.
5. **Add add-on** for extras the customer can switch on (rot repair allowance, color consultation…).
6. Watch the right-hand panel: customer total and deposit, and (internal) cost, gross margin against your floor, labor hours, crew days and gallons. Red means below the margin floor.
7. Discount? Set it under Discount, deposit & notes with a reason. If it's over your limit, **Ask for approval** and an owner approves it in Jobs → Approvals.
8. **Preview PDF**, then **Send for signature** by text, email or both. The link appears so you can copy or open it. (Messages are simulated in this build.)
9. The customer picks an option on their phone, toggles add-ons, signs. The job moves to Sold → Onboarding by itself, with the signed contract in Signed documents, the deposit invoice under Financial, the onboarding checklist, paint order and work orders drafted, and the color schedule ready.
10. Need to change it after sending? **New version** (it copies the sent one). Found more work mid-job? **Change order** (crew leads can report one from the field).

**Before real customers:** set your real numbers in Admin → Estimate Setup and the Price Book (everything says "Sample – Erik to calibrate" until saved), confirm tax with your accountant, and publish the agreement templates after your attorney's review.

## Clear onboarding and get to Ready to Schedule

1. When a customer signs, the job lands on the **Onboarding Board** (Schedule → Onboarding Board) in **Deposit Hold** with its checklist (Job → Onboarding).
2. Most items check themselves: the signed contract, contact info, colors, paint order, prep instructions, start date in season. Each says what it found.
3. For the rest use the buttons on each item: **Request** (texts or emails the customer, simulated for now), **Upload** (HOA approval, lead-safe acknowledgment), **Task** (for a teammate), or **Mark cleared** with a note (for example "Check #1042 received"). Clearing the deposit releases the Deposit Hold.
4. When everything required is cleared and nothing is on hold, the job moves to **Ready to Schedule** by itself. On the board you can also drag it there, or press its button; anything else you drop explains what's missing.
5. Photos: crew use **Camera** (phone tab bar) or the job's Photos section. Without signal, photos wait on the phone and upload when it's back ("Offline · 2 waiting to upload").

## Run the schedule _(Phase 6)_

1. Set up once: **Admin → Schedule Admin** (production days, start time, arrival window, crew-day hours, work rules, skills, checklists) and **Production → Resources** (crews, members, skills, time off). Add subcontractors and their paperwork in **Admin → Subcontractors**.
2. Open **Schedule → Master Schedule**. Jobs that are Ready to Schedule sit in the tray on the left with a recommended crew and dates; rain reschedules are pinned on top.
3. Drag a job onto a crew and day (or press **Schedule job**), drag a bar to move it, drag its right edge to change the last day. Anything that breaks a rule shows in red with the reason; nothing is sent yet.
4. Press **Publish changes**. The customer gets their dates and the crew lead gets the job (simulated until texting is connected). The job moves to Scheduled and its on-time promise date is set.
5. Rain: **Production → Weather → Mark rain delay** (or on the job's Schedule section). The customer gets the rain-day text, nothing is charged, and the job goes to the top of the tray for rescheduling.
6. **Command Center** shows what's ready, at risk and starting this week; **Exceptions** lists what needs you (no crew, paint not ordered, missed daily update, open punch items, sub paperwork).

## Close out a job _(Phases 6–7)_

1. Crew leads press **Start job** on day one (or post the first daily log) and post a **Daily Log** every evening from their phone: what got done, what's next, hours, "Cleanup done" and a cleanup photo. The customer gets the update signed by the job's point of contact.
2. When the last work order is marked completed, the job moves to **Final Walkthrough**. Book the final walkthrough (job → Schedule → Book appointment).
3. At the walkthrough add touch-ups on **Punch List** (area, what to fix, photo), mark them fixed, then **Capture customer sign-off** on the phone. The job moves to **Completed**.
4. If a start was late for a reason other than weather, an **on-time credit** waits for your approval on the job's Schedule section. Approve or waive it; approved credits go on the final invoice (Phase 7).

## What the CRM promises customers for you

| Promise                      | What the CRM does                                                          |
| ---------------------------- | -------------------------------------------------------------------------- |
| Text back within minutes     | Auto-text on new web leads; Attention item after 10 business minutes       |
| Written estimate in 24 hours | "Send estimate" task due +24h after the walkthrough; warning at 20h        |
| One point of contact         | Every job has exactly one; it signs every customer message                 |
| A photo update every day     | Daily log → customer update; Attention at 7 pm if missing                  |
| Clean house every evening    | Daily log requires "cleanup done" + photo                                  |
| Rain-day promise             | Rain delays never create charges; the job jumps to the top of the schedule |
| On time or $250 off          | Missed non-weather start drafts a $250 credit for owner approval           |
