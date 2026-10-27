import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { GitMerge, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadCustomFields } from "@/lib/custom-fields/server";
import { loadLeadOptions } from "@/lib/leads/service";
import {
  MERGE_FIELDS,
  MERGE_MOVES,
  defaultMergeChoices,
  type MergeModule,
} from "@/lib/domain/merge";
import { formatCustomValue, toCustomValues } from "@/lib/domain/custom-fields";
import { formatDateTime } from "@/lib/format/dates";
import { cn } from "@/lib/utils";
import { MergeCompare, UndoMergeButton } from "./merge-client";

export const metadata: Metadata = { title: "Merge Customers" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SELECT: Record<MergeModule, string> = {
  accounts:
    "id, display_name, account_type, status, owner_id, territory_id, primary_contact_id, notes, tags, custom_field_values, created_at",
  contacts:
    "id, first_name, last_name, role, mobile, phone, email, preferred_channel, language, notes, account_id, do_not_contact, opted_out_at, custom_field_values, created_at",
};

function name(module: MergeModule, r: Record<string, unknown>): string {
  return module === "accounts"
    ? String(r.display_name ?? "")
    : [r.first_name, r.last_name].filter(Boolean).join(" ");
}

/** Admin → Merge Customers (SPEC §8.19): pick the record that stays, choose field by field, undo any time. */
export default async function MergePage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("records:merge");
  const sp = await searchParams;
  const mod: MergeModule = sp.module === "contacts" ? "contacts" : "accounts";
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const a = z.uuid().safeParse(str("a")).success ? str("a") : null;
  const b = z.uuid().safeParse(str("b")).success ? str("b") : null;
  const q = str("q").trim().slice(0, 80);
  const db = await createSupabaseServerClient();
  const table = mod;
  const href = (p: Record<string, string | null>) => {
    const u = new URLSearchParams({ module: mod });
    for (const [k, v] of Object.entries({ a, b, q: q || null, ...p })) if (v) u.set(k, v);
    return `/admin/merge?${u.toString()}`;
  };

  // Search results and likely duplicates.
  const term = q.replace(/[%,()*]/g, " ").trim();
  const results = term
    ? (
        (
          await (mod === "accounts"
            ? db
                .from("accounts")
                .select(SELECT.accounts)
                .ilike("display_name", `%${term}%`)
                .limit(20)
            : db
                .from("contacts")
                .select(SELECT.contacts)
                .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`)
                .limit(20))
        ).data ?? []
      ).map((r) => r as unknown as Record<string, unknown>)
    : [];
  const recent = ((
    await db
      .from(table)
      .select(
        mod === "accounts" ? "id, display_name" : "id, first_name, last_name, email, phone_digits",
      )
      .order("created_at", { ascending: false })
      .limit(2000)
  ).data ?? []) as unknown as Record<string, string | null>[];
  const groups = new Map<string, Record<string, string | null>[]>();
  for (const r of recent) {
    const keys =
      mod === "accounts"
        ? [
            String(r.display_name ?? "")
              .toLowerCase()
              .trim(),
          ]
        : [
            r.email ? `e:${r.email}` : "",
            r.phone_digits ? `p:${String(r.phone_digits).slice(-10)}` : "",
          ];
    for (const k of keys.filter(Boolean)) groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const suggestions = [...groups.values()].filter((g) => g.length > 1).slice(0, 10);

  const [pair, custom, options, history] = await Promise.all([
    a && b ? db.from(table).select(SELECT[mod]).in("id", [a, b]) : Promise.resolve({ data: [] }),
    loadCustomFields(db, mod),
    loadLeadOptions(db),
    db
      .from("record_merges")
      .select(
        "id, module, survivor_id, merged_id, survivor_label, merged_label, status, merged_at, undone_at, reason",
      )
      .order("merged_at", { ascending: false })
      .limit(25),
  ]);
  const rows = (pair.data ?? []) as unknown as Record<string, unknown>[];
  const survivor = rows.find((r) => r.id === a) ?? null;
  const merged = rows.find((r) => r.id === b) ?? null;
  const labels = new Map<string, string>([
    ...options.users.map((u) => [u.value, u.label] as [string, string]),
    ...options.territories.map((t) => [t.value, t.label] as [string, string]),
  ]);
  const display = (v: unknown) =>
    v === null || v === undefined || v === ""
      ? "—"
      : Array.isArray(v)
        ? v.join(", ") || "—"
        : (labels.get(String(v)) ?? String(v));

  // How many related records would move (counted as the viewer sees them).
  let moves: { label: string; count: number }[] = [];
  if (merged) {
    const counts = await Promise.all(
      MERGE_MOVES[mod].map(async (m) => {
        const [t, col] = m.ref.split(".") as [string, string];
        if (col === "subject_id") {
          const { count } = await db
            .from(t as "notes")
            .select("id", { count: "exact", head: true })
            .eq("subject_type", mod === "accounts" ? "account" : "contact")
            .eq("subject_id", merged.id as string);
          return { label: m.label, count: count ?? 0 };
        }
        const { count } = await db
          .from(t as "jobs")
          .select("id", { count: "exact", head: true })
          .eq(col as "account_id", merged.id as string);
        return { label: m.label, count: count ?? 0 };
      }),
    );
    moves = counts.filter((c) => c.count > 0);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Merge Customers"
        description="Combine two records for the same household or person. You pick the one that stays and which values to keep; their jobs, leads, contacts, notes and messages move over. Any merge can be undone."
      />
      <nav aria-label="Record type" className="flex gap-2">
        {(["accounts", "contacts"] as const).map((m) => (
          <Link
            key={m}
            href={`/admin/merge?module=${m}`}
            aria-current={m === mod ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium sm:min-h-9",
              m === mod ? "border-bb-forest bg-bb-forest text-white" : "bg-card hover:bg-muted",
            )}
          >
            {m === "accounts" ? "Accounts" : "Contacts"}
          </Link>
        ))}
      </nav>

      {survivor && merged ? (
        <MergeCompare
          module={mod}
          survivor={{ id: survivor.id as string, name: name(mod, survivor) }}
          merged={{ id: merged.id as string, name: name(mod, merged) }}
          swapHref={href({ a: b, b: a })}
          clearHref={href({ a: null, b: null })}
          fields={[
            ...MERGE_FIELDS[mod].map((f) => ({
              key: f.key,
              label: f.label,
              union: Boolean(f.union),
              survivor: display(survivor[f.key]),
              merged: display(merged[f.key]),
            })),
            ...custom
              .filter((c) => c.active)
              .map((c) => ({
                key: `cf:${c.apiName}`,
                label: `${c.label} (custom)`,
                union: false,
                survivor: formatCustomValue(
                  c,
                  toCustomValues(survivor.custom_field_values)[c.apiName],
                  labels,
                ),
                merged: formatCustomValue(
                  c,
                  toCustomValues(merged.custom_field_values)[c.apiName],
                  labels,
                ),
              })),
          ]}
          defaults={defaultMergeChoices(
            mod,
            survivor,
            merged,
            custom.map((c) => c.apiName),
          )}
          moves={moves}
          consentNote={
            mod === "contacts"
              ? "Consent isn't chosen: if either contact opted out or is Do Not Contact, the merged contact is too."
              : null
          }
          readOnly={viewer.impersonating}
        />
      ) : (
        <section className="rounded-2xl border bg-card p-5" aria-labelledby="pick-heading">
          <h2 id="pick-heading" className="text-base font-semibold">
            {a ? "Now pick the duplicate to merge into it" : "Pick the record that stays"}
          </h2>
          <form method="get" action="/admin/merge" className="mt-3 flex gap-2">
            <input type="hidden" name="module" value={mod} />
            {a && <input type="hidden" name="a" value={a} />}
            <label htmlFor="merge-q" className="sr-only">
              Search
            </label>
            <Input
              id="merge-q"
              name="q"
              defaultValue={q}
              placeholder={mod === "accounts" ? "Account name" : "Name or email"}
            />
            <Button type="submit" variant="outline">
              <Search aria-hidden /> Search
            </Button>
          </form>
          {results.length > 0 && (
            <ul className="mt-3 divide-y rounded-xl border">
              {results.map((r) => (
                <li key={String(r.id)} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm">
                    <strong>{name(mod, r) || "(no name)"}</strong>
                    {mod === "contacts" && r.email ? (
                      <span className="text-muted-foreground"> · {String(r.email)}</span>
                    ) : null}
                  </span>
                  {r.id === a ? (
                    <Badge variant="info">Stays</Badge>
                  ) : (
                    <Button size="sm" variant={a ? "default" : "outline"} asChild>
                      <Link href={a ? href({ b: String(r.id) }) : href({ a: String(r.id) })}>
                        {a ? "Merge into the first" : "Keep this one"}
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {suggestions.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Likely duplicates</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {suggestions.map((g) => (
                  <li
                    key={g.map((x) => x.id).join()}
                    className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                  >
                    <span className="flex-1">
                      {g
                        .map((x) =>
                          mod === "accounts"
                            ? x.display_name
                            : [x.first_name, x.last_name].filter(Boolean).join(" "),
                        )
                        .join(" · ")}
                    </span>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={href({ a: g[0]!.id ?? null, b: g[1]!.id ?? null, q: null })}>Compare</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="merge-history">
        <h2 id="merge-history" className="mb-3 text-base font-semibold">
          Merge history
        </h2>
        {(history.data ?? []).length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitMerge className="size-4" aria-hidden /> No merges yet.
          </p>
        ) : (
          <ul className="divide-y">
            {(history.data ?? []).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1 text-sm">
                  <p>
                    <strong>{m.merged_label || "A duplicate"}</strong> into{" "}
                    <Link
                      className="text-bb-forest underline"
                      href={`/${m.module}/${m.survivor_id}`}
                    >
                      {m.survivor_label || "the survivor"}
                    </Link>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.module === "accounts" ? "Accounts" : "Contacts"} ·{" "}
                    {formatDateTime(m.merged_at)}
                    {m.reason ? ` · ${m.reason}` : ""}
                    {m.undone_at ? ` · undone ${formatDateTime(m.undone_at)}` : ""}
                  </p>
                </div>
                {m.status === "merged" ? (
                  !viewer.impersonating && (
                    <UndoMergeButton id={m.id} label={m.merged_label ?? ""} />
                  )
                ) : (
                  <Badge variant="neutral">Undone</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
