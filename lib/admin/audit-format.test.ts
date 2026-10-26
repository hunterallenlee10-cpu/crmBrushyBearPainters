import { describe, expect, it } from "vitest";
import {
  AUDIT_PAGE_SIZE,
  actionLabel,
  actorLabel,
  auditLogHref,
  auditTableOptions,
  changedFields,
  diffAuditEntry,
  formatAuditValue,
  paginateAudit,
  parseAuditSearchParams,
  planAuditPage,
  summarizeAuditEntry,
  tableLabel,
  type AuditEntry,
} from "@/lib/admin/audit-format";

const HUNTER = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const names = new Map([
  [HUNTER, "Hunter Lee"],
  [PAT, "Pat Painter"],
]);

function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: 1,
    at: "2026-10-26T17:00:00Z",
    table_name: "public.company_settings",
    record_id: "x",
    action: "update",
    actor_id: HUNTER,
    impersonated_by: null,
    before: null,
    after: null,
    changed_fields: null,
    ...over,
  };
}

describe("labels", () => {
  it("labels known tables in plain English and humanizes unknown ones", () => {
    expect(tableLabel("public.company_settings")).toBe("Company settings");
    expect(tableLabel("public.profiles")).toBe("Users");
    expect(tableLabel("public.picklist_values")).toBe("Picklist values");
    expect(tableLabel("app.impersonation_sessions")).toBe("View as user");
    expect(tableLabel("public.work_orders")).toBe("Work orders");
  });

  it("table options are sorted and include an unlisted current table", () => {
    const opts = auditTableOptions("public.work_orders");
    expect(opts.map((o) => o.label)).toEqual(
      [...opts.map((o) => o.label)].sort((a, b) => a.localeCompare(b)),
    );
    expect(opts.find((o) => o.value === "public.work_orders")?.label).toBe("Work orders");
    expect(opts.find((o) => o.value === "public.company_settings")?.label).toBe("Company settings");
  });

  it("maps actions to Created/Changed/Deleted", () => {
    expect(actionLabel("insert")).toBe("Created");
    expect(actionLabel("update")).toBe("Changed");
    expect(actionLabel("delete")).toBe("Deleted");
  });
});

describe("actorLabel", () => {
  it("handles system, users and view-as", () => {
    expect(actorLabel(null, null, names)).toBe("System");
    expect(actorLabel(HUNTER, null, names)).toBe("Hunter Lee");
    expect(actorLabel(PAT, HUNTER, names)).toBe("Hunter Lee viewing as Pat Painter");
    expect(actorLabel("33333333-3333-4333-8333-333333333333", null, names)).toBe("Unknown user");
  });
});

describe("summarizeAuditEntry", () => {
  it("lists changed fields without bookkeeping columns", () => {
    const e = entry({ changed_fields: ["hours_text", "phone", "updated_at", "updated_by"] });
    expect(summarizeAuditEntry(e, names)).toBe("Changed Company settings: hours_text, phone");
  });

  it("computes changed fields when the trigger list is missing", () => {
    const e = entry({
      before: { phone: "1", email: "a", updated_at: "x" },
      after: { phone: "2", email: "a", updated_at: "y" },
    });
    expect(changedFields(e)).toEqual(["phone"]);
  });

  it("names the record for created/deleted rows", () => {
    expect(
      summarizeAuditEntry(
        entry({
          table_name: "public.picklist_values",
          action: "insert",
          after: { label: "Yard sign" },
        }),
        names,
      ),
    ).toBe("Created Picklist value “Yard sign”");
    expect(
      summarizeAuditEntry(
        entry({
          table_name: "public.profiles",
          action: "delete",
          before: { full_name: "Pat Painter" },
        }),
        names,
      ),
    ).toBe("Deleted User “Pat Painter”");
  });

  it("does not name singleton tables", () => {
    expect(
      summarizeAuditEntry(
        entry({ action: "insert", after: { company_name: "X", name: "Y" } }),
        names,
      ),
    ).toBe("Created Company settings");
  });

  it("shortens long field lists", () => {
    const e = entry({ changed_fields: ["a", "b", "c", "d", "e", "f", "g", "h"] });
    expect(summarizeAuditEntry(e, names)).toBe(
      "Changed Company settings: a, b, c, d, e, f and 2 more",
    );
  });

  it("describes soft delete and restore", () => {
    const base = { table_name: "public.territories", changed_fields: ["deleted_at"] };
    expect(
      summarizeAuditEntry(
        entry({ ...base, after: { name: "Kirkland", deleted_at: "2026-10-26" } }),
        names,
      ),
    ).toBe("Moved Territory “Kirkland” to Deleted Records");
    expect(
      summarizeAuditEntry(entry({ ...base, after: { name: "Kirkland", deleted_at: null } }), names),
    ).toBe("Restored Territory “Kirkland” from Deleted Records");
  });

  it("describes view-as sessions", () => {
    const start = entry({
      table_name: "app.impersonation_sessions",
      action: "insert",
      after: { target_user_id: PAT, event: "view_as_started" },
    });
    expect(summarizeAuditEntry(start, names)).toBe("Started viewing as Pat Painter");
    const end = entry({
      table_name: "app.impersonation_sessions",
      after: { target_user_id: PAT, event: "view_as_ended" },
    });
    expect(summarizeAuditEntry(end, names)).toBe("Stopped viewing as Pat Painter");
  });
});

