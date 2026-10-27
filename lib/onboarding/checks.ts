import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { evaluateChecklist, type OnboardingSnapshot } from "@/lib/domain/onboarding/rules";
import { advanceIfGatePasses } from "@/lib/jobs/stage";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { logError } from "@/lib/log";
import { PREP_TEMPLATE_KEY } from "./messages";
import { loadCrewCoverage } from "@/lib/production/coverage";

type Db = SupabaseClient<Database>;

/**
 * Runs the onboarding auto-verify rules for jobs (SPEC §6.4) with the service
 * client: loads the job snapshot, evaluates lib/domain/onboarding, writes the
 * results through apply_onboarding_checks() (which never overwrites a manual
 * clear and releases the Deposit Hold when the deposit clears), then moves the
 * job Onboarding → Ready to Schedule through advanceIfGatePasses() when the
 * gate passes. Callers check visibility first; the worker sweeps every job in
 * Onboarding each minute.
 */

const OPEN_APPOINTMENT = ["tentative", "scheduled", "confirmed", "in_progress"];
const SENT_MESSAGE = ["simulated", "queued", "sent", "delivered"];

export async function loadOnboardingSnapshot(
  service: Db,
  jobId: string,
): Promise<OnboardingSnapshot | null> {
  const { data: job } = await service
    .from("jobs")
    .select(
      "id, org_id, work_types, primary_contact_id, property_id, account_id, promised_start_date",
    )
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!job) return null;

  const [
    contact,
    property,
    estimates,
    signatures,
    signedDocs,
    changeOrders,
    deposit,
    colors,
    consults,
    docs,
    paint,
    prep,
    settings,
  ] = await Promise.all([
    job.primary_contact_id
      ? service
          .from("contacts")
          .select("first_name, last_name, mobile, email")
          .eq("id", job.primary_contact_id)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    job.property_id
      ? service
          .from("properties")
          .select("has_hoa, occupancy, pets, parking, access_notes")
          .eq("id", job.property_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    service
      .from("estimates")
      .select("id, status, accepted_version_id, accepted_option_id")
      .eq("job_id", jobId)
      .eq("status", "accepted")
      .is("deleted_at", null),
    service
      .from("signatures")
      .select("id, estimate_version_id, document_id")
      .eq("job_id", jobId)
      .not("estimate_version_id", "is", null),
    service
      .from("documents")
      .select("id")
      .eq("job_id", jobId)
      .in("category", ["contract", "proposal"])
      .eq("status", "signed")
      .is("deleted_at", null)
      .limit(1),
    service.from("change_orders").select("status").eq("job_id", jobId).is("deleted_at", null),
    service
      .from("invoice_ledger")
      .select("invoice_number, status, total_cents, collected_cents")
      .eq("job_id", jobId)
      .eq("invoice_type", "deposit")
      .neq("status", "void")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service.from("color_selections").select("status").eq("job_id", jobId).is("deleted_at", null),
    service
      .from("appointments")
      .select("status")
      .eq("job_id", jobId)
      .eq("type", "color_consultation")
      .is("deleted_at", null),
    service
      .from("documents")
      .select("category")
      .or(
        job.account_id
          ? `job_id.eq.${jobId},and(account_id.eq.${job.account_id},job_id.is.null)`
          : `job_id.eq.${jobId}`,
      )
      .in("category", ["hoa", "lead_safe"])
      .is("deleted_at", null),
    service
      .from("paint_orders")
      .select("status")
      .eq("job_id", jobId)
      .neq("status", "canceled")
      .is("deleted_at", null),
    service
      .from("messages")
      .select("created_at")
      .eq("subject_type", "job")
      .eq("subject_id", jobId)
      // The prep list goes out on its own or inside the welcome email (workflow 5).
      .or(`template_key.eq.${PREP_TEMPLATE_KEY},and(template_key.eq.welcome,channel.eq.email)`)
      .eq("direction", "outbound")
      .in("status", SENT_MESSAGE)
      .order("created_at", { ascending: false })
      .limit(1),
    service
      .from("company_settings")
      .select("exterior_season_start, exterior_season_end")
      .eq("org_id", job.org_id)
      .maybeSingle(),
  ]);

  const coverage = await loadCrewCoverage(service, jobId);
  const accepted = (estimates.data ?? []).find((e) => e.accepted_version_id);
  let repairAccepted = false;
  if (accepted?.accepted_version_id) {
    const { data: version } = await service
      .from("estimate_versions")
      .select("accepted_option_id, accepted_addon_ids")
      .eq("id", accepted.accepted_version_id)
      .maybeSingle();
    const { data: repairs } = await service
      .from("estimate_line_items")
      .select("id, option_id")
      .eq("version_id", accepted.accepted_version_id)
      .eq("is_repair_allowance", true);
    const addons = new Set(version?.accepted_addon_ids ?? []);
    repairAccepted = (repairs ?? []).some(
      (l) =>
        (l.option_id !== null && l.option_id === version?.accepted_option_id) || addons.has(l.id),
    );
  }
  const acceptedVersions = new Set(
    (estimates.data ?? []).map((e) => e.accepted_version_id).filter(Boolean),
  );
  const sigs = (signatures.data ?? []).filter((s) => acceptedVersions.has(s.estimate_version_id));
  const cos = changeOrders.data ?? [];
  const colorRows = colors.data ?? [];
  const docRows = docs.data ?? [];
  const c = contact.data;

  return {
    workTypes: job.work_types,
    signedContractStored: (signedDocs.data ?? []).length > 0 || sigs.some((s) => s.document_id),
    estimateSigned: sigs.length > 0,
    changeOrdersSent: cos.filter((x) => x.status === "sent").length,
    changeOrdersSigned: cos.filter((x) => x.status === "signed").length,
    deposit: {
      invoice:
        deposit.data?.invoice_number && deposit.data.status
          ? {
              number: deposit.data.invoice_number,
              status: deposit.data.status,
              totalCents: Number(deposit.data.total_cents ?? 0),
            }
          : null,
      // Money applied to it from live payments (public.invoice_ledger).
      appliedCents: deposit.data ? Number(deposit.data.collected_cents ?? 0) : null,
    },
    contact: c
      ? {
          name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "the primary contact",
          mobile: c.mobile,
          email: c.email,
        }
      : null,
    property: property.data
      ? {
          hasHoa: property.data.has_hoa === true,
          occupancy: property.data.occupancy,
          pets: property.data.pets,
          parking: property.data.parking,
          accessNotes: property.data.access_notes,
        }
      : null,
    colors: {
      total: colorRows.length,
      chosen: colorRows.filter((r) => r.status !== "needed").length,
      confirmed: colorRows.filter((r) => r.status === "confirmed").length,
    },
    colorConsult: {
      completed: (consults.data ?? []).some((a) => a.status === "completed"),
      booked: (consults.data ?? []).some((a) => OPEN_APPOINTMENT.includes(a.status)),
    },
    documents: {
      hoa: docRows.filter((d) => d.category === "hoa").length,
      leadSafe: docRows.filter((d) => d.category === "lead_safe").length,
    },
    certifiedRenovatorAssigned: coverage.certifiedRenovator ?? false,
    repairAllowanceAccepted: repairAccepted,
    paintOrderStatuses: (paint.data ?? []).map((p) => p.status),
    crewCoversSkills: coverage.coversSkills ?? false,
    crewAssigned: coverage.crewIds.length > 0,
    crewMissingSkills: coverage.missing,
    prepInstructionsSentAt: prep.data?.[0]?.created_at ?? null,
    promisedStartDate: job.promised_start_date,
    season: {
      start: settings.data?.exterior_season_start ?? "06-01",
      end: settings.data?.exterior_season_end ?? "09-30",
    },
  };
}

