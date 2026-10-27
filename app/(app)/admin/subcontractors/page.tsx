import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { pacificToday } from "@/lib/domain/scheduling/dates";
import { complianceIssues } from "@/lib/domain/scheduling/subcontractors";
import { SubcontractorsClient, type SubRow } from "./subcontractors-client";

export const metadata: Metadata = { title: "Subcontractors" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Admin → Subcontractors (SPEC §8.19, §5.4, §13.4): roster and compliance. */
export default async function SubcontractorsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("crews:manage");
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [subs, docs, crews] = await Promise.all([
    supabase.from("subcontractors").select("*").order("company_name"),
    supabase
      .from("subcontractor_documents")
      .select("id, subcontractor_id, kind, title, file_name, expires_on, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("crews").select("id, name, subcontractor_id").not("subcontractor_id", "is", null),
  ]);
  const today = pacificToday(new Date());
  const rows: SubRow[] = (subs.data ?? []).map((s) => ({
    id: s.id,
    companyName: s.company_name,
    contactName: s.contact_name,
    phone: s.phone,
    email: s.email,
    lniRegistration: s.lni_registration,
    lniExpiresOn: s.lni_expires_on,
    coiCarrier: s.coi_carrier,
    coiExpiresOn: s.coi_expires_on,
    w9OnFile: s.w9_on_file,
    bondOnFile: s.bond_on_file,
    bondExpiresOn: s.bond_expires_on,
    rrpCertification: s.rrp_certification,
    rrpExpiresOn: s.rrp_expires_on,
    status:
      s.status === "suspended" ? "suspended" : s.status === "expiring" ? "expiring" : "active",
    suspendedReason: s.suspended_reason,
    notes: s.notes,
    issues: complianceIssues(
      {
        status: s.status,
        lniExpiresOn: s.lni_expires_on,
        coiExpiresOn: s.coi_expires_on,
        bondExpiresOn: s.bond_expires_on,
        rrpExpiresOn: s.rrp_expires_on,
        w9OnFile: s.w9_on_file,
      },
      today,
    ).map((i) => ({ level: i.level, message: i.message })),
    crews: (crews.data ?? []).filter((c) => c.subcontractor_id === s.id).map((c) => c.name),
    documents: (docs.data ?? [])
      .filter((d) => d.subcontractor_id === s.id)
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.title,
        expiresOn: d.expires_on,
        createdAt: d.created_at,
      })),
  }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Subcontractors"
        description="WA L&I registration, insurance (COI), W-9, bond and RRP certification for each subcontractor. Crews made of a subcontractor can't be scheduled while paperwork is missing or suspended."
      />
      <SubcontractorsClient
        rows={rows}
        canEdit={!viewer.impersonating}
        openId={typeof sp.id === "string" ? sp.id : null}
      />
    </div>
  );
}
