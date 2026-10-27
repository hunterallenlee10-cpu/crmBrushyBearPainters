import type { Metadata } from "next";
import { PublicMessage } from "@/components/public/public-message";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { serverEnv } from "@/lib/env";
import { linkSecret, verifyUnsubscribeToken } from "@/lib/messaging/links";
import { companyNameFor } from "@/lib/messaging/public-links";
import { UnsubscribeForm } from "./unsubscribe-form";
import { consumePublicLimit, PUBLIC_LIMITS, requestIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Marketing email unsubscribe (SPEC §8.11). Opening the link only asks;
 * the button confirms (so link scanners don't unsubscribe people).
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = await createSupabaseServiceClient();
  if (
    !(await consumePublicLimit(
      service,
      `unsubscribe:view:${await requestIp()}`,
      PUBLIC_LIMITS.unsubscribeViewPerIp,
    ))
  ) {
    return (
      <PublicMessage title="Please wait a moment" companyName={null}>
        <p>Too many requests from this network. Try the link again in a few minutes.</p>
      </PublicMessage>
    );
  }
  const secret = linkSecret(serverEnv());
  const target = secret ? verifyUnsubscribeToken(token, secret) : null;
  const company = target ? await companyNameFor(service, target.orgId) : null;
  if (!target) {
    return (
      <PublicMessage title="This link isn't valid" companyName={null}>
        <p>The link may be incomplete. Try opening it again from the email we sent.</p>
      </PublicMessage>
    );
  }
  return (
    <PublicMessage title="Unsubscribe from marketing emails?" companyName={company}>
      <p>
        You&apos;ll stop getting newsletters and seasonal offers. We&apos;ll still email you about
        your own project (appointments, estimates and invoices).
      </p>
      <UnsubscribeForm token={token} />
    </PublicMessage>
  );
}
