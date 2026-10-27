import { DEFAULT_TEMPLATES } from "@/lib/domain/templates/defaults";
import { mergeContexts, type MergeContext } from "@/lib/domain/templates/merge";
import type { EngineSettings, Recipient, RunContext, TemplateLookup } from "./types";
import type { FooterSettings } from "./plan";

/**
 * Fixtures for workflow tests: a fully filled-in customer, job and company,
 * the default templates, and settings with quiet hours 8 pm–8 am Pacific.
 */

export const FIXTURE_SETTINGS: EngineSettings = {
  quietHours: { enabled: true, start: "20:00", end: "08:00" },
  reviewDelayDays: 2,
  referralInviteDelayDays: 14,
};

export const FIXTURE_FOOTER: FooterSettings = {
  smsOptOutText: "Reply STOP to opt out.",
  emailFooter: "Brushy Bear Painters · [MAILING_ADDRESS]",
};

export const defaultTemplateLookup: TemplateLookup = (key, channel) => {
  const t = DEFAULT_TEMPLATES.find((x) => x.key === key && x.channel === channel);
  return t
    ? {
        key: t.key,
        channel: t.channel,
        subject: t.subject ?? null,
        body: t.body,
        active: true,
        status: "draft",
        messageType: t.messageType,
      }
    : null;
};

export const CUSTOMER: Recipient = {
  kind: "contact",
  id: "c-1",
  name: "Jamie Rivera",
  mobile: "+14255550101",
  email: "jamie@example.com",
  doNotContact: false,
  smsOptedOut: false,
  emailOptedOut: false,
  smsOptIn: true,
  emailOptIn: true,
};

export const PEOPLE: RunContext["people"] = {
  owners: [
    { id: "u-hunter", name: "Hunter Lee" },
    { id: "u-erik", name: "Erik" },
  ],
  schedulers: [
    { id: "u-hunter", name: "Hunter Lee" },
    { id: "u-office", name: "Office Manager" },
  ],
  finance: [{ id: "u-books", name: "Bookkeeper" }],
  job_owner: [{ id: "u-erik", name: "Erik" }],
  point_of_contact: [{ id: "u-hunter", name: "Hunter Lee" }],
  project_manager: [{ id: "u-pm", name: "Sam Crew" }],
  crew_lead: [{ id: "u-pm", name: "Sam Crew" }],
  crew: [
    { id: "u-pm", name: "Sam Crew" },
    { id: "u-painter", name: "Pat Painter" },
  ],
  lead_owner: [{ id: "u-erik", name: "Erik" }],
};

const BASE: MergeContext = {
  company: {
    name: "Brushy Bear Painters",
    phone: "[PHONE]",
    email: "[EMAIL]",
    hours: "[HOURS]",
    website: "brushybear.vercel.app",
  },
  contact: { first_name: "Jamie", last_name: "Rivera", full_name: "Jamie Rivera" },
  poc: { first_name: "Hunter", full_name: "Hunter Lee" },
  lead: {
    id: "l-1",
    first_name: "Jamie",
    services: "exterior painting",
    service_keys: ["exterior"],
    status: "new",
    intake_channel: "website",
    timeline: "1_3_months",
    owner_id: null,
    open: true,
    city: "Kirkland",
  },
  job: {
    id: "j-1",
    number: "BB-2026-0042",
    name: "Rivera – Kirkland – Exterior",
    city: "Kirkland",
    stage: "estimate_sent",
    work_types: "exterior painting",
    prep_list:
      "- Clear about 3 feet around the house.\n- Make sure we can use an outside spigot and outlet.",
    point_of_contact: { first_name: "Hunter", full_name: "Hunter Lee" },
    owner: { first_name: "Erik", full_name: "Erik" },
    crew_lead: { first_name: "Sam" },
    link: "/jobs/j-1",
    closed: false,
    paid_in_full_at: "2026-10-27T17:00:00.000Z",
  },
};

export function fixtureContext(
  extra: MergeContext = {},
  opts: Partial<RunContext> = {},
): RunContext {
  const merge = mergeContexts(BASE, extra);
  return {
    merge,
    facts: merge,
    recipients: { customer: CUSTOMER, crew_lead: null, subcontractor: null, ...opts.recipients },
    people: opts.people ?? PEOPLE,
    customerInitiated: opts.customerInitiated ?? false,
  };
}
