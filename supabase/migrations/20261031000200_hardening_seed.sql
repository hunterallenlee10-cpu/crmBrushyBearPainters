-- Phase 10 · Help Center seed (SPEC §8.17, §15.1).
--
-- Real configuration only: the Help Center categories and the 10 short how-to
-- articles (create a lead, book a walkthrough, build an estimate, send a
-- proposal, record a deposit, clear onboarding, schedule a crew, submit a
-- daily log, run the final walkthrough, close a job). The articles explain
-- how to use the CRM; they state no prices, rates, legal terms or contact
-- details. Owners can edit or unpublish them in Help → Manage articles; a
-- re-seed never overwrites an edited article (on conflict do nothing).
--
-- Idempotent: safe on a database with Phases 0–9 and on re-runs.
-- Rollback: supabase/rollbacks/20261031000200_hardening_seed.down.sql

create or replace function app.seed_help_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.kb_categories (org_id, key, name, description, sort_order)
  values
    (p_org, 'leads', 'Leads & walkthroughs', 'Getting a new customer from the first call to a booked visit.', 10),
    (p_org, 'estimates', 'Estimates & proposals', 'Pricing the job and getting it signed.', 20),
    (p_org, 'money', 'Money', 'Deposits, invoices and payments.', 30),
    (p_org, 'production', 'Onboarding & scheduling', 'Getting a sold job ready and on the calendar.', 40),
    (p_org, 'field', 'For the crew', 'What the crew does on site each day.', 50),
    (p_org, 'closing', 'Finishing a job', 'Final walkthrough, final invoice and closing out.', 60)
  on conflict (org_id, key) do nothing;

  insert into public.kb_articles (org_id, category_id, slug, title, summary, body, tags, audience, status, seed_key, sort_order)
  select p_org, c.id, v.slug, v.title, v.summary, v.body, v.tags, v.audience, 'published', v.seed_key, v.ord
  from (values
    -- @help-articles:begin
    ('leads', 'create-a-lead', 'Create a lead', 'Add a new lead by hand when someone calls, texts or stops you on a job.',
$md$Website requests arrive on their own. Use this when a customer reaches you another way (a phone call, a neighbor on a job site, a referral).

## Steps

1. Go to **Leads → New Lead**.
2. **Contact:** enter the name and at least a phone number or an email. If the person is already in the CRM, a box tells you so. Open the existing record instead of creating a duplicate.
3. **Property:** enter the address or just the ZIP code. The city (territory) fills in from the ZIP. A ZIP outside the service area is flagged **Out of area**, not rejected.
4. **Qualify:** pick the services, the timeline and when the home was built. Homes built before 1978 (or "not sure") get the lead-safe note.
5. Pick the **lead source** (how they found you) and save. Use **Save & book walkthrough** if you already agreed on a time.

## Good to know

- The lead gets a score and a grade (A–F) right away. Open the lead to see why.
- The first call, text or email someone logs sets **speed to lead**. Log your first contact even if it was a quick call.
- A new lead nobody has touched shows up in **Attention** after a few business minutes.
$md$, array['leads', 'new lead', 'duplicates'], array['owner', 'office', 'sales'], 'create_lead', 10),

    ('leads', 'book-a-walkthrough', 'Book a walkthrough', 'Put the estimate visit on the calendar and let the customer know.',
$md$A walkthrough is the visit where you measure and talk through the job.

## Steps

1. Open the lead (or the job, if it was already converted).
2. Choose **Book walkthrough**, pick the day, time and who is going.
3. Save. Booking turns the lead into a job at **Walkthrough Scheduled**, with the customer, contact and property filled in.
4. The customer confirmation and reminders go through the messaging outbox. While messaging is not connected they are recorded as **simulated**, nothing is actually sent.

## After the visit

- Open the job and mark the walkthrough **Completed** with the result **Measured**. The job moves to **Walkthrough Complete** on its own.
- If you need to go back, pick **Needs second visit** and book another one.
- An unconfirmed walkthrough for tomorrow shows up in **Attention** in the late afternoon.
$md$, array['walkthrough', 'appointments', 'calendar'], array['owner', 'office', 'sales'], 'book_walkthrough', 20),

    ('estimates', 'build-an-estimate', 'Build an estimate', 'Price the job area by area, with options and add-ons.',
$md$Build the estimate on a tablet or laptop, ideally the same day as the walkthrough.

## Steps

1. Open the job and go to **Estimate → New estimate**.
2. Add an **option** (for example "Option A – Walls only" and "Option B – Walls and trim"). Each option has its own areas and price.
3. In each option add **areas** (rooms or elevations), then the **line items** for each surface. Enter the measurements; the price book fills in hours, paint and sundries.
4. Add **add-ons** the customer can switch on themselves (for example pressure washing or rot repair).
5. Check the **margin panel** on the side. It warns you when a price drops below the margin floor. Customers never see it.

## Good to know

- Rates and paint costs marked **Sample** are placeholders until Erik sets the real numbers in **Admin → Estimate Setup**.
- A discount above your approval limit goes to **Jobs → Approvals** for an owner before you can send.
- You can change a price by hand; you'll be asked for a short reason.
$md$, array['estimate', 'pricing', 'options', 'add-ons'], array['owner', 'sales'], 'build_estimate', 30),

    ('estimates', 'send-a-proposal', 'Send a proposal', 'Send the customer a link to review, choose options and sign.',
$md$## Steps

1. Open the estimate and choose **Send estimate**.
2. Check the preview: options, add-ons, what's included and the guarantees.
3. Send. The customer gets a private link to the proposal page. Sending freezes this version; edits after that make a new version.
4. The job moves to **Estimate Sent** and the follow-ups (day 2, 5 and 10) start.

## What the customer sees

- A phone-friendly page where they pick an option, switch add-ons on or off and see the total change.
- **Accept & sign** with a drawn signature. On signing, the job becomes **Sold**, the signed PDF is saved, the deposit invoice is drafted and the onboarding checklist appears.

## Good to know

- The proposal wording and contract text are drafts until the owners approve them (and an attorney reviews the agreement templates).
- An estimate that hasn't been opened for a few days shows up in **Attention**.
$md$, array['proposal', 'estimate', 'signature'], array['owner', 'sales'], 'send_proposal', 40),

    ('money', 'record-a-deposit', 'Record a deposit', 'Record the customer''s deposit and apply it to the deposit invoice.',
$md$## Steps

1. Open the job and go to **Financial**.
2. Choose **Record payment**. Enter the amount, how they paid (check, card, ACH, Zelle…), the date received and a reference such as the check number.
3. **Apply** it to the deposit invoice. Every payment must be applied; money that isn't applied shows as a warning and never counts as collected.
4. Save. The money summary updates (Contract, Billed, Collected, Balance) and the deposit hold is released.

## When the check clears

- Mark the payment **Cleared** once it's in the bank.
- If it bounces, mark it **Bounced**. The invoice goes back to owing and the job shows it in **Needs attention**.

## Good to know

- Balances are always worked out from invoices and payments. There is no field to type a balance.
- A closed month is locked. Changing a payment in it needs an owner override with a reason.
$md$, array['deposit', 'payment', 'money'], array['owner', 'office'], 'record_deposit', 50),

    ('production', 'clear-onboarding', 'Clear onboarding', 'Finish the checklist so a sold job can be scheduled.',
$md$After the customer signs, the job gets an onboarding checklist built from the accepted estimate.

## Steps

1. Open the job and go to **Onboarding**.
2. Work down the list: deposit, colors selected, HOA approval (if the home has an HOA), lead-safe paperwork for older homes, materials and anything else the job needs.
3. Many items clear on their own when the CRM sees the work done (for example the deposit payment or an uploaded HOA approval). Others you clear by hand with a short note.
4. When every required item is cleared and no hold blocks scheduling, the job moves to **Ready to Schedule** by itself.

## Good to know

- Use **Schedule → Onboarding Board** to see every job's progress at once.
- A job stuck in onboarding for more than a week shows up in **Attention**.
$md$, array['onboarding', 'checklist', 'holds'], array['owner', 'office'], 'clear_onboarding', 60),

    ('production', 'schedule-a-crew', 'Schedule a crew', 'Put a ready job on the Master Schedule and publish it.',
$md$## Steps

1. Go to **Schedule → Master Schedule**.
2. Drag a job from the **Ready to schedule** list onto a crew and day, then drag the edge to set how many days it runs.
3. The schedule checks the work rules as you go (crew skills, deposit, season, one job per crew per day…). A hard conflict is blocked with the reason; a heads-up can be overridden by an owner with a reason.
4. Changes stay as a **draft** until you choose **Publish changes**. Publishing sends the customer and crew notices (simulated while messaging is off) and moves the job to **Scheduled**.

## Rain days

- Mark a rain delay on the day. The job gets the priority reschedule flag and the customer gets a note. A rain day never costs the customer anything.
$md$, array['schedule', 'crew', 'publish', 'rain delay'], array['owner', 'office'], 'schedule_crew', 70),

    ('field', 'submit-a-daily-log', 'Submit a daily log', 'Tell the office and the customer what got done today.',
$md$Crew leads submit one daily log for each day on a job, before the end of the day.

## Steps (on your phone)

1. Open **Daily Log** from the bottom bar (or from the job in **Today**).
2. Fill in **Finished today** and **Next up** in plain words the customer will understand.
3. Note any issues or blockers.
4. Enter the hours for each person on the crew.
5. Confirm the **cleanup** is done and add the cleanup photo. This is required.
6. Submit. The customer update goes out after the point of contact checks it.

## Good to know

- No signal? The log and photos are saved on the phone and sync when you're back online.
- A production day with no daily log by 7 pm shows up in **Attention**.
$md$, array['daily log', 'crew', 'photos', 'offline'], array['crew', 'owner', 'office'], 'submit_daily_log', 80),

    ('closing', 'run-the-final-walkthrough', 'Run the final walkthrough', 'Walk the job with the customer, fix the punch list and get sign-off.',
$md$## Steps

1. When the work orders are done the job moves to **Final Walkthrough**. Book the final walkthrough with the customer.
2. Walk every area together. Add a **punch list** item for anything to touch up, with a photo.
3. Fix each item and mark it **Fixed** with an after photo.
4. Ask the customer to sign off on your device (**Customer sign-off**).
5. When the sign-off is saved (or the walkthrough is done with no open items) the job can move to **Completed**.

## Good to know

- Open punch items more than a few days after the final walkthrough show up in **Attention**.
- Take the before/after photos now; they're useful for reviews later.
$md$, array['final walkthrough', 'punch list', 'sign-off'], array['owner', 'office', 'crew'], 'final_walkthrough', 90),

    ('closing', 'close-a-job', 'Close a job', 'Final invoice, final payment, Paid in Full and Closed Won.',
$md$## Steps

1. At **Completed**, the final invoice is drafted for you (including any on-time credit an owner approved).
2. Open **Financial**, check the final invoice and send it. The job moves to **Invoiced**.
3. Record the final payment and apply it to the final invoice.
4. When everything billed is paid and nothing is left to bill, the job moves to **Paid in Full**. The thank-you, review request and Bear Champions invite go out (simulated while messaging is off).
5. Three days later, if the balance is still $0, the job closes as **Closed Won** on its own.

## Good to know

- If a payment bounces before then, the job stays open and shows the problem in **Needs attention**.
- Closing a job as **Closed Lost** (any stage) asks for a lost reason.
$md$, array['final invoice', 'paid in full', 'closed won'], array['owner', 'office'], 'close_job', 100)
    -- @help-articles:end
  ) as v(category_key, slug, title, summary, body, tags, audience, seed_key, ord)
  join public.kb_categories c on c.org_id = p_org and c.key = v.category_key
  on conflict (org_id, seed_key) do nothing;
end;
$$;
revoke execute on function app.seed_help_defaults(uuid) from public, anon, authenticated;

select app.seed_help_defaults(id) from public.organizations;
