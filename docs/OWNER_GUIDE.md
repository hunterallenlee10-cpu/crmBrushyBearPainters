# Owner guide — Erik & Hunter

> How to run Brushy Bear CRM day to day. Start with the **first-week checklist** at the bottom: until those placeholders are replaced, some numbers and wording are samples.

## Signing in

Sign in at `/login` with your work email and password (or a sign-in link by email). Change your password in Settings → Security. Two-step sign-in (an authenticator app code) is **off for owners** right now because you asked for email + password only. We recommend turning it back on once you're settled in — your accounts can see and change everything. It's one line in the database (RUNBOOK "Sign-in setup"); ask whoever maintains the CRM.

## Daily routine

1. **Home**: owners open the **Executive Overview** (the whole company at a glance); everyone else opens **My Day** with their Ready Score, today's appointments, tasks and new leads. Switch between them at the top, or change your default in Settings → Preferences.
2. **Attention**: anything about to break a promise (untouched lead, estimate due, missed daily update). Clear it to zero.
3. **Follow-up Lists**: hot new leads, tomorrow's walkthroughs to confirm, estimates awaiting reply.

## Build and send an estimate in under 15 minutes

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

## Run the schedule

1. Set up once: **Admin → Schedule Admin** (production days, start time, arrival window, crew-day hours, work rules, skills, checklists) and **Production → Resources** (crews, members, skills, time off). Add subcontractors and their paperwork in **Admin → Subcontractors**.
2. Open **Schedule → Master Schedule**. Jobs that are Ready to Schedule sit in the tray on the left with a recommended crew and dates; rain reschedules are pinned on top.
3. Drag a job onto a crew and day (or press **Schedule job**), drag a bar to move it, drag its right edge to change the last day. Anything that breaks a rule shows in red with the reason; nothing is sent yet.
4. Press **Publish changes**. The customer gets their dates and the crew lead gets the job (simulated until texting is connected). The job moves to Scheduled and its on-time promise date is set.
5. Rain: **Production → Weather → Mark rain delay** (or on the job's Schedule section). The customer gets the rain-day text, nothing is charged, and the job goes to the top of the tray for rescheduling.
6. **Command Center** shows what's ready, at risk and starting this week; **Exceptions** lists what needs you (no crew, paint not ordered, missed daily update, open punch items, sub paperwork).

## Close out a job

1. Crew leads press **Start job** on day one (or post the first daily log) and post a **Daily Log** every evening from their phone: what got done, what's next, hours, "Cleanup done" and a cleanup photo. The customer gets the update signed by the job's point of contact.
2. When the last work order is marked completed, the job moves to **Final Walkthrough**. Book the final walkthrough (job → Schedule → Book appointment).
3. At the walkthrough add touch-ups on **Punch List** (area, what to fix, photo), mark them fixed, then **Capture customer sign-off** on the phone. The job moves to **Completed**.
4. If a start was late for a reason other than weather, an **on-time credit** waits for your approval on the job's Schedule section. Approve or waive it; approved credits go on the final invoice by themselves.
5. When the job reaches **Completed**, the **final invoice** is drafted for you (what's left of the contract, with approved credits as lines). Open Job → **Financial**, check it and press **Send**. The job moves to **Invoiced**.
6. When the customer pays, **Record payment** (below). Once the balance is $0 the job moves to **Paid in Full**.

## Record payments and send invoices

1. Open the job → **Financial**. The **Money summary** shows contract, billed, left to bill, collected and balance; **Needs attention** says in plain English what's off (for example "A $500.00 payment isn't applied to any invoice").
2. **Record payment:** method, amount, date and check number or reference, then say which invoices it pays (the app suggests the oldest first; the split must add up). Recording the deposit clears the onboarding deposit item and releases the Deposit Hold.
3. **New invoice** for deposits or progress billing; **Send** emails and/or texts it with the PDF (simulated until email and texting are connected) and stores the PDF in Documents.
4. Mistakes: **Mark bounced** (the invoices reopen), **Void** a payment entered by mistake, **Refund** part or all of a payment (with a reason), **Void** an invoice. Nothing is deleted; everything is logged.
5. **Credits:** add a goodwill, discount or referral credit with a reason; owners approve it. Approved credits come off the contract and land on the final invoice (or a credit memo if the final invoice was already sent).
6. **Invoices** (top nav) lists every invoice with A/R, overdue and collection tiles; **A/R Aging** shows who owes what by age. Overdue invoices get a reminder at 7 and 30 days (simulated) and show up in Attention.
7. **Job Costing** (owners and bookkeeper): labor from daily-log hours, paint orders, subcontractor costs and expenses with receipt photos, and the job's gross margin.

## Close the month

1. **Admin → Finance** lists each month with billed, collected and what to tidy up (uncleared payments, unapplied money, draft invoices).
2. Press **Close month**. Nobody can then change money dated in that month — except you, with a written reason, if something really has to change. **Reopen** a month the same way.

## Messages, workflows and templates

- **Messages** (More → Messages) shows every customer conversation, unread first. Opening one marks it read for everyone; reply from there. Unread for 30 business minutes → Attention.
- **Admin → Workflows**: the 17 automations, all on. Open one to see its steps, press **Test** to see exactly what it would send for a real job or lead (nothing is sent), or switch it off (say why).
- **Admin → Messaging & Templates**: every text and email. Edit the wording, preview it with a real job, watch the text counter, then **Approve wording**. Everything starts as "Draft – owner to approve". **Messaging settings**: quiet hours, the STOP line, the email footer, the review and referral delays, the warranty SLA.

## Warranty and service

- A customer calls about peeling trim: **More → Warranty & Service → New case** (or Onboarding → Cases on the job). Pick the job, describe it, choose "Text/Email: We got your request".
- On the case: book the **warranty visit** (it goes on the calendar as a Warranty Visit), send the visit time, then **Resolved** with what was done. The SLA (2 business days by default) turns the case red on the Attention Center when it's missed.

## Follow-up calls

- **Leads → Follow-up Lists**: eight call lists that fill themselves (hot new leads, tomorrow's walkthroughs, estimates waiting, callbacks, just planning, pre-season exterior, lost 90 days, past customers). Open one: the script is on the side; **Call**, **Text** from a template, pick what happened, **Save & next**. Callbacks come back on the day you pick.
- Change the scripts, names, cooldowns and outcomes in Admin → Follow-up Lists.

## Campaigns, Bear Champions and reviews

- **More → Campaigns → New campaign**: pick who (contacts, leads, or customers on jobs, with rules), write or pick the message, **Run checks**, **Send a test to me**, then **Schedule** or **Send now**. The checks tell you who's left out and why (no opt-in, opted out, Do Not Contact). The **Drips** tab has the two seasonal drips; **Automations** links to the workflows.
- **Bear Champions**: happy customers get a code like BEAR-7KQ2 and a link to the website form. Referrals with the code come in by themselves; record a phone referral by hand. When the referred job is paid in full, the reward shows under **Payouts** — record how you paid it.
- **Reviews**: each review request (2 days after Paid in Full), whether they clicked, and mark when a review shows up. Add your Google review link in Company Settings first.
- **Settings → Notifications**: choose per event how you hear about it (in-app, email, text). Admin → Notification Settings sets the company defaults.

## Numbers, dashboards and reports

1. **Set it up once:** Admin → **Revenue Goals** (a goal per month; On Pace and the forecast use it) and Admin → **Marketing Spend** (what you spent per month and lead source; this gives cost per lead and cost to win a job). Until you enter them those numbers show "—".
2. **Ask Brushy Bear** (Analytics): type a question like "sales this month vs last month" or "which lead sources convert best". The answer names the numbers it used; tap through to the dashboard or report.
3. **Daily Brief**: a one-paragraph summary of any day (new leads, walkthroughs, estimates, sold, payments, what needs attention).
4. **Dashboards**: six ready-made ones (Executive, Sales, Production, Marketing, A/R, Seasonality). Pick a date range and filter by work type, city, owner or source. Every chart has **View data** (the numbers as a table) and **Download CSV**. Star the ones you use; build your own with **New dashboard**.
5. **Reports**: start from one of the 10 templates or **New report**, choose columns and filters, group and total, then **Save as** and share it with the team. **Schedule** emails it to teammates daily, weekly or monthly (simulated until email is connected).
6. **My Numbers**: each person's scoreboard for the month; owners can pick any rep. Once you turn commissions on (Admin → Commissions), each rep also sees their own commissions there.

## Help when you're stuck

- The round **?** button (bottom left) searches the **Help Center** from any screen. **Help** in the menu has ten how-to articles (create a lead, book a walkthrough, build and send an estimate, record a deposit, clear onboarding, schedule a crew, daily logs, final walkthrough, close a job) and **Release notes** (what changed in each version).
- **Help → Manage** (owners): edit the articles in plain text with simple formatting, add your own, publish or keep as draft.

## Setup tools (Admin)

- **Module Manager**: add your own fields to leads, jobs, accounts and contacts (text, number, money, date, checkbox, picklist, person, link…), show them as list columns, reorder or hide sections of a record page, and add rules the CRM checks when someone saves (for example "Gate code required for exterior jobs").
- **Data Import**: bring in a spreadsheet of past customers or leads (CSV). Match the columns, review the rows it flags (errors, possible duplicates), then import. Texting/email consent is never imported — record it when the customer gives it.
- **Bulk Update**: change many records at once (select them in a list → **Bulk update…**, or upload a CSV). You see every change before it happens, and **Revert** puts it back.
- **Merge Customers**: two records for the same household? Compare side by side, pick which values to keep, merge (jobs, messages and documents move over). **Undo** is available afterwards.
- **Export Controls**: choose which roles can download lists to CSV and see who exported what.
- **Job Recovery**: jobs whose stage doesn't match their records (or that sat far too long) with a one-click fix that asks for a reason.
- **Commissions**: off until you set your rules (who gets what rate on company vs self-generated leads, overhead, review threshold). The simulator shows what a job would pay before you turn it on.
- **Demo Data**: on a test copy you can load sample data to practice; **Purge demo data** removes all of it. The live CRM never has demo data.

## First-week checklist (replace the placeholders)

Nothing below was guessed for you; until you fill it in, the CRM shows "Sample" or "Draft – owner to approve", or leaves the number blank.

1. **Company Settings:** legal name, phone, email, office hours, address, contractor license / registration numbers, your Google review link, quiet hours. (Admin → Company Settings.)
2. **Prices and production rates:** Admin → Estimate Setup and the Price Book — labor rate, margins, minimums, deposit %, production rates and paint costs (all "Sample – Erik to calibrate"). Confirm sales tax rules with your accountant.
3. **Legal wording:** the proposal terms, warranty, lead-safe and e-signature wording, final sign-off text and agreement templates ("Draft – owner/attorney to approve"). Have your attorney review, then publish.
4. **Messages:** Admin → Messaging & Templates — read and **Approve wording** on each text and email (text-back, confirmations, daily update, invoices, review and referral asks).
5. **Territories and ZIPs:** Admin → Territories — confirm the five cities and their ZIP codes; leads outside them are flagged "Outside service area".
6. **People:** Admin → Users — invite the team, pick their roles; Production → Resources — crews, members, skills and certifications (RRP), time off; Admin → Subcontractors — their license, insurance, W-9 and expiry dates.
7. **Goals and spend:** Admin → Revenue Goals and Admin → Marketing Spend.
8. **Commissions** (if you pay them): Admin → Commissions.
9. **Help articles:** skim the ten articles and adjust them to how you work.
10. **Security:** turn two-step sign-in back on for owners when you're ready (see Signing in); keep the gate-code key (`FIELD_ENCRYPTION_KEY`) in your password manager.
11. **Connections** (later, one at a time, see `docs/INTEGRATIONS.md`): texting, email sending, QuickBooks, Google Calendar, weather, payments. Until then every message is recorded as "simulated" and nothing reaches customers.

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
