import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_DRIPS } from "@/lib/domain/drips/defaults";
import { DEFAULT_DISPOSITIONS, FOLLOW_UP_LISTS } from "@/lib/domain/follow-ups";
import { NOTIFICATION_TYPES } from "@/lib/domain/notifications/catalog";
import { WORKFLOWS } from "@/lib/domain/workflows/catalog";
import { countSms } from "@/lib/leads/messaging";
import { DEFAULT_TEMPLATES } from "./defaults";
import { fieldsUsed, parseTags, renderTemplate, sampleContext, validateTemplate } from "./merge";

describe("renderTemplate", () => {
  const ctx = {
    contact: { first_name: "Jamie" },
    company: { phone: "[PHONE]", name: "Brushy Bear Painters" },
    appointment: { start: "2026-11-03T17:00:00.000Z" },
    schedule: { start_date: "2027-06-07" },
    invoice: { balance_cents: 125050 },
    poc: { full_name: "Hunter Lee" },
  };

  it("fills fields and keeps placeholders as they are", () => {
    const r = renderTemplate("Hi {{contact.first_name}}, call {{company.phone}}.", ctx);
    expect(r.text).toBe("Hi Jamie, call [PHONE].");
    expect(r.missing).toEqual([]);
    expect(r.placeholders).toEqual(["[PHONE]"]);
  });

  it("formats dates in Pacific, calendar dates without shifting", () => {
    expect(renderTemplate("{{appointment.start | date}}", ctx).text).toBe("Tuesday, November 3");
    expect(renderTemplate("{{appointment.start | time}}", ctx).text).toBe("9:00 am");
    expect(renderTemplate("{{appointment.start | datetime}}", ctx).text).toBe(
      "Tuesday, November 3 at 9:00 am",
    );
    expect(renderTemplate("{{appointment.start | short_date}}", ctx).text).toBe("Tue, Nov 3");
    expect(renderTemplate("{{schedule.start_date | date}}", ctx).text).toBe("Monday, June 7");
    expect(renderTemplate("{{schedule.start_date | weekday}}", ctx).text).toBe("Monday");
  });

  it("money, first, upper, lower and defaults", () => {
    expect(renderTemplate("{{invoice.balance_cents | money}}", ctx).text).toBe("$1,250.50");
    expect(renderTemplate("{{poc.full_name | first}}", ctx).text).toBe("Hunter");
    expect(renderTemplate("{{contact.first_name | upper}}", ctx).text).toBe("JAMIE");
    expect(renderTemplate("{{contact.first_name | lower}}", ctx).text).toBe("jamie");
    expect(renderTemplate('{{contact.last_name | default:"there"}}', ctx).text).toBe("there");
  });

  it("reports missing fields; the preview marks them, sends leave them out tidily", () => {
    const send = renderTemplate(
      "Hi {{contact.last_name}}, see you {{appointment.start | date}}.",
      ctx,
    );
    expect(send.missing).toEqual(["contact.last_name"]);
    expect(send.text).toBe("Hi, see you Tuesday, November 3.");
    const preview = renderTemplate("Hi {{contact.last_name}}.", ctx, { missingAs: "marker" });
    expect(preview.text).toBe("Hi [contact.last_name].");
  });

  it('`| default:""` makes a field optional', () => {
    const r = renderTemplate('Done. {{daily_log.photo_note | default:""}} – Hunter', ctx);
    expect(r.missing).toEqual([]);
    expect(r.text).toBe("Done. – Hunter");
  });
});

describe("validateTemplate", () => {
  it("accepts the catalog's fields and filters", () => {
    expect(validateTemplate("{{contact.first_name}} {{appointment.start | date}}")).toEqual([]);
  });
  it("flags unknown fields, unknown filters and stray braces", () => {
    const issues = validateTemplate("{{contact.nickname}} {{contact.first_name | shout}} {{ oops");
    expect(issues.map((i) => i.kind)).toEqual(["unknown_field", "unknown_filter", "syntax"]);
    expect(validateTemplate("{{Not A Field}}")[0]?.kind).toBe("syntax");
  });
  it("lists fields used and parses filter arguments", () => {
    expect(fieldsUsed("{{a.b}} {{a.b | date}} {{c.d}}")).toEqual(["a.b", "c.d"]);
    expect(parseTags('{{x.y | default:"a | b"}}')[0]?.filters).toEqual([
      { name: "default", arg: "a | b" },
    ]);
  });
  it("renders every default template against the sample context with nothing missing", () => {
    const ctx = sampleContext();
    for (const t of DEFAULT_TEMPLATES) {
      const r = renderTemplate(t.body, ctx);
      expect(r.missing, `${t.key} ${t.channel}`).toEqual([]);
    }
  });
});

describe("default templates", () => {
  it("has an SMS and an email for every key, unique per channel", () => {
    const keys = new Set(DEFAULT_TEMPLATES.map((t) => t.key));
    for (const k of keys) {
      expect(DEFAULT_TEMPLATES.filter((t) => t.key === k && t.channel === "sms")).toHaveLength(1);
      expect(DEFAULT_TEMPLATES.filter((t) => t.key === k && t.channel === "email")).toHaveLength(1);
    }
  });
  it("keeps the Phase 5 onboarding keys (the Prep check reads prep_instructions)", () => {
    for (const k of [
      "prep_instructions",
      "onboarding_contact",
      "onboarding_access",
      "onboarding_colors",
      "onboarding_hoa",
      "onboarding_lead_safe",
      "invoice_reminder",
      "daily_update",
      "rain_delay",
      "schedule_published",
    ]) {
      expect(DEFAULT_TEMPLATES.some((t) => t.key === k)).toBe(true);
    }
  });
  it("customer texts stay short: at most 3 segments with sample values", () => {
    const ctx = sampleContext();
    for (const t of DEFAULT_TEMPLATES.filter(
      (x) => x.channel === "sms" && x.category !== "internal",
    )) {
      expect(countSms(renderTemplate(t.body, ctx).text).segments, t.key).toBeLessThanOrEqual(3);
    }
  });
  it("marketing templates are the drips' only", () => {
    const marketing = DEFAULT_TEMPLATES.filter((t) => t.messageType === "marketing").map(
      (t) => t.key,
    );
    const dripKeys = DEFAULT_DRIPS.flatMap((d) => d.steps.map((s) => s.template_key));
    expect(new Set(marketing)).toEqual(new Set(dripKeys));
  });
});

describe("seed migration stays in step with the TypeScript defaults", () => {
  const sql = readFileSync("supabase/migrations/20261029000200_communication_seed.sql", "utf8");
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

  it("seeds every template with the same wording", () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(sql, `${t.key} ${t.channel}`).toContain(`(p_org, ${lit(t.key)}, ${lit(t.channel)}, `);
      expect(sql, `${t.key} ${t.channel} body`).toContain(lit(t.body));
    }
  });
  it("seeds every workflow, list, disposition, drip and notification type", () => {
    for (const w of WORKFLOWS) expect(sql).toContain(`(p_org, ${lit(w.key)})`);
    for (const l of FOLLOW_UP_LISTS) expect(sql).toContain(`(p_org, ${lit(l.key)}, ${lit(l.name)}`);
    for (const d of DEFAULT_DISPOSITIONS)
      expect(sql).toContain(`(p_org, ${lit(d.key)}, ${lit(d.label)}`);
    for (const d of DEFAULT_DRIPS) expect(sql).toContain(lit(JSON.stringify(d.steps)));
    for (const n of NOTIFICATION_TYPES) expect(sql).toContain(`(p_org, ${lit(n.type)}, `);
  });
});