describe("diffAuditEntry", () => {
  it("shows only changed fields for an update, hiding updated_at/updated_by", () => {
    const e = entry({
      before: { phone: "(425) 555-0100", hours_text: "Mon–Fri", email: "a@b.co", updated_at: "1" },
      after: {
        phone: "(425) 555-0199",
        hours_text: "By appointment",
        email: "a@b.co",
        updated_at: "2",
      },
      changed_fields: ["hours_text", "phone", "updated_at"],
    });
    expect(diffAuditEntry(e)).toEqual([
      { field: "hours_text", before: "Mon–Fri", after: "By appointment" },
      { field: "phone", before: "(425) 555-0100", after: "(425) 555-0199" },
    ]);
  });

  it("shows the row's own fields for a create, without ids and stamps", () => {
    const e = entry({
      action: "insert",
      after: {
        id: "x",
        org_id: "o",
        label: "Yard sign",
        sort_order: 3,
        color: null,
        created_at: "t",
      },
    });
    expect(diffAuditEntry(e)).toEqual([
      { field: "label", before: "—", after: "Yard sign" },
      { field: "sort_order", before: "—", after: "3" },
    ]);
  });

  it("shows the old fields for a delete", () => {
    const e = entry({ action: "delete", before: { label: "Old" } });
    expect(diffAuditEntry(e)).toEqual([{ field: "label", before: "Old", after: "—" }]);
  });

  it("truncates long JSON values", () => {
    const big = { list: Array.from({ length: 100 }, (_, i) => `item-${i}`) };
    const out = formatAuditValue(big, 40);
    expect(out).toHaveLength(40);
    expect(out.endsWith("…")).toBe(true);
    expect(formatAuditValue(null)).toBe("—");
    expect(formatAuditValue(false)).toBe("false");
  });
});

describe("parseAuditSearchParams", () => {
  it("keeps valid filters and drops invalid ones", () => {
    const { filters, cursor } = parseAuditSearchParams({
      table: "public.company_settings",
      action: "update",
      actor: HUNTER,
      from: "2026-10-01",
      to: "2026-02-30",
      record: " abc ",
      before: "120",
    });
    expect(filters).toEqual({
      table: "public.company_settings",
      action: "update",
      actor: HUNTER,
      from: "2026-10-01",
      record: "abc",
    });
    expect(cursor).toEqual({ before: 120 });
  });

  it("rejects injection-shaped values", () => {
    const { filters, cursor } = parseAuditSearchParams({
      table: "public.x;drop",
      action: "truncate",
      actor: "x,actor_id.eq.y",
      before: "-3",
      after: "1.5",
    });
    expect(filters).toEqual({});
    expect(cursor).toEqual({});
  });

  it("uses the first value of repeated params", () => {
    expect(parseAuditSearchParams({ action: ["delete", "insert"] }).filters.action).toBe("delete");
  });
});

