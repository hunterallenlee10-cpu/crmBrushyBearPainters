import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import { loadCustomFields } from "@/lib/custom-fields/server";
import {
  findDuplicates,
  mapImportRow,
  rowStatus,
  type ExistingRecord,
  type ImportModule,
} from "@/lib/domain/imports";
import { phoneDigits } from "@/lib/domain/leads/normalize";
import { rescoreLead } from "@/lib/leads/service";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

const CHUNK = 500;

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Existing records to check duplicates against (email / phone, or account name). */
async function existingFor(
  db: Db,
  module: ImportModule,
  emails: string[],
  digits: string[],
  names: string[],
): Promise<ExistingRecord[]> {
  const out: ExistingRecord[] = [];
  if (module === "accounts") {
    for (const part of chunks([...new Set(names)], 200)) {
      const { data } = await db.from("accounts").select("id, display_name").in("search_text", part);
      for (const a of data ?? [])
        out.push({ id: a.id, label: a.display_name, email: null, phoneDigits: null });
    }
    return out;
  }
  const table = module === "leads" ? "leads" : "contacts";
  for (const part of chunks([...new Set(emails)], 200)) {
    const { data } = await db
      .from(table)
      .select("id, first_name, last_name, email, phone_digits")
      .in("email", part);
    for (const r of data ?? [])
      out.push({
        id: r.id,
        label: [r.first_name, r.last_name].filter(Boolean).join(" "),
        email: r.email,
        phoneDigits: r.phone_digits,
      });
  }
  for (const part of chunks([...new Set(digits.map((d) => d.slice(-10)))], 200)) {
    const { data } = await db
      .from(table)
      .select("id, first_name, last_name, email, phone_digits")
      .in(
        "phone_digits",
        part.flatMap((d) => [d, `1${d}`]),
      );
    for (const r of data ?? [])
      out.push({
        id: r.id,
        label: [r.first_name, r.last_name].filter(Boolean).join(" "),
        email: r.email,
        phoneDigits: r.phone_digits,
      });
  }
  return out;
}

/** Maps every row with the chosen columns and fills the review queue. */
export async function buildReviewQueue(
  db: Db,
  imp: { id: string; org_id: string; module: ImportModule },
  mapping: Record<string, string>,
  duplicates: "skip" | "create",
): Promise<{ valid: number; errors: number; duplicates: number }> {
  const [custom, sources, rows] = await Promise.all([
    loadCustomFields(db, imp.module),
    db
      .from("picklists")
      .select("picklist_values(value, label, active)")
      .eq("key", "lead_source")
      .maybeSingle(),
    (async () => {
      const all: { id: string; row_number: number; raw: Json }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await db
          .from("import_rows")
          .select("id, row_number, raw")
          .eq("import_id", imp.id)
          .order("row_number")
          .range(from, from + 999);
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return all;
    })(),
  ]);
  const leadSources = (sources.data?.picklist_values ?? []).filter((v) => v.active);
  const ctx = {
    leadSources,
    defaultSource: leadSources.some((s) => s.value === "other") ? "other" : null,
    custom,
  };
  const mapped = rows.map((r) =>
    mapImportRow(imp.module, (r.raw ?? {}) as Record<string, string>, mapping, ctx),
  );
  const existing = await existingFor(
    db,
    imp.module,
    mapped.flatMap((m) => (m.email ? [m.email] : [])),
    mapped.flatMap((m) => (m.phoneDigits ? [m.phoneDigits] : [])),
    imp.module === "accounts" ? mapped.map((m) => m.label.toLowerCase()) : [],
  );
  const dups = findDuplicates(imp.module, mapped, existing);
  let valid = 0;
  let errors = 0;
  let duplicateCount = 0;
  const updates = rows.map((r, i) => {
    const m = mapped[i]!;
    const status = rowStatus(m.errors, dups[i] ?? null);
    if (status === "valid") valid += 1;
    else if (status === "error") errors += 1;
    else duplicateCount += 1;
    return {
      id: r.id,
      org_id: imp.org_id,
      import_id: imp.id,
      row_number: r.row_number,
      raw: (r.raw ?? {}) as { [key: string]: Json },
      data: m.data as { [key: string]: Json },
      status,
      errors: m.errors,
      duplicate_of: dups[i]?.of ?? null,
      duplicate_reason: dups[i]?.reason ?? null,
      decision: status === "duplicate" ? duplicates : null,
    };
  });
  for (const part of chunks(updates, CHUNK)) {
    check(await db.from("import_rows").upsert(part, { onConflict: "id" }));
  }
  check(
    await db
      .from("imports")
      .update({
        mapping,
        options: { duplicates },
        status: "review",
        valid_rows: valid,
        error_rows: errors,
        duplicate_rows: duplicateCount,
      })
      .eq("id", imp.id),
  );
  return { valid, errors, duplicates: duplicateCount };
}

type RowData = Record<string, Json | undefined>;

