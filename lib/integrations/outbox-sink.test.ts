import { type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { type Database } from "@/lib/db/types";
import { createSupabaseOutboxSink, toJsonObject } from "@/lib/integrations/outbox-sink";

type Inserted = Database["public"]["Tables"]["integration_outbox"]["Insert"];

/** Minimal fake of the `.from().insert().select().single()` chain the sink uses. */
function fakeClient(result: { data: { id: string } | null; error: { message: string } | null }) {
  const calls: { table: string; row: Inserted; columns: string }[] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: Inserted) {
          return {
            select(columns: string) {
              calls.push({ table, row, columns });
              return { single: async () => result };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

describe("createSupabaseOutboxSink", () => {
  it("inserts a simulated row and returns its id", async () => {
    const { client, calls } = fakeClient({ data: { id: "row-1" }, error: null });
    const sink = createSupabaseOutboxSink(client);
    const result = await sink.record({
      orgId: "org-1",
      domain: "email",
      provider: "outbox",
      operation: "email.send",
      recipient: "owner@example.com",
      subject: "Hello",
      renderedBody: "<p>Hi</p>",
      payload: { amountCents: 1000, when: new Date("2026-10-26T17:00:00Z"), skip: undefined },
      related: { type: "invoice", id: "inv-1" },
      createdBy: "user-1",
    });
    expect(result).toEqual({ id: "row-1" });
    expect(calls).toEqual([
      {
        table: "integration_outbox",
        columns: "id",
        row: {
          org_id: "org-1",
          domain: "email",
          provider: "outbox",
          operation: "email.send",
          recipient: "owner@example.com",
          subject: "Hello",
          rendered_body: "<p>Hi</p>",
          payload: { amountCents: 1000, when: "2026-10-26T17:00:00.000Z" },
          related_type: "invoice",
          related_id: "inv-1",
          status: "simulated",
          created_by: "user-1",
        },
      },
    ]);
  });

  it("defaults optional columns to null", async () => {
    const { client, calls } = fakeClient({ data: { id: "row-2" }, error: null });
    await createSupabaseOutboxSink(client).record({
      orgId: "org-1",
      domain: "sms_voice",
      provider: "outbox",
      operation: "sms.send",
      payload: {},
    });
    expect(calls[0]?.row).toMatchObject({
      recipient: null,
      subject: null,
      rendered_body: null,
      related_type: null,
      related_id: null,
      created_by: null,
    });
  });

  it("throws when the insert fails", async () => {
    const { client } = fakeClient({ data: null, error: { message: "permission denied" } });
    await expect(
      createSupabaseOutboxSink(client).record({
        orgId: "org-1",
        domain: "sms_voice",
        provider: "outbox",
        operation: "sms.send",
        payload: {},
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("toJsonObject", () => {
  it("keeps JSON values and normalises the rest", () => {
    expect(
      toJsonObject({
        s: "x",
        n: 1,
        nan: Number.NaN,
        b: true,
        nil: null,
        big: BigInt(5),
        arr: [1, undefined, "a"],
        nested: { d: new Date("2026-01-01T00:00:00Z"), f: () => 1 },
      }),
    ).toEqual({
      s: "x",
      n: 1,
      nan: null,
      b: true,
      nil: null,
      big: "5",
      arr: [1, null, "a"],
      nested: { d: "2026-01-01T00:00:00.000Z" },
    });
  });
});
