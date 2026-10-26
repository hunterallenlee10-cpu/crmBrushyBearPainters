import { SCOPE_LABELS, type Permission, type PermissionMap, type Scope } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { CATALOG_BY_CATEGORY } from "../model";

type Change = "added" | "removed" | "rescoped";

/**
 * Read-only grid of every catalog permission, grouped by category, with the scope
 * the template resolves to (Own records / Team / Everyone's) or "—".
 */
export function PermissionMatrix({
  map,
  changes,
  title = "Effective permissions",
  description,
}: {
  map: PermissionMap;
  /** Optional highlight for unsaved changes. */
  changes?: Partial<Record<Permission, Change>>;
  title?: string;
  description?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="perm-matrix-heading" className="rounded-2xl border bg-card p-5">
      <div className="mb-4">
        <h2 id="perm-matrix-heading" className="text-base font-semibold">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {CATALOG_BY_CATEGORY.map((group) => (
          <table key={group.category} className="w-full text-sm">
            <caption className="pb-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {group.label}
            </caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Permission</th>
                <th scope="col">Scope</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {group.items.map((p) => {
                const scope: Scope | undefined = map[p.key];
                const change = changes?.[p.key];
                return (
                  <tr
                    key={p.key}
                    className={cn(
                      change === "added" && "bg-success-bg",
                      change === "removed" && "bg-danger-bg",
                      change === "rescoped" && "bg-warning-bg",
                    )}
                  >
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      {p.label}
                    </th>
                    <td
                      className={cn(
                        "py-1.5 text-right whitespace-nowrap",
                        scope ? "font-medium" : "text-muted-foreground",
                      )}
                    >
                      {scope ? (p.scoped ? SCOPE_LABELS[scope] : "Granted") : "—"}
                      {change === "removed" && <span className="sr-only"> (being removed)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
    </section>
  );
}
