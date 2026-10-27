import type { Metadata } from "next";
import Link from "next/link";
import { BadgeDollarSign, Handshake, Trophy, Users } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi/kpi-card";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { REFERRAL_STATUS_LABELS, referralLink, type ReferralStatus } from "@/lib/domain/referrals";
import { formatCents } from "@/lib/format/money";
import { formatDate } from "@/lib/format/dates";
import { loadCommunicationStats } from "@/lib/messaging/stats";
import { communicationMetricValue, type CommunicationMetricId } from "@/lib/metrics/registry";
import { loadChampions, loadReferralSettings, loadReferrals } from "@/lib/referrals/load";
import { PAYOUT_METHOD_LABELS } from "@/lib/validation/referrals";
import { cn } from "@/lib/utils";
import {
  AddChampionForm,
  ChampionStatusSelect,
  CopyLink,
  IneligibleButton,
  ManualReferralForm,
  PayoutForm,
  ReferralSettingsForm,
} from "./referral-forms";

export const metadata: Metadata = { title: "Bear Champions" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TABS = [
  { id: "champions", label: "Champions" },
  { id: "referrals", label: "Referrals" },
  { id: "payouts", label: "Payouts" },
  { id: "settings", label: "Settings" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const KPIS: { id: CommunicationMetricId; icon: typeof Users }[] = [
  { id: "referrals.champions", icon: Users },
  { id: "referrals.referrals", icon: Handshake },
  { id: "referrals.conversion", icon: Trophy },
  { id: "referrals.payable", icon: BadgeDollarSign },
];

const STATUS_VARIANT: Record<
  ReferralStatus,
  "info" | "success" | "warning" | "neutral" | "danger"
> = {
  referred: "info",
  walkthrough: "info",
  sold: "success",
  payable: "warning",
  paid: "success",
  lost: "neutral",
  ineligible: "danger",
};

/**
 * Bear Champions (SPEC §5.8, §8.16, §14): customers who refer friends get a
 * BEAR-XXXX code and a ?ref= link; referrals come in through the website
 * form or by hand; a reward is payable when the program rule is met and an
 * owner records the payout.
 */
export default async function ReferralsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("referrals:manage");
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === one(sp.tab)) ? (one(sp.tab) as Tab) : "champions";
  const supabase = await createSupabaseServerClient();
  const settings = await loadReferralSettings(supabase);
  const [referrals, stats] = await Promise.all([
    loadReferrals(supabase, settings.payableWhen),
    loadCommunicationStats(supabase, { days: 365 }),
  ]);
  const champions = await loadChampions(supabase, referrals);
  const readOnly = viewer.impersonating;

  const [contacts, leads, jobs] =
    tab === "champions" || tab === "referrals"
      ? await Promise.all([
          tab === "champions"
            ? supabase
                .from("contacts")
                .select("id, first_name, last_name, email")
                .is("deleted_at", null)
                .order("first_name")
                .limit(500)
            : Promise.resolve({ data: [] }),
          tab === "referrals"
            ? supabase
                .from("leads")
                .select("id, first_name, last_name, city")
                .is("deleted_at", null)
                .order("created_at", { ascending: false })
                .limit(300)
            : Promise.resolve({ data: [] }),
          tab === "referrals"
            ? supabase
                .from("jobs")
                .select("id, name, job_number")
                .is("deleted_at", null)
                .order("created_at", { ascending: false })
                .limit(300)
            : Promise.resolve({ data: [] }),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
  const championContactIds = new Set(champions.map((c) => c.contactId));

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="Bear Champions"
        description={`Customers who send friends our way. Reward: ${settings.rewardCents === null ? "[REFERRAL_REWARD] – owner to set in Company Settings" : formatCents(settings.rewardCents)}, payable when the referred job is ${settings.payableWhen === "sold" ? "sold" : "paid in full"}.`}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k) => {
          const v = communicationMetricValue(k.id, stats);
          return (
            <KpiCard
              key={k.id}
              label={v.label}
              value={v.display}
              caption={v.caption}
              icon={k.icon}
            />
          );
        })}
      </div>
      <nav aria-label="Bear Champions sections" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/referrals?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              t.id === tab ? "border-bb-forest bg-bb-forest text-white" : "hover:bg-muted",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "champions" && (
        <section aria-label="Champions" className="flex flex-col gap-4">
          <AddChampionForm
            readOnly={readOnly}
            contacts={(contacts.data ?? [])
              .filter((c) => !championContactIds.has(c.id))
              .map((c) => ({
                value: c.id,
                label: `${[c.first_name, c.last_name].filter(Boolean).join(" ")}${c.email ? ` · ${c.email}` : ""}`,
              }))}
          />
          {champions.length === 0 ? (
            <EmptyState icon={Users} title="No Bear Champions yet">
              Happy customers get a code automatically when the referral invite goes out after Paid
              in Full, or add one here.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-2xl border bg-card">
              <table className="w-full min-w-[760px] text-sm">
                <caption className="sr-only">Bear Champions</caption>
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Champion
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Code &amp; link
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Referrals
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Sold
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Paid out
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {champions.map((c) => {
                    const link = referralLink(settings.websiteUrl, c.code);
                    return (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <Link
                            href={`/contacts/${c.contactId}`}
                            className="font-medium text-bb-forest hover:underline"
                          >
                            {c.name}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            Since {formatDate(c.createdAt)}
                            {c.invitedAt ? ` · invited ${formatDate(c.invitedAt)}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono font-semibold">{c.code}</span>
                          <span className="ml-1 inline-flex items-center">
                            <span className="max-w-48 truncate text-xs text-muted-foreground">
                              {link}
                            </span>
                            <CopyLink link={link} label={`${c.name}'s referral link`} />
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.totals.referrals}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.totals.sold}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCents(c.totals.paidCents)}
                          {c.totals.payableCents > 0 && (
                            <div className="text-xs text-warning">
                              {formatCents(c.totals.payableCents)} due
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <ChampionStatusSelect
                            id={c.id}
                            status={c.status}
                            name={c.name}
                            readOnly={readOnly}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "referrals" && (
        <section aria-label="Referrals" className="flex flex-col gap-4">
          <ManualReferralForm
            readOnly={readOnly}
            champions={champions
              .filter((c) => c.status === "active")
              .map((c) => ({ value: c.id, label: `${c.name} · ${c.code}` }))}
            leads={(leads.data ?? []).map((l) => ({
              value: l.id,
              label: `${[l.first_name, l.last_name].filter(Boolean).join(" ")}${l.city ? ` · ${l.city}` : ""}`,
            }))}
            jobs={(jobs.data ?? []).map((j) => ({
              value: j.id,
              label: `${j.name} · ${j.job_number}`,
            }))}
          />
          <ReferralTable rows={referrals} readOnly={readOnly} mode="all" />
        </section>
      )}

      {tab === "payouts" && (
        <section aria-label="Payouts" className="flex flex-col gap-4">
          <ReferralTable
            rows={referrals.filter((r) => r.status === "payable" || r.status === "paid")}
            readOnly={readOnly}
            mode="payouts"
          />
        </section>
      )}

      {tab === "settings" && (
        <ReferralSettingsForm
          readOnly={readOnly}
          defaults={{
            payableWhen: settings.payableWhen,
            codePrefix: settings.codePrefix,
            programNote: settings.programNote,
            terms: settings.terms,
          }}
        />
      )}
    </PageContainer>
  );
}

function ReferralTable({
  rows,
  readOnly,
  mode,
}: {
  rows: Awaited<ReturnType<typeof loadReferrals>>;
  readOnly: boolean;
  mode: "all" | "payouts";
}) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={Handshake}
        title={mode === "payouts" ? "Nothing to pay yet" : "No referrals yet"}
      >
        {mode === "payouts"
          ? "Rewards show up here once a referred job meets the program rule."
          : "Website leads that arrive with a ?ref= code show up here automatically."}
      </EmptyState>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[820px] text-sm">
        <caption className="sr-only">{mode === "payouts" ? "Payouts" : "Referrals"}</caption>
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Referred
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              By
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Reward
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {mode === "payouts" ? "Payout" : "Came in"}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b align-top last:border-0">
              <td className="px-3 py-2">
                {r.job ? (
                  <Link
                    href={`/jobs/${r.job.id}`}
                    className="font-medium text-bb-forest hover:underline"
                  >
                    {r.referredName}
                  </Link>
                ) : r.lead ? (
                  <Link
                    href={`/leads/${r.lead.id}`}
                    className="font-medium text-bb-forest hover:underline"
                  >
                    {r.referredName}
                  </Link>
                ) : (
                  r.referredName
                )}
                <div className="text-xs text-muted-foreground">
                  {r.source === "ref_link" ? "Website ?ref= link" : "Added by hand"}
                </div>
              </td>
              <td className="px-3 py-2">
                {r.championName}
                <div className="font-mono text-xs text-muted-foreground">{r.championCode}</div>
              </td>
              <td className="px-3 py-2">
                <Badge variant={STATUS_VARIANT[r.status]}>{REFERRAL_STATUS_LABELS[r.status]}</Badge>
                {r.ineligibleReason && (
                  <div className="mt-1 text-xs text-muted-foreground">{r.ineligibleReason}</div>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {r.rewardCents === null ? "[REFERRAL_REWARD]" : formatCents(r.rewardCents)}
              </td>
              <td className="px-3 py-2">
                {r.status === "paid" ? (
                  <span className="text-xs">
                    Paid {r.paidAt ? formatDate(r.paidAt) : ""} ·{" "}
                    {r.payoutMethod
                      ? (PAYOUT_METHOD_LABELS[
                          r.payoutMethod as keyof typeof PAYOUT_METHOD_LABELS
                        ] ?? r.payoutMethod)
                      : ""}
                    {r.payoutReference ? ` · ${r.payoutReference}` : ""}
                  </span>
                ) : r.status === "payable" ? (
                  <PayoutForm referralId={r.id} label={r.referredName} readOnly={readOnly} />
                ) : mode === "all" ? (
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
                    {r.status !== "ineligible" && r.status !== "lost" && (
                      <IneligibleButton referralId={r.id} readOnly={readOnly} />
                    )}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
