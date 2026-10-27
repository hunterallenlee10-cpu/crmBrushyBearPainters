import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/domain/csv";
import {
  autoMap,
  findDuplicates,
  mapImportRow,
  rowStatus,
  type ImportContext,
} from "@/lib/domain/imports";
import type { CustomFieldDef } from "@/lib/domain/custom-fields";

const rooms: CustomFieldDef = {
  id: "d",
  module: "leads",
  apiName: "rooms",
  label: "Rooms",
  type: "number",
  options: [],
  required: false,
  helpText: null,
  showInList: false,
  sortOrder: 0,
  active: true,
};
const ctx: ImportContext = {
  leadSources: [
    { value: "website", label: "Website" },
    { value: "customer_referral", label: "Customer Referral" },
  ],
  defaultSource: "other",
  custom: [rooms],
};

describe("parseCsv", () => {
  it("handles quotes, commas, line breaks, CRLF, BOM and ragged rows", () => {
    const r = parseCsv('﻿Name,Notes,Zip\r\n"Smith, Jane","Line 1\nLine ""2""",98004\r\nBo,,\n\n');
    expect(r.error).toBeNull();
    expect(r.header).toEqual(["Name", "Notes", "Zip"]);
    expect(r.rows).toEqual([
      ["Smith, Jane", 'Line 1\nLine "2"', "98004"],
      ["Bo", "", ""],
    ]);
    expect(parseCsv("a,b\n1").rows).toEqual([["1", ""]]);
    expect(parseCsv("a,b\n1,2,3").rows).toEqual([["1", "2"]]);
  });

  it("reports empty files, unterminated quotes and too many rows", () => {
    expect(parseCsv("").error).toMatch(/empty/);
    expect(parseCsv('a\n"oops').error).toMatch(/quoted/);
    const big = ["h", ...Array.from({ length: 12 }, (_, i) => String(i))].join("\n");
    const r = parseCsv(big, { maxRows: 10 });
    expect(r.rows).toHaveLength(10);
    expect(r.error).toMatch(/first 10 rows/);
  });
});

describe("import mapping", () => {
  it("auto-maps headers by label, alias or custom field", () => {
    expect(
      autoMap(
        "leads",
        ["Name", "E-mail", "Cell", "Zip Code", "Source", "Rooms", "Mystery", "Email"],
        [rooms],
      ),
    ).toEqual({
      Name: "full_name",
      "E-mail": "email",
      Cell: "mobile",
      "Zip Code": "zip",
      Source: "lead_source",
      Rooms: "cf:rooms",
    });
    expect(autoMap("accounts", ["Household", "Address"])).toEqual({
      Household: "display_name",
      Address: "street",
    });
  });

  it("maps a lead row with normalization and custom values", () => {
    const m = mapImportRow(
      "leads",
      {
        Name: "Jane Q Smith",
        Email: " JANE@X.COM ",
        Phone: "425-555-0100",
        Zip: "98004-1234",
        Svc: "Interior and deck",
        Src: "customer referral",
        Rooms: "4",
        Built: "1965",
      },
      {
        Name: "full_name",
        Email: "email",
        Phone: "phone",
        Zip: "zip",
        Svc: "services",
        Src: "lead_source",
        Rooms: "cf:rooms",
        Built: "home_built",
      },
      ctx,
    );
    expect(m.errors).toEqual([]);
    expect(m.data).toMatchObject({
      first_name: "Jane Q",
      last_name: "Smith",
      email: "jane@x.com",
      phone: "+14255550100",
      zip: "98004",
      services: ["interior", "deck_fence"],
      lead_source: "customer_referral",
      home_built: "before_1978",
      year_built: 1965,
      custom_field_values: { rooms: 4 },
    });
    expect(m.label).toBe("Jane Q Smith");
    expect(m.phoneDigits).toBe("14255550100");
  });

  it("collects errors a person can fix", () => {
    const m = mapImportRow(
      "leads",
      { E: "not-an-email", P: "12", R: "lots" },
      { E: "email", P: "phone", R: "cf:rooms" },
      { ...ctx, defaultSource: null },
    );
    expect(m.errors).toEqual([
      "Rooms: enter a number.",
      '"not-an-email" isn\'t a valid email.',
      '"12" isn\'t a phone number we can use.',
      "A first name (or full name) is required.",
      "Add an email or a phone number.",
      "Pick a lead source (or map a column to it).",
    ]);
    expect(rowStatus(m.errors, null)).toBe("error");
  });

  it("maps accounts and contacts", () => {
    expect(
      mapImportRow(
        "accounts",
        { N: "Alder Residence", T: "HOA", G: "VIP; repeat", Z: "abc" },
        { N: "display_name", T: "account_type", G: "tags", Z: "zip" },
        ctx,
      ),
    ).toMatchObject({
      data: { display_name: "Alder Residence", account_type: "hoa", tags: ["vip", "repeat"] },
      errors: ['ZIP "abc" isn\'t a 5-digit ZIP.'],
    });
    expect(
      mapImportRow(
        "contacts",
        { A: "Alder Residence", F: "Ada", R: "Wife", M: "(425) 555-0199" },
        { A: "account_name", F: "first_name", R: "role", M: "mobile" },
        ctx,
      ),
    ).toMatchObject({
      data: {
        account_name: "Alder Residence",
        first_name: "Ada",
        role: "spouse_partner",
        mobile: "+14255550199",
      },
      errors: [],
    });
  });
});

describe("duplicates", () => {
  it("matches existing records and earlier rows by email or phone", () => {
    const dups = findDuplicates(
      "leads",
      [
        { label: "A", email: "a@x.com", phoneDigits: null },
        { label: "B", email: null, phoneDigits: "14255550100" },
        { label: "C", email: "c@x.com", phoneDigits: null },
        { label: "C2", email: "c@x.com", phoneDigits: null },
        { label: "D", email: null, phoneDigits: null },
      ],
      [
        { id: "e1", label: "Ann", email: "a@x.com", phoneDigits: null },
        { id: "e2", label: "Ben", email: null, phoneDigits: "4255550100" },
      ],
    );
    expect(dups).toEqual([
      { of: "e1", reason: "Same email as Ann." },
      { of: "e2", reason: "Same phone as Ben." },
      null,
      { of: null, reason: "Same email as row 3." },
      null,
    ]);
    expect(rowStatus([], dups[0]!)).toBe("duplicate");
  });

  it("accounts match on name", () => {
    expect(
      findDuplicates(
        "accounts",
        [
          { label: "Alder  Residence", email: null, phoneDigits: null },
          { label: "x", email: null, phoneDigits: null },
          { label: "X", email: null, phoneDigits: null },
        ],
        [{ id: "a", label: "alder residence", email: null, phoneDigits: null }],
      ),
    ).toEqual([
      { of: "a", reason: 'Same name as the existing account "alder residence".' },
      null,
      { of: null, reason: "Same name as row 2." },
    ]);
  });
});
