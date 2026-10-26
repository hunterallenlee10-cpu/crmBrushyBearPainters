import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runAction, type ActionViewer } from "@/lib/actions/run-action";
import { ActionFailure, check, mapDbError } from "@/lib/actions/errors";
import { maskPii } from "@/lib/log";
import { initials, parseAccess, sessionGate } from "@/lib/auth/access";

const def = {
  name: "test.save",
  schema: z.object({ name: z.string().min(2, "Name is too short.") }),
  permissions: ["settings:manage"] as const,
  handler: vi.fn(async (input: { name: string }) => ({ saved: input.name })),
};

function viewer(over: Partial<ActionViewer> = {}): ActionViewer {
  return { id: "u1", impersonating: false, can: () => true, ...over };
}

const deps = (v: ActionViewer | null) => ({
  getViewer: async () => v,
  makeContext: async () => ({}),
});

describe("runAction", () => {
  it("validates input before anything else", async () => {
    const r = await runAction(def, { name: "x" }, deps(null));
    expect(r).toEqual({
      ok: false,
      error: {
        code: "validation",
        message: "Some fields need attention.",
        fieldErrors: { name: ["Name is too short."] },
      },
    });
  });

  it("requires a signed-in viewer", async () => {
    const r = await runAction(def, { name: "Bear" }, deps(null));
    expect(r.ok === false && r.error.code).toBe("unauthenticated");
  });

  it("refuses every write while viewing as another user", async () => {
    const r = await runAction(def, { name: "Bear" }, deps(viewer({ impersonating: true })));
    expect(r.ok === false && r.error.code).toBe("read_only");
  });

  it("checks permissions server-side", async () => {
    const r = await runAction(def, { name: "Bear" }, deps(viewer({ can: () => false })));
    expect(r.ok === false && r.error.code).toBe("forbidden");
    expect(def.handler).not.toHaveBeenCalled();
  });

  it("runs the handler and returns its data", async () => {
    const r = await runAction(def, { name: "Bear" }, deps(viewer()));
    expect(r).toEqual({ ok: true, data: { saved: "Bear" } });
  });

  it("passes ActionFailure through and hides unexpected errors", async () => {
    const failing = {
      ...def,
      handler: async () => {
        throw new ActionFailure({ code: "conflict", message: "Taken." });
      },
    };
    expect(await runAction(failing, { name: "Bear" }, deps(viewer()))).toEqual({
      ok: false,
      error: { code: "conflict", message: "Taken." },
    });
    const onError = vi.fn();
    const crashing = {
      ...def,
      handler: async () => {
        throw new Error("db exploded for bob@example.com");
      },
    };
    const r = await runAction(crashing, { name: "Bear" }, { ...deps(viewer()), onError });
    expect(r.ok === false && r.error.code).toBe("server");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("null permissions means any signed-in user", async () => {
    const open = { ...def, permissions: null };
    const r = await runAction(open, { name: "Bear" }, deps(viewer({ can: () => false })));
    expect(r.ok).toBe(true);
  });
});

describe("mapDbError", () => {
  it("passes our guard messages through", () => {
    expect(
      mapDbError({ code: "42501", message: "Only an owner can assign the Owner role." }),
    ).toEqual({
      code: "forbidden",
      message: "Only an owner can assign the Owner role.",
    });
    expect(
      mapDbError({ code: "23514", message: "At least one active owner is required." }).code,
    ).toBe("validation");
  });

  it("hides Postgres internals", () => {
    expect(
      mapDbError({
        code: "42501",
        message: 'new row violates row-level security policy for table "x"',
      }).message,
    ).toBe("You don't have permission to do that.");
    expect(
      mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "x"' })
        .message,
    ).toBe("That conflicts with an existing record.");
    expect(mapDbError({ code: "XX000", message: "internal" })).toEqual({
      code: "server",
      message: "Something went wrong. Try again, and tell an owner if it keeps happening.",
    });
  });

  it("check() throws ActionFailure on error and returns data otherwise", () => {
    expect(check({ data: 1, error: null })).toBe(1);
    expect(() =>
      check({ data: null, error: { code: "P0002", message: "Record not found." } }),
    ).toThrow("Record not found.");
  });
});

describe("maskPii", () => {
  it("masks emails and phone numbers", () => {
    expect(maskPii("call bob@example.com at (425) 555-0100 or +1 425.555.0199")).toBe(
      "call [email] at [phone] or [phone]",
    );
  });
});

describe("parseAccess / sessionGate", () => {
  const user = {
    id: "u1",
    email: "owner@test.bb",
    full_name: "Hunter Lee",
    org_id: "o1",
    is_active: true,
    role: {
      id: "r1",
      key: "owner",
      name: "Owner",
      requires_mfa: true,
      is_crew: false,
      grants_all: true,
    },
  };

  it("parses the RPC payload", () => {
    const a = parseAccess({
      user,
      effective_user: user,
      impersonation: null,
      session_ok: true,
      mfa: { required: true, aal: "aal2" },
      permissions: { "users:read": "all", nope: "all" },
    });
    expect(a?.user.fullName).toBe("Hunter Lee");
    expect(a?.user.role.grantsAll).toBe(true);
    expect(a?.permissions).toEqual({ "users:read": "all" });
    expect(sessionGate(a)).toBe("ok");
  });

  it("routes to MFA, no-access or ok", () => {
    const base = { user, effective_user: user, session_ok: false, permissions: {} };
    expect(sessionGate(parseAccess({ ...base, mfa: { required: true, aal: "aal1" } }))).toBe("mfa");
    expect(sessionGate(parseAccess({ user: null }))).toBe("no_access");
    // Optional two-step sign-in: asked for once the user has set up an authenticator.
    const optional = parseAccess({
      ...base,
      session_ok: true,
      mfa: { required: false, aal: "aal1" },
    });
    expect(sessionGate(optional)).toBe("ok");
    expect(sessionGate(optional, { hasVerifiedFactor: true })).toBe("mfa");
    expect(
      sessionGate(
        parseAccess({ ...base, session_ok: true, mfa: { required: false, aal: "aal2" } }),
        {
          hasVerifiedFactor: true,
        },
      ),
    ).toBe("ok");
    expect(
      sessionGate(
        parseAccess({
          ...base,
          user: { ...user, is_active: false },
          mfa: { required: false, aal: "aal1" },
        }),
      ),
    ).toBe("no_access");
    expect(sessionGate(null)).toBe("no_access");
  });

  it("parses an impersonation", () => {
    const painter = {
      ...user,
      id: "u2",
      full_name: "Pat Painter",
      role: { ...user.role, key: "painter", grants_all: false },
    };
    const a = parseAccess({
      user,
      effective_user: painter,
      impersonation: { id: "s1", target_user_id: "u2", started_at: "t0", expires_at: "t1" },
      session_ok: true,
      mfa: { required: true, aal: "aal2" },
      permissions: {},
    });
    expect(a?.effectiveUser.fullName).toBe("Pat Painter");
    expect(a?.impersonation?.targetUserId).toBe("u2");
  });

  it("builds initials", () => {
    expect(initials("Hunter Lee")).toBe("HL");
    expect(initials("Erik")).toBe("E");
    expect(initials("  mary  ann  smith ")).toBe("MS");
    expect(initials("")).toBe("?");
  });
});
