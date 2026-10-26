import { describe, expect, it } from "vitest";
import { filterToOps, validateRules } from "@/lib/lists/filters";
import { listOps, parseListState, resolveColumns } from "@/lib/lists/params";
import {
  ACCOUNTS_LIST,
  ACCOUNT_FIELDS,
  accountSearchOps,
  cleanSearchTerm,
} from "@/lib/lists/modules/accounts";
import {
  CONTACTS_LIST,
  CONTACT_ACCOUNT_OWNER_COLUMN,
  CONTACT_FIELDS,
  contactSearchOps,
} from "@/lib/lists/modules/contacts";

const NOW = new Date("2026-10-26T18:00:00Z");
const ME = "11111111-1111-4111-8111-111111111111";
const ctx = { userId: ME, now: NOW };
const A1 = "22222222-2222-4222-8222-222222222222";

describe("accounts list", () => {
  it("defaults to All, newest first", () => {
    const s = parseListState({}, ACCOUNTS_LIST);
    expect(s).toMatchObject({ tab: "all", sort: "created_at", dir: "desc", chips: [] });
    expect(listOps(s, ACCOUNTS_LIST, ctx, [])).toEqual([]);
  });

  it("maps status tabs and My accounts", () => {
    expect(ACCOUNTS_LIST.tabOps("active_customer", ctx)).toEqual([
      { kind: "filter", column: "status", op: "eq", value: "active_customer" },
    ]);
    expect(ACCOUNTS_LIST.tabOps("mine", ctx)).toEqual([
      { kind: "filter", column: "owner_id", op: "eq", value: ME },
    ]);
    expect(ACCOUNTS_LIST.tabOps("all", ctx)).toEqual([]);
    expect(ACCOUNTS_LIST.tabOps("bogus", ctx)).toEqual([]);
    for (const t of ACCOUNTS_LIST.tabs) expect(t.countKey).toBeTruthy();
  });

  it("maps type chips and referral champions", () => {
    expect(ACCOUNTS_LIST.chipOps("hoa", ctx)).toEqual([
      { kind: "filter", column: "account_type", op: "eq", value: "hoa" },
    ]);
    expect(ACCOUNTS_LIST.chipOps("referral_champions", ctx)).toEqual([
      { kind: "filter", column: "is_referral_champion", op: "eq", value: "true" },
    ]);
    expect(ACCOUNTS_LIST.chipOps("nope", ctx)).toEqual([]);
    // Type chips are either/or.
    const groups = ACCOUNTS_LIST.chips.filter((c) => c.group === "type").map((c) => c.id);
    expect(groups).toEqual(["residential", "property_manager", "hoa", "commercial"]);
  });

  it("ignores unknown chips and unsortable columns from the URL", () => {
    const s = parseListState(
      { tab: "nope", chips: "hoa,evil", sort: "search_text", dir: "sideways" },
      ACCOUNTS_LIST,
    );
    expect(s).toMatchObject({ tab: "all", chips: ["hoa"], sort: "created_at", dir: "desc" });
  });

  it("searches the name, quoted, and folds in address matches", () => {
    expect(accountSearchOps('Smith, "Res" (2)*')).toEqual([
      { kind: "or", expr: 'search_text.ilike."*smith res 2*"' },
    ]);
    expect(accountSearchOps("larch ln", [A1])).toEqual([
      { kind: "or", expr: `search_text.ilike."*larch ln*",id.in.("${A1}")` },
    ]);
    expect(accountSearchOps("  ,,  ")).toEqual([]);
    expect(cleanSearchTerm("  A\\B%C  ")).toBe("a b c");
  });

  it("validates advanced rules against account fields", () => {
    const spec = {
      match: "all" as const,
      rules: [
        { field: "type", op: "equals" as const, value: "hoa" },
        { field: "type", op: "equals" as const, value: "castle" },
        { field: "referral_champion", op: "equals" as const, value: "true" },
        { field: "tags", op: "contains" as const, value: "repeat" },
      ],
    };
    expect(validateRules(spec, ACCOUNT_FIELDS).map((e) => e.index)).toEqual([1]);
    expect(filterToOps(spec, ACCOUNT_FIELDS, NOW)).toEqual([
      { kind: "filter", column: "account_type", op: "eq", value: "hoa" },
      { kind: "filter", column: "is_referral_champion", op: "eq", value: "true" },
      { kind: "filter", column: "tags", op: "cs", value: "{repeat}" },
    ]);
  });

  it("always shows the name column", () => {
    expect(resolveColumns(ACCOUNTS_LIST, ["owner"]).map((c) => c.id)).toEqual(["name", "owner"]);
  });
});

describe("contacts list", () => {
  it("maps tabs, including Mine through the account owner", () => {
    expect(CONTACTS_LIST.tabOps("sms", ctx)).toEqual([
      { kind: "filter", column: "sms_opt_in", op: "eq", value: "true" },
    ]);
    expect(CONTACTS_LIST.tabOps("dnc", ctx)).toEqual([
      { kind: "filter", column: "do_not_contact", op: "eq", value: "true" },
    ]);
    expect(CONTACTS_LIST.tabOps("mine", ctx)).toEqual([
      { kind: "filter", column: CONTACT_ACCOUNT_OWNER_COLUMN, op: "eq", value: ME },
    ]);
    expect(CONTACT_ACCOUNT_OWNER_COLUMN).toBe("account.owner_id");
    expect(CONTACTS_LIST.tabOps("all", ctx)).toEqual([]);
  });

  it("maps chips", () => {
    expect(CONTACTS_LIST.chipOps("has_mobile", ctx)).toEqual([
      { kind: "filter", column: "mobile", op: "not.is", value: "null" },
    ]);
    expect(CONTACTS_LIST.chipOps("billing", ctx)).toEqual([
      { kind: "filter", column: "role", op: "eq", value: "billing" },
    ]);
    expect(CONTACTS_LIST.chipOps("nope", ctx)).toEqual([]);
  });

  it("searches name/email text and phone digits in one or-group", () => {
    expect(contactSearchOps("(425) 555-0142")).toEqual([
      {
        kind: "or",
        expr: 'search_text.ilike."*425 555-0142*",phone_digits.ilike."*4255550142*"',
      },
    ]);
    expect(contactSearchOps("Tess")).toEqual([{ kind: "or", expr: 'search_text.ilike."*tess*"' }]);
    // Fewer than 4 digits: no phone search.
    expect(contactSearchOps("12")).toEqual([{ kind: "or", expr: 'search_text.ilike."*12*"' }]);
    expect(contactSearchOps('a"b')).toEqual([{ kind: "or", expr: 'search_text.ilike."*a b*"' }]);
  });

  it("combines tab, chips, search and rules", () => {
    const s = parseListState({ tab: "sms", chips: "has_email", q: "tess" }, CONTACTS_LIST);
    const rule = filterToOps(
      { match: "all", rules: [{ field: "role", op: "equals", value: "tenant" }] },
      CONTACT_FIELDS,
      NOW,
    );
    expect(listOps(s, CONTACTS_LIST, ctx, rule)).toEqual([
      { kind: "filter", column: "sms_opt_in", op: "eq", value: "true" },
      { kind: "filter", column: "email", op: "not.is", value: "null" },
      { kind: "or", expr: 'search_text.ilike."*tess*"' },
      { kind: "filter", column: "role", op: "eq", value: "tenant" },
    ]);
  });
});
