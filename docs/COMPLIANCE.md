# Compliance — owner checklist

**This is not legal, tax or safety advice.** The CRM tracks and reminds; it does not decide what the law requires. Every item below needs confirmation from the right authority before templates leave "Draft – owner to approve".

## Contractor paperwork (SPEC §13.4)

- [ ] Confirm the WA L&I contractor registration number and UBI number, then enter them in Company Settings (printed on proposals, contracts and invoices). Currently `[LNI_NUMBER]` / `[UBI_NUMBER]`.
- [ ] Confirm with **L&I and an attorney** which customer disclosure notices Washington requires on residential painting contracts, and where they must appear. The proposal/contract templates have a slot for it.
- [ ] Confirm **lien-related disclosures** required for residential work, and when they must be given.
- [ ] Have an attorney review the proposal, contract, change-order, warranty and lead-safe acknowledgment templates.
- [ ] Decide warranty terms (length, what's covered, exclusions) and approve the warranty template.
- [ ] Confirm **sales-tax treatment** of residential painting labor and materials with an **accountant** (rates and rules by location). Painting an existing home may be taxed as a retail sale in Washington. Tax is configurable in the CRM and starts unset.
- [ ] Confirm deposit limits or rules, if any, for residential contracts.

## Lead-safe work in pre-1978 homes (SPEC §13.3)

- [ ] **Washington runs its own RRP (Renovation, Repair and Painting) program through the Department of Commerce. Verify current requirements with them** — firm certification, certified renovator rules, recordkeeping, and required pamphlet ("Renovate Right") delivery and acknowledgment.
- [ ] Enter the firm's RRP certification and each certified renovator (with expiry dates) in Company Settings / Subcontractors once Phase 6 lands.
- [ ] Approve the lead-safe checklist used on work orders (containment, cleanup, cleaning verification).
- [ ] Decide how "Not sure" year-built homes are handled (the CRM treats them as needing lead-safe prep until confirmed).

## Messaging (SPEC §13.2)

- [ ] Confirm consent requirements for marketing texts and emails (how opt-in is collected and recorded on the website form).
- [ ] Approve quiet hours (default: no texts before 8 am; overnight texts queue).
- [ ] Before connecting an SMS provider: complete the carrier registration it requires for business texting.

## Subcontractors

- [ ] **Check the registration type before using sub crews.** The owners' business plan notes that a Washington _specialty_ contractor registration may not allow hiring subcontractors, and that a _general_ contractor registration may be needed to do so. Confirm with **L&I** before any Subcontractor user is set up. The CRM has a Subcontractor role ready, but nothing requires using it.
- [ ] Decide required documents for subcontract crews: L&I registration, certificate of insurance (COI), W-9, bond, RRP certification. The CRM tracks expiry dates and warns 30 days ahead (Phase 6).

## Data and privacy

- [ ] Decide data retention for leads that never became customers.
- [ ] Confirm who may export customer data (Export Controls, Phase 10).

## Accounts and access (Phase 1)

- [ ] Keep two-step sign-in (MFA) on for Owner and Bookkeeper. It's on by default.
- [ ] Review Admin → Users each quarter and turn off anyone who has left. Turned-off users can't sign in, and their records stay.
- [ ] Use View as user only to check what a teammate sees. Each use is in the audit log.

## Estimates and e-signatures (Phase 4)

- [ ] Have an attorney approve the four agreement templates (Admin → Agreement Templates). They're drafts with [SLOTS] for the L&I/UBI numbers, warranty terms, required disclosures and the lead-safe text; customers see "Draft – owner/attorney to approve" until an owner publishes them.
- [ ] Approve the e-sign consent sentence shown next to Accept & Sign (`ESIGN_CONSENT` in `lib/domain/estimating/agreements.ts`) and confirm what a valid electronic signature needs to record. Today each signature stores the typed name, the drawn signature (PNG and its SHA-256), the time, IP address, user agent, the consent text and the exact option/add-ons/total accepted.
- [ ] Enter the lead-safe disclosure in Admin → Estimate Setup → Guarantees (currently a slot). It shows on proposals for pre-1978 homes with lead-safe work.
- [ ] Approve the interior, cabinets and deck/fence "What's included" lists and the guarantees (drafts; the exterior list is the website's wording).
- [ ] Confirm the sales-tax rate and treatment with your accountant, then set it in Estimate Setup and tick "Confirmed with our accountant" (tax is 0% until then).
- [ ] Decide how long signed documents are kept. They're stored privately and never deleted by the app.

## Photos, documents and lead-safe paperwork (Phase 5)

- [ ] Photos: the app removes GPS location and every other EXIF field from photos when they're uploaded and doesn't keep the originals. If you want proof-of-location on photos for disputes, ask for a staff-only location field instead.
- [ ] Decide what you tell customers before sharing photos of their home (and whether neighbors' homes in a shot need blurring). Sharing is simulated until email/text are connected.
- [ ] Lead-safe (RRP): upload each customer's signed "Renovate Right" acknowledgment (category Lead-Safe). The lead-safe onboarding item clears only with that document and, once crews arrive (Phase 6), a certified renovator on the crew. Washington runs its own RRP program through the Department of Commerce: confirm current record-keeping and retention requirements with them (records are commonly kept for years after the job).
- [ ] HOA approvals: upload the HOA's written approval (category HOA) before scheduling exterior color changes.
- [ ] Review the draft customer messages used for onboarding requests and prep instructions ("Draft wording – owner to approve" in the dialog; `lib/onboarding/messages.ts`).
- [ ] Decide how long uploaded documents and photos are kept. Deleted ones can be restored from Admin → Deleted Records; signed documents can't be deleted.

## Production (Phase 6)

- [ ] **Subcontractors:** upload each sub's certificate of insurance, contractor license and W-9 with expiry dates in Admin → Subcontractors. A sub with missing paperwork or anything expiring within 30 days shows "Expiring" and raises an Attention item; an expired document blocks scheduling their crews. Confirm with your insurer what coverage you require from subs (amounts aren't in the app).
- [ ] **Lead-safe (RRP):** mark crews that have a certified renovator with the "RRP certified" skill (with the certificate's expiry date) in Production → Resources. Lead-safe jobs then need such a crew, and the onboarding item checks it.
- [ ] **Customer sign-off:** the final-walkthrough statement customers sign on the crew's phone is draft wording (`lib/domain/scheduling/messages.ts` → `signoffStatement`). Have it reviewed; it records the name, drawn signature, time, IP and device, and can't be changed afterwards.
- [ ] **Customer messages:** schedule notices, rain-delay texts and daily updates use draft wording (owner to approve) and are only simulated until texting/email are connected. They respect opt-outs (SMS only with opt-in, otherwise email).
- [ ] **Hours:** crew hours come from daily logs. If you'll use them for payroll, decide who approves them and confirm Washington break/overtime rules with your payroll provider — the app doesn't calculate pay.
- [ ] **On-time credit:** the amount comes from Company Settings (On-time guarantee). Confirm the amount and the customer-facing terms; credits are drafted for owner approval and never applied automatically.

## Money (Phase 7)

- [ ] **Payment terms:** invoices are due on the issue date ("due on receipt") unless you pick another due date when sending. Tell us your standard terms (deposit %, progress billing, final due within N days) and the wording to print on invoices.
- [ ] **How to pay:** invoice emails, texts and the PDF say `[HOW_TO_PAY — owner to provide]`. Give us the payment methods you accept (check payable to …, Zelle, card) and any card-fee policy. No card payments are taken in the app (Stripe isn't connected).
- [ ] **Sales tax:** the app doesn't calculate tax; invoice lines are the prices from the accepted estimate. Confirm with your accountant how Washington sales tax applies to your residential painting work and how it should appear on invoices; we'll add it once you tell us.
- [ ] **Credits, refunds and late reminders:** review the draft wording for overdue reminders (7 and 30 days) and invoice messages (`lib/money/messages.ts`), and decide your refund policy. Refunds and credits need a written reason and are audit-logged; there are no late fees or interest in the app.
- [ ] **Lien and collection notices:** none are generated. If you send pre-lien or lien notices under Washington law, confirm the deadlines and wording with your attorney; the app can remind you once you give us the rules.
- [ ] **Receipts:** expense receipts (photos or PDFs) are stored privately, photos with location and other EXIF removed. Decide how long receipts must be kept for tax purposes (ask your accountant).
- [ ] **Closed months:** once a month is closed in Admin → Finance, nobody can change payments, refunds, invoices or expenses dated in it except an owner with a written reason (audit-logged). Agree with your bookkeeper when each month gets closed.
- [ ] **Access to money:** crew roles never see contract amounts, payments or margins. The bookkeeper can read hourly labor cost for job costing (not edit it). Check Admin → Users that only the right people have Finance packs.
