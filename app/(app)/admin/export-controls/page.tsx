import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatPacific } from "@/lib/admin/pacific";
import { RoleExportSwitch } from "./role-export-switch";

export const metadata: Metadata = { title: "Export Controls" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KIND_LABELS: Record<string, string> = {
  chart: "Chart",
  kpi_table: "KPI table",
  report: "Report",
  report_schedule: "Scheduled report",
  list: "List",
  audit_log: "Audit log",
  import_errors: "Import errors",
};
const PAGE = 50;

/**
 * Admin → Export Controls (SPEC §8.19, §13.1): who can export customer data,
 * and the export log (who exported what, with which filters, how many rows).
 */
export default async function ExportControlsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("audit:read");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const kind = typeof sp.kind === "string" && sp.kind in KIND_LABELS ? sp.kind : null;
  const db = await createSupabaseServerClient();
  let logQuery = db
    .from("export_log")
    .select("id, user_id, impersonated_by, kind, dataset, title, filters, row_count, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (kind) logQuery = logQuery.eq("kind", kind);
  const [templates, packs, links, overrides, profiles, log] = await Promise.all([
    db
      .from("role_templates")
      .select("id, key, name, grants_all, sort_order")
      .is("deleted_at", null)
      .order("sort_order"),
    db
      .from("permission_packs")
      .select("id, key, pack_permissions(permission)")
      .is("deleted_at", null),
    db.from("template_packs").select("template_id, pack_id"),
    db
      .from("user_permission_overrides")
      .select("user_id, permission, effect")
      .in("permission", ["data:export", "leads:export"]),
    db.from("profiles").select("id, full_name, role_template_id, is_active").order("full_name"),
    logQuery,
  ]);
  const packPerms = new Map(
    (packs.data ?? []).map((p) => [p.id, new Set(p.pack_permissions.map((x) => x.permission))]),
  );
  const dataExportPack = (packs.data ?? []).find((p) => p.key === "data_export")?.id ?? null;
  const roleRows = (templates.data ?? [])
    .filter((t) => !t.key.startsWith("e2e_"))
    .map((t) => {
      const mine = (links.data ?? []).filter((l) => l.template_id === t.id).map((l) => l.pack_id);
      const has = (perm: string) => t.grants_all || mine.some((id) => packPerms.get(id)?.has(perm));
      const people = (profiles.data ?? []).filter(
        (p) => p.role_template_id === t.id && p.is_active,
      ).length;
      return {
        id: t.id,
        name: t.name,
        locked: t.grants_all,
        data: has("data:export"),
        leads: has("leads:export"),
        viaPack: t.grants_all || (dataExportPack !== null && mine.includes(dataExportPack)),
        people,
      };
    });
  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]));
  const canManage = viewer.can("roles:manage") && !viewer.impersonating;
  const total = log.count ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Export Controls"
        description="Who can download customer data as CSV, and a log of every export. Exports are off while someone is using View as user."
      />
      <section className="rounded-2xl border bg-card p-5" aria-labelledby="who-heading">
        <h2 id="who-heading" className="text-base font-semibold">
          Who can export
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Turning a role on adds the “Data export” permission pack to it (the same as in{" "}
          <Link href="/admin/roles" className="text-bb-forest underline">
            Roles &amp; Permissions
          </Link>
          ). Lead exports also need “Export leads”, which is in the same pack.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Role
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  People
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Export data (CSV)
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Export leads
                </th>
                <th scope="col" className="py-2 font-medium">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {roleRows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {r.name}
                  </th>
                  <td className="py-2 pr-3 tabular-nums">{r.people}</td>
                  <td className="py-2 pr-3">
                    {r.data ? (
                      <Badge variant="success">Yes</Badge>
                    ) : (
                      <Badge variant="neutral">No</Badge>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {r.leads ? (
                      <Badge variant="success">Yes</Badge>
                    ) : (
                      <Badge variant="neutral">No</Badge>
                    )}
                  </td>
                  <td className="py-2">
                    {r.locked ? (
                      <span className="text-xs text-muted-foreground">Always on</span>
                    ) : canManage ? (
                      <RoleExportSwitch templateId={r.id} name={r.name} allowed={r.viaPack} />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Needs Roles &amp; Permissions
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(overrides.data ?? []).length > 0 && (
          <div className="mt-4 text-sm">
            <h3 className="font-semibold">Per-person exceptions</h3>
            <ul className="mt-1 list-disc pl-5">
              {(overrides.data ?? []).map((o) => (
                <li key={`${o.user_id}-${o.permission}`}>
                  {names.get(o.user_id) ?? "Someone"}: {o.effect === "grant" ? "can" : "can't"}{" "}
                  {o.permission === "leads:export" ? "export leads" : "export data"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="log-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="log-heading" className="text-base font-semibold">
            Export log{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {total.toLocaleString("en-US")}
            </span>
          </h2>
          <nav aria-label="Filter by kind" className="flex flex-wrap gap-1.5 text-xs">
            <Link
              href="/admin/export-controls"
              aria-current={!kind ? "page" : undefined}
              className={
                !kind
                  ? "rounded-full bg-bb-forest px-3 py-1 text-white"
                  : "rounded-full border px-3 py-1"
              }
            >
              All
            </Link>
            {Object.entries(KIND_LABELS).map(([k, l]) => (
              <Link
                key={k}
                href={`/admin/export-controls?kind=${k}`}
                aria-current={kind === k ? "page" : undefined}
                className={
                  kind === k
                    ? "rounded-full bg-bb-forest px-3 py-1 text-white"
                    : "rounded-full border px-3 py-1"
                }
              >
                {l}
              </Link>
            ))}
          </nav>
        </div>
        {(log.data ?? []).length === 0 ? (
          <EmptyState icon={Download} title="No exports yet" className="py-8">
            Every “Download CSV” and “Export CSV” is recorded here with who, what and how many rows.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    When (Pacific)
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Who
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    What
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Rows
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Filters
                  </th>
                </tr>
              </thead>
              <tbody>
                {(log.data ?? []).map((e) => (
                  <tr key={e.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatPacific(e.created_at, "MMM d, yyyy h:mm a")}
                    </td>
                    <td className="py-2 pr-3">
                      {(e.user_id && names.get(e.user_id)) || "Someone"}
                    </td>
                    <td className="py-2 pr-3">
                      {e.title}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({KIND_LABELS[e.kind] ?? e.kind})
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {e.row_count.toLocaleString("en-US")}
                    </td>
                    <td className="max-w-72 py-2 text-xs break-words text-muted-foreground">
                      {summarizeFilters(e.filters)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="mt-3 flex justify-end gap-3 text-sm">
            {page > 1 && (
              <Link
                className="underline"
                href={`/admin/export-controls?page=${page - 1}${kind ? `&kind=${kind}` : ""}`}
              >
                Newer
              </Link>
            )}
            {page * PAGE < total && (
              <Link
                className="underline"
                href={`/admin/export-controls?page=${page + 1}${kind ? `&kind=${kind}` : ""}`}
              >
                Older
              </Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function summarizeFilters(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "—";
  const parts = Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0) && v !== 0)
    .map(
      ([k, v]) =>
        `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`,
    );
  return parts.length ? parts.join(" · ").slice(0, 300) : "None";
}
