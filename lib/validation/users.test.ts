import { describe, expect, it } from "vitest";
import {
  canRemoveFactor,
  countByStatus,
  escapeHtml,
  filterUsers,
  invitationEmail,
  inviteUserSchema,
  laborCostSchema,
  mergePreferences,
  normalizeEmail,
  overrideSchema,
  ownProfileSchema,
  parseOpenWorkCounts,
  preferencesSchema,
  readPreferences,
  roleDefaultHome,
  userProfileSchema,
  type UserListRow,
} from "@/lib/validation/users";

const UID = "6f1c2a4e-3b5d-4c7e-9f00-112233445566";
const TPL = "0a1b2c3d-4e5f-4a6b-8c7d-8e9fa0b1c2d3";

describe("inviteUserSchema", () => {
  it("lowercases and trims the email; empty optional fields become null", () => {
    const v = inviteUserSchema.parse({
      full_name: "  Casey Crew ",
      email: "  Casey@Example.COM ",
      role_template_id: TPL,
      title: "",
      department: " Field ",
    });
    expect(v).toEqual({
      full_name: "Casey Crew",
      email: "casey@example.com",
      role_template_id: TPL,
      title: null,
      department: "Field",
    });
  });

  it("rejects a bad email and a missing name with friendly messages", () => {
    const r = inviteUserSchema.safeParse({ full_name: "", email: "nope", role_template_id: TPL });
    expect(r.success).toBe(false);
    const messages = r.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain("Full name is required.");
    expect(messages).toContain("Use an email like name@example.com.");
  });

  it("requires a role", () => {
    const r = inviteUserSchema.safeParse({ full_name: "A", email: "a@b.co", role_template_id: "" });
    expect(r.success).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => expect(normalizeEmail(" A@B.Co ")).toBe("a@b.co"));
});

describe("userProfileSchema / ownProfileSchema", () => {
  it("accepts a hex color and blank territory", () => {
    const v = userProfileSchema.parse({
      user_id: UID,
      full_name: "Pat",
      phone: "(425) 555-0100",
      title: "",
      department: "",
      default_territory_id: "",
      calendar_color: "#2F6B4F",
      signature: "",
    });
    expect(v.default_territory_id).toBeNull();
    expect(v.calendar_color).toBe("#2F6B4F");
    expect(v.signature).toBeNull();
  });

  it("rejects malformed phone and color", () => {
    const r = ownProfileSchema.safeParse({
      full_name: "Pat",
      phone: "call me",
      title: "",
      calendar_color: "green",
      signature: "",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toEqual(["phone", "calendar_color"]);
  });
});

describe("laborCostSchema", () => {
  it("converts dollars to integer cents", () => {
    expect(laborCostSchema.parse({ user_id: UID, hourly_cost: "$42.50" }).hourly_cost).toBe(4250);
  });
  it("blank clears the value", () => {
    expect(laborCostSchema.parse({ user_id: UID, hourly_cost: "" }).hourly_cost).toBeNull();
  });
  it("rejects nonsense and implausible amounts", () => {
    expect(laborCostSchema.safeParse({ user_id: UID, hourly_cost: "abc" }).success).toBe(false);
    expect(laborCostSchema.safeParse({ user_id: UID, hourly_cost: "5000" }).success).toBe(false);
  });
});

describe("overrideSchema", () => {
  it("keeps the scope for scoped permissions", () => {
    const v = overrideSchema.parse({
      user_id: UID,
      permission: "leads:read",
      effect: "grant",
      scope: "team",
      reason: "Covering phones",
    });
    expect(v.scope).toBe("team");
  });

  it("forces scope 'all' for permissions without scope", () => {
    const v = overrideSchema.parse({
      user_id: UID,
      permission: "data:export",
      effect: "revoke",
      scope: "own",
      reason: "No exports",
    });
    expect(v.scope).toBe("all");
  });

  it("rejects unknown permissions and short reasons", () => {
    const r = overrideSchema.safeParse({
      user_id: UID,
      permission: "rocket:launch",
      effect: "grant",
      reason: "no",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0]).sort()).toEqual(["permission", "reason"]);
  });
});

describe("preferences", () => {
  it("reads defaults from empty or junk input", () => {
    expect(readPreferences(null)).toEqual({
      default_home: "executive_overview",
      time_format: "12h",
    });
    expect(readPreferences({ default_home: "nope", time_format: 24 })).toEqual({
      default_home: "executive_overview",
      time_format: "12h",
    });
    expect(readPreferences({ default_home: "my_day", time_format: "24h" })).toEqual({
      default_home: "my_day",
      time_format: "24h",
    });
    // Phase 9: non-owners land on My Day until they pick otherwise.
    expect(readPreferences(null, roleDefaultHome(false)).default_home).toBe("my_day");
    expect(readPreferences(null, roleDefaultHome(true)).default_home).toBe("executive_overview");
    expect(readPreferences({ default_home: "executive_overview" }, "my_day").default_home).toBe(
      "executive_overview",
    );
  });

  it("merges without dropping other keys", () => {
    expect(
      mergePreferences(
        { density: "compact", default_home: "my_day" },
        preferencesSchema.parse({ default_home: "executive_overview", time_format: "24h" }),
      ),
    ).toEqual({ density: "compact", default_home: "executive_overview", time_format: "24h" });
    expect(mergePreferences([], { default_home: "my_day", time_format: "12h" })).toEqual({
      default_home: "my_day",
      time_format: "12h",
    });
  });
});

describe("filterUsers / countByStatus", () => {
  const rows: UserListRow[] = [
    {
      id: "1",
      fullName: "Olive Owner",
      email: "olive@x.co",
      roleName: "Owner",
      title: null,
      department: null,
      isActive: true,
    },
    {
      id: "2",
      fullName: "Pat Painter",
      email: "pat@x.co",
      roleName: "Painter",
      title: "Crew",
      department: "Field",
      isActive: true,
    },
    {
      id: "3",
      fullName: "Gone Guy",
      email: "gone@x.co",
      roleName: "Painter",
      title: null,
      department: null,
      isActive: false,
    },
  ];

  it("filters by status tab", () => {
    expect(filterUsers(rows, "", "active").map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterUsers(rows, "", "deactivated").map((r) => r.id)).toEqual(["3"]);
    expect(filterUsers(rows, "", "all")).toHaveLength(3);
  });

  it("searches name, email, role, title and department case-insensitively", () => {
    expect(filterUsers(rows, "PAINTER", "all").map((r) => r.id)).toEqual(["2", "3"]);
    expect(filterUsers(rows, "field", "all").map((r) => r.id)).toEqual(["2"]);
    expect(filterUsers(rows, "olive@", "active").map((r) => r.id)).toEqual(["1"]);
    expect(filterUsers(rows, "gone", "active")).toEqual([]);
  });

  it("counts each tab", () => {
    expect(countByStatus(rows)).toEqual({ active: 2, deactivated: 1, all: 3 });
  });
});

describe("parseOpenWorkCounts", () => {
  it("returns nothing for the Phase 1 empty object or bad input", () => {
    expect(parseOpenWorkCounts({})).toEqual([]);
    expect(parseOpenWorkCounts(null)).toEqual([]);
    expect(parseOpenWorkCounts([1, 2])).toEqual([]);
  });

  it("keeps positive counts with friendly labels, sorted", () => {
    expect(
      parseOpenWorkCounts({ leads: 3, jobs: 0, tasks: "2", custom_things: 1, bad: "x" }),
    ).toEqual([
      { key: "custom_things", label: "Custom things", count: 1 },
      { key: "leads", label: "Open leads", count: 3 },
      { key: "tasks", label: "Open tasks", count: 2 },
    ]);
  });
});

describe("canRemoveFactor", () => {
  it("always allows removing an unverified factor", () => {
    expect(canRemoveFactor({ requiresMfa: true, factorVerified: false, verifiedCount: 1 })).toBe(
      true,
    );
  });
  it("blocks removing the last verified factor when the role requires MFA", () => {
    expect(canRemoveFactor({ requiresMfa: true, factorVerified: true, verifiedCount: 1 })).toBe(
      false,
    );
    expect(canRemoveFactor({ requiresMfa: true, factorVerified: true, verifiedCount: 2 })).toBe(
      true,
    );
  });
  it("allows it when the role does not require MFA", () => {
    expect(canRemoveFactor({ requiresMfa: false, factorVerified: true, verifiedCount: 1 })).toBe(
      true,
    );
  });
});

describe("invitationEmail", () => {
  it("builds a plain message pointing at /login and escapes HTML", () => {
    const m = invitationEmail({
      inviterName: "Hunter <b>",
      appUrl: "http://localhost:3000/",
      email: "a@b.co",
    });
    expect(m.subject).toBe("You're invited to Brushy Bear CRM");
    expect(m.text).toBe(
      "Hunter <b> invited you to Brushy Bear CRM. Sign in at http://localhost:3000/login with this email (a@b.co).",
    );
    expect(m.html).toContain("Hunter &lt;b&gt;");
    expect(m.html).not.toContain("<b>");
  });

  it("escapeHtml handles quotes and ampersands", () => {
    expect(escapeHtml(`a&b "c" 'd'`)).toBe("a&amp;b &quot;c&quot; &#39;d&#39;");
  });
});
