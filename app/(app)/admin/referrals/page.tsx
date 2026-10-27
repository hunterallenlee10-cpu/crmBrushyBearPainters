import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatCents } from "@/lib/format/money";
import { loadReferralSettings } from "@/lib/referrals/load";
import { ReferralSettingsForm } from "@/app/(app)/referrals/referral-forms";

export const metadata: Metadata = { title: "Referral Program" };

/** Admin → Referral Program (SPEC §8.19): when rewards are payable, the code prefix and the program wording. */
export default async function ReferralProgramPage() {
  const viewer = await requirePermission("referrals:manage");
  const supabase = await createSupabaseServerClient();
  const s = await loadReferralSettings(supabase);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Referral Program"
        description={
          <>
            Bear Champions get a code and a ?ref= link to the website estimate form. The reward
            amount ({s.rewardCents === null ? "not set yet" : formatCents(s.rewardCents)}) is set in{" "}
            <Link href="/admin/company" className="text-bb-forest underline">
              Company Settings
            </Link>
            . See champions and payouts in{" "}
            <Link href="/referrals" className="text-bb-forest underline">
              Bear Champions
            </Link>
            .
          </>
        }
      />
      <ReferralSettingsForm
        readOnly={viewer.impersonating}
        defaults={{
          payableWhen: s.payableWhen,
          codePrefix: s.codePrefix,
          programNote: s.programNote,
          terms: s.terms,
        }}
      />
    </div>
  );
}
