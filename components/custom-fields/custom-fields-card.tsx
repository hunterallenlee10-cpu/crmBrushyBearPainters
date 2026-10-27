import { createSupabaseServerClient } from "@/lib/db/server";
import { loadCustomFields } from "@/lib/custom-fields/server";
import {
  formatCustomValue,
  toCustomInput,
  toCustomValues,
  type CustomFieldModule,
} from "@/lib/domain/custom-fields";
import { CustomFieldsEditor } from "@/components/custom-fields/custom-fields-editor";

/**
 * "More fields" card: the company's custom fields for one record (Module
 * Manager). Renders nothing when the module has no active custom fields.
 */
export async function CustomFieldsCard({
  module,
  recordId,
  values,
  canEdit,
  className,
}: {
  module: CustomFieldModule;
  recordId: string;
  /** The record's custom_field_values jsonb. */
  values: unknown;
  canEdit: boolean;
  className?: string;
}) {
  const db = await createSupabaseServerClient();
  const defs = (await loadCustomFields(db, module)).filter((d) => d.active);
  if (defs.length === 0) return null;
  const stored = toCustomValues(values);
  const needsUsers = defs.some((d) => d.type === "user");
  const users = needsUsers
    ? ((await db.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"))
        .data ?? [])
    : [];
  const userNames = new Map(users.map((u) => [u.id, u.full_name]));

  return (
    <section
      aria-labelledby={`more-fields-${recordId}`}
      className={className ?? "min-w-0 rounded-2xl border bg-card p-4 sm:p-5"}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={`more-fields-${recordId}`} className="text-base font-semibold">
          More fields
        </h2>
        {canEdit && (
          <CustomFieldsEditor
            module={module}
            recordId={recordId}
            defs={defs}
            initial={Object.fromEntries(
              defs.map((d) => [d.apiName, toCustomInput(d, stored[d.apiName])]),
            )}
            users={users.map((u) => ({ value: u.id, label: u.full_name }))}
          />
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {defs.map((d) => (
          <div key={d.id} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{d.label}</dt>
            <dd className="text-sm break-words whitespace-pre-line">
              {d.type === "url" && typeof stored[d.apiName] === "string" ? (
                <a
                  href={String(stored[d.apiName])}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-bb-forest underline"
                >
                  {String(stored[d.apiName])}
                </a>
              ) : (
                formatCustomValue(d, stored[d.apiName], userNames)
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