describe("auditLogHref", () => {
  it("keeps filters and adds a cursor", () => {
    expect(auditLogHref({})).toBe("/admin/audit-log");
    expect(auditLogHref({ table: "public.profiles", action: "update" }, { before: 9 })).toBe(
      "/admin/audit-log?table=public.profiles&action=update&before=9",
    );
    expect(auditLogHref({ record: "a b" }, { after: 3 })).toBe(
      "/admin/audit-log?record=a+b&after=3",
    );
  });
});

describe("keyset pagination", () => {
  const ids = (n: number, start: number, step: -1 | 1) =>
    Array.from({ length: n }, (_, i) => ({ id: start + i * step }));

  it("plans newest-first, older and newer pages with one extra row", () => {
    expect(planAuditPage({})).toEqual({ ascending: false, limit: AUDIT_PAGE_SIZE + 1 });
    expect(planAuditPage({ before: 100 })).toEqual({ ascending: false, ltId: 100, limit: 51 });
    expect(planAuditPage({ after: 100 })).toEqual({ ascending: true, gtId: 100, limit: 51 });
  });

  it("first page: Older link only when more rows exist", () => {
    const full = paginateAudit(ids(51, 200, -1), {});
    expect(full.rows).toHaveLength(50);
    expect(full.rows[0]?.id).toBe(200);
    expect(full.older).toEqual({ before: 151 });
    expect(full.newer).toBeNull();

    const short = paginateAudit(ids(10, 200, -1), {});
    expect(short.older).toBeNull();
    expect(short.newer).toBeNull();
  });

  it("older page: Newer link back, Older only when more exist", () => {
    const page = paginateAudit(ids(6, 150, -1), { before: 151 });
    expect(page.rows.map((r) => r.id)).toEqual([150, 149, 148, 147, 146, 145]);
    expect(page.newer).toEqual({ after: 150 });
    expect(page.older).toBeNull();

    const more = paginateAudit(ids(51, 150, -1), { before: 151 });
    expect(more.older).toEqual({ before: 101 });
  });

  it("newer page: fetched ascending, shown newest first", () => {
    const page = paginateAudit(ids(51, 101, 1), { after: 100 });
    expect(page.rows).toHaveLength(50);
    expect(page.rows[0]?.id).toBe(150);
    expect(page.rows[49]?.id).toBe(101);
    expect(page.newer).toEqual({ after: 150 });
    expect(page.older).toEqual({ before: 101 });

    const top = paginateAudit(ids(5, 101, 1), { after: 100 });
    expect(top.newer).toBeNull();
    expect(top.older).toEqual({ before: 101 });
  });

  it("walking older then newer returns to the same rows", () => {
    const all = ids(120, 120, -1); // ids 120..1, newest first
    const fetchPlan = (cursor: { before?: number; after?: number }) => {
      const plan = planAuditPage(cursor);
      let rows = all.filter(
        (r) =>
          (plan.ltId === undefined || r.id < plan.ltId) &&
          (plan.gtId === undefined || r.id > plan.gtId),
      );
      if (plan.ascending) rows = [...rows].reverse();
      return paginateAudit(rows.slice(0, plan.limit), cursor);
    };
    const p1 = fetchPlan({});
    const p2 = fetchPlan(p1.older ?? {});
    const p3 = fetchPlan(p2.older ?? {});
    expect(p3.rows.map((r) => r.id)).toEqual(ids(20, 20, -1).map((r) => r.id));
    expect(p3.older).toBeNull();
    const back = fetchPlan(p3.newer ?? {});
    expect(back.rows.map((r) => r.id)).toEqual(p2.rows.map((r) => r.id));
  });

  it("empty pages still offer a way back", () => {
    expect(paginateAudit([], { before: 5 }).newer).toEqual({ after: 4 });
    expect(paginateAudit([], { after: 5 }).older).toEqual({ before: 6 });
  });
});
