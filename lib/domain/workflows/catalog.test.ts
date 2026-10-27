import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "@/lib/domain/templates/defaults";
import { validateTemplate } from "@/lib/domain/templates/merge";
import { DEFAULT_DRIPS } from "@/lib/domain/drips/defaults";
import { getWorkflow, templatesUsed, WORKFLOWS, workflowsForEvent } from "./catalog";
import {
  CUSTOMER,
  defaultTemplateLookup,
  FIXTURE_FOOTER,
  FIXTURE_SETTINGS,
  fixtureContext,
} from "./fixtures";
import { simulateWorkflow, type Simulation } from "./plan";
import type { RunContext } from "./types";

/**
 * SPEC §11.2 / PLAN Phase 8 "done when": every seeded workflow has a passing
 * dry-run test. Each test runs the workflow's Test (simulateWorkflow) against a
 * fixture record and checks what would happen, step by step, with nothing sent.
 */

// 10:00 am Pacific on Tuesday Oct 27, 2026 (outside quiet hours).
const NOW = new Date("2026-10-27T17:00:00.000Z");

function run(key: string, ctx: RunContext, eventType?: string, now = NOW): Simulation {
  const def = getWorkflow(key);
  if (!def) throw new Error(`No workflow ${key}`);
  return simulateWorkflow(def, ctx, {
    now,
    settings: FIXTURE_SETTINGS,
    templates: defaultTemplateLookup,
    footer: FIXTURE_FOOTER,
    eventType,
  });
}

function step(sim: Simulation, id: string) {
  const s = sim.steps.find((x) => x.actionId === id);
  if (!s) throw new Error(`No step ${id}`);
  return s;
}

/** Every send that would go out rendered with no missing merge fields. */
function expectCleanSends(sim: Simulation) {
  for (const s of sim.steps) {
    for (const m of s.sends ?? []) {
      if (!m.blocked) expect(m.missing, `${s.actionId} ${m.channel}`).toEqual([]);
    }
  }
}