export type ReverifyResult = {
  checked: boolean;
  changed: number;
  cleared: boolean;
  advanced: boolean;
};

/** Re-runs the checks for one job and moves it forward when the gate passes. */
export async function reverifyJob(
  service: Db,
  jobId: string,
  opts: { advance?: boolean } = {},
): Promise<ReverifyResult> {
  const none = { checked: false, changed: 0, cleared: false, advanced: false };
  const { data: rows, error } = await service
    .from("onboarding_requirements")
    .select("key, required, status, verified_auto")
    .eq("job_id", jobId);
  if (error) throw error;
  if (!rows?.length) return none;
  const snapshot = await loadOnboardingSnapshot(service, jobId);
  if (!snapshot) return none;
  const results = evaluateChecklist(
    rows.map((r) => ({
      key: r.key,
      required: r.required,
      status: r.status,
      verifiedAuto: r.verified_auto,
    })),
    snapshot,
  );
  const { data, error: rpcError } = await service.rpc("apply_onboarding_checks", {
    p_job: jobId,
    p_results: results.map((r) => ({
      key: r.key,
      status: r.status,
      detail: r.detail,
      ...(r.required === undefined ? {} : { required: r.required }),
    })) as unknown as Json,
  });
  if (rpcError) throw rpcError;
  const out = (data ?? {}) as { changed?: number; cleared?: boolean };
  let advanced = false;
  if (opts.advance !== false && out.cleared) {
    const { data: job } = await service.from("jobs").select("stage").eq("id", jobId).maybeSingle();
    if (job?.stage === "onboarding") {
      advanced = await advanceIfGatePasses(service, jobId, "onboarding", "ready_to_schedule");
    }
  }
  if ((out.changed ?? 0) > 0 && !advanced) {
    await recomputeJobHealth(service, [jobId]).catch((e: unknown) =>
      logError("onboarding.health", e),
    );
  }
  return {
    checked: true,
    changed: out.changed ?? 0,
    cleared: out.cleared === true,
    advanced,
  };
}

/** Worker sweep: every job in Sold or Onboarding (oldest check first). */
export async function sweepOnboarding(service: Db, limit = 500) {
  const { data: jobs, error } = await service
    .from("jobs")
    .select("id")
    .in("stage", ["sold", "onboarding"])
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let changed = 0;
  let advanced = 0;
  for (const j of jobs ?? []) {
    try {
      const r = await reverifyJob(service, j.id);
      changed += r.changed;
      if (r.advanced) advanced++;
    } catch (e) {
      logError("worker.onboarding.job", e);
    }
  }
  return { jobs: (jobs ?? []).length, changed, advanced };
}
