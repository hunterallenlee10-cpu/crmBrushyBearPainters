import { createSupabaseServerClient } from "@/lib/db/server";
import { ONBOARDING_REQUIREMENTS, type OnboardingKey } from "@/lib/estimating/engine";
import { checklistSummary } from "@/lib/domain/onboarding/checklist";
import { isOnboardingKey } from "@/lib/domain/onboarding/rules";
import {
  requestDraftFromTemplates,
  type RequestDraft,
  type TemplatePair,
} from "@/lib/onboarding/messages";
import { renderTemplate, type MergeContext } from "@/lib/domain/templates/merge";
import type { Option } from "@/lib/leads/service";
import { getStage } from "@/lib/domain/stages";
import { formatDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/metrics/registry";
import { OnboardingSection } from "./onboarding-section";
import { ChecklistClient, type ChecklistItem } from "./onboarding/checklist-client";
import type { JobDetailData } from "./types";

type Props = Omit<
  React.ComponentProps<typeof OnboardingSection>,
  "checklist" | "summary" | "jobSummary"
> & {
  data: JobDetailData;
  users: Option[];
};

/**
 * Onboarding (SPEC §6.4, §8.5 #2): the requirement checklist with the result
 * of each auto-check, who owns it, and its actions; tiles, holds and tasks
 * around it. Rows are read with the person's own client (row security).
 */
export async function OnboardingWithChecklist({ data, users, ...props }: Props) {
  const supabase = await createSupabaseServerClient();
  const [{ data: rows }, settings, me, deposit, templates] = await Promise.all([
    supabase
      .from("onboarding_requirements")
      .select(
        "id, key, group_key, label, required, owner_role, status, verified_auto, verified_at, verified_by, note, auto_detail, last_checked_at, requested_at, task_id, sort_order",
      )
      .eq("job_id", props.jobId)
      .order("sort_order"),
    supabase.from("company_settings").select("company_name, phone").maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", data.viewerId).maybeSingle(),
    data.can.readInvoices
      ? supabase
          .from("invoices")
          .select("invoice_number, status, total_cents")
          .eq("job_id", props.jobId)
          .eq("invoice_type", "deposit")
          .neq("status", "void")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("message_templates")
      .select("key, channel, subject, body, active")
      .in("key", [
        "prep_instructions",
        "onboarding_contact",
        "onboarding_access",
        "onboarding_colors",
        "onboarding_hoa",
        "onboarding_lead_safe",
      ]),
  ]);
  const list = rows ?? [];
  const templateFor = (key: string): TemplatePair => {
    const rowsFor = (templates.data ?? []).filter((t) => t.key === key);
    const sms = rowsFor.find((t) => t.channel === "sms");
    const email = rowsFor.find((t) => t.channel === "email");
    return {
      sms: sms ? { body: sms.body, active: sms.active } : null,
      email: email ? { subject: email.subject, body: email.body, active: email.active } : null,
    };
  };
  const render = (text: string, ctx: Record<string, unknown>) =>
    renderTemplate(text, ctx as MergeContext).text;

  const verifierIds = [...new Set(list.map((r) => r.verified_by).filter((u): u is string => !!u))];
  const names = new Map<string, string>();
  if (verifierIds.length) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", verifierIds);
    for (const p of people ?? []) names.set(p.id, p.full_name);
  }

  const when = new Map<string, string>(ONBOARDING_REQUIREMENTS.map((r) => [r.key, r.when]));
  const contactFirst = data.job.contact?.name.split(/\s+/)[0] ?? null;
  const draftCtx = {
    customerFirstName: contactFirst,
    senderName: me.data?.full_name ?? "The Brushy Bear team",
    companyName: settings.data?.company_name ?? "Brushy Bear Painters",
    companyPhone: settings.data?.phone ?? "[PHONE]",
    workTypes: data.job.workTypes,
  };

  const items: ChecklistItem[] = list.map((r) => ({
    id: r.id,
    key: r.key,
    group: r.group_key,
    label: r.label,
    required: r.required,
    ownerRole: r.owner_role,
    status: r.status,
    verifiedAuto: r.verified_auto,
    verifiedAt: r.verified_at,
    verifiedByName: r.verified_by ? (names.get(r.verified_by) ?? null) : null,
    note: r.note,
    detail: r.auto_detail,
    requestedAt: r.requested_at,
    hasTask: Boolean(r.task_id),
    when: when.get(r.key) ?? null,
    draft: isOnboardingKey(r.key)
      ? (requestDraftFromTemplates(
          r.key as OnboardingKey,
          draftCtx,
          templateFor,
          render,
        ) satisfies RequestDraft | null)
      : null,
  }));
  const summary = list.length
    ? checklistSummary(
        list.map((r) => ({
          key: r.key,
          label: r.label,
          group: r.group_key,
          required: r.required,
          status: r.status,
          verifiedAuto: r.verified_auto,
        })),
      )
    : null;
  const lastChecked = list
    .map((r) => r.last_checked_at)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);

  const job = data.job;
  const jobSummary = [
    { label: "Stage", value: getStage(job.stage).label },
    {
      label: "Sold",
      value: job.milestones.estimate_accepted_at
        ? formatDate(job.milestones.estimate_accepted_at)
        : "—",
    },
    {
      label: "Deposit invoice",
      value: deposit.data
        ? `${deposit.data.invoice_number} · ${formatMoney(Number(deposit.data.total_cents))} · ${deposit.data.status}`
        : data.can.readInvoices
          ? "None"
          : "—",
    },
    {
      label: "Promised start",
      value: job.promisedStartDate ? formatDate(`${job.promisedStartDate}T12:00:00`) : "Not set",
    },
    { label: "Point of contact", value: job.pocName ?? "Not assigned" },
  ];

  const checklist = list.length ? (
    <ChecklistClient
      key={props.jobId}
      jobId={props.jobId}
      items={items}
      summary={summary}
      lastCheckedAt={lastChecked ?? null}
      users={users}
      defaultAssignee={job.pocId ?? job.ownerId ?? data.viewerId}
      can={{
        edit: data.can.update,
        request: data.can.update && data.can.sendMessages,
        upload: data.can.update && data.can.manageDocuments,
        task: data.can.update && data.can.manageTasks,
      }}
    />
  ) : null;

  return (
    <OnboardingSection {...props} checklist={checklist} summary={summary} jobSummary={jobSummary} />
  );
}
