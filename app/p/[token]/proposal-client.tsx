"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  ShieldCheck,
  Star,
} from "lucide-react";
import {
  ESIGN_CONSENT,
  ESIGN_CONSENT_CHANGE_ORDER,
  quoteSelection,
  type QuoteTotals,
} from "@/lib/estimating/engine";
import type { ProposalView } from "@/lib/estimating/proposal-view";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import { acceptAndSign, declineEstimate } from "./actions";
import { SignaturePad } from "./signature-pad";

type State = "open" | "expired" | "accepted" | "declined";

function TotalsBox({ totals, kind }: { totals: QuoteTotals; kind: "estimate" | "change_order" }) {
  const row = (label: string, cents: number, muted = false) => (
    <div className={cn("flex justify-between gap-3 py-0.5", muted && "text-bb-ink/70")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatCents(cents)}</dd>
    </div>
  );
  return (
    <dl className="text-sm">
      {row(kind === "estimate" ? "Scope" : "Change", totals.linesCents)}
      {totals.addOnsCents !== 0 && row("Add-ons", totals.addOnsCents)}
      {totals.rrpCents !== 0 && row("Lead-safe (RRP) supplies", totals.rrpCents)}
      {totals.minimumAdjustmentCents !== 0 &&
        row("Minimum job charge", totals.minimumAdjustmentCents)}
      {totals.discountCents !== 0 && row("Discount", -totals.discountCents)}
      {totals.taxCents !== 0 && row("Tax", totals.taxCents)}
      <div className="mt-1 flex justify-between gap-3 border-t border-bb-forest/20 pt-2 text-lg font-bold text-bb-forest">
        <dt>Total</dt>
        <dd className="tabular-nums" data-testid="proposal-total">
          {formatCents(totals.totalCents)}
        </dd>
      </div>
      {totals.depositCents > 0 && row("Deposit to book your spot", totals.depositCents, true)}
    </dl>
  );
}

function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-bb-border bg-white p-5">
      <h2 id={id} className="font-display text-2xl text-bb-forest">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Draft({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 inline-block rounded-full bg-bb-honey/20 px-2.5 py-0.5 text-xs font-semibold text-bb-ink">
      {children}
    </p>
  );
}

/**
 * The customer's proposal page (SPEC §7.5): mobile-first, cream and forest.
 * Picking an option or toggling an add-on updates the total right away (the
 * same engine math the office uses); Accept & Sign records a typed name and a
 * drawn signature.
 */
