import { describe, expect, it } from "vitest";
import {
  accessCodeSchema,
  accountSchema,
  consentPatch,
  contactSchema,
  createAccountSchema,
  deleteRecordSchema,
  needsLeadSafe,
  parseTags,
  propertySchema,
  suggestDisplayName,
  yearBuiltRange,
  type ContactInput,
  type PropertyInput,
} from "@/lib/validation/accounts";

const NOW = new Date("2026-10-26T18:00:00Z");

const contact = (over: Partial<ContactInput> = {}): ContactInput => ({
  first_name: "Tess",
  last_name: "Tester",
  role: "primary",
  mobile: "(425) 555-0142",
  email: "Tess@Example.com ",
  ...over,
});

const property = (over: Partial<PropertyInput> = {}): PropertyInput => ({
  street: "123 Larch Ln",
  city: "Kirkland",
  zip: "98033",
  ...over,
});

function issues(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((i) => i.path.join("."));
}

describe("contactSchema", () => {
  it("normalizes phones to E.164 and emails to lowercase", () => {
    const c = contactSchema.parse(contact({ phone: "425.555.0199" }));
    expect(c.mobile).toBe("+14255550142");
    expect(c.phone).toBe("+14255550199");
    expect(c.email).toBe("tess@example.com");
    expect(c.language).toBe("en");
    expect(c.preferred_channel).toBeNull();
  });

  it("rejects a bad phone or email with a plain message", () => {
    const r = contactSchema.safeParse(contact({ mobile: "555", email: "nope" }));
    expect(r.success).toBe(false);
    expect(issues(r)).toEqual(expect.arrayContaining(["mobile", "email"]));
  });

  it("requires a source when opting in to texts or email", () => {
    const r = contactSchema.safeParse(contact({ sms_opt_in: true, email_opt_in: true }));
    expect(r.success).toBe(false);
    expect(issues(r)).toEqual(expect.arrayContaining(["sms_opt_in_source", "email_opt_in_source"]));
    const ok = contactSchema.parse(
      contact({ sms_opt_in: true, sms_opt_in_source: "  Website form  " }),
    );
    expect(ok.sms_opt_in).toBe(true);
    expect(ok.sms_opt_in_source).toBe("Website form");
  });

  it("needs a mobile number to opt in to texts and an email to opt in to email", () => {
    const r = contactSchema.safeParse(
      contact({
        mobile: "",
        email: "",
        sms_opt_in: true,
        sms_opt_in_source: "call",
        email_opt_in: true,
        email_opt_in_source: "call",
      }),
    );
    expect(issues(r)).toEqual(expect.arrayContaining(["mobile", "email"]));
  });

  it("Do Not Contact clears both opt-ins and needs no source", () => {
    const c = contactSchema.parse(
      contact({ do_not_contact: true, sms_opt_in: true, email_opt_in: true }),
    );
    expect(c).toMatchObject({
      do_not_contact: true,
      sms_opt_in: false,
      sms_opt_in_source: null,
      email_opt_in: false,
      email_opt_in_source: null,
    });
  });

  it("drops a leftover source when consent is off", () => {
    const c = contactSchema.parse(contact({ sms_opt_in: false, sms_opt_in_source: "old" }));
    expect(c.sms_opt_in_source).toBeNull();
  });
});

describe("consentPatch", () => {
  const base = {
    sms_opt_in_source: "Website form",
    email_opt_in_source: null,
    do_not_contact: false,
  };

  it("stamps a new opt-in with the current time", () => {
    const p = consentPatch({ ...base, sms_opt_in: true, email_opt_in: false }, null, NOW);
    expect(p.sms_opt_in_at).toBe(NOW.toISOString());
    expect(p.email_opt_in_at).toBeNull();
  });

  it("keeps the original time when consent is unchanged", () => {
    const p = consentPatch(
      { ...base, sms_opt_in: true, email_opt_in: false },
      {
        sms_opt_in: true,
        sms_opt_in_at: "2026-01-02T00:00:00Z",
        email_opt_in: false,
        email_opt_in_at: null,
      },
      NOW,
    );
    expect(p.sms_opt_in_at).toBe("2026-01-02T00:00:00Z");
  });

  it("clears time and source when consent is turned off or Do Not Contact is set", () => {
    const prev = {
      sms_opt_in: true,
      sms_opt_in_at: "2026-01-02T00:00:00Z",
      email_opt_in: true,
      email_opt_in_at: "2026-01-02T00:00:00Z",
    };
    const off = consentPatch({ ...base, sms_opt_in: false, email_opt_in: true }, prev, NOW);
    expect(off).toMatchObject({ sms_opt_in: false, sms_opt_in_at: null, sms_opt_in_source: null });
    expect(off.email_opt_in_at).toBe("2026-01-02T00:00:00Z");
    const dnc = consentPatch(
      { ...base, sms_opt_in: true, email_opt_in: true, do_not_contact: true },
      prev,
      NOW,
    );
    expect(dnc).toMatchObject({
      sms_opt_in: false,
      sms_opt_in_at: null,
      email_opt_in: false,
      email_opt_in_at: null,
      do_not_contact: true,
    });
  });
});