/** Creates one record from a mapped row (as the person: row security applies). Returns its id. */
async function createRecord(
  db: Db,
  orgId: string,
  module: ImportModule,
  data: RowData,
  accountCache: Map<string, string>,
): Promise<string> {
  const cf = (data.custom_field_values ?? {}) as { [key: string]: Json };
  if (module === "leads") {
    const { data: row, error } = await db
      .from("leads")
      .insert({
        org_id: orgId,
        intake_channel: "import",
        first_name: String(data.first_name ?? ""),
        last_name: (data.last_name as string | null) ?? null,
        company: (data.company as string | null) ?? null,
        email: (data.email as string | null) ?? null,
        mobile: (data.mobile as string | null) ?? null,
        phone: (data.phone as string | null) ?? null,
        street: (data.street as string | null) ?? null,
        city: (data.city as string | null) ?? null,
        zip: (data.zip as string | null) ?? null,
        services: (data.services as string[] | undefined) ?? [],
        timeline: (data.timeline as string | null) ?? null,
        home_built: (data.home_built as string | null) ?? null,
        year_built: (data.year_built as number | null) ?? null,
        lead_source: String(data.lead_source ?? "other"),
        customer_notes: (data.customer_notes as string | null) ?? null,
        custom_field_values: cf,
      })
      .select("id")
      .single();
    if (error || !row) throw new ActionFailure(mapError(error));
    return row.id;
  }
  if (module === "accounts") {
    const { data: acct, error } = await db
      .from("accounts")
      .insert({
        org_id: orgId,
        display_name: String(data.display_name ?? ""),
        account_type: (data.account_type as string | undefined) ?? "residential",
        notes: (data.notes as string | null) ?? null,
        tags: (data.tags as string[] | undefined) ?? [],
        custom_field_values: cf,
      })
      .select("id")
      .single();
    if (error || !acct) throw new ActionFailure(mapError(error));
    if (data.street || data.zip) {
      const { error: pErr } = await db.from("properties").insert({
        org_id: orgId,
        account_id: acct.id,
        street: (data.street as string | null) ?? null,
        city: (data.city as string | null) ?? null,
        zip: (data.zip as string | null) ?? null,
        is_primary: true,
      });
      if (pErr) logError("imports.property", pErr);
    }
    return acct.id;
  }
  // Contacts: attach to an account by name, or start one ("<Last> Residence").
  const last = (data.last_name as string | null) ?? null;
  const accountName = String(
    data.account_name ?? (last ? `${last} Residence` : `${data.first_name} Residence`),
  ).slice(0, 160);
  let accountId = accountCache.get(accountName.toLowerCase());
  if (!accountId) {
    const { data: found } = await db
      .from("accounts")
      .select("id")
      .eq("search_text", accountName.toLowerCase())
      .limit(1);
    accountId = found?.[0]?.id;
    if (!accountId) {
      const { data: created, error } = await db
        .from("accounts")
        .insert({ org_id: orgId, display_name: accountName })
        .select("id")
        .single();
      if (error || !created) throw new ActionFailure(mapError(error));
      accountId = created.id;
    }
    accountCache.set(accountName.toLowerCase(), accountId);
  }
  const { data: contact, error } = await db
    .from("contacts")
    .insert({
      org_id: orgId,
      account_id: accountId,
      first_name: String(data.first_name ?? ""),
      last_name: last,
      email: (data.email as string | null) ?? null,
      mobile: (data.mobile as string | null) ?? null,
      phone: (data.phone as string | null) ?? null,
      role: (data.role as string | undefined) ?? "other",
      language: (data.language as string | undefined) ?? undefined,
      notes: (data.notes as string | null) ?? null,
      custom_field_values: cf,
    })
    .select("id")
    .single();
  if (error || !contact) throw new ActionFailure(mapError(error));
  return contact.id;
}

function mapError(error: { code?: string; message?: string } | null) {
  if (!error) return actionError("server");
  return error.code === "23514" || error.code === "23505" || error.code === "23502"
    ? actionError("validation", (error.message ?? "").slice(0, 300) || undefined)
    : error.code === "42501"
      ? actionError("forbidden", "You can't create this record.")
      : actionError("server");
}

/** Applies the review queue: valid rows and duplicates marked "create". */
export async function applyImport(
  db: Db,
  imp: { id: string; org_id: string; module: ImportModule },
  actorId: string,
): Promise<{ applied: number; skipped: number; failed: number }> {
  const rows: { id: string; data: Json; status: string; decision: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("import_rows")
      .select("id, data, status, decision")
      .eq("import_id", imp.id)
      .order("row_number")
      .range(from, from + 999);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  check(await db.from("imports").update({ status: "applying" }).eq("id", imp.id));
  const accountCache = new Map<string, string>();
  const created: string[] = [];
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of rows) {
    const go = r.status === "valid" || (r.status === "duplicate" && r.decision === "create");
    if (!go) {
      if (r.status !== "error") {
        skipped += 1;
        await db.from("import_rows").update({ status: "skipped" }).eq("id", r.id);
      }
      continue;
    }
    try {
      const id = await createRecord(
        db,
        imp.org_id,
        imp.module,
        (r.data ?? {}) as RowData,
        accountCache,
      );
      created.push(id);
      applied += 1;
      await db.from("import_rows").update({ status: "applied", record_id: id }).eq("id", r.id);
    } catch (e) {
      failed += 1;
      const msg = e instanceof ActionFailure ? e.error.message : "Couldn't save this row.";
      await db
        .from("import_rows")
        .update({ status: "failed", errors: [msg] })
        .eq("id", r.id);
    }
  }
  if (imp.module === "leads") {
    for (const part of chunks(created, 8)) {
      await Promise.allSettled(part.map((id) => rescoreLead(db, id))).then((results) =>
        results.forEach((x) => x.status === "rejected" && logError("imports.rescore", x.reason)),
      );
    }
  }
  check(
    await db
      .from("imports")
      .update({
        status: "applied",
        applied_rows: applied,
        skipped_rows: skipped,
        failed_rows: failed,
        applied_at: new Date().toISOString(),
        applied_by: actorId,
      })
      .eq("id", imp.id),
  );
  return { applied, skipped, failed };
}

/** Raw CSV rows as header → cell objects for import_rows.raw. */
export function rawRows(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): Record<string, string>[] {
  return rows.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}

export { phoneDigits };
