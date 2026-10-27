import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  INCLUSION_WORK_TYPES,
  SAMPLE_BADGE,
  parseDiscountLimits,
  parseGuarantees,
  parseInclusions,
  parsePricing,
  parseTaxConfig,
} from "@/lib/estimating/engine";
import { formatDateTime } from "@/lib/format/dates";
import { GuaranteesForm, InclusionsForm, PricingForm } from "./forms";

export const metadata: Metadata = { title: "Estimate Setup" };

/** Admin → Estimate Setup (SPEC §8.19, §7.3–7.6). */
export default async function EstimateSetupPage() {
  await requirePermission("settings:manage");
  const supabase = await createSupabaseServerClient();
  const [settings, company, roles, workTypes] = await Promise.all([
    supabase.from("estimate_settings").select("*").maybeSingle(),
    supabase
      .from("company_settings")
      .select("tax_config, deposit_percent, estimate_expiry_days")
      .maybeSingle(),
    supabase
      .from("role_templates")
      .select("key, name, grants_all, sort_order")
      .is("deleted_at", null)
      .order("sort_order"),
    supabase
      .from("picklist_values")
      .select("value, label, picklists!inner(key)")
      .eq("picklists.key", "work_type"),
  ]);
  const s = settings.data;
  const limits = parseDiscountLimits(s?.discount_limits);
  const inclusions = parseInclusions(s?.whats_included);
  const wtLabel = new Map((workTypes.data ?? []).map((w) => [w.value, w.label]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Estimate Setup"
        description={
          <>
            The numbers behind every estimate. Deposit % and expiry days live in{" "}
            <Link href="/admin/company" className="text-bb-forest underline">
              Company Settings
            </Link>{" "}
            (now {Number(company.data?.deposit_percent ?? 0)}% and{" "}
            {company.data?.estimate_expiry_days ?? 0} days). Paint and production rates are in the{" "}
            <Link href="/price-book" className="text-bb-forest underline">
              Price Book
            </Link>
            .
          </>
        }
      />
      <p className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
        {s?.is_sample ? (
          <>
            <Badge variant="sample">Sample</Badge> These are sample numbers ({SAMPLE_BADGE}). Saving
            the pricing form marks them as calibrated.
          </>
        ) : (
          <>
            <Badge variant="success">Calibrated</Badge>
            {s?.calibrated_at ? `Last saved ${formatDateTime(s.calibrated_at)}.` : ""}
          </>
        )}
      </p>
      <PricingForm
        pricing={parsePricing(s?.pricing)}
        tax={parseTaxConfig(company.data?.tax_config)}
        roles={(roles.data ?? [])
          .filter((r) => !r.grants_all)
          .map((r) => ({ key: r.key, name: r.name, limit: limits.roles[r.key] ?? 0 }))}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What&apos;s included</h2>
        <p className="text-sm text-muted-foreground">
          Shown on the proposal for each work type in the estimate. One item per line.
        </p>
        <div className="grid gap-4 xl:grid-cols-2">
          {INCLUSION_WORK_TYPES.map((wt) => (
            <InclusionsForm
              key={wt}
              workType={wt}
              label={wtLabel.get(wt) ?? wt}
              items={inclusions[wt].items}
              approved={inclusions[wt].status === "approved"}
              fromWebsite={inclusions[wt].source === "website"}
            />
          ))}
        </div>
      </section>
      <GuaranteesForm
        guarantees={parseGuarantees(s?.guarantees)}
        approved={s?.guarantees_status === "approved"}
        leadSafeDisclosure={s?.lead_safe_disclosure ?? ""}
      />
    </div>
  );
}
