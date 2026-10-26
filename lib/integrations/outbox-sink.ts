import "server-only";
import { type SupabaseClient } from "@supabase/supabase-js";
import { type Database, type Json } from "@/lib/db/types";
import { type OutboxEntry, type OutboxSink } from "@/lib/integrations/core";

/**
 * Outbox sink backed by `integration_outbox`. Pass the service-role client
 * (callers have already checked permissions). Every row is `simulated`: this
 * build never sends anything (SPEC §2.1).
 */
export function createSupabaseOutboxSink(client: SupabaseClient<Database>): OutboxSink {
  return {
    async record(entry: OutboxEntry) {
      const { data, error } = await client
        .from("integration_outbox")
        .insert({
          org_id: entry.orgId,
          domain: entry.domain,
          provider: entry.provider,
          operation: entry.operation,
          recipient: entry.recipient ?? null,
          subject: entry.subject ?? null,
          rendered_body: entry.renderedBody ?? null,
          payload: toJsonObject(entry.payload),
          related_type: entry.related?.type ?? null,
          related_id: entry.related?.id ?? null,
          status: "simulated",
          created_by: entry.createdBy ?? null,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Could not record outbox entry: ${error?.message ?? "no row returned"}`);
      }
      return { id: data.id };
    },
  };
}

/** Convert an arbitrary payload into JSON-safe values (drops undefined/functions, Dates → ISO). */
export function toJsonObject(value: Record<string, unknown>): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  for (const [k, v] of Object.entries(value)) {
    const json = toJson(v);
    if (json !== undefined) out[k] = json;
  }
  return out;
}

function toJson(value: unknown): Json | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => toJson(v) ?? null);
  if (typeof value === "object") return toJsonObject(value as Record<string, unknown>);
  return undefined;
}
