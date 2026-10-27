import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { PublicMessage } from "@/components/public/public-message";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { recordReviewClick } from "@/lib/messaging/public-links";
import { consumeProposalLimit } from "@/app/p/[token]/limits";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Leave a review",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Review request link (SPEC §8.16): counts the click on the job's review
 * request, then forwards to the company's review page (Company Settings →
 * Review link). Without one set, a thank-you page instead.
 */
export default async function ReviewLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = await createSupabaseServiceClient();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await consumeProposalLimit(service, `review:${ip}`, {
    limit: 60,
    windowSeconds: 600,
  });
  const r = allowed
    ? await recordReviewClick(service, token)
    : { found: false, link: null, companyName: null };
  if (r.found && r.link) redirect(r.link);
  return (
    <PublicMessage
      title={r.found ? "Thank you!" : "This link isn't valid"}
      companyName={r.companyName}
    >
      {r.found ? (
        <p>
          Thanks for taking a moment. Our review page isn&apos;t set up yet; we&apos;ll send you the
          link soon.
        </p>
      ) : (
        <p>The link may be incomplete. Try opening it again from the message we sent.</p>
      )}
    </PublicMessage>
  );
}
