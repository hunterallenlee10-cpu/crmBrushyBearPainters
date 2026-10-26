import { describe, expect, it } from "vitest";
import {
  decodeFilter,
  encodeFilter,
  filterToOps,
  fromBase64Url,
  quote,
  renderExpr,
  ruleToExpr,
  toBase64Url,
  validateRules,
  type FieldDef,
  type FilterSpec,
} from "@/lib/lists/filters";
import { listOps, listStateToQuery, parseListState, resolveColumns } from "@/lib/lists/params";
import { LEADS_LIST, LEAD_FIELDS } from "@/lib/lists/modules/leads";

const NOW = new Date("2026-10-26T18:00:00Z");
const field = (key: string): FieldDef => LEAD_FIELDS.find((f) => f.key === key)!;
const OWNER = "11111111-1111-4111-8111-111111111111";

describe("filter rules", () => {
  it("validates operators per field type and values", () => {
    const spec: FilterSpec = {
      match: "all",
      rules: [
        { field: "score", op: "gt", value: "70" },
        { field: "score", op: "contains", value: "7" },
        { field: "created", op: "between", value: "2026-10-01", value2: "nope" },
        { field: "owner", op: "equals", value: "not-a-uuid" },
        { field: "status", op: "equals", value: "won" },
        { field: "nope", op: "equals", value: "x" },
        { field: "name", op: "contains", value: "  " },
        { field: "created", op: "in_last_days", value: "0" },
        { field: "out_of_area", op: "equals", value: "maybe" },
      ],
    };
    expect(validateRules(spec, LEAD_FIELDS).map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("accepts empty-checks without a value", () => {
    expect(
      validateRules({ match: "all", rules: [{ field: "owner", op: "is_empty" }] }, LEAD_FIELDS),
    ).toEqual([]);
  });

  it("translates each operator to PostgREST", () => {
    expect(
      renderExpr(ruleToExpr({ field: "name", op: "contains", value: "Smith" }, field("name"), NOW)),
    ).toBe('search_text.ilike."*smith*"');
    expect(
      renderExpr(ruleToExpr({ field: "score", op: "gt", value: "70" }, field("score"), NOW)),
    ).toBe('score.gt."70"');
    expect(renderExpr(ruleToExpr({ field: "owner", op: "is_empty" }, field("owner"), NOW))).toBe(
      "owner_id.is.null",
    );
    expect(renderExpr(ruleToExpr({ field: "email", op: "is_empty" }, field("email"), NOW))).toBe(
      'or(email.is.null,email.eq."")',
    );
    expect(
      renderExpr(
        ruleToExpr({ field: "owner", op: "not_equals", value: OWNER }, field("owner"), NOW),
      ),
    ).toBe(`or(owner_id.neq."${OWNER}",owner_id.is.null)`);
    expect(
      renderExpr(
        ruleToExpr({ field: "service", op: "contains", value: "exterior" }, field("service"), NOW),
      ),
    ).toBe('services.cs."{exterior}"');
    expect(
      renderExpr(
        ruleToExpr(
          { field: "status", op: "in", value: ["new", "contacted"] },
          field("status"),
          NOW,
        ),
      ),
    ).toBe('status.in.("new","contacted")');
    expect(
      renderExpr(
        ruleToExpr(
          { field: "created", op: "between", value: "2026-10-01", value2: "2026-10-31" },
          field("created"),
          NOW,
        ),
      ),
    ).toBe(
      'and(created_at.gte."2026-10-01T07:00:00.000Z",created_at.lte."2026-11-01T06:59:59.999Z")',
    ); // Pacific days
    expect(
      renderExpr(
        ruleToExpr({ field: "created", op: "in_last_days", value: "7" }, field("created"), NOW),
      ),
    ).toBe('created_at.gte."2026-10-19T18:00:00.000Z"');
  });

  it("quotes values so commas, parentheses and quotes can't break out", () => {
    expect(quote('a,b)"c\\')).toBe('"a,b)\\"c\\\\"');
    const ops = filterToOps(
      {
        match: "any",
        rules: [
          { field: "city", op: "contains", value: 'x"),status.eq.lost' },
          { field: "zip", op: "equals", value: "98033" },
        ],
      },
      LEAD_FIELDS,
      NOW,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      kind: "or",
      expr: 'city.ilike."*x\\"),status.eq.lost*",zip.ilike."98033"',
    });
  });

  it("ANDs rules into separate filters and drops invalid ones", () => {
    const ops = filterToOps(
      {
        match: "all",
        rules: [
          { field: "score", op: "gt", value: "70" },
          { field: "score", op: "gt", value: "abc" },
          { field: "created", op: "between", value: "2026-10-01", value2: "2026-10-31" },
        ],
      },
      LEAD_FIELDS,
      NOW,
    );
    expect(ops).toEqual([
      { kind: "filter", column: "score", op: "gt", value: "70" },
      { kind: "filter", column: "created_at", op: "gte", value: "2026-10-01T07:00:00.000Z" },
      { kind: "filter", column: "created_at", op: "lte", value: "2026-11-01T06:59:59.999Z" },
    ]);
  });

  it("round-trips through the URL, including non-ASCII text", () => {
    const spec: FilterSpec = {
      match: "any",
      rules: [{ field: "name", op: "contains", value: "Zoë – O'Neil" }],
    };
    expect(decodeFilter(encodeFilter(spec))).toEqual(spec);
    expect(fromBase64Url(toBase64Url("héllo ✓"))).toBe("héllo ✓");
    expect(encodeFilter({ match: "all", rules: [] })).toBe("");
    expect(decodeFilter("%%%not-base64")).toEqual({ match: "all", rules: [] });
    expect(decodeFilter(toBase64Url('{"match":"sideways"}'))).toEqual({ match: "all", rules: [] });
  });
});

describe("list state", () => {
  it("parses and sanitizes URL params", () => {
    const s = parseListState(
      {
        tab: "nope",
        chips: "hot,evil,stale",
        sort: "password",
        dir: "up",
        page: "-3",
        size: "1000",
        q: "smith",
      },
      LEADS_LIST,
    );
    expect(s).toMatchObject({
      tab: "active",
      chips: ["hot", "stale"],
      sort: "created_at",
      dir: "desc",
      page: 1,
      size: 25,
      q: "smith",
    });
  });

  it("serializes back without defaults", () => {
    const s = parseListState(new URLSearchParams("tab=new&sort=score&dir=asc&page=2"), LEADS_LIST);
    expect(listStateToQuery(s, LEADS_LIST)).toBe("?tab=new&sort=score&dir=asc&page=2");
    expect(listStateToQuery(parseListState({}, LEADS_LIST), LEADS_LIST)).toBe("");
  });

  it("combines tab, chips, search and rules", () => {
    const s = parseListState({ tab: "mine", chips: "hot", q: "425-555" }, LEADS_LIST);
    const ops = listOps(s, LEADS_LIST, { userId: OWNER, now: NOW }, []);
    expect(ops).toEqual([
      {
        kind: "filter",
        column: "status",
        op: "in",
        value: "(new,contacted,walkthrough_scheduled,nurture)",
      },
      { kind: "filter", column: "owner_id", op: "eq", value: OWNER },
      { kind: "filter", column: "temperature", op: "eq", value: "hot" },
      {
        kind: "or",
        expr: 'search_text.ilike."*425-555*",phone_digits.ilike."*425555*",lead_source.ilike."*425-555*"',
      },
    ]);
  });

  it("source chips cover sources and sub-sources", () => {
    expect(LEADS_LIST.chipOps("google", { userId: OWNER, now: NOW })).toEqual([
      {
        kind: "or",
        expr:
          'lead_source.in.("google_ads","google_business_profile","local_services_ads"),' +
          'lead_sub_source.in.("google_ads","google_business_profile","local_services_ads")',
      },
    ]);
  });

  it("resolves visible columns (saved order, unknown ids dropped, name always shown)", () => {
    expect(resolveColumns(LEADS_LIST, ["status", "bogus", "score"]).map((c) => c.id)).toEqual([
      "name",
      "status",
      "score",
    ]);
    expect(resolveColumns(LEADS_LIST, null).map((c) => c.id)).toContain("owner");
    expect(resolveColumns(LEADS_LIST, null).map((c) => c.id)).not.toContain("zip");
  });
});