describe("workflow catalog", () => {
  it("has the 17 workflows of SPEC §11.2, numbered 1–17, with unique keys", () => {
    expect(WORKFLOWS.map((w) => w.number)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    expect(new Set(WORKFLOWS.map((w) => w.key)).size).toBe(17);
  });

  it("only uses templates that are seeded for both channels, and valid merge fields", () => {
    for (const w of WORKFLOWS) {
      for (const key of templatesUsed(w)) {
        expect(
          DEFAULT_TEMPLATES.some((t) => t.key === key && t.channel === "sms"),
          `${w.key}: ${key} sms`,
        ).toBe(true);
        expect(
          DEFAULT_TEMPLATES.some((t) => t.key === key && t.channel === "email"),
          `${w.key}: ${key} email`,
        ).toBe(true);
      }
    }
    for (const t of DEFAULT_TEMPLATES) {
      expect(validateTemplate(t.body), `${t.key} ${t.channel}`).toEqual([]);
      if (t.subject) expect(validateTemplate(t.subject), `${t.key} subject`).toEqual([]);
    }
  });

  it("drips use seeded templates", () => {
    for (const d of DEFAULT_DRIPS)
      for (const s of d.steps)
        expect(DEFAULT_TEMPLATES.some((t) => t.key === s.template_key)).toBe(true);
  });

  it("finds workflows by event", () => {
    expect(workflowsForEvent("job.stage_changed").map((w) => w.key)).toEqual([
      "onboarding_cleared",
      "work_orders_complete",
      "final_walkthrough_signed_off",
      "paid_in_full",
    ]);
  });
});

describe("dry runs (one per seeded workflow)", () => {
  it("1. new web lead → assign, text-back, call task", () => {
    const sim = run(
      "lead_text_back",
      fixtureContext({ event: { type: "lead.created", payload: {} } }),
      "lead.created",
    );
    expect(sim.matched).toBe(true);
    expect(step(sim, "assign").outcome).toBe("would_run");
    const text = step(sim, "text_back");
    expect(text.outcome).toBe("would_run");
    expect(text.sends?.[0]?.channel).toBe("sms");
    expect(text.sends?.[0]?.body).toBe(
      "Hi Jamie, this is Hunter with Brushy Bear Painters. Got your request for exterior painting. When's a good time for a quick walkthrough?",
    );
    const task = step(sim, "call_task");
    expect(task.task?.assignee).toBe("Erik");
    expect(task.task?.dueAt).toBe("2026-10-27T17:10:00.000Z");
    expectCleanSends(sim);
  });

  it("1. a lead typed in by hand doesn't start the text-back", () => {
    const sim = run(
      "lead_text_back",
      fixtureContext({ lead: { intake_channel: "manual" } }),
      "lead.created",
    );
    expect(sim.matched).toBe(false);
    expect(sim.reason).toContain("the lead came from the website");
  });

  it("2. walkthrough booked → confirmation by text and email, calendar, reminders 24 h and 2 h before", () => {
    const start = "2026-10-30T17:00:00.000Z"; // Fri 10:00 am Pacific
    const sim = run(
      "walkthrough_booked",
      fixtureContext({
        appointment: { type: "walkthrough", status: "scheduled", start, with: "Erik" },
      }),
      "appointment.created",
    );
    const confirm = step(sim, "confirm");
    expect(confirm.sends?.map((s) => s.channel)).toEqual(["sms", "email"]);
    expect(confirm.sends?.[0]?.body).toContain("Friday, October 30 at 10:00 am");
    expect(step(sim, "calendar").outcome).toBe("would_run");
    expect(step(sim, "wait_24h").detail).toContain("2026-10-29T17:00:00.000Z");
    expect(step(sim, "reminder_24h").at).toBe("2026-10-29T17:00:00.000Z");
    expect(step(sim, "reminder_2h").at).toBe("2026-10-30T15:00:00.000Z");
    expectCleanSends(sim);
  });

  it("2. a walkthrough booked for an hour from now skips the reminders that are already late", () => {
    const sim = run(
      "walkthrough_booked",
      fixtureContext({
        appointment: {
          type: "walkthrough",
          status: "scheduled",
          start: "2026-10-27T18:00:00.000Z",
        },
      }),
      "appointment.created",
    );
    expect(step(sim, "wait_24h").outcome).toBe("skipped");
    expect(step(sim, "reminder_24h").outcome).toBe("skipped");
    expect(step(sim, "wait_2h").outcome).toBe("skipped");
    expect(step(sim, "reminder_2h").outcome).toBe("skipped");
  });

  it("3. walkthrough measured → “Send estimate” task due in 24 hours", () => {
    const sim = run(
      "walkthrough_completed",
      fixtureContext({
        appointment: { type: "walkthrough", result: "measured", status: "completed" },
      }),
      "appointment.completed",
    );
    const task = step(sim, "task");
    expect(task.task?.title).toBe("Send the estimate for Rivera – Kirkland – Exterior");
    expect(task.task?.dueAt).toBe("2026-10-28T17:00:00.000Z");
    expect(task.task?.assignee).toBe("Erik");
    expect(step(sim, "notify").notify?.to).toEqual(["Erik"]);
  });

  it("3. a second visit doesn't ask for the estimate yet", () => {
    const sim = run(
      "walkthrough_completed",
      fixtureContext({ appointment: { type: "walkthrough", result: "needs_second_visit" } }),
      "appointment.completed",
    );
    expect(sim.matched).toBe(false);
  });

  it("4. estimate sent → day 2 text, day 5 email, day 10 text from the owner", () => {
    const sim = run(
      "estimate_follow_up",
      fixtureContext({
        estimate: {
          status: "sent",
          number: "EST-2026-0007",
          link: "https://crm.example/p/abc",
          sent_at: NOW.toISOString(),
          expires_at: "2026-11-26T18:00:00.000Z",
        },
      }),
      "estimate.sent",
    );
    expect(step(sim, "day2").at).toBe("2026-10-29T17:00:00.000Z");
    expect(step(sim, "day2").sends?.[0]?.channel).toBe("sms");
    expect(step(sim, "day2").sends?.[0]?.body).toContain("https://crm.example/p/abc");
    expect(step(sim, "day5").sends?.[0]?.channel).toBe("email");
    expect(step(sim, "day5").at).toBe("2026-11-01T17:00:00.000Z");
    expect(step(sim, "day10").sends?.[0]?.body).toContain("this is Erik, one of the owners");
    expectCleanSends(sim);
    expect(getWorkflow("estimate_follow_up")?.exitLabel).toContain("accepted");
  });

  it("5. estimate accepted → welcome email with the prep list", () => {
    const sim = run("estimate_accepted", fixtureContext(), "estimate.accepted");
    const w = step(sim, "welcome");
    expect(w.sends?.[0]?.channel).toBe("email");
    expect(w.sends?.[0]?.subject).toBe("Welcome to Brushy Bear Painters: what happens next");
    expect(w.sends?.[0]?.body).toContain("Clear about 3 feet around the house");
    expectCleanSends(sim);
  });

  it("6. deposit paid → tell finance and the point of contact", () => {
    const sim = run(
      "deposit_paid",
      fixtureContext({ event: { payload: { hold_type: "deposit" } } }),
      "job.hold_released",
    );
    const n = step(sim, "notify");
    expect(n.notify?.to).toEqual(["Bookkeeper", "Hunter Lee"]);
    expect(n.notify?.title).toBe("Deposit paid: Rivera – Kirkland – Exterior");
  });

  it("6. releasing an HOA hold isn't the deposit", () => {
    const sim = run(
      "deposit_paid",
      fixtureContext({ event: { payload: { hold_type: "hoa" } } }),
      "job.hold_released",
    );
    expect(sim.matched).toBe(false);
  });

  it("7. ready to schedule → tell schedulers not already on the job", () => {
    const sim = run(
      "onboarding_cleared",
      fixtureContext({ event: { payload: { to: "ready_to_schedule" } } }),
      "job.stage_changed",
    );
    // Hunter is the point of contact (already told by the stage notice).
    expect(step(sim, "notify").notify?.to).toEqual(["Office Manager"]);
  });

  it("8. schedule published → customer notice with the rain-day promise, crew notices, day-before reminder", () => {
    const sim = run(
      "schedule_published",
      fixtureContext(
        {
          schedule: {
            change: "scheduled",
            notify_customer: true,
            start_date: "2026-11-09",
            dates: "Nov 9 – Nov 13",
            arrival_window: "8:00–8:30 am",
            crew_lead_first_name: "Sam",
            crew_changes: "• Rivera – Kirkland: Nov 9 – Nov 13",
            still_current: true,
          },
        },
        {
          recipients: {
            customer: CUSTOMER,
            crew_lead: { ...CUSTOMER, kind: "staff", name: "Sam Crew", mobile: "+14255550199" },
            subcontractor: null,
          },
        },
      ),
      "job.schedule_published",
    );
    const notice = step(sim, "scheduled");
    expect(notice.sends?.[0]?.body).toContain("We start Monday, November 9");
    expect(notice.sends?.[0]?.body).toContain("first on the schedule when it clears");
    expect(step(sim, "moved").outcome).toBe("skipped");
    expect(step(sim, "crew_notice").sends?.[0]?.to).toBe("Sam Crew");
    expect(step(sim, "crew_app").notify?.to).toEqual(["Sam Crew", "Pat Painter"]);
    // 4:00 pm Pacific (PST) the day before.
    expect(step(sim, "day_before").at).toBe("2026-11-09T00:00:00.000Z");
    expectCleanSends(sim);
  });

  it("8. a publish that doesn't tell the customer sends only the crew notice", () => {
    const sim = run(
      "schedule_published",
      fixtureContext({
        schedule: { change: "moved", notify_customer: false, crew_changes: "• x" },
      }),
      "job.schedule_published",
    );
    expect(step(sim, "moved").outcome).toBe("skipped");
    expect(step(sim, "day_before").outcome).toBe("skipped");
  });

  it("9. rain delay → the SPEC's rain-day text", () => {
    const sim = run(
      "rain_delay",
      fixtureContext({ rain_delay: { date: "2026-10-29", notify_customer: true } }),
      "job.rain_delay",
    );
    expect(step(sim, "text").sends?.[0]?.body).toBe(
      "Hi Jamie, rain's coming in Thursday. We'll move your start to the next dry day, and you're first on the list. No cost to you. - Hunter, Brushy Bear Painters",
    );
  });

  it("9. no text when the person unticked “text the customer”", () => {
    const sim = run(
      "rain_delay",
      fixtureContext({ rain_delay: { date: "2026-10-29", notify_customer: false } }),
      "job.rain_delay",
    );
    expect(sim.matched).toBe(false);
  });

  it("10. start missed → owners approve or waive the credit", () => {
    const sim = run("start_missed", fixtureContext(), "on_time_credit.created");
    expect(step(sim, "notify").notify?.to).toEqual(["Hunter Lee", "Erik"]);
    expect(step(sim, "notify").notify?.title).toBe(
      "Start date missed: Rivera – Kirkland – Exterior",
    );
  });

  it("11. daily log → customer update signed by the point of contact", () => {
    const sim = run(
      "daily_log_update",
      fixtureContext({
        daily_log: {
          finished_today: "Washed and scraped the north side",
          next_up: "Prime and caulk",
          photo_note: "4 photos from today are in your project.",
        },
      }),
      "daily_log.submitted",
    );
    const body = step(sim, "update").sends?.[0]?.body;
    expect(body).toBe(
      "Hi Jamie, today's update: Washed and scraped the north side. Next up: Prime and caulk. The work area is cleaned up for the evening. 4 photos from today are in your project. - Hunter, Brushy Bear Painters",
    );
  });

  it("11. a daily log submitted at 9 pm waits for 8 am to text (quiet hours)", () => {
    const night = new Date("2026-10-28T04:00:00.000Z"); // 9:00 pm Pacific
    const sim = run(
      "daily_log_update",
      fixtureContext({ daily_log: { finished_today: "Primed", next_up: null, photo_note: null } }),
      "daily_log.submitted",
      night,
    );
    expect(step(sim, "update").sends?.[0]?.deferredUntil).toBe("2026-10-28T15:00:00.000Z");
    expect(step(sim, "update").detail).toContain("quiet hours");
  });

  it("12. work orders done → ask for a final walkthrough, PM task", () => {
    const sim = run(
      "work_orders_complete",
      fixtureContext({ event: { payload: { to: "final_walkthrough" } } }),
      "job.stage_changed",
    );
    expect(step(sim, "request").sends?.[0]?.body).toContain("final walkthrough together");
    expect(step(sim, "task").task?.assignee).toBe("Sam Crew");
  });

  it("13. completed → tell the office, task to send the final invoice", () => {
    const sim = run(
      "final_walkthrough_signed_off",
      fixtureContext({ event: { payload: { to: "completed" } } }),
      "job.stage_changed",
    );
    expect(step(sim, "notify").notify?.to).toEqual(["Bookkeeper", "Hunter Lee"]);
    expect(step(sim, "task").task?.assignee).toBe("Bookkeeper");
  });

  it("14. invoice overdue → reminder and a note to the job's people and owners", () => {
    const sim = run(
      "invoice_overdue",
      fixtureContext({
        invoice: {
          number: "INV-2026-0012",
          balance_cents: 125000,
          days_past_due: 7,
          how_to_pay: "[HOW_TO_PAY — owner to provide]",
          open: true,
        },
      }),
      "invoice.overdue",
    );
    const r = step(sim, "reminder").sends?.[0];
    expect(r?.body).toContain("invoice INV-2026-0012 has $1,250.00 still open");
    expect(r?.placeholders).toEqual(["[HOW_TO_PAY — owner to provide]"]);
    expect(step(sim, "notify").notify?.to).toEqual(["Erik", "Hunter Lee"]);
  });

  it("14. a paid invoice gets no reminder", () => {
    const sim = run(
      "invoice_overdue",
      fixtureContext({ invoice: { number: "INV-1", open: false } }),
      "invoice.overdue",
    );
    expect(step(sim, "reminder").outcome).toBe("skipped");
  });

  it("15. paid in full → thanks, review +2 days, referral +14 days, one-year check-in", () => {
    const sim = run(
      "paid_in_full",
      fixtureContext({
        event: { payload: { to: "paid_in_full" } },
        review: { link: "https://crm.example/r/xyz" },
        referral: { code: "BEAR-7KQ2", reward: "[REFERRAL_REWARD]" },
      }),
      "job.stage_changed",
    );
    expect(step(sim, "thanks").sends?.[0]?.channel).toBe("email");
    expect(step(sim, "thanks").sends?.[0]?.placeholders).toContain("[WARRANTY_TERMS]");
    expect(step(sim, "review").at).toBe("2026-10-29T17:00:00.000Z");
    expect(step(sim, "review").sends?.[0]?.body).toContain("https://crm.example/r/xyz");
    expect(step(sim, "referral").at).toBe("2026-11-10T17:00:00.000Z");
    expect(step(sim, "referral").sends?.[0]?.body).toContain("BEAR-7KQ2");
    expect(step(sim, "check_in").at).toBe("2027-10-27T17:00:00.000Z");
    expectCleanSends(sim);
  });

  it("16. just-planning lead → nurture drip; exterior leads also get the pre-season drip", () => {
    const sim = run(
      "nurture",
      fixtureContext({
        lead: { timeline: "just_planning", service_keys: ["exterior", "interior"] },
      }),
      "lead.created",
    );
    expect(step(sim, "nurture").outcome).toBe("would_run");
    expect(step(sim, "preseason").outcome).toBe("would_run");
    const interior = run(
      "nurture",
      fixtureContext({ lead: { timeline: "just_planning", service_keys: ["interior"] } }),
      "lead.created",
    );
    expect(step(interior, "preseason").outcome).toBe("skipped");
  });

  it("16. a stale lead is enrolled too", () => {
    const sim = run(
      "nurture",
      fixtureContext({ lead: { service_keys: ["cabinets"] } }),
      "lead.stale",
    );
    expect(sim.matched).toBe(true);
    expect(step(sim, "nurture").outcome).toBe("would_run");
  });

  it("17. subcontractor paperwork → owners and the sub's contact", () => {
    const sim = run(
      "sub_compliance",
      fixtureContext(
        {
          subcontractor: {
            company_name: "Cascade Coatings",
            issues: "Insurance (COI) expires Nov 30.",
          },
        },
        {
          recipients: {
            customer: null,
            crew_lead: null,
            subcontractor: {
              ...CUSTOMER,
              kind: "subcontractor",
              name: "Cascade Coatings",
              email: "office@cascade.example",
            },
          },
        },
      ),
      "subcontractor.compliance_expiring",
    );
    expect(step(sim, "notify").notify?.title).toBe("Subcontractor paperwork: Cascade Coatings");
    expect(step(sim, "sub").sends?.[0]?.channel).toBe("email");
    expect(step(sim, "sub").sends?.[0]?.address).toBe("office@cascade.example");
  });
});

describe("dry runs respect consent", () => {
  it("Do Not Contact blocks every customer message", () => {
    const sim = run(
      "rain_delay",
      fixtureContext(
        { rain_delay: { date: "2026-10-29", notify_customer: true } },
        {
          recipients: {
            customer: { ...CUSTOMER, doNotContact: true },
            crew_lead: null,
            subcontractor: null,
          },
        },
      ),
      "job.rain_delay",
    );
    expect(step(sim, "text").outcome).toBe("blocked");
    expect(step(sim, "text").detail).toContain("asked not to be contacted");
  });

  it("a STOP reply moves the message to email", () => {
    const sim = run(
      "daily_log_update",
      fixtureContext(
        { daily_log: { finished_today: "Primed" } },
        {
          recipients: {
            customer: { ...CUSTOMER, smsOptedOut: true },
            crew_lead: null,
            subcontractor: null,
          },
        },
      ),
      "daily_log.submitted",
    );
    expect(step(sim, "update").sends?.[0]?.channel).toBe("email");
  });
});