describe("propertySchema", () => {
  it("requires a 5-digit ZIP", () => {
    for (const zip of ["", "9803", "98033-1234", "abcde"]) {
      expect(issues(propertySchema.safeParse(property({ zip })))).toContain("zip");
    }
    expect(propertySchema.parse(property({ zip: " 98033 " })).zip).toBe("98033");
  });

  it("limits the year built to 1700 through next year", () => {
    const { max } = yearBuiltRange();
    expect(issues(propertySchema.safeParse(property({ year_built: "1699" })))).toContain(
      "year_built",
    );
    expect(issues(propertySchema.safeParse(property({ year_built: String(max + 1) })))).toContain(
      "year_built",
    );
    expect(issues(propertySchema.safeParse(property({ year_built: "19x5" })))).toContain(
      "year_built",
    );
    expect(propertySchema.parse(property({ year_built: "1965" })).year_built).toBe(1965);
    expect(propertySchema.parse(property({ year_built: "" })).year_built).toBeNull();
  });

  it("parses stories, square feet and empty choices", () => {
    const p = propertySchema.parse(
      property({ stories: "2", approx_sqft: "2,400", home_built: "", occupancy: "" }),
    );
    expect(p).toMatchObject({ stories: 2, approx_sqft: 2400, home_built: null, occupancy: null });
    expect(issues(propertySchema.safeParse(property({ approx_sqft: "50" })))).toContain(
      "approx_sqft",
    );
  });

  it("clears HOA details when there's no HOA", () => {
    const p = propertySchema.parse(
      property({ has_hoa: false, hoa_name: "Lakeview", hoa_color_approval_required: true }),
    );
    expect(p).toMatchObject({ hoa_name: null, hoa_color_approval_required: false });
    const h = propertySchema.parse(property({ has_hoa: true, hoa_name: "Lakeview" }));
    expect(h.hoa_name).toBe("Lakeview");
  });

  it("uppercases the state and defaults to WA", () => {
    expect(propertySchema.parse(property()).state).toBe("WA");
    expect(propertySchema.parse(property({ state: "or" })).state).toBe("OR");
  });
});

describe("needsLeadSafe", () => {
  it("matches the database rule (year wins; otherwise before 1978 or not sure)", () => {
    expect(needsLeadSafe({ year_built: 1965, home_built: null })).toBe(true);
    expect(needsLeadSafe({ year_built: 1978, home_built: "before_1978" })).toBe(false);
    expect(needsLeadSafe({ year_built: null, home_built: "not_sure" })).toBe(true);
    expect(needsLeadSafe({ year_built: null, home_built: "1978_or_later" })).toBe(false);
    expect(needsLeadSafe({ year_built: null, home_built: null })).toBe(false);
  });
});

describe("accountSchema and friends", () => {
  it("parses tags and an empty owner", () => {
    const a = accountSchema.parse({
      display_name: " Smith Residence ",
      account_type: "residential",
      status: "prospect",
      owner_id: "",
      tags: "repeat,  referral champ , repeat,",
    });
    expect(a).toMatchObject({
      display_name: "Smith Residence",
      owner_id: null,
      tags: ["repeat", "referral champ"],
      is_referral_champion: false,
      notes: null,
    });
  });

  it("rejects unknown types and statuses", () => {
    const r = accountSchema.safeParse({
      display_name: "X",
      account_type: "villa",
      status: "won",
    });
    expect(issues(r)).toEqual(expect.arrayContaining(["account_type", "status"]));
  });

  it("caps tags", () => {
    expect(parseTags(" a, b ,, a ")).toEqual(["a", "b"]);
    const many = Array.from({ length: 31 }, (_, i) => `t${i}`).join(",");
    expect(
      issues(
        accountSchema.safeParse({
          display_name: "X",
          account_type: "hoa",
          status: "inactive",
          tags: many,
        }),
      ),
    ).toContain("tags");
  });

  it("nests errors by section for the New account form", () => {
    const r = createAccountSchema.safeParse({
      account: { display_name: "", account_type: "residential", status: "prospect" },
      contact: contact({ first_name: "" }),
      property: property({ zip: "1" }),
    });
    expect(issues(r)).toEqual(
      expect.arrayContaining(["account.display_name", "contact.first_name", "property.zip"]),
    );
  });

  it("needs a reason to delete and a code to save", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(deleteRecordSchema.safeParse({ id, reason: "  x " }).success).toBe(false);
    expect(deleteRecordSchema.safeParse({ id, reason: "Duplicate" }).success).toBe(true);
    expect(accessCodeSchema.safeParse({ property_id: id, code: "   " }).success).toBe(false);
    expect(accessCodeSchema.parse({ property_id: id, code: " 1234# " }).code).toBe("1234#");
  });

  it("suggests a household name", () => {
    expect(suggestDisplayName("residential", "Smith", "Ann")).toBe("Smith Residence");
    expect(suggestDisplayName("residential", "", "Ann")).toBe("Ann Residence");
    expect(suggestDisplayName("commercial", "Smith")).toBe("");
  });
});
