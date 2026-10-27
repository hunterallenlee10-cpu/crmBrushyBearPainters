import type { Metadata } from "next";
import { headers } from "next/headers";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { loadPublicProposal, recordView } from "@/lib/estimating/proposal";
import type { ProposalView } from "@/lib/estimating/proposal-view";
import { consumeProposalLimit, PROPOSAL_LIMITS } from "./limits";
import { ProposalPage } from "./proposal-client";

type Params = Promise<{ token: string }>;

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your proposal",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Only what the customer needs: drop the pre-override prices the engine keeps. */
function forCustomer(view: ProposalView): ProposalView {
  const clean = <T extends { priceCents: number; computedPriceCents: number }>(l: T): T => ({
    ...l,
    computedPriceCents: l.priceCents,
  });
  return {
    ...view,
    snapshot: {
      ...view.snapshot,
      options: view.snapshot.options.map((o) => ({
        ...o,
        lines: o.lines.map(clean),
        areas: o.areas.map((a) => ({ ...a, lines: a.lines.map(clean) })),
      })),
      addOns: view.snapshot.addOns.map(clean),
    },
    contract: null,
  };
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bb-cream px-4">
      <div className="max-w-md rounded-2xl border border-bb-border bg-white p-6 text-center">
        <h1 className="font-display text-3xl text-bb-forest">{title}</h1>
        <div className="mt-2 text-sm text-bb-ink/80">{children}</div>
      </div>
    </main>
  );
}

/** Customer proposal / change-order page (SPEC §7.5). No login; the link is the key. */
export default async function PublicProposalPage({ params }: { params: Params }) {
  const { token } = await params;
  const service = await createSupabaseServiceClient();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (!(await consumeProposalLimit(service, `view:ip:${ip}`, PROPOSAL_LIMITS.viewPerIp))) {
    return (
      <Message title="One moment">
        <p>Too many requests from this network. Please wait a few minutes and reload.</p>
      </Message>
    );
  }
  const proposal = await loadPublicProposal(service, token);
  if (proposal.state === "invalid") {
    return (
      <Message title="Link not found">
        <p>
          This link isn&apos;t valid. Check the message we sent you, or get in touch and we&apos;ll
          resend it.
        </p>
      </Message>
    );
  }
  if (proposal.state === "replaced") {
    return (
      <Message title="There's a newer version">
        <p>We sent you an updated proposal. Please use the link in our latest message.</p>
      </Message>
    );
  }
  if (proposal.state === "open") await recordView(service, token);
  return (
    <ProposalPage
      token={token}
      kind={proposal.kind}
      state={proposal.state}
      view={forCustomer(proposal.view)}
      hasSignedCopy={proposal.hasSignedCopy}
    />
  );
}
