import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BULK_FIELDS,
  isBulkKey,
  parseBulkCsv,
  planBulkUpdate,
  summarizePlan,
  type BulkRecord,
} from "@/lib/domain/bulk";
import {
  MERGE_FIELDS,
  MERGE_MOVES,
  cleanMergeChoices,
  defaultMergeChoices,
  previewMerge,
} from "@/lib/domain/merge";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261031000100_hardening.sql"),
  "utf8",
);

function sqlArray(fn: string, module: string): string[] {
  const body = MIGRATION.split(`create or replace function app.${fn}`)[1]!.split("$$;")[0]!;
  const block = body.split(`when '${module}' then array[`)[1]!.split("]")[0]!;
  return [...block.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]!);
}

const A = "0b3c6d1e-1111-4222-8333-444455556666";
const B = "1b3c6d1e-1111-4222-8333-444455556666";

describe("bulk fields agree with app.bulk_fields()", () => {
  for (const mod of ["leads", "jobs", "accounts", "contacts"] as const) {
    it(mod, () => {
      expect(sqlArray("bulk_fields", mod)).toEqual(BULK_FIELDS[mod].map((f) => f.key));
    });
  }
  it("never includes stage or consent", () => {
    for (const fields of Object.values(BULK_FIELDS)) {
      const keys = fields.map((f) => f.key);
      expect(keys).not.toContain("stage");
      expect(keys).not.toContain("do_not_contact");
      expect(keys).not.toContain("sms_opt_in");
    }
    expect(isBulkKey("jobs", "stage", [])).toBe(false);
    expect(isBulkKey("leads", "cf:rooms", ["rooms"])).toBe(true);
    expect(isBulkKey("leads", "cf:rooms", [])).toBe(false);
  });
});

describe("planBulkUpdate", () => {
  const records: BulkRecord[] = [
    { id: "r1", label: "Ada", values: { owner_id: A, custom_field_values: { rooms: 3 } } },
    { id: "r2", label: "Bo", values: { owner_id: B, custom_field_values: {} } },
  ];

  it("previews before/after per row and skips rows that already match", () => {
    const rows = planBulkUpdate("leads", records, () => ({ owner_id: B, "cf:rooms": 3 }), [
      "rooms",
    ]);
    expect(rows[0]).toMatchObject({
      status: "pending",
      before: { owner_id: A },
      after: { owner_id: B },
      changed: ["owner_id"],
    });
    expect(rows[1]).toMatchObject({
      status: "pending",
      before: { custom_field_values: { rooms: null } },
      after: { custom_field_values: { rooms: 3 } },
      changed: ["cf:rooms"],
    });
    const same = planBulkUpdate("leads", records.slice(1), () => ({ owner_id: B }), []);
    expect(same[0]!.status).toBe("unchanged");
    expect(summarizePlan([...rows, ...same])).toEqual({
      total: 3,
      changed: 2,
      unchanged: 1,
      errors: 0,
    });
  });

  it("marks rows asking for a field that can't be bulk updated", () => {
    const rows = planBulkUpdate("jobs", records.slice(0, 1), () => ({ stage: "closed_won" }), []);
    expect(rows[0]).toMatchObject({ status: "error", error: '"stage" can\'t be bulk updated.' });
  });

  it("treats empty strings and missing values as the same empty", () => {
    const rows = planBulkUpdate(
      "contacts",
      [{ id: "c", label: "C", values: { language: null } }],
      () => ({ language: "" }),
      [],
    );
    expect(rows[0]!.status).toBe("unchanged");
  });
});

describe("parseBulkCsv", () => {
  it("maps headers by key or label and reads changes", () => {
    const parsed = parseBulkCsv(
      "jobs",
      ["ID", "Priority", "tags", "Permit number", "Unknown", "Estimated duration (days)"],
      [
        [A, "high", "Exterior; Rush", "", "x", "4"],
        ["", "urgent", "", "P-1", "", ""],
        [B, "(clear)", "", "P-2", "", "abc"],
      ],
      [{ apiName: "permit_no", label: "Permit number" }],
    );
    expect(parsed.columns.map((c) => c.key)).toEqual([
      "id",
      "priority",
      "tags",
      "cf:permit_no",
      null,
      "estimated_duration_days",
    ]);
    expect(parsed.rows[0]).toEqual({
      rowNumber: 1,
      id: A,
      changes: { priority: "high", tags: ["exterior", "rush"], estimated_duration_days: 4 },
      error: null,
    });
    expect(parsed.rows[1]!.error).toMatch(/record id/);
    expect(parsed.rows[2]!.changes).toEqual({
      priority: null,
      "cf:permit_no": "P-2",
      estimated_duration_days: "abc",
    });
  });

  it("asks for an id column", () => {
    expect(parseBulkCsv("leads", ["Owner"], [["x"]], []).rows[0]!.error).toMatch(/id column/);
  });
});

describe("merge", () => {
  it("fields and moves agree with the database", () => {
    for (const mod of ["accounts", "contacts"] as const) {
      expect(sqlArray("merge_fields", mod)).toEqual(MERGE_FIELDS[mod].map((f) => f.key));
      const refs = sqlArray("merge_references", mod);
      expect(MERGE_MOVES[mod].map((m) => m.ref).filter((r) => !r.endsWith(".subject_id"))).toEqual(
        refs,
      );
    }
  });

  it("defaults: keep the survivor, fill blanks from the duplicate, combine tags", () => {
    const survivor = {
      display_name: "Alder Residence",
      notes: null,
      tags: ["vip"],
      custom_field_values: { a: 1 },
    };
    const merged = {
      display_name: "Alder Home",
      notes: "Dog",
      tags: ["repeat"],
      custom_field_values: { a: 2, b: 3 },
    };
    const choices = defaultMergeChoices("accounts", survivor, merged, ["a", "b"]);
    expect(choices).toMatchObject({
      display_name: "survivor",
      notes: "merged",
      tags: "union",
      "cf:a": "survivor",
      "cf:b": "merged",
    });
    expect(previewMerge("accounts", survivor, merged, choices)).toMatchObject({
      display_name: "Alder Residence",
      notes: "Dog",
      tags: ["repeat", "vip"],
    });
    expect(
      cleanMergeChoices("accounts", { ...choices, bogus: "merged", display_name: "union" }, [
        "a",
        "b",
      ]),
    ).toEqual({
      account_type: "survivor",
      status: "survivor",
      owner_id: "survivor",
      territory_id: "survivor",
      primary_contact_id: "survivor",
      notes: "merged",
      tags: "union",
      "cf:b": "merged",
    });
  });

  it("contacts: the stricter consent always wins in the preview", () => {
    const p = previewMerge(
      "contacts",
      { first_name: "Ada", do_not_contact: false, opted_out_at: null },
      { first_name: "Ada", do_not_contact: true, opted_out_at: "2026-01-01T00:00:00Z" },
      {},
    );
    expect(p).toMatchObject({ do_not_contact: true, opted_out_at: "2026-01-01T00:00:00Z" });
  });
});