export function ProposalPage({
  token,
  kind,
  state,
  view,
  hasSignedCopy,
}: {
  token: string;
  kind: "estimate" | "change_order";
  state: State;
  view: ProposalView;
  hasSignedCopy: boolean;
}) {
  const router = useRouter();
  const snap = view.snapshot;
  const recommended = snap.options.find((o) => o.isRecommended) ?? snap.options[0];
  const [optionId, setOptionId] = React.useState(view.selection?.optionId ?? recommended?.id ?? "");
  const [addOnIds, setAddOnIds] = React.useState<string[]>(view.selection?.addOnIds ?? []);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [signature, setSignature] = React.useState<string | null>(null);
  const [agreed, setAgreed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [declining, setDeclining] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState("");
  const open = state === "open";

  const quote = quoteSelection(snap, { optionId, addOnIds });
  const totals = view.selection?.totals ?? quote?.totals ?? recommended?.totals ?? null;
  const shownOptions =
    state === "accepted" && view.selection
      ? snap.options.filter((o) => o.id === view.selection?.optionId)
      : snap.options;
  const consent = kind === "estimate" ? ESIGN_CONSENT : ESIGN_CONSENT_CHANGE_ORDER;
  const coChange = (
    snap as typeof snap & {
      changeOrder?: { beforeCents: number | null; afterCents: number | null };
    }
  ).changeOrder;

  const toggleAddOn = (id: string) =>
    setAddOnIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await acceptAndSign({
        token,
        kind,
        optionId: kind === "estimate" ? optionId : undefined,
        addOnIds,
        signerName: name,
        signerEmail: email,
        signaturePng: signature ?? "",
        agreed: agreed as true,
      });
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  };

  const decline = () => {
    setError(null);
    startTransition(async () => {
      const r = await declineEstimate({ token, reason: declineReason });
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  };

  const docLabel = kind === "estimate" ? "proposal" : "change order";

  return (
    <div className="min-h-dvh bg-bb-cream text-bb-ink">
      <header className="bg-bb-forest text-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-5">
          <p className="font-display text-3xl leading-tight">{view.company.name}</p>
          {view.company.tagline && <p className="text-sm text-white/85">{view.company.tagline}</p>}
          <p className="text-xs text-white/75">
            {[view.company.phone, view.company.email, view.company.website]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-xs text-white/75">
            WA L&amp;I {view.company.lniNumber} · UBI {view.company.ubiNumber}
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <div>
          <p className="text-sm text-bb-ink/70">
            {kind === "estimate" ? "Proposal" : "Change order"} {view.document.number}
            {view.document.version ? ` · version ${view.document.version}` : ""}
          </p>
          <h1 className="font-display text-4xl leading-tight text-bb-forest">
            {kind === "estimate"
              ? `Hi ${view.customer.firstName ?? view.customer.name}, here's your estimate`
              : view.job.name}
          </h1>
          <p className="mt-1 text-sm text-bb-ink/80">
            {view.customer.address ?? view.customer.name}
            {view.pointOfContact ? ` · Your point of contact: ${view.pointOfContact}` : ""}
          </p>
          {open && view.expiresAt && (
            <p className="mt-1 text-sm text-bb-ink/70">Good until {formatDate(view.expiresAt)}.</p>
          )}
        </div>

        {state === "accepted" && (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-2xl border-2 border-success/40 bg-success-bg p-5 text-success"
          >
            <p className="flex items-center gap-2 text-lg font-semibold">
              <CheckCircle2 className="size-6" aria-hidden />
              {kind === "estimate"
                ? "You're booked in. Thank you!"
                : "Change order signed. Thank you!"}
            </p>
            {view.signature && (
              <p className="text-sm text-bb-ink">
                Signed by {view.signature.name} on {formatDateTime(view.signature.signedAt)}.
                {kind === "estimate" ? " We'll be in touch about your deposit and start date." : ""}
              </p>
            )}
            {hasSignedCopy && (
              <a
                href={`/p/${token}/pdf`}
                className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl bg-bb-forest px-4 font-semibold text-white"
              >
                <Download className="size-4" aria-hidden />
                Download your signed copy
              </a>
            )}
          </div>
        )}
        {state === "expired" && (
          <p
            role="status"
            className="rounded-2xl border border-warning/40 bg-warning-bg p-5 text-warning"
          >
            This {docLabel} has expired. Call or text us and we&apos;ll send a fresh one.
          </p>
        )}
        {state === "declined" && (
          <p role="status" className="rounded-2xl border bg-white p-5">
            You declined this {docLabel}. If you change your mind, just let us know.
          </p>
        )}

        {view.customerNotes && (
          <Section title={kind === "estimate" ? "A note from us" : "Why this change"} id="notes-h">
            <p className="text-sm whitespace-pre-line">{view.customerNotes}</p>
          </Section>
        )}

        <section aria-labelledby="options-h" className="flex flex-col gap-3">
          <h2 id="options-h" className="font-display text-2xl text-bb-forest">
            {kind === "change_order"
              ? "The change"
              : shownOptions.length > 1
                ? "Choose your option"
                : "Your scope"}
          </h2>
          <div
            role={open && shownOptions.length > 1 ? "radiogroup" : undefined}
            aria-labelledby="options-h"
            className="flex flex-col gap-3"
          >
            {shownOptions.map((o) => {
              const selected = o.id === optionId;
              return (
                <div
                  key={o.id}
                  className={cn(
                    "rounded-2xl border-2 bg-white transition-colors",
                    selected ? "border-bb-forest" : "border-bb-border",
                  )}
                >
                  <button
                    type="button"
                    role={open && shownOptions.length > 1 ? "radio" : undefined}
                    aria-checked={open && shownOptions.length > 1 ? selected : undefined}
                    disabled={!open || shownOptions.length < 2}
                    onClick={() => setOptionId(o.id)}
                    className="flex w-full items-start justify-between gap-3 p-4 text-left disabled:cursor-default"
                  >
                    <span className="flex min-w-0 items-start gap-3">
                      {open && shownOptions.length > 1 && (
                        <span
                          className={cn(
                            "mt-1 grid size-6 shrink-0 place-items-center rounded-full border-2",
                            selected
                              ? "border-bb-forest bg-bb-forest text-white"
                              : "border-bb-ink/30",
                          )}
                          aria-hidden
                        >
                          {selected && <Check className="size-4" />}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                          {o.name}
                          {o.isRecommended && shownOptions.length > 1 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-bb-honey px-2 py-0.5 text-xs font-semibold text-bb-ink">
                              <Star className="size-3 fill-current" aria-hidden />
                              Recommended
                            </span>
                          )}
                        </span>
                        {o.description && (
                          <span className="block text-sm text-bb-ink/75">{o.description}</span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-lg font-bold text-bb-forest tabular-nums">
                      {formatCents(o.totals.totalCents)}
                    </span>
                  </button>
                  <details
                    className="group border-t border-bb-border px-4 py-3"
                    open={shownOptions.length === 1}
                  >
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-bb-forest">
                      What&apos;s in this option
                      <ChevronDown
                        className="size-4 transition-transform group-open:rotate-180"
                        aria-hidden
                      />
                    </summary>
                    <div className="mt-2 flex flex-col gap-3">
                      {o.areas.map((a, i) => (
                        <div key={i}>
                          <p className="text-sm font-semibold">{a.name}</p>
                          <ul className="mt-1 flex flex-col gap-1 text-sm">
                            {a.lines.map((l) => (
                              <li key={l.id} className="flex justify-between gap-3">
                                <span>{l.description}</span>
                                <span className="shrink-0 text-bb-ink/70 tabular-nums">
                                  {formatCents(l.priceCents)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                      {o.lines.filter(
                        (l) => !o.areas.some((a) => a.lines.some((x) => x.id === l.id)),
                      ).length > 0 && (
                        <ul className="flex flex-col gap-1 text-sm">
                          {o.lines
                            .filter((l) => !o.areas.some((a) => a.lines.some((x) => x.id === l.id)))
                            .map((l) => (
                              <li key={l.id} className="flex justify-between gap-3">
                                <span>{l.description}</span>
                                <span className="shrink-0 text-bb-ink/70 tabular-nums">
                                  {formatCents(l.priceCents)}
                                </span>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        </section>

        {snap.addOns.length > 0 && (state !== "accepted" || addOnIds.length > 0) && (
          <Section
            title={state === "accepted" ? "Add-ons you chose" : "Optional add-ons"}
            id="addons-h"
          >
            <ul className="flex flex-col divide-y divide-bb-border">
              {snap.addOns
                .filter((a) => state !== "accepted" || addOnIds.includes(a.id))
                .map((a) => {
                  const on = addOnIds.includes(a.id);
                  return (
                    <li key={a.id}>
                      <label className="flex min-h-14 cursor-pointer items-center justify-between gap-3 py-2">
                        <span className="min-w-0 text-sm">
                          <span className="block font-medium">{a.name}</span>
                          <span className="block text-bb-ink/70">{a.description}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="text-sm font-semibold tabular-nums">
                            +{formatCents(a.priceCents)}
                          </span>
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`Add ${a.name}`}
                            className="size-6 accent-bb-forest"
                            checked={on}
                            disabled={!open}
                            onChange={() => toggleAddOn(a.id)}
                          />
                        </span>
                      </label>
                    </li>
                  );
                })}
            </ul>
          </Section>
        )}

        {totals && (
          <section
            aria-labelledby="total-h"
            className="sticky bottom-2 z-10 rounded-2xl border-2 border-bb-forest bg-bb-cream-light p-4 shadow-lg"
            aria-live="polite"
          >
            <h2 id="total-h" className="sr-only">
              Your total
            </h2>
            <TotalsBox totals={totals} kind={kind} />
            {kind === "change_order" &&
              coChange?.beforeCents != null &&
              coChange.afterCents != null && (
                <p className="mt-2 text-xs text-bb-ink/70">
                  Contract total goes from {formatCents(coChange.beforeCents)} to{" "}
                  {formatCents(coChange.afterCents)}.
                </p>
              )}
          </section>
        )}

        {view.inclusions.length > 0 && (
          <Section title="What's included" id="inc-h">
            <div className="flex flex-col gap-4">
              {view.inclusions.map((inc) => (
                <div key={inc.workType}>
                  <p className="text-sm font-semibold">{inc.label}</p>
                  {inc.draft && <Draft>Draft – owner to approve</Draft>}
                  <ul className="mt-1 flex flex-col gap-1 text-sm">
                    {inc.items.map((item, i) => (
                      <li key={i} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-bb-forest" aria-hidden />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}

        {view.guarantees.length > 0 && (
          <Section title="Our promises" id="g-h">
            {view.guaranteesDraft && <Draft>Draft – owner to approve</Draft>}
            <ul className="flex flex-col gap-3 text-sm">
              {view.guarantees.map((g) => (
                <li key={g.key} className="flex gap-3">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-bb-forest" aria-hidden />
                  <span>
                    <span className="font-semibold">{g.title}.</span> {g.body}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {view.leadSafe && (
          <Section title="Lead-safe work" id="ls-h">
            <p className="text-sm whitespace-pre-line">{view.leadSafe}</p>
          </Section>
        )}

        {view.terms && (
          <Section title="Terms" id="terms-h">
            {view.terms.draft && <Draft>Draft – owner/attorney to approve</Draft>}
            <details>
              <summary className="min-h-11 cursor-pointer text-sm font-semibold text-bb-forest">
                Read the terms
              </summary>
              <div className="mt-2 flex flex-col gap-2 text-sm">
                {view.terms.blocks
                  .filter((b) => !(b.kind === "heading" && b.level === 1))
                  .map((b, i) =>
                    b.kind === "heading" ? (
                      <h3 key={i} className="mt-2 font-semibold">
                        {b.text}
                      </h3>
                    ) : (
                      <p
                        key={i}
                        className={
                          b.kind === "placeholder" ? "rounded bg-bb-honey/20 px-2 py-1" : undefined
                        }
                      >
                        {b.text}
                      </p>
                    ),
                  )}
              </div>
            </details>
          </Section>
        )}

        {open && (
          <section
            aria-labelledby="sign-h"
            className="rounded-2xl border-2 border-bb-forest bg-white p-5"
          >
            <h2 id="sign-h" className="font-display text-2xl text-bb-forest">
              Accept &amp; sign
            </h2>
            {kind === "estimate" && quote && (
              <p className="mt-1 text-sm">
                You&apos;re accepting <strong>{quote.option.name}</strong>
                {quote.addOns.length
                  ? ` with ${quote.addOns.map((a) => a.name).join(", ")}`
                  : ""}{" "}
                for <strong>{formatCents(quote.totals.totalCents)}</strong>.
              </p>
            )}
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="signer-name" className="text-sm font-medium">
                  Your full name
                </label>
                <input
                  id="signer-name"
                  autoComplete="name"
                  className="h-12 rounded-xl border border-bb-border px-3 text-base"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="signer-email" className="text-sm font-medium">
                  Email for your signed copy (optional)
                </label>
                <input
                  id="signer-email"
                  type="email"
                  autoComplete="email"
                  className="h-12 rounded-xl border border-bb-border px-3 text-base"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span id="sig-label" className="text-sm font-medium">
                  Your signature
                </span>
                <SignaturePad labelId="sig-label" onChange={setSignature} disabled={pending} />
              </div>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-6 shrink-0 accent-bb-forest"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>{consent}</span>
              </label>
              {error && (
                <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={
                  pending ||
                  !name.trim() ||
                  !signature ||
                  !agreed ||
                  (kind === "estimate" && !quote)
                }
                className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-bb-forest text-lg font-semibold text-white disabled:opacity-50"
              >
                {pending && <Loader2 className="size-5 animate-spin" aria-hidden />}
                Accept &amp; sign
              </button>
              <p className="text-xs text-bb-ink/75">
                We record your name, signature, the time, and your device and network address with
                your signed copy.
              </p>
            </form>
            {kind === "estimate" && (
              <div className="mt-4 border-t border-bb-border pt-4">
                {declining ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor="decline-reason" className="text-sm font-medium">
                      Anything we should know? (optional)
                    </label>
                    <textarea
                      id="decline-reason"
                      rows={3}
                      className="rounded-xl border border-bb-border p-3 text-base"
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="min-h-11 rounded-xl border border-bb-border px-4 text-sm"
                        onClick={() => setDeclining(false)}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className="min-h-11 rounded-xl bg-bb-ink px-4 text-sm font-semibold text-white disabled:opacity-50"
                        onClick={decline}
                      >
                        Decline this proposal
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="min-h-11 text-sm text-bb-ink/70 underline"
                    onClick={() => setDeclining(true)}
                  >
                    Not going ahead? Let us know
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        <footer className="py-6 text-center text-xs text-bb-ink/75">
          {view.company.name} · {view.document.number}
        </footer>
      </main>
    </div>
  );
}
